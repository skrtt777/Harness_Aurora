// Laboratório do Mapa Vivo de Memórias: um banco temporário com memórias de teste (gravadas pelo próprio
// store, com embeddings reais), o servidor de teste e o Chromium do Playwright abrindo Memórias / Mapa Vivo.
// Nunca o banco nem o app da pessoa. Tira capturas da visão geral, de um agrupamento em foco, de uma memória
// selecionada e da atividade ao vivo (memórias criadas e consultadas durante a captura).
//   node scripts/livemap-lab/lab.mjs [--memories 1000] [--out pasta] [--chrome caminho] [--no-embed]
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const total = Number(arg("memories", 1000));
const out = arg("out", mkdtempSync(join(tmpdir(), "aurora-livemap-shots-")));
mkdirSync(out, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), "aurora-livemap-lab-"));
process.env.HARNESS_DB_FILE = join(temp, "harness.db");
if (process.argv.includes("--no-embed")) process.env.EMBEDDINGS_ENABLED = "false";

const store = await import("../../app/store.js");
const { emitMemoryEvent } = await import("../../app/memoryEvents.js");
const { createServer } = await import("../../app/server.js");

// ---- test memories: realistic themes, spread over projects and conversations ----
const THEMES = {
  Vendas: ["meta de vendas do trimestre", "ticket médio por região", "clientes que mais compram", "comissão dos vendedores", "funil de propostas abertas", "desconto máximo autorizado", "previsão de vendas de dezembro", "devoluções do mês"],
  Financeiro: ["contas a pagar atrasadas", "fluxo de caixa semanal", "conciliação bancária", "boletos a vencer", "centro de custo do marketing", "orçamento anual por área", "notas fiscais de serviço", "impostos do mês"],
  RH: ["férias programadas", "admissões de outubro", "vale-refeição", "banco de horas", "treinamentos obrigatórios", "avaliação de desempenho", "folha de pagamento", "aniversariantes do mês"],
  Operações: ["estoque mínimo do almoxarifado", "pedidos de compra pendentes", "prazo de entrega dos fornecedores", "manutenção das máquinas", "inventário trimestral", "logística de distribuição", "ordens de serviço abertas", "controle de qualidade"],
  "Projeto Aurora": ["modelo local qwen3.5", "bateria de conversas", "espelho com valores falsos", "gateway do WhatsApp", "mapa vivo de memórias", "professor cego", "agentes de setor", "escritório em pixel art"],
};
const GENERAL = ["prefere respostas curtas e diretas", "trabalha em Recife, horário de Brasília", "usa Windows com placa de vídeo", "quer gráficos nativos no PowerPoint", "não gosta de emojis nas respostas", "escreve em português do Brasil", "prioriza testes antes de publicar", "gosta de relatórios em Word com tabela no fim"];
const pick = (list, i) => list[i % list.length];
const projects = {};
for (const name of Object.keys(THEMES)) projects[name] = await store.createProject({ name });
const conversations = [];
for (const [name, p] of Object.entries(projects)) for (let c = 0; c < 4; c += 1) conversations.push({ theme: name, conv: await store.createConversation({ provider: "local", projectId: p.id, title: `${name}: ${pick(THEMES[name], c * 3)}` }) });
const loose = [];
for (let c = 0; c < 5; c += 1) loose.push(await store.createConversation({ provider: "local", title: ["Ideias soltas", "Viagem de trabalho", "Lista de compras do escritório", "Dúvidas do Excel", "Planejamento pessoal"][c] }));

