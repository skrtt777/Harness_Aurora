// Power BI for the Aurora: finds the installed Power BI Desktop, compiles app/powerbi/PbiHost.cs against its
// own libraries (TOM, ADOMD, TMDL) and talks to it one JSON line at a time — like app/desktop.js does with
// the UI Automation host. On top: building a complete BI project from spreadsheets (app/powerbiDesign.js +
// app/powerbiReport.js) and opening it in Power BI Desktop, already refreshed.
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { finish, prepare, profile, readSources } from "./powerbiDesign.js";
import { planWithModel } from "./powerbiPlanner.js";
import { writeProject, writeReport } from "./powerbiReport.js";

const SOURCE = fileURLToPath(new URL("./powerbi/PbiHost.cs", import.meta.url));
const FRAMEWORK = join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319");
let host = null;
let building = null;
let binCache = null;

const run = (file, args, timeout = 30_000) => new Promise((resolve, reject) => execFile(file, args, { windowsHide: true, timeout }, (error, stdout, stderr) => (error ? reject(new Error(String(stderr || error.message).trim().split("\n")[0])) : resolve(String(stdout)))));

/** The Power BI Desktop "bin" folder (Store or installer version), or null when it is not installed. */
export async function powerBiBin() {
  if (binCache !== null) return binCache || null;
  if (process.platform !== "win32") { binCache = ""; return null; }
  const installer = join(process.env.ProgramFiles || "C:\\Program Files", "Microsoft Power BI Desktop", "bin");
  if (existsSync(join(installer, "Microsoft.PowerBI.Tabular.dll"))) { binCache = installer; return installer; }
  const store = (await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "(Get-AppxPackage Microsoft.MicrosoftPowerBIDesktop | Select-Object -First 1).InstallLocation"]).catch(() => "")).trim();
  binCache = store && existsSync(join(store, "bin", "Microsoft.PowerBI.Tabular.dll")) ? join(store, "bin") : "";
  return binCache || null;
}

/** How Power BI Desktop is started with a file: the installer's exe or the Store alias. */
async function desktopExe() {
  const bin = await powerBiBin();
  if (bin && !/WindowsApps/i.test(bin)) return join(bin, "PBIDesktop.exe");
  const alias = join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Microsoft", "WindowsApps", "PBIDesktopStore.exe");
  // An app execution alias: existsSync does not see it (a special reparse point), the folder listing does.
  try { return readdirSync(dirname(alias)).includes("PBIDesktopStore.exe") ? alias : null; } catch { return null; }
}

async function hostExe(env = process.env) {
  const bin = await powerBiBin();
  if (!bin) throw new Error("O Power BI Desktop não está instalado neste computador. Ele é gratuito, na Microsoft Store (\"Power BI Desktop\").");
  const source = readFileSync(SOURCE, "utf8");
  const hash = createHash("sha256").update(source).update(bin).digest("hex").slice(0, 12);
  const dir = join(dirname(env.HARNESS_DB_FILE || join(homedir(), ".aurora", "harness.db")), "desktop");
  const exe = join(dir, `AuroraPbiHost-${hash}.exe`);
  if (existsSync(exe)) return { exe, bin };
  building ||= (async () => {
    mkdirSync(dir, { recursive: true });
    const cs = join(dir, "PbiHost.cs");
    writeFileSync(cs, source);
    const refs = [
      ...["Microsoft.PowerBI.Tabular.dll", "Microsoft.PowerBI.Amo.Core.dll", "Microsoft.PowerBI.AdomdClient.dll"].map((r) => join(bin, r)),
      ...["System.Web.Extensions.dll", "System.Management.dll", "System.Core.dll", "Microsoft.CSharp.dll", "System.Xml.dll", "System.Data.dll"].map((r) => join(FRAMEWORK, r)),
    ].map((r) => `-r:${r}`);
    await new Promise((resolve, reject) => execFile(join(FRAMEWORK, "csc.exe"), ["-nologo", "-optimize", "-target:exe", "-platform:x64", `-out:${exe}`, ...refs, cs], { windowsHide: true, timeout: 90_000 }, (error, stdout) => (error ? reject(new Error(`Não consegui preparar o Power BI da Aurora: ${String(stdout || error.message).split(/\r?\n/).find((l) => /error/i.test(l)) || error.message}`)) : resolve())));
  })().finally(() => { building = null; });
  await building;
  return { exe, bin };
}

