import { execFile, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { protectPort } from "./agentTools/netGuard.js";
import { cacheDir, learnPrefix, noteCacheUse, restoreSnapshot, snapshotKey } from "./llamaCache.js";

const ensureDir = (dir) => { mkdirSync(dir, { recursive: true }); return dir; };

/**
 * The local model served by llama-server for the agent, so several copies answer at once
 * (copies.js). Ollama does not run qwen3.5 in parallel ("model architecture does not currently
 * support parallel requests"): 4 answers took 3.7× one; llama-server with 4 slots, 1.6×
 * (docs/AVALIACAO_EMPRESA_2026-10-04.md). Nothing new to install or download: it is the
 * llama-server that ships inside Ollama, on the weights Ollama already has. Embeddings and the
 * rest stay on Ollama.
 */

const SLOTS = 4;
// Ollama unloads an idle model; this server must too, or it keeps ~4 GB of video memory while the
// person plays a game with the app open. It comes back in ~3 s at the next question.
const IDLE_STOP_MS = 10 * 60_000;
let server = null; // { model, baseUrl, child, ready: Promise<string|null>, lastUsed }
let idleTimer = null;
let failedAt = 0;
const RETRY_AFTER_MS = 10 * 60_000;

/** Ollama's bundled libraries: lib/ollama next to ollama.exe (Windows) or the install dir. */
export function ollamaLibDir(env = process.env) {
  const candidates = [
    env.OLLAMA_LIB_DIR,
    env.OLLAMA_BIN && join(dirname(env.OLLAMA_BIN), "lib", "ollama"),
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Programs", "Ollama", "lib", "ollama"),
    "C:\\Program Files\\Ollama\\lib\\ollama",
    "/usr/local/lib/ollama",
    "/usr/lib/ollama",
  ].filter(Boolean);
  return candidates.find((dir) => existsSync(join(dir, process.platform === "win32" ? "llama-server.exe" : "llama-server"))) || null;
}

/** The weights file Ollama downloaded for a model ("qwen3.5:4b"), from its manifest. */
export function ollamaModelBlob(model, env = process.env) {
  const dir = env.OLLAMA_MODELS || join(homedir(), ".ollama", "models");
  const [name, tag = "latest"] = String(model).split(":");
  const manifest = join(dir, "manifests", "registry.ollama.ai", ...(name.includes("/") ? name.split("/") : ["library", name]), tag);
  if (!existsSync(manifest)) return null;
  const layer = JSON.parse(readFileSync(manifest, "utf8")).layers?.find((l) => l.mediaType === "application/vnd.ollama.image.model");
  const blob = layer && join(dir, "blobs", layer.digest.replace(":", "-"));
  return blob && existsSync(blob) ? blob : null;
}

/**
 * The GPU backends live in subfolders (cuda_v13, cuda_v12, vulkan) and llama-server only sees
 * them when started from inside one. The first that lists a device wins; otherwise the CPU.
 */
export async function pickDeviceDir(libDir, { run = listDevices, env = process.env } = {}) {
  // The CPU build on purpose: a video driver that misbehaves, or measuring a PC without a GPU.
  if (env.LLAMA_FORCE_CPU === "1") return { dir: libDir, gpu: false };
  for (const sub of ["cuda_v13", "cuda_v12", "rocm_v7_1", "vulkan"]) {
    const dir = join(libDir, sub);
    if (!existsSync(dir)) continue;
    const out = await run(libDir, dir).catch(() => "");
    if (/Available devices:\s*\n\s*(?!\(none\))\S/.test(out)) return { dir, gpu: true, device: parseDevice(out) };
  }
  return { dir: libDir, gpu: false };
}

/** "CUDA0: NVIDIA GeForce RTX 4090 (23027 MiB, 21510 MiB free)" → name and memory in GB. */
export function parseDevice(listing) {
  const m = String(listing).match(/^\s*\w+\d*:\s*(.+?)\s*\((\d+)\s*MiB,\s*(\d+)\s*MiB free\)/m);
  return m ? { name: m[1], memoryGb: Math.round(Number(m[2]) / 1024), freeGb: Math.round(Number(m[3]) / 1024) } : null;
}

let gpuPromise = null;
/** The video card the local model would use, or null (CPU). Asked once per app run. */
export function detectGpu(env = process.env) {
  gpuPromise ||= (async () => {
    const libDir = ollamaLibDir(env);
    if (!libDir) return null;
    const picked = await pickDeviceDir(libDir, { env });
    return picked.gpu ? picked.device || { name: "placa de vídeo", memoryGb: null, freeGb: null } : null;
  })().catch(() => null);
  return gpuPromise;
}

const bin = (libDir) => join(libDir, process.platform === "win32" ? "llama-server.exe" : "llama-server");
const serverEnv = (libDir, dir) => ({ ...process.env, PATH: [dir, libDir, process.env.PATH].join(process.platform === "win32" ? ";" : ":") });

function listDevices(libDir, dir) {
  return new Promise((resolve) => execFile(bin(libDir), ["--list-devices"], { cwd: dir, env: serverEnv(libDir, dir), timeout: 20_000, windowsHide: true }, (error, stdout, stderr) => resolve(`${stdout}${stderr}`)));
}

async function waitHealthy(baseUrl, child, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try { if ((await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) })).ok) return true; } catch { /* still loading */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * Base URL of a running llama-server for `model`, starting it if needed; null when it cannot run
 * here (no bundled binary, weights not downloaded, failed to load) — the agent then stays on Ollama.
 * `contextTokens` is per copy: the server gets SLOTS times that.
 */
// 12k tokens per copy was too little: a PDF attachment, the rules and a redo went past it
// ("request (13792 tokens) exceeds the available context size", 04/10/2026).
const MIN_SLOT_TOKENS = 16384;
const LOG_LIMIT = 5_000_000;

/** llama-server.log next to the database (kept small: rotated to .old past 5 MB). It used to
 * run with no output at all, so a template error that dropped the agent left no trace. */
function serverLog(env) {
  try {
    const file = join(dirname(env.HARNESS_DB_FILE || process.env.HARNESS_DB_FILE || join(homedir(), ".aurora", "harness.db")), "llama-server.log");
    if (existsSync(file) && statSync(file).size > LOG_LIMIT) renameSync(file, `${file}.old`);
    return openSync(file, "a");
  } catch { return null; }
}

export async function ensureLlamaServer({ model, contextTokens = 16384, env = process.env, port = Number(env.LLAMA_SERVER_PORT) || 18181 } = {}) {
  if (!model) return null;
  scheduleIdleStop();
  if (server?.model === model) { server.lastUsed = Date.now(); return server.ready; }
  if (Date.now() - failedAt < RETRY_AFTER_MS) return null;
  stopLlamaServer();
  const libDir = ollamaLibDir(env);
  const blob = libDir && ollamaModelBlob(model, env);
  if (!blob) { failedAt = Date.now(); return null; }
  const baseUrl = `http://127.0.0.1:${port}`;
  // Like Ollama's port: unauthenticated and local, so the agent's browser and web_fetch never reach it.
  protectPort(port);
  const entry = { model, baseUrl, child: null, ready: null, lastUsed: Date.now() };
  server = entry;
  entry.ready = (async () => {
    const { dir, gpu } = await pickDeviceDir(libDir, { env });
    const args = ["-m", blob, "--jinja", "--host", "127.0.0.1", "--port", String(port), "--alias", model,
      "-np", String(SLOTS), "-c", String(Math.max(contextTokens, MIN_SLOT_TOKENS) * SLOTS), "-fa", "on", "-ctk", "q8_0", "-ctv", "q8_0", ...(gpu ? ["-ngl", "99"] : []),
      // Speculative decoding from n-grams already in the context (no draft model): the agent copies
      // rows from tool results into documents, and those come out 2.5x faster on GPU and ~5x on CPU,
      // same text (scripts/spec-bench.mjs, 05/10/2026). LLAMA_SPEC=off turns it off.
      ...(env.LLAMA_SPEC === "off" ? [] : ["--spec-type", "ngram-mod"]),
      // Partida instantânea (app/llamaCache.js): the fixed start of the prompt saved and restored here.
      ...(env.LLAMA_CACHE === "off" ? [] : ["--slot-save-path", ensureDir(cacheDir(env))]),
      // Experiments (benchmarks of speculative decoding, sampling…) without touching the code.
      ...String(env.LLAMA_SERVER_EXTRA_ARGS || "").split(/\s+/).filter(Boolean)];
    const log = serverLog(env);
    const child = spawn(bin(libDir), args, { cwd: dir, env: serverEnv(libDir, dir), stdio: ["ignore", log ?? "ignore", log ?? "ignore"], windowsHide: true });
    if (log !== null) closeSync(log);
    entry.child = child;
    child.on("exit", () => { if (server === entry) server = null; });
    const ok = await waitHealthy(baseUrl, child);
    if (!ok) { child.kill(); if (server === entry) server = null; failedAt = Date.now(); return null; }
    entry.gpu = gpu;
    entry.cacheKey = snapshotKey(model, blob, bin(libDir));
    if (env.LLAMA_CACHE !== "off") entry.restored = await restoreSnapshot(baseUrl, { key: entry.cacheKey, slots: SLOTS, env });
    entry.env = env;
    return baseUrl;
  })();
  return entry.ready;
}

function scheduleIdleStop() {
  if (idleTimer) return;
  idleTimer = setInterval(() => {
    if (!server) { clearInterval(idleTimer); idleTimer = null; return; }
    if (Date.now() - server.lastUsed > IDLE_STOP_MS) stopLlamaServer();
  }, 60_000);
  idleTimer.unref?.();
}

export function stopLlamaServer() {
  const current = server;
  server = null;
  current?.child?.kill();
}

/** After an answer from this server: was the restored start used, and learn it if none is saved. */
export function afterLlamaAnswer(baseUrl, body, cachedTokens) {
  const current = server;
  if (!current || current.baseUrl !== baseUrl || !current.cacheKey || current.env?.LLAMA_CACHE === "off") return;
  // Only the agent's requests share the saved start (a plain chat has another one).
  if (body?.tools?.length) noteCacheUse(baseUrl, cachedTokens);
  void learnPrefix(baseUrl, body, { key: current.cacheKey, env: current.env });
}

export const llamaServerInfo = () => (server ? { model: server.model, baseUrl: server.baseUrl, gpu: Boolean(server.gpu), slots: SLOTS, restoredTokens: server.restored || 0 } : null);

// The server belongs to this app: it closes with it.
process.once("exit", stopLlamaServer);
