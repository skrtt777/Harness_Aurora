// A photo of the one-floor office with the HR team at work (docs/img/escritorio-rh.png), on a
// temporary database: 6 task agents with real-shaped runs, an HR review, two sessions working.
// node scripts/office-hr-photo.mjs [saída.png]
import { existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const temp = mkdtempSync(join(tmpdir(), "aurora-office-hr-"));
process.env.HARNESS_DB_FILE = join(temp, "harness.db");
process.env.LOCAL_BASE_URL = "http://127.0.0.1:1";
const out = process.argv[2] || new URL("../docs/img/escritorio-rh.png", import.meta.url).pathname.replace(/^\/([a-z]:)/i, "$1");
const { createServer } = await import("../app/server.js");
const { createConversation, createProject, setSetting } = await import("../app/store.js");
const agents = await import("../app/agents.js");
const { hrReview } = await import("../app/hr.js");
const { getDb } = await import("../app/db.js");
const turns = await import("../app/pendingTurns.js");
await setSetting("onboarding_completed", "true");

const db = await getDb();
const add = (id, list, from) => { let t = from; for (const r of list) { t += 60000; db.prepare("INSERT INTO agent_runs (id, agent_id, request, trigger, status, started_at, finished_at, review, error, checks) VALUES (?, ?, ?, 'manual', ?, ?, ?, ?, ?, '[]')").run(`${id}-${t}`, id, r.req || "Tarefa da semana", r.s, new Date(t).toISOString(), new Date(t + 5000).toISOString(), r.fix ? JSON.stringify({ verdict: "fix", problems: [r.fix] }) : null, r.err || null); } };
const ok = { s: "done" }, fix = (p) => ({ s: "done", fix: p }), fail = (e) => ({ s: "failed", err: e });
const team = {};
for (const [name, dept] of [["Relatórios", "Diretoria"], ["Cobrança", "Financeiro"], ["Estoque", "Logística"], ["Folha", "RH"], ["Atendimento", "Comercial"], ["Compras", "Suprimentos"]]) team[name] = await agents.createAgent({ name, mission: `Cuidar de ${name.toLowerCase()}.`, department: dept, workDir: join(temp, name) });
const old = Date.now() - 3 * 86400000;
add(team["Relatórios"].id, [ok, ok, ok, ok, ok], old);
add(team["Estoque"].id, [ok, ok, fix("Faltou o total por depósito."), ok], old);
add(team["Folha"].id, [ok, ok, ok, ok], old);
add(team["Atendimento"].id, [fail("não achei a planilha de chamados"), fix("Respondeu sem citar o protocolo."), ok], old);
add(team["Cobrança"].id, [fail("sem acesso à pasta Clientes"), fix("Faltou o valor em atraso de cada cliente."), fail("planilha vazia")], old);
add(team["Compras"].id, [ok, fix("Fornecedor duplicado."), ok], old);
await hrReview({ now: Date.now() - 4 * 86400000 + 86400000 });
add(team["Cobrança"].id, [fail("falhou de novo"), fail("planilha vazia outra vez")], Date.now() - 120000);
await hrReview();
// Two sessions at work on the same floor.
const sales = await createProject({ name: "Vendas" });
const c1 = await createConversation({ title: "Metas de outubro", provider: "local", projectId: sales.id });
const c2 = await createConversation({ title: "Planilha de comissões", provider: "local" });
const t1 = turns.startTurn(c1.id); turns.pushTurnStep(c1.id, { tool: "write_document", status: "running", summary: "Escrevendo metas.xlsx" });
const t2 = turns.startTurn(c2.id); turns.pushTurnStep(c2.id, { tool: "read_file", status: "running", summary: "Lendo vendas.xlsx" });

const server = createServer({ allowDev: false }); await new Promise((r) => server.listen(0, "127.0.0.1", r));
const exe = existsSync("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe") ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" : undefined;
const browser = await chromium.launch({ executablePath: exe, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1300 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("button", { name: "Escritório" }).click();
  await page.getByRole("heading", { name: "RH dos agentes" }).waitFor();
  await page.locator(".office-hr-table table").waitFor();
  await page.waitForTimeout(6000);
  await page.locator(".office-view").screenshot({ path: out });
  console.log(out);
} finally { turns.endTurn(c1.id, t1); turns.endTurn(c2.id, t2); await browser.close(); server.closeAllConnections(); server.close(); }
process.exit(0);