async function start() {
  const { exe, bin } = await hostExe();
  const child = spawn(exe, [bin], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map();
  createInterface({ input: child.stdout }).on("line", (line) => {
    let reply;
    try { reply = JSON.parse(line); } catch { return; }
    const waiter = pending.get(reply.id);
    if (waiter) { pending.delete(reply.id); waiter(reply); }
  });
  child.on("exit", () => { for (const waiter of pending.values()) waiter({ ok: false, error: "O Power BI da Aurora parou; tente de novo." }); pending.clear(); if (host?.child === child) host = null; });
  child.stdin.on("error", () => {});
  return { child, pending, next: 0 };
}

/** One request to the Power BI helper: { ok, text, error, … }. */
export async function pbiRequest(cmd, args = {}, timeoutMs = 120_000) {
  if (process.platform !== "win32") return { ok: false, error: "O Power BI Desktop só existe no Windows." };
  try { host ||= await start(); } catch (error) { return { ok: false, error: error.message }; }
  const id = (host.next += 1);
  const current = host;
  if (cmd === "connect") lastPort = args.port;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { current.pending.delete(id); resolve({ ok: false, error: `O Power BI demorou mais de ${Math.round(timeoutMs / 1000)} s para responder.` }); }, timeoutMs);
    current.pending.set(id, (reply) => { clearTimeout(timer); resolve(reply); });
    current.child.stdin.write(`${JSON.stringify({ id, cmd, ...args })}\n`);
  });
}

export function stopPowerBi() { host?.child.kill(); host = null; if (watchTimer) { clearInterval(watchTimer); watchTimer = null; } watched.clear(); }

