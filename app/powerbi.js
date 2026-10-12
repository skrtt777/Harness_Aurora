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
import { localPlanAsk, planWithModel } from "./powerbiPlanner.js";
import { biEvents, changedTable, diffSnapshots, narrate, notesTable } from "./powerbiChanges.js";
import { auditReport, fixPlan } from "./powerbiAudit.js";
import { writeSummaries } from "./powerbiSummary.js";
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
export function watchReport(report, files = [], { everyMs = 60_000, watch = null, plan = null } = {}) {
  if (!report?.pid || !report?.port) return;
  watched.set(report.pid, { pid: report.pid, port: report.port, title: report.title, files, mtimes: files.map(mtimeOf), lastRefresh: Date.now(), last: "aberto agora", watch, plan, snapshot: null, notes: [] });
  if (!watchTimer) { watchTimer = setInterval(() => { void refreshDue().catch(() => {}); }, everyMs); watchTimer.unref?.(); }
}

/** The reports kept current, for the person and the diagnostics. */
export const watchedReports = () => [...watched.values()].map((w) => ({ title: w.title, files: w.files, lastRefresh: new Date(w.lastRefresh).toISOString(), last: w.last }));

/** The numbers and the entities of a watched report now (the same DAX as its scenes). */
export async function snapshotOf(watch) {
  const snap = { at: Date.now(), numbers: {}, entities: {} };
  if (watch.numbers.length) {
    const r = await pbiRequest("query", { dax: `EVALUATE ROW(${watch.numbers.map((n, i) => `"m${i}", [${n.replace(/]/g, "]]")}]`).join(", ")})`, max: 2 });
    const values = String(r.text || "").split("\n")[2]?.split(" | ") || [];
    watch.numbers.forEach((n, i) => { const v = Number(String(values[i] ?? "").replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "")); if (r.ok && Number.isFinite(v)) snap.numbers[n] = v; });
  }
  if (watch.entities) {
    const r = await pbiRequest("query", { dax: watch.entities, max: 2000 });
    for (const line of String(r.text || "").split("\n").slice(2)) {
      const [name, where, place, late] = line.split(" | ");
      if (name && where) snap.entities[name] = { where, place: place || "", late: late === "1" };
    }
  }
  return snap;
}

async function noteChanges(w) {
  const snap = await snapshotOf(w.watch);
  const { facts, alerts, changed } = diffSnapshots(w.snapshot, snap, { badUp: w.watch.badUp, place: w.watch.place });
  w.snapshot = snap;
  // The scene rings who just arrived or moved (until the next refresh).
  if (w.watch.entities) await pbiRequest("apply", { ops: [{ op: "tableExpression", name: "Mudanças", expression: changedTable(changed) }] }).catch(() => {});
  if (!facts.length) return null;
  const text = await narrate(facts, await localPlanAsk(process.env).catch(() => null), process.env);
  const when = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  w.notes.unshift({ when, text });
  await pbiRequest("apply", { ops: [{ op: "tableExpression", name: "Notas da Aurora", expression: notesTable(w.notes) }] });
  if (alerts.length) biEvents.emit("alert", { title: `${w.title}: ${alerts[0]}`, body: text, report: w.title });
  return { when, text, alerts };
}

/** The twin's state (app/powerbiTwin.js) of the report the Aurora opened last, or null. */
export async function twinNow() {
  const w = [...watched.values()].at(-1);
  if (!w) return null;
  const { twinState } = await import("./powerbiTwin.js");
  return twinState(w, pbiRequest);
}

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
    // What changed since the refresh before: a note in the report, an alert when it got worse.
    const note = r.ok && w.watch ? await noteChanges(w).catch(() => null) : null;
    // The pages' sentences follow the new numbers.
    if (r.ok && w.plan) await writeSummaries(w.plan, pbiRequest, await localPlanAsk(process.env).catch(() => null), process.env).catch(() => []);
    done.push({ title: w.title, why: changed ? "arquivo" : "tempo", ok: r.ok, note });
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
  const result = { pbip, folder: projectDir, plan, opened: null, refreshed: "", checks: "", audit: [] };
  if (!open) return result;
  onStage("Abrindo no Power BI Desktop…");
  let report = await openInDesktop(pbip);
  result.opened = report;
  try {
    await loadOpened(result, plan, report, conversationId, onStage);
    // Checked before it is handed over: a chart or card that says nothing is fixed and the pages drawn
    // again (once).
    onStage("Conferindo cada gráfico…");
    const issues = await auditReport(plan, pbiRequest).catch(() => []);
    const fixed = issues.length && plan.plan ? fixPlan(plan.plan, issues, prep.cat) : null;
    if (fixed) {
      onStage("Corrigindo o que não ficou bom…");
      const redone = finish(prep, fixed.plan);
      // Closed first: an open Power BI writes its pages back over the new ones.
      try { process.kill(report.pid); } catch { /* closed */ }
      for (let t = 0; t < 20 && alive(report.pid); t += 1) await wait(500);
      await wait(2000);
      // A project of its own: reopened at the same path, Power BI brought the old page back (its recovery
      // of the closed window), and the report had both.
      const fixedDir = join(projectDir, "conferido");
      mkdirSync(fixedDir, { recursive: true });
      const fixedPbip = writeProject(fixedDir, projectName);
      ok(await pbiRequest("build", { folder: join(fixedDir, `${projectName}.SemanticModel`), model: redone.model }));
      writeReport(join(fixedDir, `${projectName}.Report`), { name: projectName, modelFolder: `${projectName}.SemanticModel`, pages: redone.pages, measures: redone.measures, palette: redone.palette });
      result.pbip = fixedPbip; result.folder = fixedDir;
      report = await openInDesktop(fixedPbip);
      result.opened = report;
      Object.assign(plan, { pages: redone.pages, plan: redone.plan, summary: `${redone.summary}\nConferi o painel antes de entregar: ${fixed.changes.join("; ")}.` });
      await loadOpened(result, plan, report, conversationId, onStage);
    }
    result.audit = fixed ? fixed.changes : [];
    // The Aurora's sentence under each page's title, from the numbers it shows.
    onStage("Escrevendo o resumo de cada página…");
    result.summaries = await writeSummaries(plan, pbiRequest, await localPlanAsk(process.env).catch(() => null), process.env).catch(() => []);
    // From now on its data follows the spreadsheets (at most REFRESH_MINUTES late).
    watchReport(report, files, { watch: plan.watch || null, plan });
    // The first look, to compare the next refreshes with.
    const w = watched.get(report.pid);
    if (w?.watch) w.snapshot = await snapshotOf(w.watch).catch(() => null);
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
  const kpis = plan.pages[0].visuals.filter((v) => v.type === "card" || v.kpi).map((v) => v.kpi || v.values);
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
