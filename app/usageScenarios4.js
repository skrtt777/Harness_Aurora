// Testes de uso, bateria 4: pedidos pobres. A pessoa pede algo complexo com poucas palavras ("faz
// um convite pro niver da minha filha") e a entrega precisa sair completa e bem feita: as decisões
// tomadas sozinha, nada inventado, e as opções de ajuste no fim (app/briefs/*.md).
import { extractText } from "./docText.js";
import { any, fold, has, used, written } from "./usageScenarios.js";

/** The answer before the "Quer ajustar?" section (the delivery itself). */
const body = (t) => String(t.text).split(/\*{0,2}Quer ajustar\?/i)[0];
const words = (s) => String(s).split(/\s+/).filter(Boolean).length;
const adjust = { name: "opções de ajuste no fim", ok: (t) => /Quer ajustar\?/i.test(t.text) && (String(t.text).split(/Quer ajustar\?/i)[1].match(/^\s*\d[.)]\s+\S/gm) || []).length >= 2 };
const noFile = { name: "escrito na conversa (sem arquivo)", ok: (t) => !written(t).length };
const complete = (min = 60) => ({ name: "entrega pronta, não só perguntas", ok: (t) => words(body(t)) >= min });
const fileText = async (t, ...exts) => { const f = written(t).find((x) => exts.some((e) => x.toLowerCase().endsWith(e))); return f ? fold(await extractText(f).catch(() => "")) : ""; };

