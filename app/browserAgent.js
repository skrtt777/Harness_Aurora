import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { runLocal } from "./local.js";
import { centerOf, findTextBox, recognizeImage } from "./ocr.js";

const root = dirname(fileURLToPath(import.meta.url));

function defaultProfileDir(env) {
  return env.BROWSER_AGENT_PROFILE_DIR || join(root, "data", "browser-profile");
}

/**
 * The model is prompted to give a full "https://..." URL, but small local
 * models don't reliably follow that — this tolerates a bare domain
 * ("powerapps.microsoft.com") without treating it as a wrong answer.
 * Anything that already declares a scheme (including a non-http one, which
 * would be unusual but isn't this function's business to reject) is left
 * alone.
 */
export function normalizeGotoUrl(url) {
  const trimmed = String(url || "").trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// ---------- Browser lifecycle ----------

/**
 * Whether Playwright's managed Chromium is present. This is separate from
 * "is Chrome installed on the user's machine" — Playwright drives its own
 * downloaded copy (or, in this dev sandbox, the pre-installed one pointed
 * at via CHROMIUM_EXECUTABLE_PATH), the same way runLocal talks to Ollama's
 * own server rather than some system-wide LLM.
 */
export function isChromiumInstalled(env = process.env) {
  if (env.CHROMIUM_EXECUTABLE_PATH) return existsSync(env.CHROMIUM_EXECUTABLE_PATH);
  try {
    const path = chromium.executablePath();
    return Boolean(path) && existsSync(path);
  } catch {
    return false;
  }
}

function playwrightCliPath() {
  // Playwright ships its CLI at node_modules/playwright/cli.js. Spawning it
  // directly — the same way ollamaSetup.js spawns the real Ollama installer
  // — is the documented, stable way to trigger a browser download
  // programmatically; Playwright's internal download APIs aren't public.
  return fileURLToPath(new URL("../node_modules/playwright/cli.js", import.meta.url));
}

/**
 * Zero-config install of the one browser this feature needs (Chromium
 * only — no Firefox/WebKit, keeping the download to ~150 MB instead of
 * ~400+). Mirrors installOllamaLinux()/installOllamaWindows() in
 * ollamaSetup.js: spawn the real, official installer rather than
 * reimplementing it, report a single "downloading" stage (Playwright's own
 * CLI doesn't expose fine-grained byte progress the way Ollama's /api/pull
 * does), and never throw — callers get {ok:false, error} instead.
 */
export async function installChromium(onProgress = () => {}) {
  onProgress({ stage: "downloading-browser" });
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [playwrightCliPath(), "install", "chromium"],
      // PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD is set in this project's own dev/CI
      // environments (see test setup) to avoid re-downloading Chromium on
      // every `npm install`; explicitly cleared here so an actual install
      // triggered by this function always goes through, in dev or in prod.
      { windowsHide: true, timeout: 10 * 60_000, env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "" } },
      (error) => {
        if (error) resolve({ ok: false, error: `Não foi possível baixar o navegador automatizado: ${error.message}` });
        else resolve({ ok: true });
      },
    );
  });
}

/**
 * Launches (or would launch) the agent's browser with a *persistent*
 * profile directory instead of a fresh incognito-style context — so a
 * login the user does once (e.g. into Microsoft/PowerApps) survives across
 * runs, the same reasoning Claude-in-Chrome gets "for free" by driving the
 * user's real browser. Not headless by default: this drives a visible
 * window on purpose, so the user can see what an experimental local-model
 * agent is doing and intervene (close it, or use the cancel endpoint).
 */
async function launchBrowserContext(env) {
  const userDataDir = defaultProfileDir(env);
  await mkdir(userDataDir, { recursive: true });
  const launchOptions = {
    headless: env.BROWSER_AGENT_HEADLESS === "1",
    viewport: { width: 1280, height: 800 },
  };
  if (env.CHROMIUM_EXECUTABLE_PATH) launchOptions.executablePath = env.CHROMIUM_EXECUTABLE_PATH;
  const context = await chromium.launchPersistentContext(userDataDir, launchOptions);
  const page = context.pages()[0] || (await context.newPage());
  return { context, page };
}

let contextPromise = null;

/**
 * Reuses one browser context/window across agent runs instead of launching
 * a new one each time — a persistent-profile Chromium instance holds an
 * OS-level lock on its userDataDir, so a second concurrent launch against
 * the same profile would fail outright, and stacking up windows across
 * runs would be confusing anyway. The window is deliberately left open
 * between runs (not closed when a run finishes) so the user can see its
 * final state and the next run doesn't pay the ~1-2s launch cost again.
 */
