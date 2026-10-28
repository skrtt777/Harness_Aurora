// The code models of the editor (app/codeAssist.js), each on a llama-server of its own beside the agent's:
// - "fim": a small coder trained for fill-in-the-middle (Qwen2.5-Coder 1.5B base, Apache 2.0, 1.6 GB) for
//   the gray suggestion, with the prompt cache reused from one keystroke to the next (--cache-reuse, as
//   llama.vscode does). Measured on 27/10 (scripts/code-bench.mjs): 77% → 87% right, 475 → 132 ms.
// - "strong": Qwen3-Coder-30B-A3B Instruct (Apache 2.0, 17.7 GB; a mixture of experts with 3B active per
//   token), for Ctrl+I and the gray suggestion when the person picks the "Forte" profile. --fit puts in
//   the video card what fits and leaves the rest of the experts in RAM (the idea of colibri, 28/10).
// The profile (settings code_model_profile) is "padrao" by default: the small coder for suggestions and
// the chat model for Ctrl+I. A model not downloaded, or one that does not start, falls back to that.
// Settings → Editor de código downloads them (checked by SHA-256) into the folder the person chooses.
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { bin, ollamaLibDir, pickDeviceDir, serverEnv, waitHealthy } from "./llamaServer.js";
import { protectPort } from "./agentTools/netGuard.js";
import { getSetting, setSetting } from "./store.js";

export const CODE_MODELS = {
  fim: {
    id: "fim", file: "qwen2.5-coder-1.5b-q8_0.gguf",
    url: "https://huggingface.co/ggml-org/Qwen2.5-Coder-1.5B-Q8_0-GGUF/resolve/main/qwen2.5-coder-1.5b-q8_0.gguf",
    sha256: "29871c94d15727a6e243f79a37113d4ae625a6215b5e800bf41a23af2da32832", bytes: 1646573056,
    license: "Apache-2.0", name: "Qwen2.5-Coder 1.5B", env: "AURORA_CODE_MODEL", port: 18182,
    args: ["-np", "2", "-c", "16384", "-fa", "on", "-b", "1024", "-ub", "1024", "--cache-reuse", "256"], gpuArgs: ["-ngl", "99"],
  },
  strong: {
    id: "strong", file: "Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf",
    url: "https://huggingface.co/unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF/resolve/main/Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf",
    sha256: "2841aa314d916434860cfb8990347528dcdfe5c350dbcb9d1461dbee88ff2533", bytes: 17665334432,
    license: "Apache-2.0", name: "Qwen3-Coder 30B-A3B", env: "AURORA_STRONG_CODE_MODEL", port: 18183,
    // --fit: as many layers and experts on the card as fit with 1.5 GB to spare; the rest in RAM.
    args: ["--jinja", "-np", "1", "-c", "16384", "-fa", "on", "-ctk", "q8_0", "-ctv", "q8_0", "--cache-reuse", "256", "--fit", "on", "--fit-target", "1536"], gpuArgs: [],
  },
};
/** Kept for the callers of 27/10: the small FIM model. */
export const CODE_MODEL = CODE_MODELS.fim;
export const PROFILES = ["padrao", "forte"];
const IDLE_STOP_MS = 20 * 60 * 1000;

/** The default folder: "aurora" beside Ollama's models (the person may choose another one). */
export function defaultCodeModelDir(env = process.env) {
  return join(dirname(env.OLLAMA_MODELS || join(homedir(), ".ollama", "models")), "aurora");
}
async function settings(env = process.env) {
  const dir = (await getSetting("code_model_dir").catch(() => null)) || null;
  const enabled = (await getSetting("code_model_enabled").catch(() => null)) !== "false";
  const saved = await getSetting("code_model_profile").catch(() => null);
  const profile = PROFILES.includes(env.AURORA_CODE_PROFILE) ? env.AURORA_CODE_PROFILE : PROFILES.includes(saved) ? saved : "padrao";
  return { dir, enabled, profile };
}
/** A model's file when it is there: its environment variable, the chosen folder, or the default one. */
export function codeModelPath(env = process.env, dir = null, model = CODE_MODELS.fim) {
  const candidates = [env[model.env], dir && join(dir, model.file), join(defaultCodeModelDir(env), model.file)].filter(Boolean);
  return candidates.find((p) => p !== "off" && existsSync(p) && statSync(p).size > 100_000_000) || null;
}