// ---- Keeping an open report current ------------------------------------------------------------------
// The data of a BI the Aurora opened is at most REFRESH_MINUTES late: the source files are looked at every
// minute and the model refreshed as soon as one changes, and every REFRESH_MINUTES anyway (the measures of
// "now" — late, in the yard — move with the clock). The report shows the time in its live badge.
export const REFRESH_MINUTES = Math.max(1, Number(process.env.HARNESS_PBI_REFRESH_MIN) || 10);
const watched = new Map();
let watchTimer = null;
let lastPort = null;
const mtimeOf = (f) => { try { return statSync(f).mtimeMs; } catch { return 0; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** Keeps a report current: files = its source spreadsheets (empty: by the clock only). */
export function watchReport(report, files = [], { everyMs = 60_000 } = {}) {
  if (!report?.pid || !report?.port) return;
  watched.set(report.pid, { pid: report.pid, port: report.port, title: report.title, files, mtimes: files.map(mtimeOf), lastRefresh: Date.now(), last: "aberto agora" });
  if (!watchTimer) { watchTimer = setInterval(() => { void refreshDue().catch(() => {}); }, everyMs); watchTimer.unref?.(); }
}

/** The reports kept current, for the person and the diagnostics. */
export const watchedReports = () => [...watched.values()].map((w) => ({ title: w.title, files: w.files, lastRefresh: new Date(w.lastRefresh).toISOString(), last: w.last }));

/** One round: each watched report whose files changed (or whose time came) is refreshed. */
export async function refreshDue(now = Date.now()) {
  const done = [];
  for (const w of [...watched.values()]) {
    if (!alive(w.pid)) { watched.delete(w.pid); continue; }
    const mtimes = w.files.map(mtimeOf);
    const changed = mtimes.some((t, i) => t !== w.mtimes[i]);
    if (!changed && now - w.lastRefresh < REFRESH_MINUTES * 60_000 - 15_000) continue;
    const back = lastPort;
    const c = await pbiRequest("connect", { port: w.port });
    if (!c.ok) { w.last = c.error; continue; }
    const r = await pbiRequest("refresh", {}, 300_000);
    w.lastRefresh = Date.now(); w.mtimes = mtimes; w.last = r.ok ? (changed ? "planilha mudou" : "relógio") : r.error;
    done.push({ title: w.title, why: changed ? "arquivo" : "tempo", ok: r.ok });
    // Back to the report a conversation was working on.
    if (back && back !== w.port) await pbiRequest("connect", { port: back });
  }
  if (!watched.size && watchTimer) { clearInterval(watchTimer); watchTimer = null; }
  return done;
}
process.once("exit", stopPowerBi);

const ok = (reply) => { if (!reply.ok) throw new Error(reply.error); return reply; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The Power BI Desktop files open now: [{ port, title, pid }]. */
export async function openReports() { return ok(await pbiRequest("instances")).instances || []; }

// The model the Aurora is connected to, per conversation.
const connected = new Map();
export const connectedReport = (conversationId) => connected.get(conversationId || "") || null;
/** After a change: the model text the prompt shows (measure and column names) is refreshed. */
export function rememberModel(conversationId, text) { const c = connected.get(conversationId || ""); if (c) c.model = text; }
/** The names a small model needs to ask the right thing: measures and visible columns, per table. */
export function modelNames(conversationId) {
  const text = connected.get(conversationId || "")?.model || "";
  const measures = [...text.matchAll(/medida \[([^\]]+)\]/g)].map((m) => m[1]);
  const columns = [];
  let table = "";
  for (const line of text.split("\n")) {
    const t = /^Tabela (.+?)( \(calculada\))?( \[oculta\])?:$/.exec(line);
    if (t) { table = t[1]; continue; }
    const c = /^\s+colunas: (.*)$/.exec(line);
    if (c) columns.push(`${table}: ${c[1].split(/, (?=[^,]+ \()/).filter((x) => !/oculta/.test(x)).map((x) => x.replace(/ \(.*$/, "")).join(", ")}`);
  }
  return { measures, columns };
}

/** Connects to an open Power BI (by part of its title, or the only one open). */
export async function connectReport(conversationId, title = "") {
  const all = await openReports();
  if (!all.length) throw new Error("Não há nenhum Power BI Desktop aberto com um relatório. Abra o arquivo (.pbix ou .pbip) ou peça para a Aurora criar um.");
  const wanted = String(title || "").toLowerCase();
  const target = wanted ? all.find((r) => r.title.toLowerCase().includes(wanted)) : all.length === 1 ? all[0] : null;
  if (!target) throw new Error(`Há ${all.length} Power BI abertos: ${all.map((r) => `"${r.title}"`).join(", ")}. Diga qual (window: parte do título).`);
  const reply = ok(await pbiRequest("connect", { port: target.port }));
  connected.set(conversationId || "", { ...target, model: reply.text });
  // A report the person opened: kept current by the clock (its sources are its own).
  if (!watched.has(target.pid)) watchReport(target, []);
  return { ...target, text: reply.text };
}

/** Opens a .pbip/.pbix in Power BI Desktop and waits for its model (up to `timeoutMs`). */
export async function openInDesktop(file, { timeoutMs = 150_000 } = {}) {
  const exe = await desktopExe();
  if (!exe) throw new Error("O Power BI Desktop não está instalado neste computador. Ele é gratuito, na Microsoft Store.");
  const before = new Set((await openReports().catch(() => [])).map((r) => r.port));
  spawn(exe, [file], { detached: true, stdio: "ignore", windowsHide: false }).unref();
  for (const started = Date.now(); Date.now() - started < timeoutMs;) {
    await wait(3000);
    // The window says "Sem título" while the file loads; the model is there before the title.
    const fresh = (await openReports().catch(() => [])).find((r) => !before.has(r.port) && r.title);
    if (fresh && (!/^(Sem t[íi]tulo|Untitled)\b/i.test(fresh.title) || Date.now() - started > 60_000)) return fresh;
  }
  throw new Error("O Power BI Desktop não terminou de abrir o arquivo a tempo. Ele pode estar mostrando um aviso: dê uma olhada na janela.");
}

/**
 * A complete BI from spreadsheets: profile the data, design model and pages, write the .pbip project,
 * open it in Power BI Desktop, refresh, and check the numbers. Returns a summary for the person.
 */
/**
 * planner: { ask, env } to have the local model plan the BI (its pages, layout, scenes, style) from the
 * catalog of the data; without it, or when it gives nothing usable, the automatic plan.
 */
export async function buildReport({ files, folder, name, goal, conversationId, open = true, onStage = () => {}, adjust = null, planner = null }) {
  onStage("Lendo os dados…");
  const tables = files.flatMap((f) => readSources(f)).map(profile);
  const prep = prepare(tables, { title: name, goal });
  let modelPlan = null; let plannerError = null;
  if (planner?.ask) {
    onStage("Planejando o painel…");
    modelPlan = await planWithModel(prep.cat, goal || "", planner.ask, planner.env, (e) => { plannerError = e; }).catch((e) => { plannerError = e.message; return null; });
  }
  const designed = finish(prep, modelPlan);
  // Why the automatic plan was used, for whoever reads the result (a test, the diagnostics).
  if (plannerError) designed.summary += `\n(A IA local não planejou: ${String(plannerError).slice(0, 160)}; usei o plano automático.)`;
  // A lab may change the plan before it is written (a new visual tried on real data).
  const plan = adjust ? adjust(designed) || designed : designed;
  const projectName = String(name || plan.name).replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  const projectDir = join(folder, projectName);
  mkdirSync(projectDir, { recursive: true });
  onStage("Montando o modelo semântico…");
  const pbip = writeProject(projectDir, projectName);
  ok(await pbiRequest("build", { folder: join(projectDir, `${projectName}.SemanticModel`), model: plan.model }));
  onStage("Desenhando as páginas…");
  writeReport(join(projectDir, `${projectName}.Report`), { name: projectName, modelFolder: `${projectName}.SemanticModel`, pages: plan.pages, measures: plan.measures, palette: plan.palette });
  const result = { pbip, folder: projectDir, plan, opened: null, refreshed: "", checks: "" };
  if (!open) return result;
  onStage("Abrindo no Power BI Desktop…");
  const report = await openInDesktop(pbip);
  result.opened = report;
  try {
    await loadOpened(result, plan, report, conversationId, onStage);
    // From now on its data follows the spreadsheets (at most REFRESH_MINUTES late).
    watchReport(report, files);
  } catch (error) {
    // Opened but not loaded: who called knows which window it was (a test closes it, 11/10).
    error.opened = report;
    throw error;
  }
  return result;
}

async function loadOpened(result, plan, report, conversationId, onStage) {
  // The engine is up before the project's model is in it: a few tries.
  let model = "";
  for (let tries = 0; ; tries += 1) {
    const reply = await pbiRequest("connect", { port: report.port });
    if (reply.ok) { model = reply.text; break; }
    if (tries >= 30) throw new Error(reply.error);
    await wait(3000);
  }
  connected.set(conversationId || "", { ...report, model });
  onStage("Carregando os dados…");
  result.refreshed = ok(await pbiRequest("refresh", {}, 300_000)).text;
  // The headline numbers, as the cards will show them.
  const kpis = plan.pages[0].visuals.filter((v) => v.type === "card").map((v) => v.values);
  if (kpis.length) {
    // Formatted as the cards show them ("66,0%", not 0,66 — read as 0,66% by the model, 11/10).
    const formatOf = (k) => plan.measureList.find((x) => `[${x.name}]` === k)?.format;
    const dax = `EVALUATE ROW(${kpis.map((k) => `"${k.replace(/^\[|\]$/g, "").replace(/"/g, "\"\"")}", ${formatOf(k) ? `FORMAT(${k}, "${formatOf(k).replace(/"/g, "\"\"")}")` : k}`).join(", ")})`;
    const reply = await pbiRequest("query", { dax, max: 2 });
    result.checks = reply.ok ? reply.text : `(não consegui conferir os números: ${reply.error})`;
    // One "Name: value" per line: a small model misaligned the columns of the table (13 and 9 swapped, 11/10).
    if (reply.ok) {
      const [, head = "", row = ""] = String(reply.text).split("\n");
      const names = head.split(" | "); const values = row.split(" | ");
      result.cards = names.map((n, i) => `- ${n}: ${values[i] ?? ""}`).join("\n");
    }
  }
  return result;
}