export async function getOrLaunchBrowserContext(env = process.env) {
  if (!contextPromise) {
    contextPromise = launchBrowserContext(env).catch((error) => {
      contextPromise = null;
      throw error;
    });
  }
  return contextPromise;
}

export async function closeBrowserContext() {
  if (!contextPromise) return;
  const { context } = await contextPromise.catch(() => ({ context: null }));
  contextPromise = null;
  if (context) await context.close().catch(() => {});
}

export function resetBrowserContextForTests() {
  contextPromise = null;
}

// ---------- Prompting ----------

const ACTION_LABEL = {
  click: (a) => `clicar em "${a.target}"`,
  type: (a) => `digitar "${a.text}"`,
  goto: (a) => `ir para ${a.url}`,
  key: (a) => `apertar a tecla "${a.key}"`,
  scroll: (a) => "rolar a tela",
  wait: (a) => "esperar um instante",
  finish: (a) => `finalizar (${a.reason || "sem motivo informado"})`,
};

function describeAction(action) {
  const fn = action && ACTION_LABEL[action.action];
  return fn ? fn(action) : "ação inválida";
}

/**
 * Builds the prompt the local model sees each step: the goal, the current
 * URL, the OCR'd text of the screenshot (its only "vision" — this is a
 * text-only local model, not a multimodal one), and a short action history
 * so it doesn't repeat a failing action forever. Asks for a single JSON
 * action back, in the same "keep it simple, be lenient parsing the reply"
 * spirit as the rest of this codebase's local-model prompts.
 */
export function buildAgentPrompt({ goal, url, ocrText, history = [] }) {
  const recent = history.slice(-5);
  const historyText = recent.length
    ? recent
        .map((h, i) => `${i + 1}. ${describeAction(h.action)} → ${h.execResult?.ok ? "ok" : `falhou: ${h.execResult?.error || "erro desconhecido"}`}`)
        .join("\n")
    : "(nenhuma ação ainda)";

  return `Você é um agente que controla um navegador pra cumprir uma tarefa. Você não vê a tela como imagem — só o texto que um OCR extraiu dela, então pode ter erros de reconhecimento ou faltar contexto visual (cores, ícones sem texto, layout).

TAREFA: ${goal}

URL ATUAL: ${url || "(desconhecida)"}

TEXTO VISÍVEL NA TELA (via OCR):
"""
${ocrText && ocrText.trim() ? ocrText.trim() : "(nenhum texto detectado)"}
"""

ÚLTIMAS AÇÕES:
${historyText}

Responda com APENAS um objeto JSON (nenhum texto antes ou depois) com a PRÓXIMA ação, no formato de uma destas opções:
{"action":"click","target":"texto exatamente como aparece na tela"}
{"action":"type","text":"texto a digitar"}
{"action":"goto","url":"https://..."}
{"action":"key","key":"Enter"}
{"action":"scroll","dy":400}
{"action":"wait","ms":1000}
{"action":"finish","reason":"por que a tarefa terminou, ou por que não dá pra continuar"}

Se a tarefa já foi cumprida ou você não consegue prosseguir (texto necessário não está na tela, mesma ação falhando repetidamente), use "finish" explicando o motivo em vez de tentar de novo. Responda só o JSON, nada mais.`;
}

const VALID_ACTIONS = new Set(["click", "type", "goto", "key", "scroll", "wait", "finish"]);

/**
 * Extracts a single JSON action object from the model's raw reply. Local
 * models — especially small ones — don't reliably follow "respond with
 * ONLY json": they wrap it in a markdown fence, add a sentence before or
 * after, or just talk. This strips a fence if present, then takes the
 * substring between the first "{" and the last "}" rather than requiring
 * the whole reply to be valid JSON. Returns null (never throws) for
 * anything that doesn't parse into a recognized action shape — the caller
 * treats that as "the model didn't produce a usable action this step".
 */
export function parseAction(rawText) {
  if (!rawText) return null;
  let text = String(rawText).trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || !VALID_ACTIONS.has(parsed.action)) return null;
  return parsed;
}

// ---------- Action execution ----------