const servers = new Map();   // model id -> { baseUrl, child, ready, lastUsed, path, healthy }
let idle = null;

/**
 * Which model answers a role now: "fim" (the gray suggestion) or "edit" (Ctrl+I). { model, path } or
 * null (the chat model answers). The "forte" profile uses the strong model for both; "padrao" the small
 * coder for "fim" and nothing for "edit".
 */
export async function modelFor(role, env = process.env) {
  if (env.AURORA_CODE_MODEL === "off") return null;
  const s = await settings(env);
  if (s.profile === "forte") {
    const path = codeModelPath(env, s.dir, CODE_MODELS.strong);
    if (path) return { model: CODE_MODELS.strong, path };
  }
  if (role !== "fim" || (!s.enabled && !env.AURORA_CODE_MODEL)) return null;
  const path = codeModelPath(env, s.dir, CODE_MODELS.fim);
  return path ? { model: CODE_MODELS.fim, path } : null;
}

/** Base URL of the llama-server of the model for a role (started when needed), or null. */
export async function ensureCodeServer({ env = process.env, role = "fim" } = {}) {
  const pick = await modelFor(role, env);
  if (!pick) return null;
  const { model, path } = pick;
  const running = servers.get(model.id);
  if (running?.path === path) { running.lastUsed = Date.now(); return running.ready; }
  stopCodeServer(model.id);
  const libDir = ollamaLibDir(env);
  if (!libDir) return null;
  const port = Number(env[`${model.env}_PORT`]) || model.port;
  const baseUrl = `http://127.0.0.1:${port}`;
  protectPort(port);
  const entry = { path, baseUrl, child: null, lastUsed: Date.now(), ready: null, model: model.id };
  servers.set(model.id, entry);
  entry.ready = (async () => {
    const { dir, gpu } = await pickDeviceDir(libDir, { env });
    const args = ["-m", path, "--host", "127.0.0.1", "--port", String(port), "--alias", model.name, ...model.args, ...(gpu ? model.gpuArgs : [])];
    const child = spawn(bin(libDir), args, { cwd: dir, env: serverEnv(libDir, dir), stdio: "ignore", windowsHide: true });
    entry.child = child;
    child.on("exit", () => { if (servers.get(model.id) === entry) servers.delete(model.id); });
    // The strong model takes longer to load (17 GB from disk).
    if (!(await waitHealthy(baseUrl, child, model.id === "strong" ? 240_000 : 60_000))) { child.kill(); if (servers.get(model.id) === entry) servers.delete(model.id); return null; }
    entry.healthy = true;
    return baseUrl;
  })();
  if (!idle) {
    idle = setInterval(() => {
      for (const [id, s] of servers) if (Date.now() - s.lastUsed > IDLE_STOP_MS) stopCodeServer(id);
      if (!servers.size) { clearInterval(idle); idle = null; }
    }, 60_000);
    idle.unref?.();
  }
  return entry.ready;
}

/**
 * The models of the profile start loading now, without waiting (the VS Code extension calls it when it
 * connects: the strong model takes a minute or two from a hard disk, better before the first Ctrl+I).
 */
export async function warmCodeModels(env = process.env) {
  for (const role of ["edit", "fim"]) if (await modelFor(role, env).catch(() => null)) ensureCodeServer({ env, role }).catch(() => null);
  return codeModelStatus(env);
}

export function stopCodeServer(id = null) {
  for (const [key, s] of servers) if (!id || key === id) { servers.delete(key); s.child?.kill(); }
}
/** The server of the model a role uses now when it is up: { baseUrl, model, healthy } or null. */
export function codeServerInfo(id = "fim") {
  const s = servers.get(id);
  return s ? { path: s.path, baseUrl: s.baseUrl, healthy: Boolean(s.healthy), model: id, name: CODE_MODELS[id].name } : null;
}

/**
 * Ctrl+I on the strong model: the prompt as a chat message, the answer's text. Same shape as runLocal
 * ({ ok, text, metrics }), so app/codeAssist.js runs it the same way.
 */