const started = Date.now();
const ids = [];
console.log(`gravando ${total} memórias de teste (${process.env.EMBEDDINGS_ENABLED === "false" ? "sem" : "com"} embeddings)…`);
for (let i = 0; i < total; i += 1) {
  const r = i % 10;
  let m;
  if (r === 0) m = await store.createMemory({ scope: "global", title: `${pick(GENERAL, i)} (${i})`, content: `A pessoa ${pick(GENERAL, i)}. Registro ${i}.`, tags: ["preferência"], dedupe: false });
  else if (r <= 4) {
    const theme = pick(Object.keys(THEMES), i * 7 + r);
    const topic = pick(THEMES[theme], i);
    m = await store.createMemory({ scope: "project", projectId: projects[theme].id, title: `${topic[0].toUpperCase()}${topic.slice(1)} — nota ${i}`, content: `${theme}: ${topic}. Anotação ${i} feita durante o trabalho no projeto.`, tags: [theme.toLowerCase()], dedupe: false });
  } else if (r <= 8) {
    const { theme, conv } = pick(conversations, i * 3 + r);
    const topic = pick(THEMES[theme], i + 1);
    m = await store.createMemory({ scope: "conversation", conversationId: conv.id, title: `Combinado sobre ${topic} (${i})`, content: `Na conversa "${conv.title}", ficou combinado: ${topic}. Item ${i}.`, dedupe: false });
  } else {
    const conv = pick(loose, i);
    m = await store.createMemory({ scope: "conversation", conversationId: conv.id, kind: i % 20 === 9 ? "imported" : "extracted", title: `${conv.title}: ponto ${i}`, content: `Anotação ${i} da conversa ${conv.title}.`, dedupe: false });
  }
  ids.push(m.id);
  if (i > 0 && i % 7 === 0) await store.createRelation({ fromId: m.id, toId: ids[Math.floor(i / 2)], type: ["derivation", "thematic", "correction", "belonging"][i % 4] }).catch(() => {});
  if (i % 200 === 199) console.log(`  ${i + 1} (${Math.round((Date.now() - started) / 1000)} s)`);
}

// For the Zeladora: copies (extracted, so she may join them) and two memories that disagree on a value.
for (let c = 0; c < 3; c += 1) {
  await store.createMemory({ scope: "project", projectId: projects.Vendas.id, kind: "extracted", dedupe: false, title: "Fechamento de vendas do mês", content: "O fechamento de vendas do mês é feito no último dia útil, com o relatório por vendedor enviado ao comercial." });
}
await store.createMemory({ scope: "project", projectId: projects.Vendas.id, kind: "extracted", dedupe: false, title: "Meta de vendas do Sul", content: "A meta de vendas da região Sul em outubro é de 263 mil reais." });
await store.createMemory({ scope: "project", projectId: projects.Vendas.id, kind: "extracted", dedupe: false, title: "Meta de vendas do Sul atualizada", content: "A meta de vendas da região Sul em outubro é de 280 mil reais." });

// …and one thought said twice with a detail more (she compacts them into one, keeping both sentences).
await store.createMemory({ scope: "project", projectId: projects.Vendas.id, kind: "extracted", dedupe: false, title: "Cliente Atlas: pagamento", content: "O cliente Atlas paga sempre por boleto e pede a nota fiscal antes do pagamento." });
await store.createMemory({ scope: "project", projectId: projects.Vendas.id, kind: "extracted", dedupe: false, title: "Cliente Atlas: pagamento e contato", content: "O cliente Atlas paga sempre por boleto e pede a nota fiscal antes do pagamento. Contato com a Joana do financeiro." });

const keeperPace = Number(arg("keeper-pace", 350));
const server = createServer({ centralSync: false, agentScheduler: false, warmLocal: false, memoryKeeper: { paceMs: keeperPace, firstDelayMs: 1000, restMs: 600_000 } });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;
console.log(`servidor de teste: ${url}`);

