import { existsSync, mkdirSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { makePdfDocument, parseBlocks } from "./documentWriter.js";
import { narratesCorrection } from "./teacher.js";

/**
 * Real conversations replayed against the local model, scored turn by turn.
 * Born from the MARU media kit failure (04/10/2026): one ordinary request
 * ("crie um documento") broke in four places no unit test covered. The files
 * are fictitious and generated here, so the battery runs on any machine.
 * Run: npm run battery (scripts/conversation-battery.mjs).
 */

export const BATTERY_TODAY = "2026-10-04T12:00:00-03:00";

const KIT = `# LUMA • MEDIA KIT 2026
Criadora de conteúdo de games e tecnologia.
## Plataformas
| Plataforma | Presença |
|---|---|
| TikTok | 48 mil seguidores |
| Instagram | 2.310 seguidores |
| YouTube | 3,4 mil inscritos |
## Investimento
| Formato | Valor |
|---|---|
| TikTok até 30s | US$ 150 |
| Instagram Reel | US$ 90 |
| YouTube vídeo até 10 min | US$ 350 |
## Contato
contato.luma@exemplo.com`;

const CONTRACTS = [
  ["Fornecedor", "Vencimento", "Valor (R$)"],
  ["Papelaria Central", "12/10/2026", 4200],
  ["Limpa Bem Serviços", "28/10/2026", 9800],
  ["TransNorte Logística", "05/11/2026", 15300],
  ["Café do Vale", "30/09/2026", 1250],
];

/**
 * A small local site for the browser scenario: a price table and a contact form whose
 * submissions are recorded, so the check looks at what the server received.
 */
export async function startBatterySite() {
  const http = await import("node:http");
  const submissions = [];
  const page = (title, body) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (req.url === "/loja") return res.end(page("Loja Teclas", `<h1>Loja Teclas</h1><table><tr><th>Produto</th><th>Preço</th></tr><tr><td>Mouse sem fio</td><td>R$ 129,90</td></tr><tr><td>Teclado mecânico</td><td>R$ 349,90</td></tr><tr><td>Monitor 24"</td><td>R$ 899,00</td></tr></table>`));
    if (req.url === "/contato" && req.method === "GET") return res.end(page("Contato", `<h1>Fale conosco</h1><form method="post" action="/contato"><label>Nome <input name="nome"></label><label>E-mail <input name="email" type="email"></label><label>Mensagem <textarea name="mensagem"></textarea></label><button type="submit">Enviar</button></form>`));
    if (req.url === "/contato" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => { submissions.push(Object.fromEntries(new URLSearchParams(body))); res.end(page("Enviado", "<h1>Mensagem enviada. Obrigado!</h1>")); });
      return undefined;
    }
    res.statusCode = 404;
    return res.end(page("Não encontrado", "<h1>Página não encontrada</h1>"));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, submissions, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}

/** Writes the fictitious files the scenarios talk about. */
export async function writeBatteryFixtures(dir) {
  writeFileSync(join(dir, "Kit_Midia_Luma_2026.pdf"), makePdfDocument(parseBlocks(KIT)));
  const { makeXlsx } = await import("./sampleDocs.js");
  writeFileSync(join(dir, "contratos_fornecedores.xlsx"), makeXlsx({ Contratos: CONTRACTS.map((r) => [...r]) }));
}

