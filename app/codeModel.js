// The code model of the gray suggestion (app/codeAssist.js): a small coder trained for fill-in-the-middle
// (Qwen2.5-Coder 1.5B base, Apache 2.0, 1.6 GB), served by a second llama-server of its own beside the
// agent's, with the prompt cache reused from one keystroke to the next (--cache-reuse, as llama.vscode
// does). Optional: without it the suggestion uses the chat model. Settings → Editor de código downloads
// it (checked by SHA-256) into the folder the person chooses (settings code_model_dir), and turns it
// on or off (code_model_enabled). Measured on 27/10 (scripts/code-bench.mjs): 77% → 87% right, 475 →
// 132 ms per suggestion.
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { bin, ollamaLibDir, pickDeviceDir, serverEnv, waitHealthy } from "./llamaServer.js";
import { protectPort } from "./agentTools/netGuard.js";
import { getSetting, setSetting } from "./store.js";

export const CODE_MODEL = {
  file: "qwen2.5-coder-1.5b-q8_0.gguf",
  url: "https://huggingface.co/ggml-org/Qwen2.5-Coder-1.5B-Q8_0-GGUF/resolve/main/qwen2.5-coder-1.5b-q8_0.gguf",
  sha256: "29871c94d15727a6e243f79a37113d4ae625a6215b5e800bf41a23af2da32832",
  bytes: 1646573056,
  license: "Apache-2.0",
  name: "Qwen2.5-Coder 1.5B",
};
const IDLE_STOP_MS = 20 * 60 * 1000;

/** The default folder: "aurora" beside Ollama's models (the person may choose another one). */
export function defaultCodeModelDir(env = process.env) {
  return join(dirname(env.OLLAMA_MODELS || join(homedir(), ".ollama", "models")), "aurora");
}
async function settings() {
  const dir = (await getSetting("code_model_dir").catch(() => null)) || null;
  const enabled = (await getSetting("code_model_enabled").catch(() => null)) !== "false";
  return { dir, enabled };
}
/** The model file when it is there: AURORA_CODE_MODEL, or the chosen folder, or the default one. */
export function codeModelPath(env = process.env, dir = null) {
  const candidates = [env.AURORA_CODE_MODEL, dir && join(dir, CODE_MODEL.file), join(defaultCodeModelDir(env), CODE_MODEL.file)].filter(Boolean);
  return candidates.find((p) => p !== "off" && existsSync(p) && statSync(p).size > 100_000_000) || null;
}

let server = null;   // { baseUrl, child, ready, lastUsed, path }
let idle = null;

/** Base URL of the code model's llama-server (started when needed), or null when there is no model. */
export async function ensureCodeServer({ env = process.env, port = Number(env.CODE_SERVER_PORT) || 18182 } = {}) {
  if (env.AURORA_CODE_MODEL === "off") return null;
  const s = await settings();
  if (!s.enabled && !env.AURORA_CODE_MODEL) return null;
  const path = codeModelPath(env, s.dir);
  if (!path) return null;
  if (server?.path === path) { server.lastUsed = Date.now(); return server.ready; }
  stopCodeServer();
  const libDir = ollamaLibDir(env);
  if (!libDir) return null;
  const baseUrl = `http://127.0.0.1:${port}`;
  protectPort(port);
  const entry = { path, baseUrl, child: null, lastUsed: Date.now(), ready: null };
  server = entry;
  entry.ready = (async () => {
    const { dir, gpu } = await pickDeviceDir(libDir, { env });
    const args = ["-m", path, "--host", "127.0.0.1", "--port", String(port), "-np", "2", "-c", "16384", "-fa", "on",
      "-b", "1024", "-ub", "1024", "--cache-reuse", "256", ...(gpu ? ["-ngl", "99"] : [])];
    const child = spawn(bin(libDir), args, { cwd: dir, env: serverEnv(libDir, dir), stdio: "ignore", windowsHide: true });
    entry.child = child;
    child.on("exit", () => { if (server === entry) server = null; });
    if (!(await waitHealthy(baseUrl, child, 60_000))) { child.kill(); if (server === entry) server = null; return null; }
    entry.healthy = true;
    return baseUrl;
  })();
  if (!idle) {
    idle = setInterval(() => { if (server && Date.now() - server.lastUsed > IDLE_STOP_MS) stopCodeServer(); if (!server) { clearInterval(idle); idle = null; } }, 60_000);
    idle.unref?.();
  }
  return entry.ready;
}

export function stopCodeServer() { const s = server; server = null; s?.child?.kill(); }
export const codeServerInfo = () => (server ? { path: server.path, baseUrl: server.baseUrl, healthy: Boolean(server.healthy) } : null);

// ---- Settings → Editor de código: the download, the folder, on/off ----
let download = null;   // { received, total, error, done, controller }

/** What the settings page shows. */
export async function codeModelStatus(env = process.env) {
  const s = await settings();
  const dir = s.dir || defaultCodeModelDir(env);
  const path = codeModelPath(env, s.dir);
  return {
    name: CODE_MODEL.name, license: CODE_MODEL.license, bytes: CODE_MODEL.bytes,
    dir, path, installed: Boolean(path), enabled: s.enabled, running: Boolean(codeServerInfo()?.healthy),
    download: download ? { received: download.received, total: download.total, error: download.error, done: download.done } : null,
  };
}

/** The folder where the model goes (a drive with room; the person's choice). */
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
  if (!on) stopCodeServer();
  return codeModelStatus();
}

/**
 * Downloads the model into the folder, checked against its SHA-256 (a wrong file is deleted), in the
 * background; codeModelStatus().download follows it. A second call while it runs changes nothing.
 */
export async function startCodeModelDownload({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (download && !download.done && !download.error) return codeModelStatus(env);
  const s = await settings();
  const dir = s.dir || defaultCodeModelDir(env);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, CODE_MODEL.file), part = `${target}.part`;
  const state = { received: 0, total: CODE_MODEL.bytes, error: null, done: false, controller: new AbortController() };
  download = state;
  (async () => {
    try {
      const response = await fetchImpl(CODE_MODEL.url, { signal: state.controller.signal, redirect: "follow" });
      if (!response.ok || !response.body) throw new Error(`O download respondeu ${response.status}.`);
      state.total = Number(response.headers.get("content-length")) || CODE_MODEL.bytes;
      const hash = createHash("sha256");
      const out = createWriteStream(part);
      for await (const chunk of response.body) {
        hash.update(chunk);
        state.received += chunk.length;
        if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
      }
      await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
      if (hash.digest("hex") !== CODE_MODEL.sha256) { rmSync(part, { force: true }); throw new Error("O arquivo baixado não confere (SHA-256); foi apagado. Tente de novo."); }
      renameSync(part, target);
      state.done = true;
    } catch (error) {
      rmSync(part, { force: true });
      state.error = state.controller.signal.aborted ? "Download cancelado." : error.message;
    }
  })();
  return codeModelStatus(env);
}
export function cancelCodeModelDownload() { download?.controller.abort(); }