const { chromium } = await import("playwright");
const browser = await chromium.launch({ headless: true, ...(arg("chrome") ? { executablePath: arg("chrome") } : {}), args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(url);
await page.waitForTimeout(2500);
// The onboarding may show first in a new database: skip it the same way a person would.
for (const label of ["Pular", "Agora não", "Fechar", "Começar"]) { const b = page.getByRole("button", { name: label }); if (await b.count()) await b.first().click().catch(() => {}); }
await page.getByRole("button", { name: /Mapa Vivo/ }).click();
await page.waitForSelector(".livemap canvas", { timeout: 30_000 });
await page.waitForTimeout(5000);
await page.screenshot({ path: join(out, "01_visao_geral.png") });
const fps = await page.evaluate(() => new Promise((resolve) => { let n = 0; const t0 = performance.now(); const tick = () => { n += 1; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else resolve(Math.round(n / ((performance.now() - t0) / 1000))); }; requestAnimationFrame(tick); }));
console.log(`quadros por segundo (headless): ${fps}`);

// A cluster in focus (from the strip of indicators), then a memory selected from the "consultadas" path.
await page.locator(".lm-bars li > button:first-child").nth(1).click();
await page.waitForTimeout(2500);
await page.screenshot({ path: join(out, "02_agrupamento_em_foco.png") });

// The Zeladora walking: a few moments of her round.
await page.locator(".lm-side .lm-x").click().catch(() => {});
for (let k = 1; k <= 3; k += 1) {
  await page.waitForTimeout(5000);
  await page.screenshot({ path: join(out, `08_zeladora_${k}.png`) });
}
console.log("zeladora:", await page.locator(".lm-keeper").innerText().catch(() => "?"));
// A quick sequence: her steps, tentacles and what she says, a third of a second apart.
for (let k = 1; k <= 4; k += 1) { await page.waitForTimeout(330); await page.screenshot({ path: join(out, `11_anim_${k}.png`) }); }
console.log("balão:", await page.locator(".lm-bubble").first().innerText().catch(() => "?"));
// The person calls her to another section (the ⌖ button of the 3rd section).
await page.locator(".lm-call-mini").nth(2).click();
await page.waitForTimeout(3500);
await page.screenshot({ path: join(out, "10_chamado.png") });
console.log("depois do chamado:", await page.locator(".lm-bubble").first().innerText().catch(() => "?"));

// The brain working (not the Zeladora): a turn's events as the chat emits them, with memories of three
// different sections — the map draws the path from one to the next.
{
  const conv = conversations[0].conv.id;
  const picks = [ids[3], ids[47], ids[121]];
  emitMemoryEvent("turn-start", { conversationId: conv, message: "o que combinamos sobre comissão e férias?" });
  emitMemoryEvent("scanned", { conversationId: conv, candidates: [...picks, ids[5], ids[9], ids[13]].map((id, i) => ({ id, score: 3 - i * 0.3, similarity: 0.8 - i * 0.05 })) });
  await page.waitForTimeout(600);
  emitMemoryEvent("recalled", { conversationId: conv, ids: picks });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: join(out, "09_caminho_a_b.png") });
  emitMemoryEvent("answered", { conversationId: conv, ok: true, used: picks, created: [] });
  emitMemoryEvent("turn-end", { conversationId: conv });
}

// Live: new memories and a real recall event while the page watches.
const fresh = [];
for (let k = 0; k < 4; k += 1) fresh.push(await store.createMemory({ scope: "project", projectId: projects.Vendas.id, title: `Nova meta combinada ${k}`, content: `Meta nova ${k} definida agora.`, dedupe: false }));
emitMemoryEvent("recalled", { conversationId: conversations[0].conv.id, ids: [ids[1], ids[11], ids[21], ids[31], fresh[0].id] });
await page.waitForTimeout(900);
await page.screenshot({ path: join(out, "03_atividade_ao_vivo.png") });
await page.waitForTimeout(2500);

await page.fill(".lm-search", "comissão");
await page.press(".lm-search", "Enter");
await page.waitForTimeout(2500);
await page.screenshot({ path: join(out, "04_busca_e_memoria.png") });

// A real chat turn from the map's own chat (the local model answers): the Aurora walks through the map.
if (!process.argv.includes("--no-chat")) {
  await page.locator(".lm-side .lm-x").click().catch(() => {});
  await page.fill(".lm-search", "");
  // A conversation of the Vendas folder: its memories are the ones the search weighs.
  await page.selectOption(".lm-dock header select", conversations[0].conv.id);
  await page.waitForTimeout(800);
  const before = await page.locator(".lm-msg.assistant:not(.pending)").count();
  await page.fill(".lm-dock textarea", "Qual é a meta de vendas do trimestre e o que combinamos sobre a comissão dos vendedores?");
  await page.press(".lm-dock textarea", "Enter");
  const t0 = Date.now();
  let shot = 0;
  while (Date.now() - t0 < 180_000) {
    await page.waitForTimeout(1500);
    const phase = await page.locator(".lm-steps li.now b").first().textContent().catch(() => "");
    if (shot < 3 && phase && /busca|memórias no contexto/.test(phase)) { shot += 1; await page.screenshot({ path: join(out, `06_turno_${shot}_${phase.replace(/[^a-z]+/gi, "_")}.png`) }); }
    if ((await page.locator(".lm-msg.assistant:not(.pending)").count()) > before) break;
  }
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(out, "07_resposta_no_chat.png") });
  console.log(`turno pelo chat do mapa: ${Math.round((Date.now() - t0) / 1000)} s`);
}

await page.getByRole("button", { name: "por pasta / projeto" }).click();
await page.waitForTimeout(3500);
await page.screenshot({ path: join(out, "05_por_pasta.png") });

console.log(JSON.stringify({ out, fps, errors: errors.slice(0, 10) }, null, 1));
await browser.close();
server.close();
process.exit(0);