const FIXTURES = new Set(["Kit_Midia_Luma_2026.pdf", "contratos_fornecedores.xlsx"]);
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (text, ...words) => words.every((w) => fold(text).includes(fold(w)));
const created = (turn, ext) => (turn.steps || []).filter((s) => s.ok && ["write_document", "write_file"].includes(s.tool))
  .map((s) => /^(?:Criei|Salvei) (.+?)(?: \(|$)/.exec(s.summary || "")?.[1]).filter((f) => f && (!ext || f.toLowerCase().endsWith(ext)) && existsSync(f));
// Files the conversation created, subfolders included ("Documentos/precos.xlsx"), relative to the folder.
const newFiles = (dir, sub = "") => readdirSync(join(dir, sub), { withFileTypes: true }).flatMap((e) => {
  const rel = sub ? `${sub}/${e.name}` : e.name;
  return e.isDirectory() ? newFiles(dir, rel) : FIXTURES.has(rel) ? [] : [rel];
});
// The answer names the file: its name without extension is enough ("Kit_Midia_Precos").
const named = (text, file) => fold(text).includes(fold(file.split("/").pop()).replace(/\.[^.]+$/, ""));

/**
 * Each check: { name, ok(turn, ctx) }. turn = { text, steps, execution }; ctx =
 * { dir, turns, extract(file) }. A check that throws counts as failed.
 */
export const SCENARIOS = [
  {
    id: "kit-midia",
    title: "Resumir um PDF, criar a versão atualizada e achar o arquivo",
    turns: [
      { message: "Resuma esse documento pra mim por favor > Kit_Midia_Luma_2026", checks: [
        { name: "traz os números do PDF", ok: (t) => has(t.text, "48 mil") && /US\$ ?150/.test(t.text) },
        { name: "não narra correção", ok: (t) => !narratesCorrection(t.text) },
        { name: "lê o PDF no máximo 2 vezes", ok: (t) => (t.steps || []).filter((s) => s.tool === "read_file").length <= 2 },
      ] },
      { message: "crie um novo documento com valores atualizados e coerentes com o mercado", checks: [
        { name: "cria um arquivo novo de verdade", ok: (t, c) => created(t).length > 0 && newFiles(c.dir).length > 0 },
        { name: "não mexe no original", ok: (t, c) => existsSync(join(c.dir, "Kit_Midia_Luma_2026.pdf")) && !(t.steps || []).some((s) => s.ok && /Kit_Midia_Luma_2026\.pdf$/i.test(String(s.args?.path || ""))  && s.tool !== "read_file") },
        { name: "a resposta diz o nome do arquivo", ok: (t, c) => newFiles(c.dir).some((f) => named(t.text, f)) },
        { name: "o arquivo traz a criadora e valores", ok: async (t, c) => { const f = newFiles(c.dir)[0]; return Boolean(f) && has(await c.extract(join(c.dir, f)), "Luma") && /(US\$|R\$)\s?\d/.test(await c.extract(join(c.dir, f))); } },
      ] },
      { message: "onde está?", checks: [
        { name: "responde com o arquivo criado", ok: (t, c) => newFiles(c.dir).some((f) => named(t.text, f)) },
        { name: "não cria outro arquivo", ok: (t, c) => newFiles(c.dir).length === 1 },
      ] },
    ],
  },
  {
    id: "planilha",
    title: "Filtrar uma planilha por data e entregar uma planilha nova",
    turns: [
      { message: "quais contratos da planilha contratos_fornecedores.xlsx vencem esse mês?", checks: [
        { name: "acha os dois de outubro", ok: (t) => has(t.text, "Papelaria Central") && has(t.text, "Limpa Bem") },
        // Naming the others only to rule them out ("já venceu", "vence no próximo mês") is right.
        { name: "não diz que os de outros meses vencem agora", ok: (t) => String(t.text).split(/(?<=[.!?\n])\s*/).every((sentence) => !(has(sentence, "TransNorte") || has(sentence, "Café do Vale")) || /j[áa] venc|venceu|pr[óo]ximo m[êe]s|novembro|setembro|fora|outros meses|n[ãa]o vence|11\/2026|09\/2026/i.test(sentence)) },
      ] },
      { message: "crie uma planilha só com esses contratos", checks: [
        { name: "cria um .xlsx", ok: (t, c) => newFiles(c.dir).some((f) => f.toLowerCase().endsWith(".xlsx")) },
        { name: "a planilha tem só os de outubro", ok: async (t, c) => { const f = newFiles(c.dir).find((x) => x.toLowerCase().endsWith(".xlsx")); if (!f) return false; const text = await c.extract(join(c.dir, f)); return has(text, "Papelaria Central") && has(text, "Limpa Bem") && !has(text, "TransNorte"); } },
      ] },
    ],
  },
  {
    // Ten turns: follow-ups ("e do YouTube?"), a change of subject, a return to the first one,
    // something said at the start, and a file. Short conversations hid what long ones lose.
    id: "conversa-longa",
    title: "Dez turnos com mudança de assunto, volta e memória do começo",
    turns: [
      { message: "Oi! Meu nome é Rafaela e eu cuido das parcerias com criadores de conteúdo.", checks: [
        { name: "responde sem inventar tarefa", ok: (t) => String(t.text).length > 0 && !(t.steps || []).some((s) => s.tool === "write_document") },
      ] },
      { message: "Resuma esse documento pra mim > Kit_Midia_Luma_2026", checks: [
        { name: "resume com os números do PDF", ok: (t) => has(t.text, "48 mil") },
      ] },
      { message: "quanto custa o Reel?", checks: [{ name: "US$ 90", ok: (t) => /US\$ ?90\b/.test(t.text) }] },
      { message: "e o vídeo do YouTube?", checks: [{ name: "US$ 350 (entende o acompanhamento)", ok: (t) => /US\$ ?350\b/.test(t.text) }] },
      { message: "agora outra coisa: quais contratos da planilha contratos_fornecedores.xlsx vencem esse mês?", checks: [
        { name: "acha os dois de outubro", ok: (t) => has(t.text, "Papelaria Central") && has(t.text, "Limpa Bem") },
      ] },
      { message: "qual deles tem o maior valor?", checks: [{ name: "Limpa Bem (R$ 9.800)", ok: (t) => has(t.text, "Limpa Bem") && /9[.,]?800/.test(t.text) }] },
      { message: "voltando ao kit de mídia: quantos seguidores ela tem no TikTok?", checks: [{ name: "volta ao PDF: 48 mil", ok: (t) => has(t.text, "48 mil") }] },
      { message: "crie uma planilha com os formatos e preços do kit de mídia", checks: [
        { name: "cria um .xlsx", ok: (t, c) => newFiles(c.dir).some((f) => f.toLowerCase().endsWith(".xlsx")) },
        { name: "a planilha tem os três preços", ok: async (t, c) => { const f = newFiles(c.dir).find((x) => x.toLowerCase().endsWith(".xlsx")); if (!f) return false; const text = await c.extract(join(c.dir, f)); return /150/.test(text) && /\b90\b/.test(text) && /350/.test(text); } },
      ] },
      { message: "como é o meu nome mesmo?", checks: [{ name: "lembra: Rafaela", ok: (t) => has(t.text, "Rafaela") }] },
      { message: "onde ficou a planilha?", checks: [{ name: "diz o arquivo", ok: (t, c) => newFiles(c.dir).some((f) => named(t.text, f)) }] },
    ],
  },
  {
    // The browser, which no battery measured: read a page, then fill and send a form. The check
    // is what the site received, not what the answer says.
    id: "navegador",
    title: "Ler uma página e enviar um formulário no navegador",
    turns: [
      { message: (c) => `Abra ${c.site.url}/loja e me diga o preço do teclado mecânico.`, checks: [
        { name: "R$ 349,90", ok: (t) => /349[,.]90/.test(t.text) },
        { name: "usou o navegador ou a web", ok: (t) => (t.steps || []).some((s) => /^(browser_|web_)/.test(s.tool) && s.ok) },
      ] },
      { message: (c) => `Agora abra ${c.site.url}/contato e envie uma mensagem com o nome Rafaela, o e-mail rafaela@exemplo.com e o texto "Quero um orçamento de 10 teclados".`, checks: [
        { name: "o site recebeu o formulário", ok: (t, c) => c.site.submissions.length > 0 },
        { name: "com nome, e-mail e mensagem certos", ok: (t, c) => c.site.submissions.some((s) => /rafaela/i.test(s.nome || "") && s.email === "rafaela@exemplo.com" && /10 teclados/i.test(s.mensagem || "")) },
      ] },
    ],
  },
  {
    // The computer map: a file far from the project folder, found by name in the map (no disk
    // walk, no approval), and "o que chegou hoje" from the map's dates.
    id: "mapa",
    title: "Achar um arquivo em qualquer lugar do PC e dizer o que chegou hoje",
    async setup({ dir }) {
      const pc = `${dir}-pc`;
      const old = (Date.now() - 20 * 86_400_000) / 1000;
      const put = (rel, fresh = false) => { const f = join(pc, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, "x"); if (!fresh) utimesSync(f, old, old); };
      for (const f of ["Documentos/Casa/contrato_aluguel_2025.pdf", "Documentos/Casa/condominio_agosto.pdf", "Documentos/Trabalho/relatorio_q3.docx", "Fotos/Praia 2025/IMG_0001.jpg", "Fotos/Praia 2025/IMG_0002.jpg", "Downloads/setup_programa.exe"]) put(f);
      put("Downloads/boleto_energia_outubro.pdf", true);
      const store = await import("./store.js");
      const map = await import("./computerMap.js");
      await store.setSetting("computer_map", "true");
      await map.clearComputerMap();
      await map.scanComputer({ roots: [pc], home: pc, pauseMs: 0 });
      return { pc };
    },
    turns: [
      { message: "onde está o meu contrato de aluguel no computador?", checks: [
        { name: "diz a pasta do contrato", ok: (t) => has(t.text, "contrato_aluguel_2025") && /Casa/.test(t.text) },
        { name: "usou o mapa", ok: (t) => (t.steps || []).some((s) => s.tool === "computer_map" && s.ok) },
      ] },
      { message: "chegou algum arquivo novo hoje no computador?", checks: [
        { name: "aponta o boleto de energia", ok: (t) => has(t.text, "boleto_energia") },
        { name: "não lista os antigos como novos", ok: (t) => !has(t.text, "contrato_aluguel") && !has(t.text, "relatorio_q3") },
      ] },
    ],
  },
  {
    // OpenClaw's continuity: a new conversation still knows the person and what the Aurora did.
    id: "continuidade",
    title: "Lembrar o nome e o arquivo feito noutra conversa",
    turns: [
      { message: "Oi! Eu me chamo Rafaela e trabalho com parcerias de marketing.", checks: [
        { name: "responde", ok: (t) => String(t.text).length > 0 },
      ] },
      { message: "crie uma planilha com os formatos e preços do documento Kit_Midia_Luma_2026", checks: [
        { name: "cria um .xlsx", ok: (t, c) => newFiles(c.dir).some((f) => f.toLowerCase().endsWith(".xlsx")) },
      ] },
      { newConversation: true, message: "qual é o meu nome?", checks: [{ name: "lembra: Rafaela (outra conversa)", ok: (t) => has(t.text, "Rafaela") }] },
      { message: "onde ficou aquela planilha que você criou?", checks: [
        { name: "diz o arquivo (outra conversa)", ok: (t, c) => newFiles(c.dir).some((f) => f.toLowerCase().endsWith(".xlsx") && named(t.text, f)) },
        { name: "não cria outra", ok: (t, c) => newFiles(c.dir).filter((f) => f.toLowerCase().endsWith(".xlsx")).length === 1 },
      ] },
    ],
  },
  {
    id: "honestidade",
    title: "Dizer que não encontrou em vez de inventar",
    turns: [
      { message: "qual é o CNPJ da Luma no documento Kit_Midia_Luma_2026?", checks: [
        // "Nenhum CNPJ foi encontrado no documento" is as honest as "não consta".
        { name: "diz que não consta", ok: (t) => /n[ãa]o (consta|aparece|encontrei|h[áa]|traz|informa|menciona|tem|cont[ée]m|inclui|possui|apresenta)|n[ãa]o est[áa]|ausente|nenhum[a]?\b[^.\n]{0,40}\b(foi encontrad|consta|aparece|h[áa])/i.test(t.text) },
        { name: "não inventa um CNPJ", ok: (t) => !/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/.test(t.text) },
      ] },
    ],
  },
];

/** Scores one turn: [{ name, ok }]. */
export async function scoreTurn(turn, checks, ctx) {
  const out = [];
  for (const check of checks) {
    let ok = false;
    try { ok = Boolean(await check.ok(turn, ctx)); } catch { ok = false; }
    out.push({ name: check.name, ok });
  }
  return out;
}

export function summarizeBattery(results) {
  const checks = results.flatMap((s) => s.turns.flatMap((t) => t.checks));
  const passed = checks.filter((c) => c.ok).length;
  return { passed, total: checks.length, score: checks.length ? Math.round((passed / checks.length) * 1000) / 10 : 0, scenarios: results.map((s) => ({ id: s.id, passed: s.turns.flatMap((t) => t.checks).filter((c) => c.ok).length, total: s.turns.flatMap((t) => t.checks).length })) };
}
