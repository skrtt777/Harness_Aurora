// Programas do Windows pela UI Automation (app/desktop/UiaHost.cs, compiled here on first use): the
// same idea as the browser tools — the window as text with refs, actions by ref — for any program
// (Access, Excel, the company system). One hidden helper process, one JSON line per request.
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const SOURCE = fileURLToPath(new URL("./desktop/UiaHost.cs", import.meta.url));
const FRAMEWORK = join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319");
const TIMEOUT_MS = 20_000;
let host = null;
let building = null;

// Never driven by the Aurora: itself, a terminal, the task manager, the registry editor, the Windows
// password and consent prompts. Matched on the program name the host reports.
export const BLOCKED_PROGRAMS = /^(harness aurora|electron|windowsterminal|cmd|powershell|pwsh|conhost|taskmgr|regedit|mmc|consent|credentialuibroker|lockapp|logonui|securityhealthsystray|windowsdefender|msedgewebview2|aurorauiahost(-[0-9a-f]+)?)$/i;

// Windows' own settings and security screens: looked at, never clicked or typed into.
export const BLOCKED_WINDOWS = /^(configura[çc][õo]es|settings|seguran[çc]a do windows|windows security|central de seguran[çc]a|controle de conta de usu[áa]rio|user account control)\b/i;
// Modern apps (Calculator, Settings, Photos…) all show as ApplicationFrameHost: their authorization
// goes by window, or authorizing the calculator would authorize Settings too.
export const approvalKey = (program, window) => (/^applicationframehost$/i.test(String(program || "")) ? String(window || program || "").toLowerCase() : String(program || "").toLowerCase());

/**
 * The host program, compiled once from UiaHost.cs with the .NET Framework compiler every Windows 10/11
 * has (no install), into a folder next to the database; compiled again only when the source changes.
 */
async function hostExe(env = process.env) {
  const source = readFileSync(SOURCE, "utf8");
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 12);
  const dir = join(dirname(env.HARNESS_DB_FILE || join(homedir(), ".aurora", "harness.db")), "desktop");
  const exe = join(dir, `AuroraUiaHost-${hash}.exe`);
  if (existsSync(exe)) return exe;
  building ||= (async () => {
    mkdirSync(dir, { recursive: true });
    const cs = join(dir, "UiaHost.cs");
    writeFileSync(cs, source);
    const refs = ["WPF/UIAutomationClient.dll", "WPF/UIAutomationTypes.dll", "WPF/WindowsBase.dll", "System.Web.Extensions.dll", "System.Windows.Forms.dll", "System.Data.dll", "Microsoft.CSharp.dll", "System.Core.dll"].map((r) => `-r:${join(FRAMEWORK, r)}`);
    await new Promise((resolve, reject) => execFile(join(FRAMEWORK, "csc.exe"), ["-nologo", "-optimize", "-target:exe", `-out:${exe}`, ...refs, cs], { windowsHide: true, timeout: 60_000 }, (error, stdout) => (error ? reject(new Error(`Não consegui preparar o controle de programas: ${String(stdout || error.message).split(/\r?\n/)[0]}`)) : resolve())));
  })().finally(() => { building = null; });
  await building;
  return exe;
}

async function start() {
  const child = spawn(await hostExe(), [], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map();
  createInterface({ input: child.stdout }).on("line", (line) => {
    let reply;
    try { reply = JSON.parse(line); } catch { return; }
    const waiter = pending.get(reply.id);
    if (waiter) { pending.delete(reply.id); waiter(reply); }
  });
  child.on("exit", () => { for (const waiter of pending.values()) waiter({ ok: false, error: "O controle de programas parou; tente de novo." }); pending.clear(); if (host?.child === child) host = null; });
  child.stdin.on("error", () => {});
  return { child, pending, next: 0 };
}

/** One request to the host: { ok, text, window, program, error }. */
export async function desktopRequest(cmd, args = {}) {
  if (process.platform !== "win32") return { ok: false, error: "Controlar programas só funciona no Windows." };
  try { host ||= await start(); } catch (error) { return { ok: false, error: error.message }; }
  const id = (host.next += 1);
  const current = host;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { current.pending.delete(id); resolve({ ok: false, error: "O programa demorou a responder (20 s). Ele pode estar ocupado ou com uma janela de aviso aberta." }); }, TIMEOUT_MS);
    current.pending.set(id, (reply) => { clearTimeout(timer); resolve(reply); });
    current.child.stdin.write(`${JSON.stringify({ id, cmd, ...args })}\n`);
  });
}

export function stopDesktop() { host?.child.kill(); host = null; }
process.once("exit", stopDesktop);

// The program the Aurora and the person are working in, per conversation ("abre a calculadora",
// then "calcula 12 x 30"): the next request goes to it, step by step, each step confirmed.
const cowork = new Map();
export function setCoworkApp(conversationId, app) { if (conversationId && app?.window) cowork.set(conversationId, { ...app, at: Date.now() }); }
export const coworkApp = (conversationId) => (conversationId ? cowork.get(conversationId) || null : null);

/** The open windows as { title, program }, from the host's list. */
export async function openWindows() {
  const reply = await desktopRequest("windows");
  if (!reply.ok) return [];
  return [...String(reply.text).matchAll(/^- "(.*)" \[programa: ([^\]]+)\]$/gm)].map((m) => ({ title: m[1], program: m[2] }));
}

/**
 * After a program was launched: its window, once it shows (a new window, or one of the program
 * asked for), within `timeoutMs`. null if none appeared.
 */
export async function waitForNewWindow(before, { hint = "", timeoutMs = 10_000 } = {}) {
  const known = new Set(before.map((w) => `${w.title}|${w.program}`));
  const wanted = String(hint).toLowerCase().replace(/\.exe$/, "");
  for (const started = Date.now(); Date.now() - started < timeoutMs;) {
    await new Promise((r) => setTimeout(r, 700));
    const now = await openWindows();
    const fresh = now.find((w) => !known.has(`${w.title}|${w.program}`));
    if (fresh) return fresh;
    const named = wanted && now.find((w) => w.program.toLowerCase().includes(wanted) || w.title.toLowerCase().includes(wanted));
    if (named && Date.now() - started > 2500) return named;
  }
  return null;
}

// Which program each ref belongs to (from the snapshot that gave it): the approval is per program.
const refPrograms = new Map();
export function rememberRefs(text, program, window) {
  for (const m of String(text).matchAll(/\[(d\d+)\]/g)) refPrograms.set(m[1], { program, window });
}
export const programOfRef = (ref) => refPrograms.get(String(ref || "")) || null;

/** "Janela: X  [programa: Y]" -> Y. */
export const programOf = (text) => /\[programa: ([^\]]+)\]/.exec(String(text || ""))?.[1] || null;
