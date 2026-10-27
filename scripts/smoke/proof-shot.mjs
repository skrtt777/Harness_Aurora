// The comprovante as the person sees it: a temporary database with one answer about a sales sheet and
// its proof (app/proof.js, computed for real), the chat opened in Chromium, a number hovered and the
// seal opened, a screenshot of each. Never the person's database or app.
//   node scripts/smoke/proof-shot.mjs [--out pasta] [--chrome caminho]
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const out = arg("out", mkdtempSync(join(tmpdir(), "aurora-proof-shots-")));
mkdirSync(out, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), "aurora-proof-"));
process.env.HARNESS_DB_FILE = join(temp, "harness.db");
process.env.EMBEDDINGS_ENABLED = "false";

const store = await import("../../app/store.js");
const { createServer } = await import("../../app/server.js");
const { proveAnswer, documentProofs } = await import("../../app/proof.js");

const sheet = {
  tool: "read_file",
  args: { path: "C:\\Users\\voce\\Documents\\Vendas Outubro 2026.xlsx" },
  result: [
    "    1  ## Outubro",
    "    2  Vendedor | Região | Meta | Vendido | % da meta",
    "    3  Ana Souza | Sul | R$ 120.000,00 | R$ 98.400,00 | 82%",
    "    4  Bruno Lima | Norte | R$ 90.000,00 | R$ 101.250,00 | 112,5%",
    "    5  Carla Dias | Sudeste | R$ 150.000,00 | R$ 87.000,00 | 58%",
  ].join("\n"),
};
const answer = [
  "Só o **Bruno Lima** bateu a meta em outubro: vendeu **R$ 101.250,00**, ou **112,5%** da meta de R$ 90.000,00.",
  "",
  "- A equipe vendeu **R$ 286.650,00** no total, **R$ 73.350,00** abaixo da meta somada de R$ 360.000,00.",
  "- A Carla ficou mais longe: **58%**.",
  "- Comissão prevista do Bruno: **R$ 5.062,50**.",
].join("\n");
const proof = proveAnswer(answer, { sources: [sheet], asked: ["quem bateu a meta de vendas em outubro?"] });

const conv = await store.createConversation({ provider: "local", title: "Metas de outubro" });
await store.addMessage({ conversationId: conv.id, role: "user", content: "quem bateu a meta de vendas em outubro?", provider: "local" });
const reportText = [
  "# Metas de outubro", "",
  "| Vendedor | Vendido | % da meta |", "|---|---|---|",
  "| Bruno Lima | R$ 101.250,00 | 112,5% |",
  "| Ana Souza | R$ 98.400,00 | 82% |",
  "| Carla Dias | R$ 87.000,00 | 58% |", "",
  "Total: R$ 286.650,00.",
].join("\n");
const report = { tool: "write_document", ok: true, summary: "Criei C:\\Users\\voce\\Documents\\Metas de outubro.docx (DOCX, 14 KB).", args: { path: "Metas de outubro.docx", content: reportText } };
const steps = [{ tool: "read_file", args: sheet.args, ok: true, summary: "Leu Vendas Outubro 2026.xlsx" }, report];
await store.addMessage({ conversationId: conv.id, role: "assistant", content: answer, provider: "local", execution: { toolSteps: steps, proof, documentProofs: documentProofs(steps, { sources: [sheet] }) } });

const server = createServer({ allowDev: false, centralSync: false, agentScheduler: false, warmLocal: false });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;
const { chromium } = await import("playwright");
const browser = await chromium.launch({ headless: true, ...(arg("chrome") ? { executablePath: arg("chrome") } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, colorScheme: arg("theme", "dark") });
const problems = [];
page.on("pageerror", (e) => problems.push(e.message));
await page.goto(url);
await page.waitForTimeout(2000);
for (const label of ["Pular", "Agora não", "Fechar", "Começar"]) { const b = page.getByRole("button", { name: label }); if (await b.count()) await b.first().click().catch(() => {}); }
await page.getByText("Metas de outubro").first().click();
await page.waitForTimeout(1500);
const marks = page.locator("mark.proof-mark");
const count = await marks.count();
await page.screenshot({ path: join(out, "1_resposta.png") });
await marks.first().hover();
await page.waitForTimeout(400);
await page.screenshot({ path: join(out, "2_celula.png") });
const missing = page.locator("mark.proof-mark.sem-prova");
if (await missing.count()) { await missing.first().hover(); await page.waitForTimeout(400); await page.screenshot({ path: join(out, "3_sem_fonte.png") }); }
await page.mouse.move(5, 5);
await page.locator(".proof-seal-head").click();
await page.mouse.move(5, 5);
await page.waitForTimeout(400);
await page.screenshot({ path: join(out, "4_comprovante.png"), fullPage: true });
// "Baixar comprovante": the CSV for Excel, one line per number.
const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Baixar comprovante/ }).click()]);
const csvPath = join(out, "comprovante.csv");
await file.saveAs(csvPath);
const { readFileSync } = await import("node:fs");
console.log(readFileSync(csvPath, "utf8").split("\r\n").slice(0, 4).join("\n"));
console.log(JSON.stringify({ out, marks: count, seal: proof.seal, proven: proof.proven, total: proof.total, problems }, null, 1));
await browser.close();
server.close();
process.exit(problems.length ? 1 : 0);
