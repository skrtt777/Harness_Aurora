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
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIN_PREFIX_TOKENS = 1500;
const state = new Map();
const status = (baseUrl) => { if (!state.has(baseUrl)) state.set(baseUrl, { saved: false, prev: null, busy: false, restored: 0, stale: false, sigs: new Map(), lastTokens: null, slot: null }); return state.get(baseUrl); };

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

// One saved start per tool set (14/10/2026): the tools come before the rules in the prompt, and since the
// tools change with the subject (app/toolRouter.js) one start covered only requests with the very same
// tools; on a processor every other one re-read 3-7k tokens (~55 s). Each set has its own start, and
// before an agent request on a one-slot server the right one is put back when the slot holds another.
export function toolSignature(body) {
  const names = (body?.tools || []).map((t) => t?.function?.name || t?.name || "").join(",");
  return createHash("sha256").update(names).digest("hex").slice(0, 10);
}
const hashTokens = (tokens) => createHash("sha256").update(Buffer.from(Int32Array.from(tokens).buffer)).digest("hex").slice(0, 16);
const sigOf = (s, sig) => { if (!s.sigs.has(sig)) s.sigs.set(sig, { saved: false, stale: false }); return s.sigs.get(sig); };
const readMeta = (env, name) => { try { return JSON.parse(readFileSync(metaFile(env, name), "utf8")); } catch { return null; } };
const slotKeys = (env, key) => { try { return readdirSync(cacheDir(env)).filter((f) => f.startsWith(`${key}-`) && f.endsWith(".json")).map((f) => f.slice(0, -5)); } catch { return []; } };
const MAX_STARTS = 6;

/** At server start: the start used last goes into every slot. Returns how many tokens each slot got (0: none saved). */
export async function restoreSnapshot(baseUrl, { key, slots, env = process.env }) {
  const s = status(baseUrl);
  try {
    const names = slotKeys(env, key);
    const metas = names.map((name) => ({ name, meta: readMeta(env, name) })).filter((x) => x.meta && existsSync(join(cacheDir(env), x.meta.file)));
    if (!metas.length) return 0;
    const { name, meta } = metas.sort((a, b) => String(b.meta.usedAt || b.meta.savedAt).localeCompare(String(a.meta.usedAt || a.meta.savedAt)))[0];
    let restored = 0;
    for (let id = 0; id < slots; id += 1) {
      const { ok, data } = await post(`${baseUrl}/slots/${id}?action=restore`, { filename: meta.file });
      if (ok) restored = data.n_restored || meta.tokens;
    }
    const sig = name.slice(key.length + 1);
    s.restored = restored;
    s.restoredSig = sig;
    s.saved = restored > 0;
    sigOf(s, sig).saved = restored > 0;
    s.slot = restored > 0 ? { hash: meta.hash, tokens: meta.tokens } : null;
    return restored;
  } catch { return 0; }
}

/** After an answer: did the restored start get used? A request that read much less from the cache means it is stale. */
export function noteCacheUse(baseUrl, cachedTokens) {
  const s = status(baseUrl);
  if (!s.restored || cachedTokens == null) return;
  if (cachedTokens < s.restored * 0.8) {
    s.stale = true; s.saved = false;
    if (s.restoredSig) { const x = sigOf(s, s.restoredSig); x.stale = true; x.saved = false; }
  }
  s.restored = 0; // only the first answer after the restore tells
}

/** A request this module did not prepare went to the server (a title, a summary): the one slot holds something else now. */
export function markSlotUnknown(baseUrl) { const s = status(baseUrl); s.lastTokens = null; s.slot = null; s.lastActivity = Date.now(); }

const promptTokens = async (baseUrl, body) => {
  const { data: rendered } = await post(`${baseUrl}/apply-template`, { messages: body.messages, tools: body.tools, chat_template_kwargs: body.chat_template_kwargs });
  if (!rendered?.prompt) return null;
  return (await post(`${baseUrl}/tokenize`, { content: rendered.prompt, add_special: false, parse_special: true })).data.tokens || null;
};

/**
 * Before an agent request on a one-slot server: when the slot does not start with this request's saved
 * start (another conversation, other tools, a title in between), that start is put back from disk (~1 s
 * on a processor, against ~55 s of reading it again). Returns the tokens put back (0: nothing done).
 */
