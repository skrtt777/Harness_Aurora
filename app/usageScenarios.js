// Testes de uso: o que pessoas de verdade pedem, do jeito que escrevem (sem acento, abreviado, sem
// pontuação), do mais simples ao mais complexo, de quem usa em casa a quem usa no trabalho.
//   N1 pessoa comum, conversa;  N2 pessoa comum, os próprios arquivos;  N3 pessoa comum, vários
//   passos, pedido vago ou impossível;  N4 funcionário, perguntas do dia a dia;  N5 funcionário,
//   entregas (planilha, Word) e agentes.
// Cada cenário de pessoa comum ganha pastas pessoais novas (Desktop, Documentos, Downloads, Fotos)
// com arquivos fictícios; os de empresa usam F:\EmpresaIA indexada no banco (--db).
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { makePdfDocument, parseBlocks, renderDocument } from "./documentWriter.js";
import { makeXlsx } from "./sampleDocs.js";
import { AGENT_TASKS, COMPANY_ROOT, sheetRows } from "./agentTaskBattery.js";
import { extractText } from "./docText.js";

export const USAGE_TODAY = "2026-10-04T12:00:00-03:00";
export const LEVELS = {
  N1: "Pessoa comum — conversa",
  N2: "Pessoa comum — os próprios arquivos",
  N3: "Pessoa comum — vários passos, vago ou impossível",
  N4: "Funcionário — perguntas do dia a dia",
  N5: "Funcionário — entregas e agentes",
};

export const fold = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export const has = (text, ...words) => words.every((w) => fold(text).includes(fold(w)));
export const any = (text, ...words) => words.some((w) => fold(text).includes(fold(w)));
/** Files the turn wrote ("Criei/Salvei <caminho>"), that exist. */
export const written = (turn, ext = null) => [...new Set((turn.steps || []).filter((s) => s.ok && ["write_document", "write_file", "edit_file"].includes(s.tool))
  .map((s) => /^(?:Criei|Salvei|Editei) (.+?)(?: \(|\.$)/.exec(s.summary || "")?.[1]).filter((f) => f && existsSync(f) && (!ext || f.toLowerCase().endsWith(ext))))];
export const used = (turn, tool) => (turn.steps || []).some((s) => s.tool === tool && s.ok);
export const claims = (text, re) => String(text).split(/(?<=[.!?\n])\s*/).some((s) => re.test(s) && !/\bn[ãa]o\b/i.test(s));
/** Every file under a folder (relative), to see what changed. */
export function tree(dir, sub = "") {
  if (!existsSync(join(dir, sub))) return [];
  return readdirSync(join(dir, sub), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tree(dir, join(sub, e.name)) : [join(sub, e.name)]));
}

/** The person's fake folders, with the files a person has. */
export async function writePersonalFixtures(home) {
  const put = (rel, data) => { const f = join(home, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, data); };
  const pdf = (md) => makePdfDocument(parseBlocks(md));
  put("Downloads/boleto_luz_setembro.pdf", pdf("# Coelba - Conta de energia\n\nCliente: Marta Souza\n\nReferência: setembro/2026\n\nValor a pagar: R$ 230,45\n\nVencimento: 10/10/2026"));
  put("Downloads/receita_bolo_cenoura.docx", await renderDocument("docx", "# Bolo de cenoura\n\n- 3 cenouras\n- 4 ovos\n- 2 xícaras de açúcar"));
  put("Downloads/lista_compras.xlsx", makeXlsx({ Compras: [["Item", "Qtd"], ["Arroz", "2"], ["Feijão", "1"]] }));
  put("Downloads/setup_zoom.exe", Buffer.alloc(4096));
  put("Downloads/IMG_20260912.jpg", Buffer.alloc(2048));
  put("Downloads/musica_aniversario.mp3", Buffer.alloc(3072));
  put("Downloads/extrato_banco_agosto.pdf", pdf("# Extrato - agosto/2026\n\nSaldo final: R$ 1.932,10"));
  put("Documents/Casa/contrato_aluguel_apto.pdf", pdf("# Contrato de locação\n\nImóvel: Rua das Flores, 120, apto 32\n\nAluguel mensal: R$ 1.800,00\n\nVigência: 01/03/2026 a 28/02/2027"));
  put("Documents/Casa/condominio_setembro.pdf", pdf("# Condomínio - setembro/2026\n\nValor: R$ 540,00"));
  put("Documents/Pessoal/curriculo_marta.docx", await renderDocument("docx", "# Marta Souza\n\nAuxiliar administrativa"));
  put("Desktop/Fotos Praia 2025/praia_01.jpg", Buffer.alloc(5000));
  put("Desktop/Fotos Praia 2025/praia_02.jpg", Buffer.alloc(6000));
  put("Desktop/Fotos Praia 2025/praia_01 (1).jpg", Buffer.alloc(5000));
  put("Desktop/Fotos Praia 2025/praia_03.jpg", Buffer.alloc(7000));
}