export const POOR_SCENARIOS = [
  // ---------- pessoa comum ----------
  { id: "convite-pobre", level: "N1", group: "pessoal", persona: "Jorge", turns: [{ message: "faz um convite pro niver da minha filha", checks: [
    complete(30),
    { name: "sem data, hora ou local inventados", ok: (t) => !/\b\d{1,2}\/\d{1,2}\b|\b\d{1,2}h\d{0,2}\b|\brua\s+\w/i.test(body(t)) },
    { name: "pede ou marca os dados que faltam", ok: (t) => any(t.text, "[data", "[hora", "[local", "[nome", "qual a data", "me diz", "me fala", "me passa", "me conta") },
    noFile, adjust,
  ] }] },
  { id: "convite-detalhado", level: "N1", group: "pessoal", persona: "Jorge", turns: [{ message: "faz um convite pro aniversario de 7 anos da Laura, dia 25/10 as 15h aqui em casa, tema frozen", checks: [
    { name: "com Laura, 7 anos, 25/10, 15h e o tema", ok: (t) => has(t.text, "laura") && /\b7\b|sete/i.test(t.text) && /25\/10|25 de outubro/i.test(t.text) && /15h|15:00|15 horas|3 da tarde/i.test(t.text) && has(t.text, "frozen") },
    { name: "pede confirmação", ok: (t) => any(t.text, "confirm") },
    adjust,
  ] }] },
  { id: "email-chefe", level: "N1", group: "pessoal", persona: "Jorge", turns: [{ message: "escreve um email pro meu chefe pedindo pra sair mais cedo sexta pq tenho medico", checks: [
    { name: "assunto, sexta e o motivo", ok: (t) => has(t.text, "assunto") && has(t.text, "sexta") && any(t.text, "medic", "consulta") },
    { name: "curto (até ~200 palavras)", ok: (t) => words(body(t)) <= 200 },
    noFile, adjust,
  ] }] },
  { id: "legenda-bolo", level: "N1", group: "pessoal", persona: "Jorge", turns: [{ message: "faz uma legenda pro insta da minha loja de bolo caseiro", checks: [
    { name: "hashtags (3 ou mais)", ok: (t) => (body(t).match(/#[\p{L}\d_]+/gu) || []).length >= 3 },
    { name: "chamada para ação", ok: (t) => any(body(t), "direct", "dm", "encomend", "peça", "peca", "chama", "link na bio", "whats") },
    { name: "sem preço ou telefone inventado", ok: (t) => !/R\$\s?\d|\(\d{2}\)\s?\d{4,5}-?\d{4}|\b9\d{4}-\d{4}\b/.test(body(t)) },
    adjust,
  ] }] },
  { id: "desculpa-amiga", level: "N1", group: "pessoal", persona: "Jorge", turns: [{ message: "me ajuda a pedir desculpa pra minha amiga, esqueci o aniversario dela", checks: [
    { name: "a mensagem pronta", ok: (t) => any(body(t), "desculp", "perdão", "perdao") && any(body(t), "anivers") && words(body(t)) >= 25 },
    noFile, adjust,
  ] }] },
  { id: "planilha-gastos", level: "N2", group: "pessoal", persona: "Jorge", turns: [{ message: "quero uma planilha pra controlar meus gastos", checks: [
    { name: "cria uma planilha .xlsx", ok: (t) => written(t, ".xlsx").length > 0 },
    { name: "categoria, valor e total", ok: async (t) => { const x = await fileText(t, ".xlsx"); return x.includes("categoria") && x.includes("valor") && x.includes("total"); } },
    { name: "5 ou mais categorias sugeridas", ok: async (t) => { const x = await fileText(t, ".xlsx"); return ["mercado", "moradia", "aluguel", "contas", "transporte", "saude", "lazer", "educacao", "alimentacao", "outros"].filter((c) => x.includes(c)).length >= 5; } },
    adjust,
  ] }] },
  { id: "curriculo-vaga", level: "N2", group: "pessoal", persona: "Marta", turns: [{ message: "preciso arrumar meu curriculo pra uma vaga de recepcionista", checks: [
    { name: "lê o currículo dela", ok: (t) => (t.steps || []).some((s) => s.ok && s.tool === "read_file" && /curriculo/i.test(s.args ? JSON.stringify(s.args) : s.summary || "")) || has(t.text, "marta") },
    { name: "currículo novo voltado à vaga", ok: async (t) => { const x = await fileText(t, ".docx", ".pdf"); return x.includes("marta") && x.includes("recepcion"); } },
    adjust,
  ] }] },
  { id: "slides-escola", level: "N3", group: "pessoal", persona: "Jorge", turns: [{ message: "faz uns slides sobre reciclagem pro trabalho da escola", checks: [
    { name: "6 ou mais slides", ok: async (t) => { const x = (await fileText(t, ".docx", ".pptx", ".pdf")) || fold(t.text); return (x.match(/slide\s*\d+/g) || []).length >= 6 || (x.match(/\n#+\s|\n\d+\.\s/g) || []).length >= 6; } },
    { name: "conteúdo do tema", ok: async (t) => { const x = (await fileText(t, ".docx", ".pptx", ".pdf")) || fold(t.text); return x.includes("reciclag") && any(x, "papel", "plastico", "vidro", "metal", "coleta seletiva"); } },
    adjust,
  ] }] },
  { id: "roteiro-salvador", level: "N3", group: "pessoal", persona: "Jorge", turns: [{ message: "monta um roteiro de viagem pra salvador", checks: [
    { name: "dividido por dia (2 ou mais)", ok: (t) => (fold(t.text).match(/dia\s*[1-9]\b|\b[1-9]º dia/g) || []).length >= 2 || written(t).length > 0 },
    { name: "lugares de Salvador", ok: (t) => any(t.text, "pelourinho", "barra", "elevador lacerda", "mercado modelo", "bonfim", "rio vermelho", "itapu") },
    { name: "diz o que decidiu (dias ou orçamento)", ok: (t) => any(t.text, "dias", "economic", "orcament", "orçament", "considerei", "escolhi", "supondo") },
    adjust,
  ] }] },
  { id: "celular-1500", level: "N3", group: "pessoal", persona: "Jorge", turns: [{ message: "qual o melhor celular ate 1500 reais", checks: [
    { name: "recomenda e compara opções", ok: (t) => any(t.text, "recomend", "indico", "melhor escolha", "minha sugest") && (fold(t.text).match(/samsung|motorola|xiaomi|redmi|poco|galaxy|moto g|realme|iphone/g) || []).length >= 2 },
    { name: "sem link inventado", ok: (t) => !/https?:\/\//.test(t.text) || used(t, "web_search") || used(t, "web_fetch") },
    adjust,
  ] }] },
  { id: "orcamento-bolo", level: "N2", group: "pessoal", persona: "Jorge", turns: [{ message: "faz um orçamento pro cliente de 3 bolos de aniversario de 120 reais cada e uma torta de 80", checks: [
    { name: "cria o orçamento em arquivo", ok: (t) => written(t).length > 0 },
    { name: "contas certas (TOTAL 440)", ok: async (t) => { const x = (await fileText(t, ".pdf", ".docx", ".xlsx")) || fold(t.text); return /\b360\b|360,00/.test(x) && /\b440\b|440,00/.test(x); } },
    { name: "validade ou pagamento", ok: async (t) => { const x = (await fileText(t, ".pdf", ".docx", ".xlsx")) || fold(t.text); return any(x, "validade", "valido", "pagamento", "pix"); } },
    adjust,
  ] }] },
  // ---------- funcionário ----------
  { id: "proposta-emporio", level: "N5", group: "empresa", persona: "Patrícia", turns: [{ message: "monta uma proposta pro Empório Central de 50 caixas de farinha de 1kg e 20 de café 500g", checks: [
    { name: "cria a proposta", ok: (t) => written(t).length > 0 },
    { name: "preços da tabela (7,90 e 29,90)", ok: async (t) => { const x = await fileText(t, ".docx", ".pdf", ".xlsx"); return x.includes("emporio") && /7[,.]90/.test(x) && /29[,.]90/.test(x); } },
    { name: "condições (pedido mínimo, pagamento ou validade)", ok: async (t) => { const x = await fileText(t, ".docx", ".pdf", ".xlsx"); return any(x, "pedido minimo", "validade", "pagamento", "antecipado"); } },
    adjust,
  ] }] },
  { id: "relatorio-vendas", level: "N5", group: "empresa", persona: "Patrícia", turns: [{ message: "monta um relatorio das vendas", checks: [
    { name: "cria um relatório .docx", ok: (t) => written(t, ".docx").length > 0 },
    { name: "com os números reais (Camila Nunes no topo)", ok: async (t) => { const x = await fileText(t, ".docx"); return x.includes("camila") && /5[.]?839/.test(x); } },
    { name: "conclusões e fonte", ok: async (t) => { const x = await fileText(t, ".docx"); return any(x, "resumo", "destaque", "conclus") && any(x, "fonte", "vendas 2026"); } },
    adjust,
  ] }] },
  { id: "apresentacao-metas", level: "N5", group: "empresa", persona: "Patrícia", turns: [{ message: "faz uma apresentação das metas comerciais pra reunião", checks: [
    { name: "cria o arquivo", ok: (t) => written(t).length > 0 },
    { name: "com os vendedores e o % da meta", ok: async (t) => { const x = (await fileText(t, ".docx", ".pptx", ".pdf")) || fold(t.text); return ["vitor", "aline", "ricardo", "tania", "jorge", "livia", "edson", "camila"].filter((n) => x.includes(n)).length >= 6 && /\d{2}[,.]\d{1,2}\s?%/.test(x); } },
    adjust,
  ] }] },
  { id: "aviso-expediente", level: "N4", group: "empresa", persona: "Patrícia", turns: [{ message: "faz um aviso pra equipe q a partir de segunda o expediente começa 7h30", checks: [
    { name: "o que muda e quando", ok: (t) => /7h30|7:30/.test(t.text) && has(t.text, "segunda") },
    { name: "curto (até ~150 palavras)", ok: (t) => words(body(t)) <= 150 },
    noFile, adjust,
  ] }] },
  { id: "responder-cliente", level: "N4", group: "empresa", persona: "Patrícia", turns: [{ message: "responde o cliente q reclamou do atraso", checks: [
    { name: "entrega uma resposta provável", ok: (t) => any(body(t), "atraso") && any(body(t), "desculp", "lament", "sentimos", "perdao", "perdão", "sinto muito", "compreend") && words(body(t)) >= 40 },
    { name: "não inventa pedido, prazo ou data", ok: (t) => !/\bpedido\s*(n[ºo°]\.?\s*)?\d{3,}|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/i.test(body(t)) },
    adjust,
  ] }] },
];

export async function allUsageScenariosWithPoor() {
  const { allUsageScenariosWithRobust } = await import("./usageScenarios2.js");
  return [...(await allUsageScenariosWithRobust()), ...POOR_SCENARIOS.map((s) => ({ ...s, battery: 4 }))];
}
