import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getSetting, setSetting } from "./store.js";
import {automaticLocalModel} from './localModelRelease.js';

// A small model that runs acceptably on a CPU-only laptop is the point of
// this whole feature: the user should never have to know a model name
// exists before the app is useful. Power users can override via LOCAL_MODEL
// (wins over everything, for packaging/dev) or by picking one of
// CURATED_MODELS in the UI, which is stored via setSetting/local_model.
export const DEFAULT_LOCAL_MODEL = "qwen2.5-coder:1.5b";

// Shown as a "trocar modelo" picker for users who want a stronger model and
// know they have the RAM for it. Sizes are the approximate download size of
// the quantized weights Ollama pulls, not RAM usage (roughly the same order
// of magnitude for these).
export const CURATED_MODELS = [
  { id: "qwen2.5-coder:1.5b", label: "Padrão — leve e rápido", size: "~1 GB", recommendedRamGb: 4 },
  { id: "llama3.2:3b", label: "Equilibrado", size: "~2 GB", recommendedRamGb: 8 },
  { id: "qwen2.5-coder:7b", label: "Mais forte — melhor em código", size: "~4.7 GB", recommendedRamGb: 16 },
  { id: "llama3.1:8b", label: "Mais forte — uso geral", size: "~4.7 GB", recommendedRamGb: 16 },
];

function defaultBaseUrl(env) {
  return env.LOCAL_BASE_URL || "http://127.0.0.1:11434";
}

/**
 * Resolution order: LOCAL_MODEL env (dev/packaging override) > the model the
 * user picked in the UI (persisted in the settings table) > the built-in
 * default. This is what makes "escolher um modelo mais forte" work without
 * touching env vars.
 */
export async function resolveLocalModel(env = process.env) {
  if (env.LOCAL_MODEL) return env.LOCAL_MODEL;
  const stored = await getSetting("local_model");
  if(stored && stored!=='auto')return stored;
  return await automaticLocalModel(env) || DEFAULT_LOCAL_MODEL;
}

export async function setLocalModel(model) {
  const trimmed = String(model || "").trim();
  if (!trimmed) throw new Error("Informe o nome do modelo.");
  await setSetting("local_model", trimmed);
  return trimmed;
}

function which(bin, env) {
  return new Promise((resolve) => {
    execFile(bin, ["--version"], { windowsHide: true, timeout: 5000, env: { ...process.env, ...env } }, (error) => {
      resolve(!error);
    });
  });
}

// The Windows installer adds Ollama to the per-user PATH, but this
// already-running process's `process.env.PATH` was captured before that —
// so right after a fresh install, `execFile("ollama", ...)` still fails
// even though it is, in fact, installed. Falling back to the known default
// install location catches exactly that case.
function windowsDefaultBin(env) {
  const base = env.LOCALAPPDATA || process.env.LOCALAPPDATA;
  if (!base) return null;
  const candidate = join(base, "Programs", "Ollama", "ollama.exe");
  return existsSync(candidate) ? candidate : null;
}

export async function resolveOllamaBin(env = process.env) {
  const configured = env.OLLAMA_BIN;
  if (configured) return configured;
  if (await which("ollama", env)) return "ollama";
  if (process.platform === "win32") {
    const winBin = windowsDefaultBin(env);
    if (winBin) return winBin;
  }
  return "ollama";
}

export async function isOllamaInstalled(env = process.env) {
  if (await which(await resolveOllamaBin(env), env)) return true;
  if (process.platform === "win32") return Boolean(windowsDefaultBin(env));
  return false;
}

