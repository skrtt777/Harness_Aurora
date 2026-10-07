// Partida instantânea: the fixed start of the agent's prompt (tool list and rules, ~7k tokens) is
// read by the model once and kept on disk; every time the server starts again (it stops after 10
// minutes idle) the slots get it back in a fraction of a second instead of re-reading it.
// Measured with a real agent request (scripts/cache-lab.mjs, 07/10): processor only, first answer
// after a restart 68-74 s -> 1.3 s; RTX 4090 0.9 s -> 0.2 s. The idea is Strata's "keep the
// conversation, read only what is new", carried across restarts.
//
// The model (qwen3.5) has recurrent layers: a saved state can be extended but never cut back, so
// what is saved is exactly the fixed start (up to the end of the rules), with nothing generated
// after it. When the rules or tools change, the restored start stops matching, the cache hit says
// so, and it is learned again from the next agent request.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIN_PREFIX_TOKENS = 1500;
const state = new Map();
const status = (baseUrl) => { if (!state.has(baseUrl)) state.set(baseUrl, { saved: false, prev: null, busy: false, restored: 0, stale: false }); return state.get(baseUrl); };

/** Where the saved starts live: "llama-cache" next to the database. */
export function cacheDir(env = process.env) {
  if (env.LLAMA_CACHE_DIR || process.env.LLAMA_CACHE_DIR) return env.LLAMA_CACHE_DIR || process.env.LLAMA_CACHE_DIR;
  return join(dirname(env.HARNESS_DB_FILE || process.env.HARNESS_DB_FILE || join(homedir(), ".aurora", "harness.db")), "llama-cache");
}

/** One saved start per model file and server build: a new model or llama.cpp version never reads an old one. */
export function snapshotKey(model, blob, binary) {
  const id = [model, blob, ...[blob, binary].map((f) => { try { const s = statSync(f); return `${s.size}:${s.mtimeMs}`; } catch { return "?"; } })].join("|");
  return createHash("sha256").update(id).digest("hex").slice(0, 16);
}

const post = async (url, body) => { const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }); return { ok: r.ok, data: await r.json().catch(() => ({})) }; };
const metaFile = (env, key) => join(cacheDir(env), `${key}.json`);

/** At server start: the saved start goes into every slot. Returns how many tokens each slot got (0: none saved). */
export async function restoreSnapshot(baseUrl, { key, slots, env = process.env }) {
  const s = status(baseUrl);
  try {
    const meta = JSON.parse(readFileSync(metaFile(env, key), "utf8"));
    if (!existsSync(join(cacheDir(env), meta.file))) return 0;
    let restored = 0;
    for (let id = 0; id < slots; id += 1) {
      const { ok, data } = await post(`${baseUrl}/slots/${id}?action=restore`, { filename: meta.file });
      if (ok) restored = data.n_restored || meta.tokens;
    }
    s.restored = restored;
    s.saved = restored > 0;
    return restored;
  } catch { return 0; }
}

/** After an answer: did the restored start get used? A request that read much less from the cache means it is stale. */
export function noteCacheUse(baseUrl, cachedTokens) {
  const s = status(baseUrl);
  if (!s.restored || cachedTokens == null) return;
  if (cachedTokens < s.restored * 0.8) { s.stale = true; s.saved = false; }
  s.restored = 0; // only the first answer after the restore tells
}

/** Longest common prefix of two token lists. */
export function commonPrefix(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
  return n;
}

// The agent's prompt starts with its rules (runtime-policy/AGENT.md), after the tool list; what
// follows changes every turn (the time, the briefing, the question). Learning the start as the common
// prefix of two requests of one turn took the time and the question too, and the next session could
// not use it (the state cannot be cut back): the cut is the end of the rules.
const RULES = (() => { try { return readFileSync(fileURLToPath(new URL("./runtime-policy/AGENT.md", import.meta.url)), "utf8"); } catch { return ""; } })();

/** Learns and saves the fixed start from an agent request (call after a successful one, not awaited). */
export async function learnPrefix(baseUrl, body, { key, env = process.env, rules = RULES, idleCheckMs = 5000 } = {}) {
  const s = status(baseUrl);
  if ((s.saved && !s.stale) || s.busy || !body?.tools?.length || !rules) return null;
  const system = body.messages?.find((m) => m.role === "system")?.content;
  const at = typeof system === "string" ? system.indexOf(rules.trim().slice(0, 400)) : -1;
  if (at < 0) return null;
  s.busy = true;
  try {
    const { data: rendered } = await post(`${baseUrl}/apply-template`, { messages: body.messages, tools: body.tools, chat_template_kwargs: body.chat_template_kwargs });
    const full = rendered?.prompt || "";
    const systemAt = full.indexOf(system.slice(0, 400));
    if (systemAt < 0) return null;
    const staticText = full.slice(0, systemAt + at + rules.trim().length);
    const tokenize = async (content) => (await post(`${baseUrl}/tokenize`, { content, add_special: false, parse_special: true })).data.tokens || [];
    // The start's own tokens can differ at the very end from the full prompt's (a merged newline):
    // what is kept is what both share.
    const [part, whole] = [await tokenize(staticText), await tokenize(full)];
    const common = commonPrefix(part, whole);
    if (common < MIN_PREFIX_TOKENS) return null;
    // Reading that start takes ~60 s on a processor: done only when every slot is idle, so it never
    // slows an answer the person is waiting for (checked every few seconds, up to 10 minutes).
    let slots = [];
    for (let waited = 0; ; waited += idleCheckMs) {
      slots = await fetch(`${baseUrl}/slots`).then((r) => r.json()).catch(() => []);
      if (slots.length && slots.every((x) => !x.is_processing)) break;
      if (waited >= 600_000) return null;
      await new Promise((r) => setTimeout(r, idleCheckMs));
    }
    // An idle slot reads exactly that start, generating nothing, and saves it.
    const idle = slots.at(-1);
    const warm = await post(`${baseUrl}/completion`, { prompt: whole.slice(0, common), n_predict: 0, id_slot: idle.id, cache_prompt: true });
    if (!warm.ok) return null;
    mkdirSync(cacheDir(env), { recursive: true });
    const file = `${key}.bin`;
    const saved = await post(`${baseUrl}/slots/${idle.id}?action=save`, { filename: file });
    if (!saved.ok) return null;
    writeFileSync(metaFile(env, key), JSON.stringify({ file, tokens: common, savedAt: new Date().toISOString() }));
    s.saved = true;
    s.stale = false;
    return common;
  } catch { return null; } finally { s.busy = false; }
}

export const _state = state;
