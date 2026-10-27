// The resposta viva as the person sees it: a real Vendas.xlsx in a temporary folder, read by the real
// read_file, an answer proven against it (app/proof.js), then the sheet edited (Bruno's sale corrected,
// a seller added above him). The chat opened in Chromium rechecks it: the old numbers struck, the new
// ones beside them, the banner; /api/proof/stale lists it. Never the person's database, files or app.
//   node scripts/smoke/live-shot.mjs [--out pasta] [--chrome caminho]
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const out = arg("out", mkdtempSync(join(tmpdir(), "aurora-live-shots-")));
mkdirSync(out, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), "aurora-live-"));
process.env.HARNESS_DB_FILE = join(temp, "harness.db");
process.env.EMBEDDINGS_ENABLED = "false";

const store = await import("../../app/store.js");
const { createServer } = await import("../../app/server.js");
const { proveAnswer } = await import("../../app/proof.js");
const { liveIo } = await import("../../app/proofLive.js");
const { renderDocument } = await import("../../app/documentWriter.js");

const xlsx = join(temp, "Vendas Outubro.xlsx");
const sheet = (rows) => `## Outubro\n\n| Vendedor | Região | Meta | Vendido |\n|---|---|---|---|\n${rows.map((r) => `| ${r.join(" | ")} |`).join("\n")}`;
writeFileSync(xlsx, await renderDocument("xlsx", sheet([["Ana Souza", "Sul", 120000, 98400], ["Bruno Lima", "Norte", 90000, 101250], ["Carla Dias", "Sudeste", 150000, 87000]])));

// The turn: read_file as the model calls it, the answer, its proof.
const io = await liveIo({ request: "quem bateu a meta de vendas em outubro?" });
const step = { tool: "read_file", ok: true, args: { path: xlsx }, summary: "Leu Vendas Outubro.xlsx" };
const read = await io.replay(step, xlsx);
const answer = [
  "Só o **Bruno Lima** bateu a meta em outubro: vendeu **R$ 101.250,00**, acima da meta de R$ 90.000,00.",
  "",
  "- A equipe vendeu **R$ 286.650,00** no total, **R$ 73.350,00** abaixo da meta somada de R$ 360.000,00.",
  "- A Ana ficou em R$ 98.400,00 e a Carla em R$ 87.000,00.",
].join("\n");
const proof = proveAnswer(answer, { sources: [{ tool: "read_file", args: { path: xlsx }, result: read }], asked: ["quem bateu a meta de vendas em outubro?"] });
const conv = await store.createConversation({ provider: "local", title: "Metas de outubro" });
await store.addMessage({ conversationId: conv.id, role: "user", content: "quem bateu a meta de vendas em outubro?", provider: "local" });
await store.addMessage({ conversationId: conv.id, role: "assistant", content: answer, provider: "local", execution: { toolSteps: [step], proof } });

// Two days later, in Excel: Bruno's sale corrected and a new seller above him.
writeFileSync(xlsx, await renderDocument("xlsx", sheet([["Ana Souza", "Sul", 120000, 98400], ["Aline Rocha", "Centro", 60000, 50000], ["Bruno Lima", "Norte", 90000, 104800], ["Carla Dias", "Sudeste", 150000, 87000]])));
const later = new Date(Date.now() + 2 * 86_400_000);
utimesSync(xlsx, later, later);

const server = createServer({ allowDev: false, centralSync: false, agentScheduler: false, warmLocal: false });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;
const { staleAnswers } = await import("../../app/proofWatch.js");
const stale = { stale: await staleAnswers() };
const { chromium } = await import("playwright");
const browser = await chromium.launch({ headless: true, ...(arg("chrome") ? { executablePath: arg("chrome") } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, colorScheme: arg("theme", "dark") });
const problems = [];
page.on("pageerror", (e) => problems.push(e.message));
await page.goto(url);
await page.waitForTimeout(2000);
for (const label of ["Pular", "Agora não", "Fechar", "Começar"]) { const b = page.getByRole("button", { name: label }); if (await b.count()) await b.first().click().catch(() => {}); }
// The home lists the answer that went out of date; a click opens its conversation.
await page.getByRole("button", { name: /Nova conversa/ }).first().click().catch(() => {});
await page.waitForSelector(".home-stale", { timeout: 15000 }).catch(() => problems.push("o cartão Respostas que mudaram não apareceu"));
await page.screenshot({ path: join(out, "0_inicio.png") });
if (await page.locator(".home-stale button").count()) await page.locator(".home-stale button").first().click();
else await page.getByText("Metas de outubro").first().click();
await page.waitForSelector(".proof-live", { timeout: 15000 }).catch(() => problems.push("o aviso da resposta viva não apareceu"));
await page.waitForTimeout(800);
const struck = await page.locator("mark.proof-mark.mudou").count();
await page.screenshot({ path: join(out, "1_resposta_viva.png") });
const changed = page.locator("mark.proof-mark.mudou");
if (await changed.count()) { await changed.first().hover(); await page.waitForTimeout(400); await page.screenshot({ path: join(out, "2_mudou.png") }); }
await page.mouse.move(5, 5);
const banner = await page.locator(".proof-live").innerText().catch(() => "");
console.log(banner);
console.log(JSON.stringify({ out, seal: proof.seal, proven: proof.proven, total: proof.total, struck, stale: stale.stale?.map((s) => s.summary), problems }, null, 1));
await browser.close();
server.close();
process.exit(problems.length || !struck ? 1 : 0);