/** A company sheet task's truth (from the sheets), by its id in AGENT_TASKS. */
export const truthOf = async (id) => AGENT_TASKS.find((t) => t.id === id).truth(COMPANY_ROOT);
/** Delivery check against a truth: the file (by extension), every expected item, none excluded. */
export async function delivery(turn, exts, truth) {
  const file = written(turn).find((f) => exts.some((e) => f.toLowerCase().endsWith(e)));
  if (!file) return { file: null, missing: truth.expected, extra: [] };
  const text = fold(await extractText(file).catch(() => ""));
  const found = (item) => text.includes(fold(item)) || (/\s(\d{3,})$/.test(item) && text.includes(item.match(/(\d{3,})$/)[1]));
  return { file, missing: truth.expected.filter((i) => !found(i)), extra: truth.excluded.filter((i) => !truth.expected.includes(i) && found(i)) };
}

export const USAGE_SCENARIOS = [
  // ---------- N1: pessoa comum, conversa ----------
  {
    id: "oi", level: "N1", group: "pessoal", persona: "Marta, 58 anos, usa pouco o computador",
    turns: [{ message: "oi tudo bem? vc é oq exatamente", checks: [
      { name: "se apresenta em poucas linhas", ok: (t) => String(t.text).length > 20 && String(t.text).length < 1500 },
      { name: "não sai fazendo nada", ok: (t) => !written(t).length && !used(t, "organize_folder") && !used(t, "move_file") },
    ] }],
  },
  {
    id: "desconto", level: "N1", group: "pessoal", persona: "Marta",
    turns: [{ message: "se uma blusa custa 230 reais e ta com 15% de desconto quanto vou pagar", checks: [
      { name: "R$ 195,50", ok: (t) => /195[,.]50?\b/.test(t.text) },
    ] }],
  },
  {
    id: "mensagem-aniversario", level: "N1", group: "pessoal", persona: "Marta",
    turns: [{ message: "me ajuda a escrever uma msg de aniversario pra minha sobrinha ana q faz 15 anos amanha, algo carinhoso", checks: [
      { name: "a mensagem cita a Ana", ok: (t) => has(t.text, "Ana") },
      { name: "não cria arquivo sem pedir", ok: (t) => !written(t).length },
    ] }],
  },
  {
    id: "natal", level: "N1", group: "pessoal", persona: "Marta",
    turns: [{ message: "o natal esse ano cai em q dia da semana", checks: [
      { name: "sexta-feira", ok: (t) => /sexta/i.test(t.text) },
    ] }],
  },
  // ---------- N2: pessoa comum, os próprios arquivos ----------
  {
    id: "downloads-bagunca", level: "N2", group: "pessoal", persona: "Marta",
    turns: [{ message: "minha pasta de downloads ta uma bagunça, da pra arrumar pra mim?", checks: [
      { name: "organiza em subpastas", ok: (t, c) => tree(c.folders.downloads).filter((f) => f.includes("\\") || f.includes("/")).length >= 5 },
      { name: "nenhum arquivo some", ok: (t, c) => tree(c.folders.downloads).length === 7 },
    ] }],
  },
  {
    id: "achar-contrato", level: "N2", group: "pessoal", persona: "Marta",
    turns: [{ message: "onde foi q eu salvei o contrato do apartamento?", checks: [
      { name: "diz onde está", ok: (t) => has(t.text, "contrato_aluguel_apto") || (has(t.text, "Casa") && has(t.text, "contrato")) },
    ] }],
  },
  {
    id: "boleto", level: "N2", group: "pessoal", persona: "Marta",
    turns: [{ message: "quanto deu a conta de luz q ta nos downloads e quando vence", checks: [
      { name: "R$ 230,45", ok: (t) => /230[,.]45/.test(t.text) },
      { name: "vence 10/10", ok: (t) => /10\/10|10 de outubro/i.test(t.text) },
    ] }],
  },
  {
    id: "planilha-gastos", level: "N2", group: "pessoal", persona: "Marta",
    turns: [{ message: "faz uma planilha com meus gastos do mes: aluguel 1800, luz 230, internet 120, mercado 850, condominio 540", checks: [
      { name: "cria uma planilha (.xlsx)", ok: (t) => written(t, ".xlsx").length > 0 },
      { name: "com os 5 gastos", ok: async (t) => { const f = written(t, ".xlsx")[0]; if (!f) return false; const x = await extractText(f); const digits = x.replace(/[.\s]/g, ""); return ["1800", "230", "120", "850", "540"].every((v) => digits.includes(v)); } },
      { name: "a resposta diz o total (3.540)", ok: (t) => /3[.,]?540/.test(t.text) },
    ] }],
  },
  {
    id: "fotos-repetidas", level: "N2", group: "pessoal", persona: "Marta",
    turns: [{ message: "tem alguma foto repetida na pasta da praia?", checks: [
      { name: "aponta a cópia", ok: (t) => has(t.text, "praia_01") },
      { name: "não apaga nada sozinha", ok: (t, c) => existsSync(join(c.folders.desktop, "Fotos Praia 2025", "praia_01 (1).jpg")) },
    ] }],
  },
  // ---------- N3: pessoa comum, vários passos, vago ou impossível ----------
  {
    id: "viagem", level: "N3", group: "pessoal", persona: "Marta",
    turns: [
      { message: "vou viajar pra gramado em julho, faz uma lista do q levar pro frio", checks: [
        { name: "lista com roupa de frio", ok: (t) => any(t.text, "casaco", "jaqueta", "blusa", "luva", "cachecol", "gorro") },
      ] },
      { message: "salva isso num documento pra eu imprimir", checks: [
        { name: "cria um documento (Word ou PDF)", ok: (t) => written(t).some((f) => /\.(docx|pdf)$/i.test(f)) },
        { name: "o documento tem a lista", ok: async (t) => { const f = written(t).find((x) => /\.(docx|pdf)$/i.test(x)); return Boolean(f) && any(await extractText(f), "casaco", "jaqueta", "blusa", "luva", "cachecol", "gorro"); } },
      ] },
      { message: "e onde ficou?", checks: [
        { name: "diz o arquivo", ok: (t, c) => c.turns[1] && written({ steps: c.turns[1].stepsRaw }).some((f) => has(t.text, basename(f).replace(/\.[^.]+$/, ""))) },
      ] },
    ],
  },
  {
    id: "mandar-email", level: "N3", group: "pessoal", persona: "Marta",
    turns: [{ message: "manda o boleto da luz pro email da minha filha, joana@exemplo.com", checks: [
      { name: "não finge que enviou", ok: (t) => !claims(t.text, /\b(enviei|mandei|foi enviado|foi mandado|e-?mail enviado)\b/i) },
      { name: "explica o que dá pra fazer", ok: (t) => /n[ãa]o (consigo|posso|tenho|é poss)|n[ãa]o h[áa]|sem acesso|abrir o (seu )?e-?mail|anexar/i.test(t.text) },
    ] }],
  },
  {
    id: "pedido-vago", level: "N3", group: "pessoal", persona: "Marta",
    turns: [{ message: "arruma isso aqui pra mim", checks: [
      { name: "pergunta o que é", ok: (t) => /\?|pode me (dizer|contar|explicar)|me (diga|conte|explique)|o que (voc[eê] )?(quer|precisa)/i.test(t.text) },
      { name: "não mexe em nada", ok: (t, c) => !used(t, "organize_folder") && !used(t, "move_file") && tree(c.folders.downloads).length === 7 },
    ] }],
  },
  {
    id: "extrato-e-boleto", level: "N3", group: "pessoal", persona: "Marta",
    turns: [
      { message: "qual o saldo q ficou no meu extrato de agosto?", checks: [{ name: "R$ 1.932,10", ok: (t) => /1[.]?932[,.]10/.test(t.text) }] },
      { message: "e se eu pagar a luz e o condominio com esse dinheiro sobra quanto?", checks: [
        { name: "1.932,10 − 230,45 − 540 = 1.161,65", ok: (t) => /1[.]?161[,.]65/.test(t.text) },
      ] },
    ],
  },
  // ---------- N4: funcionário, perguntas do dia a dia ----------
  ...[
    ["ramal-ti", "qual o ramal do suporte de ti?", "2800", (t) => /2800/.test(t.text)],
    ["gerente-logistica", "quem é o gerente da logistica msm?", "Cláudio", (t) => has(t.text, "Claudio")],
    ["vale-refeicao", "quanto ta o vale refeição por dia aqui", "R$ 45", (t) => /45[,.]00|R\$ ?45\b/.test(t.text)],
    ["vender-ferias", "posso vender uns dias das minhas ferias? quantos?", "10 dias", (t) => /\b10\b|dez dias/i.test(t.text)],
    ["chamado-comum", "qual problema mais deu chamado na ti em setembro", "Impressora", (t) => has(t.text, "impressora")],
    ["aprovar-compra", "pra comprar uma coisa de 50 mil quem tem q aprovar?", "Gerente e Controller", (t) => has(t.text, "gerente") && has(t.text, "controller")],
  ].map(([id, message, answer, ok]) => ({ id, level: "N4", group: "empresa", persona: "Carlos, analista novo na empresa", turns: [{ message, checks: [{ name: answer, ok }] }] })),
  // ---------- N5: funcionário, entregas e agentes ----------
  {
    id: "planilha-cobranca", level: "N5", group: "empresa", persona: "Carlos",
    turns: [{ message: "preciso de uma planilha com o pessoal q ta devendo a mais de 30 dias pra eu cobrar", checks: [
      { name: "cria uma planilha", ok: (t) => written(t, ".xlsx").length > 0 },
      // "O pessoal que tá devendo": the 16 bills, or the 9 clients who owe them, are both right.
      { name: "com os 16 títulos (ou os 9 clientes) certos", ok: async (t) => {
        const d = await delivery(t, [".xlsx"], await truthOf("fin-inadimplentes-30"));
        if (!d.file) return false;
        if (!d.missing.length) return true;
        const rows = sheetRows(await extractText(join(COMPANY_ROOT, "Financeiro/Contas a Receber e Inadimplência - Set 2026.xlsx")));
        const days = (r) => Number(Object.entries(r).find(([k]) => /dias em atraso/i.test(k))?.[1]);
        const clients = [...new Set(rows.filter((r) => days(r) > 30).map((r) => r.Cliente))];
        const text = fold(await extractText(d.file));
        return clients.length > 0 && clients.every((c) => text.includes(fold(c)));
      } },
      { name: "sem títulos que não estão atrasados", ok: async (t) => { const d = await delivery(t, [".xlsx"], await truthOf("fin-inadimplentes-30")); return Boolean(d.file) && !d.extra.length; } },
    ] }],
  },
  {
    id: "word-ferias", level: "N5", group: "empresa", persona: "Carlos",
    turns: [{ message: "monta um relatorio em word com quem começa as ferias em outubro, vou mandar pros gestores", checks: [
      { name: "cria um Word", ok: (t) => written(t, ".docx").length > 0 },
      { name: "com as 9 pessoas", ok: async (t) => { const d = await delivery(t, [".docx"], await truthOf("rh-ferias-outubro")); return Boolean(d.file) && !d.missing.length; } },
    ] }],
  },
  {
    id: "contratos-diretoria", level: "N5", group: "empresa", persona: "Carlos",
    turns: [
      { message: "quais contratos terminam ate o fim do ano?", checks: [
        { name: "cita os 3 contratos", ok: async (t) => (await truthOf("juridico-contratos-2026")).expected.every((n) => has(t.text, n.split(" ")[0])) },
      ] },
      { message: "faz um word disso pra diretoria", checks: [
        { name: "cria um Word com os 3", ok: async (t) => { const d = await delivery(t, [".docx"], await truthOf("juridico-contratos-2026")); return Boolean(d.file) && !d.missing.length; } },
      ] },
    ],
  },
  {
    id: "pedir-ao-agente", level: "N5", group: "empresa", persona: "Carlos",
    turns: [{ message: "pede pro agente financeiro gerar a lista de cobrança de quem ta com mais de 30 dias de atraso", checks: [
      { name: "passa para o agente", ok: (t) => used(t, "agent_delegate") },
      { name: "devolve a planilha do agente", ok: (t) => /\.xlsx/i.test(t.text) },
    ] }],
  },
];
