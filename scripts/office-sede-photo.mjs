// A photo of the Sede (docs/img/sede.png) on a temporary database: requests of several areas, each at
// a different station of the line (Arquivo, Biblioteca, a department, Revisão, Conferência, Expedição),
// task agents at rest, the HR team and the boss. node scripts/office-sede-photo.mjs [saída.png]
import { existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const temp = mkdtempSync(join(tmpdir(), "aurora-sede-"));
process.env.HARNESS_DB_FILE = join(temp, "harness.db");
process.env.LOCAL_BASE_URL = "http://127.0.0.1:1";
const out = process.argv[2] || new URL("../docs/img/sede.png", import.meta.url).pathname.replace(/^\/([a-z]:)/i, "$1");
const { createServer } = await import("../app/server.js");
const { createConversation, setSetting } = await import("../app/store.js");
const agents = await import("../app/agents.js");
const turns = await import("../app/pendingTurns.js");
await setSetting("onboarding_completed", "true");
for (const [name, dept] of [["Cobrança", "Financeiro"], ["Folha", "RH"], ["Estoque", "Logística"], ["Contratos", "Jurídico"]]) await agents.createAgent({ name, mission: `Cuidar de ${name.toLowerCase()}.`, department: dept, workDir: join(temp, name) });

const live = [];
const turn = async (title, steps, { stage = "Decidindo o próximo passo…", check = null, end = false } = {}) => {
  const c = await createConversation({ title, provider: "local" });
  const ctl = turns.startTurn(c.id);
  for (const s of steps) turns.pushTurnStep(c.id, s);
  turns.setStage(c.id, stage);
  if (check) turns.setCheck(c.id, check);
  if (end) turns.endTurn(c.id, ctl); else live.push([c.id, ctl]);
};
await turn("Clientes inadimplentes há mais de 30 dias", [{ tool: "read_file", status: "running", summary: "Lendo Contas a receber.xlsx" }]);
await turn("Parecer sobre o contrato de locação", [{ tool: "read_file", status: "done", ok: true, summary: "Lendo contrato.pdf" }, { tool: "web_search", status: "running", summary: "Pesquisando a Lei do Inquilinato" }]);
await turn("Férias de outubro dos funcionários", [{ tool: "read_file", status: "done", ok: true }, { tool: "write_document", status: "running", summary: "Escrevendo Ferias-Outubro.xlsx" }]);
await turn("Site de video games", [{ tool: "create_site", status: "done", ok: true }], { stage: "Revisando com Claude…" });
await turn("Planilha de departamentos com mais de 300 funcionários", [{ tool: "write_document", status: "done", ok: false }], { check: "requested_files_missing" });
await turn("Campanha de Instagram para a loja", [{ tool: "web_search", status: "done", ok: true }, { tool: "write_document", status: "done", ok: true }], { end: true });
await turn("Pedido de compra de cimento", [{ tool: "run_command", status: "running", summary: "python estoque.py" }]);

const server = createServer({ allowDev: false }); await new Promise((r) => server.listen(0, "127.0.0.1", r));
const exe = existsSync("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe") ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" : undefined;
const browser = await chromium.launch({ executablePath: exe, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1700, height: 1000 }, deviceScaleFactor: 1 });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("button", { name: "Escritório" }).click();
  await page.locator(".hq-ficha").first().waitFor();
  await page.waitForTimeout(9000);
  await page.locator(".office-view").screenshot({ path: out });
  console.log(out, errors.length ? `erros: ${errors.join(" | ")}` : "sem erros");
} finally { for (const [id, ctl] of live) turns.endTurn(id, ctl); await browser.close(); server.closeAllConnections(); server.close(); }
process.exit(0);