export async function runOnCodeModel(baseUrl, prompt, { temperature = 0, maxTokens = 2048, signal } = {}) {
  const started = Date.now();
  try {
    const r = await fetch(`${baseUrl}/v1/chat/completions`, { method: "POST", signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: prompt }], temperature, max_tokens: maxTokens, cache_prompt: true }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: d.error?.message || `Modelo de código: HTTP ${r.status}` };
    return { ok: true, text: String(d.choices?.[0]?.message?.content || ""), metrics: { wallMs: Date.now() - started, model: CODE_MODELS.strong.name } };
  } catch (error) { return { ok: false, error: error.message, cancelled: Boolean(signal?.aborted) }; }
}

// ---- Settings → Editor de código: downloads, the folder, on/off, the profile ----
const downloads = new Map();   // model id -> { received, total, error, done, controller }

/** What the settings page shows. */
export async function codeModelStatus(env = process.env) {
  const s = await settings(env);
  const dir = s.dir || defaultCodeModelDir(env);
  const models = {};
  for (const m of Object.values(CODE_MODELS)) {
    const path = codeModelPath(env, s.dir, m);
    const d = downloads.get(m.id);
    models[m.id] = { name: m.name, license: m.license, bytes: m.bytes, path, installed: Boolean(path), running: Boolean(servers.get(m.id)?.healthy), loading: Boolean(servers.get(m.id) && !servers.get(m.id).healthy),
      download: d ? { received: d.received, total: d.total, error: d.error, done: d.done } : null };
  }
  const fim = models.fim;
  // The fields of 27/10 (the small model) stay at the top level for the settings page of 0.1.56.
  return { name: fim.name, license: fim.license, bytes: fim.bytes, dir, path: fim.path, installed: fim.installed, enabled: s.enabled, running: fim.running, download: fim.download, profile: s.profile, models };
}

/** The folder where the models go (a drive with room; the person's choice). */
export async function setCodeModelDir(dir) {
  const target = String(dir || "").trim();
  if (!target) throw Object.assign(new Error("Escolha uma pasta."), { status: 400 });
  mkdirSync(target, { recursive: true });
  await setSetting("code_model_dir", target);
  stopCodeServer();
  return codeModelStatus();
}
export async function setCodeModelEnabled(on) {
  await setSetting("code_model_enabled", on ? "true" : "false");
  if (!on) stopCodeServer("fim");
  return codeModelStatus();
}
/** "padrao" (the small coder + the chat model) or "forte" (the 30B-A3B for both). */
export async function setCodeModelProfile(profile) {
  if (!PROFILES.includes(profile)) throw Object.assign(new Error("Perfil inválido."), { status: 400 });
  await setSetting("code_model_profile", profile);
  if (profile !== "forte") stopCodeServer("strong");
  return codeModelStatus();
}

/**
 * Downloads a model into the folder, checked against its SHA-256 (a wrong file is deleted), in the
 * background; codeModelStatus().models[id].download follows it. A second call while it runs changes nothing.
 */
export async function startCodeModelDownload({ env = process.env, fetchImpl = globalThis.fetch, which = "fim" } = {}) {
  const model = CODE_MODELS[which];
  if (!model) throw Object.assign(new Error("Modelo desconhecido."), { status: 400 });
  const current = downloads.get(model.id);
  if (current && !current.done && !current.error) return codeModelStatus(env);
  const s = await settings(env);
  const dir = s.dir || defaultCodeModelDir(env);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, model.file), part = `${target}.part`;
  const state = { received: 0, total: model.bytes, error: null, done: false, controller: new AbortController() };
  downloads.set(model.id, state);
  (async () => {
    try {
      const response = await fetchImpl(model.url, { signal: state.controller.signal, redirect: "follow" });
      if (!response.ok || !response.body) throw new Error(`O download respondeu ${response.status}.`);
      state.total = Number(response.headers.get("content-length")) || model.bytes;
      const hash = createHash("sha256");
      const out = createWriteStream(part);
      for await (const chunk of response.body) {
        hash.update(chunk);
        state.received += chunk.length;
        if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
      }
      await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
      if (hash.digest("hex") !== model.sha256) { rmSync(part, { force: true }); throw new Error("O arquivo baixado não confere (SHA-256); foi apagado. Tente de novo."); }
      renameSync(part, target);
      state.done = true;
    } catch (error) {
      rmSync(part, { force: true });
      state.error = state.controller.signal.aborted ? "Download cancelado." : error.message;
    }
  })();
  return codeModelStatus(env);
}
export function cancelCodeModelDownload(which = null) {
  for (const [id, d] of downloads) if (!which || id === which) d.controller.abort();
}