export async function isServerUp(baseUrl, signal) {
  try {
    const timeout = AbortSignal.timeout(2000);
    const response = await fetch(`${baseUrl}/api/version`, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    await response.body?.cancel();
    return response.ok;
  } catch { return false; }
}

export async function waitForServerUp(baseUrl, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isServerUp(baseUrl)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

export async function startOllamaServer(env = process.env) {
  const bin = await resolveOllamaBin(env);
  const child = spawn(bin, ["serve"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, ...env },
  });
  await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  // Detached + unref: the server keeps running as its own background
  // process even after the Harness app (and this Node process) closes,
  // which is what makes the next launch instant instead of repeating setup.
  child.unref();
  return child;
}

async function installOllamaWindows(onProgress) {
  onProgress({ stage: "downloading-installer" });
  const installerPath = join(tmpdir(), "OllamaSetup.exe");
  const response = await fetch("https://ollama.com/download/OllamaSetup.exe", { signal: AbortSignal.timeout(300000) });
  if (!response.ok) {
    return { ok: false, error: `Não foi possível baixar o instalador do Ollama (HTTP ${response.status}).` };
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(installerPath, buffer);

  onProgress({ stage: "installing" });
  return new Promise((resolve) => {
    // /VERYSILENT + /SP- skip every dialog and the "select components"
    // splash; /NORESTART matters because this runs while the Harness app
    // itself is open. No admin rights needed — Ollama installs per-user.
    execFile(
      installerPath,
      ["/VERYSILENT", "/NORESTART", "/SP-"],
      { windowsHide: true, timeout: 5 * 60_000 },
      (error) => {
        if (error) resolve({ ok: false, error: `O instalador do Ollama terminou com erro: ${error.message}` });
        else resolve({ ok: true });
      },
    );
  });
}

async function installOllamaLinux(onProgress) {
  onProgress({ stage: "installing" });
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", "curl -fsSL https://ollama.com/install.sh | sh"], { stdio: "ignore" });
    child.on("error", (error) => resolve({ ok: false, error: `Falha ao instalar o Ollama: ${error.message}` }));
    child.on("exit", (code) => {
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, error: `O instalador do Ollama terminou com código ${code}.` });
    });
  });
}

async function installOllama(onProgress) {
  const platform = process.platform;
  if (platform === "win32") return installOllamaWindows(onProgress);
  if (platform === "linux") return installOllamaLinux(onProgress);
  // macOS ships Ollama as a signed .app in a .zip; installing it silently
  // from outside the App/Gatekeeper flow is unreliable, so this is the one
  // platform where we ask for one manual step instead of guessing wrong.
  return {
    ok: false,
    manual: true,
    url: "https://ollama.com/download/mac",
    error: "No Mac, abra o instalador do Ollama uma única vez (baixe e arraste para Aplicativos). Depois disso o Harness cuida do resto sozinho.",
  };
}

export async function isModelPulled(baseUrl, model, signal) {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000) });
    if (!response.ok) return false;
    const data = await response.json();
    const names = (data.models || []).map((m) => m.name);
    if (names.includes(model)) return true;
    // "llama3.2:3b" pulled should also satisfy a request for the bare
    // "llama3.2:3b" tag written without ":latest", and vice versa.
    const canonical = n => n.slice(n.lastIndexOf("/") + 1).includes(":") ? n : `${n}:latest`;
    return names.some(n => canonical(n) === canonical(model));
  } catch {
    return false;
  }
}

export async function pullModel(baseUrl, model, onProgress = () => {}) {
  const key = `${baseUrl}|${model}`;
  if (activePulls.has(key)) {
    const entry = activePulls.get(key); entry.listeners.add(onProgress);
    try { return await entry.promise; } finally { entry.listeners.delete(onProgress); }
  }
  const entry = { listeners: new Set([onProgress]), promise: null };
  activePulls.set(key, entry);
  entry.promise = pullModelOnce(baseUrl, model, event => { for (const listener of entry.listeners) listener(event); }).finally(() => activePulls.delete(key));
  return entry.promise;
}