/**
 * Runs one parsed action against a real (or fake, in tests) Playwright
 * page. `words` are the OCR word boxes from the screenshot that prompted
 * this action — findTextBox() resolves a "click" target's text to real
 * pixel coordinates from them, since this agent has no DOM/accessibility
 * locators, only what OCR saw. Never throws: every branch returns
 * {ok, ...} or {ok:false, error}, since an execution failure is something
 * the loop feeds back to the model next step, not a reason to crash it.
 */
export async function executeAction(page, action, words = []) {
  try {
    switch (action.action) {
      case "click": {
        const box = findTextBox(words, action.target || "");
        if (!box) return { ok: false, error: `Não encontrei o texto "${action.target}" na tela.` };
        const { x, y } = centerOf(box);
        await page.mouse.click(x, y);
        return { ok: true, clickedAt: { x, y } };
      }
      case "type": {
        await page.keyboard.type(String(action.text ?? ""));
        return { ok: true };
      }
      case "goto": {
        const url = String(action.url || "").trim();
        if (!url) return { ok: false, error: "Nenhuma URL informada." };
        await page.goto(normalizeGotoUrl(url));
        return { ok: true };
      }
      case "key": {
        const key = String(action.key || "").trim();
        if (!key) return { ok: false, error: "Nenhuma tecla informada." };
        await page.keyboard.press(key);
        return { ok: true };
      }
      case "scroll": {
        await page.mouse.wheel(0, Number(action.dy) || 400);
        return { ok: true };
      }
      case "wait": {
        // `|| 1000` would treat an explicit 0 the same as "not provided"
        // (0 is falsy) and wait a full second anyway — Number.isFinite
        // only falls back to the default for a genuinely missing/invalid
        // value.
        const requested = Number(action.ms);
        const ms = Math.min(Math.max(Number.isFinite(requested) ? requested : 1000, 0), 5000);
        await new Promise((resolve) => setTimeout(resolve, ms));
        return { ok: true };
      }
      case "finish":
        return { ok: true, finished: true };
      default:
        return { ok: false, error: `Ação desconhecida: ${action.action}` };
    }
  } catch (error) {
    return { ok: false, error: error.message || "Falha ao executar a ação." };
  }
}

// ---------- Orchestration ----------

const DEFAULT_MAX_STEPS = 25;

/**
 * Runs the full screenshot → OCR → ask the local model → parse → execute
 * loop until the model calls "finish", a hard step limit is hit (guards
 * against a confused small model looping forever, burning CPU on a
 * headless-off browser window), or `signal` is aborted (cancel button).
 *
 * `recognize`/`ask` are injectable (default to the real recognizeImage/
 * runLocal) so this orchestration itself can be tested end-to-end against
 * a real Playwright page without needing network access for Tesseract's
 * language data or a running Ollama — the same dependency-injection
 * pattern refineLocalAnswer() already uses for its onStage callback.
 */
export async function runBrowserAgent({
  page,
  goal,
  env = process.env,
  maxSteps = DEFAULT_MAX_STEPS,
  signal,
  onStep = () => {},
  recognize = recognizeImage,
  ask = runLocal,
}) {
  const history = [];
  for (let step = 1; step <= maxSteps; step += 1) {
    if (signal?.aborted) return { ok: false, cancelled: true, history };

    onStep({ stage: "observing", step });
    const screenshot = await page.screenshot();
    const ocr = await recognize(screenshot, env);

    onStep({ stage: "thinking", step, url: page.url() });
    const modelResult = await ask(buildAgentPrompt({ goal, url: page.url(), ocrText: ocr.text, history }), env, signal);
    if (!modelResult.ok) {
      onStep({ stage: "error", step, message: modelResult.error });
      return { ok: false, error: modelResult.error, cancelled: Boolean(modelResult.cancelled), history };
    }

    const action = parseAction(modelResult.text);
    if (!action) {
      history.push({ step, raw: modelResult.text, execResult: { ok: false, error: "O modelo não respondeu com uma ação reconhecível." } });
      onStep({ stage: "invalid-action", step, raw: modelResult.text });
      continue;
    }

    if (action.action === "finish") {
      history.push({ step, action });
      onStep({ stage: "finished", step, reason: action.reason });
      return { ok: true, done: true, reason: action.reason, history };
    }

    const execResult = await executeAction(page, action, ocr.words);
    history.push({ step, action, execResult });
    onStep({ stage: "acted", step, action, execResult });
  }
  return { ok: false, error: "Limite de passos atingido sem concluir a tarefa.", history };
}