export async function prepareSlot(baseUrl, body, { key, slots = 1, env = process.env } = {}) {
  if (slots !== 1 || !body?.tools?.length || !key) return 0;
  const s = status(baseUrl);
  if (s.learning) await s.learning;
  s.lastActivity = Date.now();
  try {
    const name = `${key}-${toolSignature(body)}`;
    const meta = readMeta(env, name);
    const tokens = await promptTokens(baseUrl, body);
    if (!tokens) return 0;
    const last = s.lastTokens;
    s.lastTokens = tokens;
    if (!meta?.hash || !existsSync(join(cacheDir(env), meta.file)) || tokens.length < meta.tokens) return 0;
    if (env.LLAMA_CACHE_DEBUG) writeFileSync(`${env.LLAMA_CACHE_DEBUG}.body${(s.dumped = (s.dumped || 0) + 1)}.json`, JSON.stringify(body));
    if (env.LLAMA_CACHE_DEBUG) appendFileSync(env.LLAMA_CACHE_DEBUG, `${new Date().toISOString()} prepare ${name} tokens=${tokens.length} meta=${meta.tokens} match=${hashTokens(tokens.slice(0, meta.tokens)) === meta.hash} lastCommon=${last ? commonPrefix(tokens, last) : "-"} slot=${s.slot?.hash === meta.hash}
`);
    if (hashTokens(tokens.slice(0, meta.tokens)) !== meta.hash) return 0; // this request does not start with it
    // The recurrent state can only be extended: the slot serves this request as it is when the request
    // goes on from the last one, or shares much more than the start (the server's own checkpoints are
    // near the end of the last prompt). Diverging right after the start (another conversation) it cannot.
    const shared = last ? commonPrefix(tokens, last) : 0;
    if (last && (shared >= last.length - 8 || shared > meta.tokens + 256)) return 0;
    if (!last && s.slot?.hash === meta.hash) return 0; // put there at the start
    const { ok, data } = await post(`${baseUrl}/slots/0?action=restore`, { filename: meta.file });
    if (env.LLAMA_CACHE_DEBUG) appendFileSync(env.LLAMA_CACHE_DEBUG, `  restore ok=${ok} ${JSON.stringify(data).slice(0, 300)}
`);
    if (!ok) return 0;
    s.slot = { hash: meta.hash, tokens: meta.tokens };
    s.restored = data.n_restored || meta.tokens;
    s.restoredSig = name.slice(key.length + 1);
    try { writeFileSync(metaFile(env, name), JSON.stringify({ ...meta, usedAt: new Date().toISOString() })); } catch { /* the start still works */ }
    return s.restored;
  } catch { return 0; }
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

/** Learns and saves the fixed start of this request's tool set (call after a successful agent request, not awaited). */
export async function learnPrefix(baseUrl, body, { key, env = process.env, rules = RULES, idleCheckMs = 5000, quietMs = 20_000 } = {}) {
  const s = status(baseUrl);
  s.lastActivity = Date.now(); // called right after an answer
  if (!body?.tools?.length || !rules) return null;
  const sig = toolSignature(body);
  const name = `${key}-${sig}`;
  const own = sigOf(s, sig);
  if (!own.saved && !own.stale && readMeta(env, name)?.hash) own.saved = true; // saved by an earlier session
  if ((own.saved && !own.stale) || s.busy) return null;
  const system = body.messages?.find((m) => m.role === "system")?.content;
  const at = typeof system === "string" ? system.indexOf(rules.trim().slice(0, 400)) : -1;
  if (at < 0) return null;
  s.busy = true;
  let learned = () => {};
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
      // Between turns: idle slots and no request for a while (the agent goes on calling within a turn).
      if (slots.length && slots.every((x) => !x.is_processing) && Date.now() - (s.lastActivity || 0) >= quietMs) break;
      if (waited >= 600_000) return null;
      await new Promise((r) => setTimeout(r, idleCheckMs));
    }
    // An idle slot reads exactly that start, generating nothing, and saves it.
    const idle = slots.at(-1);
    // Emptied first: the state only grows, and a slot that held a conversation saved the start plus that
    // conversation (4551 tokens for a 3050 start), which no other conversation could use (14/10).
    // A one-slot server answers in order: a request sent while the start is read would run before the save
    // and go into the saved file (4540 tokens for a 3050 start, 14/10). Requests wait for it (prepareSlot).
    s.learning = new Promise((done) => { learned = done; });
    await post(`${baseUrl}/slots/${idle.id}?action=erase`, {});
    const warm = await post(`${baseUrl}/completion`, { prompt: whole.slice(0, common), n_predict: 0, id_slot: idle.id, cache_prompt: true });
    if (!warm.ok) return null;
    mkdirSync(cacheDir(env), { recursive: true });
    const file = `${name}.bin`;
    const saved = await post(`${baseUrl}/slots/${idle.id}?action=save`, { filename: file });
    if (!saved.ok) return null;
    writeFileSync(metaFile(env, name), JSON.stringify({ file, tokens: common, hash: hashTokens(whole.slice(0, common)), tools: (body.tools || []).map((t) => t?.function?.name || t?.name), savedAt: new Date().toISOString() }));
    // The slot now holds exactly that start (the request's own continuation is gone from it).
    if (slots.length === 1) { s.slot = { hash: hashTokens(whole.slice(0, common)), tokens: common }; s.lastTokens = null; }
    own.saved = true; own.stale = false;
    s.saved = true; s.stale = false;
    pruneStarts(env, key);
    return common;
  } catch { return null; } finally { s.busy = false; s.learning = null; learned(); }
}

/** At most MAX_STARTS saved starts per model (~120 MB each): the ones used longest ago go. */
function pruneStarts(env, key) {
  try {
    const metas = slotKeys(env, key).map((name) => ({ name, meta: readMeta(env, name) })).filter((x) => x.meta);
    metas.sort((a, b) => String(b.meta.usedAt || b.meta.savedAt).localeCompare(String(a.meta.usedAt || a.meta.savedAt)));
    for (const { name, meta } of metas.slice(MAX_STARTS)) {
      for (const f of [meta.file, `${name}.json`]) { try { unlinkSync(join(cacheDir(env), f)); } catch { /* gone */ } }
    }
  } catch { /* the cache still works */ }
}

export const _state = state;