const activePulls = new Map();
async function pullModelOnce(baseUrl, model, onProgress) {
  const controller = new AbortController();
  let timer;
  const refreshTimeout = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), 120000); };
  refreshTimeout();
  try {
  let response;
  try {
    response = await fetch(`${baseUrl}/api/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, stream: true }),
      signal: controller.signal,
    });
  } catch (error) {
    return { ok: false, error: `Não foi possível iniciar o download do modelo: ${error.message}` };
  }
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    return { ok: false, error: text.trim() || `O Ollama recusou o download do modelo (HTTP ${response.status}).` };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastError = null;
  let success = false;
  const accept = line => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.error) lastError = String(event.error);
    if (event.status === "success") success = true;
    onProgress(event);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    refreshTimeout();
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      try {
        accept(line);
      } catch {
        // A partial/malformed NDJSON line: ignore it, the next chunk usually completes it.
      }
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) { try { accept(buffer); } catch { lastError = "Resposta de download inválida."; } }
  if (lastError) return { ok: false, error: lastError };
  if (!success) return { ok: false, error: "Download interrompido antes da confirmação do Ollama." };
  return { ok: true };
  } catch (error) { return { ok: false, error: `Download não concluído: ${error.message}` }; }
  finally { clearTimeout(timer); }
}

/**
 * Current status without side effects — used by the UI to decide whether to
 * show "pronto" or to kick off runOllamaSetup(). Never installs or starts
 * anything on its own.
 */
export async function getLocalStatus(env = process.env) {
  const baseUrl = defaultBaseUrl(env);
  const model = await resolveLocalModel(env);
  const running = await isServerUp(baseUrl);
  const installed = running || (await isOllamaInstalled(env));
  const modelReady = running && (await isModelPulled(baseUrl, model));
  const stored=await getSetting('local_model');
  const selection=env.LOCAL_MODEL?'environment':stored&&stored!=='auto'?'manual':'automatic';
  return { installed, running, modelReady, model, selection, platform: process.platform, ready: running && modelReady };
}

/**
 * The one function that makes "o usuário não precisa configurar nada"
 * true: installs Ollama if missing, starts the server if it isn't running,
 * and pulls the configured model if it isn't present yet — reporting every
 * stage through onProgress so the UI can show something friendlier than a
 * frozen screen. Safe to call every time the user opens a local
 * conversation: each step is skipped if already satisfied.
 */
export async function runOllamaSetup(env = process.env, onProgress = () => {}) {
  if (setupTask) {
    setupListeners.add(onProgress);
    try { return await setupTask; } finally { setupListeners.delete(onProgress); }
  }
  setupListeners.add(onProgress);
  setupTask = runSetupOnce(env, event => { for (const listener of setupListeners) listener(event); });
  try { return await setupTask; } finally { setupTask = null; setupListeners.clear(); }
}
let setupTask = null;
const setupListeners = new Set();
async function runSetupOnce(env, onProgress) {
  const baseUrl = defaultBaseUrl(env);
  const model = await resolveLocalModel(env);

  onProgress({ stage: "checking" });
  if (!(await isServerUp(baseUrl))) {
    if (!(await isOllamaInstalled(env))) {
      const installResult = await installOllama(onProgress);
      if (!installResult.ok) {
        onProgress({ stage: "error", message: installResult.error, manual: installResult.manual, url: installResult.url });
        return { ok: false, ...installResult };
      }
      onProgress({ stage: "installed" });
    }

    onProgress({ stage: "starting" });
    await startOllamaServer(env);
    const up = await waitForServerUp(baseUrl);
    if (!up) {
      const message = "O Ollama foi instalado, mas o servidor não respondeu a tempo. Feche e reabra o Harness Aurora.";
      onProgress({ stage: "error", message });
      return { ok: false, error: message };
    }
  }
  onProgress({ stage: "server-ready" });

  if (!(await isModelPulled(baseUrl, model))) {
    onProgress({ stage: "pulling", model });
    const pullResult = await pullModel(baseUrl, model, (event) => onProgress({ stage: "pulling", model, ...event }));
    if (!pullResult.ok) {
      onProgress({ stage: "error", message: pullResult.error });
      return { ok: false, error: pullResult.error };
    }
  }

  if (!(await isModelPulled(baseUrl, model))) return { ok: false, error: "O Ollama não confirmou a presença do modelo solicitado. Tente novamente." };
  onProgress({ stage: "ready", model });
  return { ok: true, model };
}
