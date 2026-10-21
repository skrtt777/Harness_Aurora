// Teste de fumaça da interface inteira: um banco temporário com alguns dados, o servidor de teste e o Chromium
// do Playwright abrindo cada página do menu, cada seção das Configurações e uma conversa nova. Registra erros
// de JavaScript, erros no console e respostas 4xx/5xx da API, com uma captura de cada tela. Nunca o banco nem
// o app da pessoa; não liga Telegram, WhatsApp nem agentes agendados.
//   node scripts/smoke/ui-smoke.mjs [--out pasta] [--chrome caminho]
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const out = arg("out", mkdtempSync(join(tmpdir(), "aurora-smoke-shots-")));
mkdirSync(out, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), "aurora-smoke-"));
process.env.HARNESS_DB_FILE = join(temp, "harness.db");
process.env.EMBEDDINGS_ENABLED = "false";

const store = await import("../../app/store.js");
const { createServer } = await import("../../app/server.js");
const project = await store.createProject({ name: "Projeto de teste" });
const conv = await store.createConversation({ provider: "local", projectId: project.id, title: "Conversa de teste" });
for (let i = 0; i < 12; i += 1) await store.createMemory({ scope: i % 3 ? "project" : "global", projectId: i % 3 ? project.id : null, title: `Memória de teste ${i}`, content: `Conteúdo de teste número ${i}, com algumas palavras para a busca.`, kind: "extracted", dedupe: false });
void conv;

const server = createServer({ allowDev: false, centralSync: false, agentScheduler: false, warmLocal: false });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const { chromium } = await import("playwright");
const browser = await chromium.launch({ headless: true, ...(arg("chrome") ? { executablePath: arg("chrome") } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
let where = "início";
page.on("pageerror", (e) => problems.push({ where, kind: "erro JS", text: e.message }));
page.on("console", (m) => { if (m.type() === "error") problems.push({ where, kind: "console", text: m.text().slice(0, 300) }); });
page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400) problems.push({ where, kind: `HTTP ${r.status()}`, text: `${r.request().method()} ${new URL(r.url()).pathname}` }); });

const shot = async (name) => { await page.screenshot({ path: join(out, `${name.replace(/[^\w-]+/g, "_")}.png`) }); };
await page.goto(url);
await page.waitForTimeout(2500);
for (const label of ["Pular", "Agora não", "Fechar", "Começar"]) { const b = page.getByRole("button", { name: label }); if (await b.count()) await b.first().click().catch(() => {}); }
await shot("00_inicio");

const pages = await page.locator(".sb-nav .sb-link").allInnerTexts();
for (let i = 0; i < pages.length; i += 1) {
  where = `página: ${pages[i].split("\n")[0]}`;
  await page.locator(".sb-nav .sb-link").nth(i).click();
  await page.waitForTimeout(2500);
  await shot(`10_${i}_${pages[i].split("\n")[0]}`);
  // Pages that take over the screen have a way back.
  const back = page.getByRole("button", { name: /Voltar/ });
  if (await back.count()) await back.first().click().catch(() => {});
}

where = "nova conversa";
await page.locator(".sb-new-main").click();
await page.waitForTimeout(1500);
await shot("20_nova_conversa");

where = "configurações";
const settings = page.getByRole("button", { name: /Configura/ }).first();
if (await settings.count()) {
  await settings.click();
  await page.waitForTimeout(1500);
  const sections = await page.locator(".settings-nav button").allInnerTexts();
  for (let i = 0; i < sections.length; i += 1) {
    where = `configurações: ${sections[i]}`;
    await page.locator(".settings-nav button").nth(i).click();
    await page.waitForTimeout(1200);
    await shot(`30_${i}_${sections[i]}`);
  }
} else problems.push({ where, kind: "faltando", text: "botão de Configurações não encontrado" });

console.log(JSON.stringify({ out, pages, problems }, null, 1));
await browser.close();
server.close();
process.exit(problems.length ? 1 : 0);
