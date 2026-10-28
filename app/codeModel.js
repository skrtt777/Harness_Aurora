// The code model of the gray suggestion (app/codeAssist.js): a small coder trained for fill-in-the-middle
// (Qwen2.5-Coder 1.5B base, Apache 2.0, 1.6 GB), served by a second llama-server of its own beside the
// agent's, with the prompt cache reused from one keystroke to the next (--cache-reuse, as llama.vscode
// does). Optional: without the file, the suggestion uses the chat model as before.
import { existsSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { bin, ollamaLibDir, pickDeviceDir, serverEnv, waitHealthy } from "./llamaServer.js";
import { protectPort } from "./agentTools/netGuard.js";

export const CODE_MODEL = {
  file: "qwen2.5-coder-1.5b-q8_0.gguf",
  url: "https://huggingface.co/ggml-org/Qwen2.5-Coder-1.5B-Q8_0-GGUF/resolve/main/qwen2.5-coder-1.5b-q8_0.gguf",
  sha256: "29871c94d15727a6e243f79a37113d4ae625a6215b5e800bf41a23af2da32832",
  bytes: 1646573056,
  license: "Apache-2.0",
  name: "Qwen2.5-Coder 1.5B",
};
const IDLE_STOP_MS = 20 * 60 * 1000;

/** Where the code model lives: AURORA_CODE_MODEL, or the "aurora" folder beside Ollama's models. */
export function codeModelDir(env = process.env) {
  return join(dirname(env.OLLAMA_MODELS || join(homedir(), ".ollama", "models")), "aurora");
}
export function codeModelPath(env = process.env) {
  const candidates = [env.AURORA_CODE_MODEL, join(codeModelDir(env), CODE_MODEL.file)].filter(Boolean);
  return candidates.find((p) => existsSync(p) && statSync(p).size > 100_000_000) || null;
}

let server = null;   // { baseUrl, child, ready, lastUsed, path }
let idle = null;

/** Base URL of the code model's llama-server (started when needed), or null when there is no model. */
export async function ensureCodeServer({ env = process.env, port = Number(env.CODE_SERVER_PORT) || 18182 } = {}) {
  if (env.AURORA_CODE_MODEL === "off") return null;
  const path = codeModelPath(env);
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
