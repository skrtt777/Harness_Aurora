import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getOrLaunchBrowserContext } from "./browserAgent.js";

const chromium = process.platform === "android" ? null : (await import("playwright")).chromium;

export const BROWSER_BACKENDS = ["aurora", "chrome"];
const CDP_PORT = 9222;

/**
 * The chat agent drives one of two browsers, picked in Settings:
 * - "aurora": Playwright's own Chromium with a persistent Aurora profile
 *   (the same window the browser agent already uses);
 * - "chrome": the user's real Chrome over CDP. Chrome 136+ refuses remote
 *   debugging on the default profile, so it runs on a dedicated profile the
 *   user logs into once — logins persist there across sessions.
 * Both expose the same {context, page}; `page` is whichever tab the agent
 * last focused, so tab switching survives between tool calls.
 */
const state = { backend: null, context: null, page: null, cdp: null };

export function chromeExecutable(env = process.env) {
  if (env.CHROME_EXECUTABLE_PATH) return env.CHROME_EXECUTABLE_PATH;
  const candidates = [
    join(env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
    join(env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
    join(env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Google", "Chrome", "Application", "chrome.exe"),
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  return candidates.find((path) => existsSync(path)) || null;
}

async function cdpUp(port) {
  try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; }
  catch { return false; }
}

async function connectChrome(env) {
  const port = Number(env.CHROME_CDP_PORT || CDP_PORT);
  if (!(await cdpUp(port))) {
    const executable = chromeExecutable(env);
    if (!executable) throw new Error("Não encontrei o Google Chrome instalado. Troque o navegador para \"Chromium da Aurora\" nas configurações.");
    const profile = env.CHROME_AGENT_PROFILE_DIR || join(env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Aurora", "chrome-profile");
    await mkdir(profile, { recursive: true });
    spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check"], { detached: true, stdio: "ignore", windowsHide: false }).unref();
    for (let i = 0; i < 40 && !(await cdpUp(port)); i += 1) await new Promise((resolve) => setTimeout(resolve, 250));
    if (!(await cdpUp(port))) throw new Error("O Chrome abriu, mas não liberou o controle remoto. Feche todas as janelas desse perfil e tente de novo.");
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  browser.once("disconnected", () => { if (state.cdp === browser) Object.assign(state, { backend: null, context: null, page: null, cdp: null }); });
  const context = browser.contexts()[0] || (await browser.newContext());
  return { browser, context };
}

export async function getBrowserPage({ backend = "aurora", env = process.env } = {}) {
  if (!chromium) throw new Error("Automação de navegador requer o Harness desktop.");
  if (!BROWSER_BACKENDS.includes(backend)) backend = "aurora";
  if (state.backend !== backend || !state.context) {
    if (backend === "chrome") {
      const { browser, context } = await connectChrome(env);
      Object.assign(state, { backend, context, cdp: browser, page: context.pages().at(-1) || null });
    } else {
      const { context, page } = await getOrLaunchBrowserContext(env);
      Object.assign(state, { backend, context, cdp: null, page });
      context.once("close", () => { if (state.context === context) Object.assign(state, { backend: null, context: null, page: null }); });
    }
  }
  if (!state.page || state.page.isClosed()) state.page = state.context.pages().filter((p) => !p.isClosed()).at(-1) || (await state.context.newPage());
  return { context: state.context, page: state.page };
}

/** The tab the agent is on, without launching a browser if none is open. */
export async function currentBrowserPage() {
  const page = state.page;
  if (!page || page.isClosed() || page.url() === "about:blank") return null;
  return { url: page.url(), title: (await page.title().catch(() => "")).slice(0, 120) };
}

export function setActivePage(page) {
  state.page = page;
}

export function resetBrowserBackendForTests(fake = null) {
  Object.assign(state, { backend: fake ? fake.backend || "aurora" : null, context: fake?.context || null, page: fake?.page || null, cdp: null });
}
