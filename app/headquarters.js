// A Sede da Aurora: one office with departments, where each request is a file (a "ficha") that goes
// through the delivery line — Recepção (understand it), Arquivo (the person's documents), Biblioteca
// (official sources), the department of its area (the work), Revisão (the teacher, the copies),
// Conferência (the checks), Expedição (the delivery). Nothing is staged: the station of each person is
// the one of what it is really doing (the tool running, the review, a check that just fired), and the
// ficha lights up the stations its own steps went through. Idea from a lawyers' office of agents
// (Recepção, Leitura do processo, Provas, Prazos, Biblioteca, Redação, Revisão, Conferência de
// citações, 13/10), made for any area.

/** The departments, in the order of the floor: three bands (entrada, produção, qualidade e apoio). */
export const DEPARTMENTS = [
  { id: "recepcao", name: "Recepção", band: 0, kind: "linha", does: "Entende o pedido e o que falta" },
  { id: "arquivo", name: "Arquivo", band: 0, kind: "linha", does: "Lê os documentos da pessoa" },
  { id: "biblioteca", name: "Biblioteca", band: 0, kind: "linha", does: "Pesquisa em fonte oficial" },
  { id: "reuniao", name: "Sala de reunião", band: 0, kind: "apoio" },
  { id: "chefe", name: "Diretoria", band: 0, kind: "apoio" },
  { id: "cafe", name: "Café", band: 0, kind: "apoio" },
  { id: "juridico", name: "Jurídico", band: 1, kind: "area", desks: ["Prazos", "Jurisprudência", "Redação", "Contratos"] },
  { id: "financeiro", name: "Financeiro", band: 1, kind: "area", desks: ["Contas", "Conciliação", "Orçamento", "Cobrança"] },
  { id: "pessoas", name: "Pessoas", band: 1, kind: "area", desks: ["Folha", "Férias", "Admissão", "Benefícios"] },
  { id: "comercial", name: "Comercial e Marketing", band: 1, kind: "area", desks: ["Vendas", "Propostas", "Campanhas", "Conteúdo"] },
  { id: "ti", name: "TI e Código", band: 1, kind: "area", desks: ["Front", "Back", "Testes", "Dados"] },
  { id: "operacoes", name: "Operações", band: 1, kind: "area", desks: ["Estoque", "Compras", "Logística", "Geral"] },
  { id: "revisao", name: "Revisão", band: 2, kind: "linha", does: "O professor e as cópias conferem" },
  { id: "conferencia", name: "Conferência", band: 2, kind: "linha", does: "Números, arquivos e fontes batem" },
  { id: "expedicao", name: "Expedição", band: 2, kind: "linha", does: "A entrega sai" },
  { id: "rh", name: "RH dos agentes", band: 2, kind: "apoio" },
  { id: "servidores", name: "Servidores", band: 2, kind: "apoio" },
  { id: "lounge", name: "Descanso", band: 2, kind: "apoio" },
];
export const AREAS = DEPARTMENTS.filter((d) => d.kind === "area").map((d) => d.id);

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const AREA_WORDS = [
  ["ti", /\b(codigo|site|website|api|backend|frontend|script|python|javascript|node|react|java|html|css|bug|programa|sistema|app|aplicativo|banco de dados|sql|servidor|deploy|ti|tecnologia|chamado)s?\b|\.(py|js|ts|jsx|html|css)\b|c\+\+/],
  ["juridico", /\b(juridic\w*|contrato|clausula|processo|peticao|prazo processual|advog\w*|lei|lgpd|parecer|notificacao|procuracao|aditivo|distrato|jurisprudencia)s?\b/],
  ["financeiro", /\b(financ\w*|contas? a (pagar|receber)|inadimpl\w*|fluxo de caixa|orcamento|orcado|custo|centro de custo|fatura|nota fiscal|boleto|pagamento|recebimento|despesa|receita|lucro|margem|dre|balanco|conciliacao|cobranca|desvio)s?\b/],
  ["pessoas", /\b(rh|recursos humanos|ferias|funcionari\w*|colaborador\w*|folha|admiss\w*|demiss\w*|salari\w*|ponto|beneficio|treinamento|vaga|curriculo|holerite)s?\b/],
  ["comercial", /\b(venda|vendedor|cliente|proposta|comercial|marketing|campanha|post|instagram|tiktok|lead|funil|meta de venda|anuncio|conteudo|e-?mail marketing|precificacao)s?\b/],
  ["operacoes", /\b(estoque|logistic\w*|entrega|compra|fornecedor|producao|frota|armazem|deposito|pedido de compra|oee|maquina|linha de producao|inventario)s?\b/],
];
/** The area a text clearly speaks of (one of its words), or null. */
export function areaHit(text) {
  const t = fold(text);
  let best = null, hits = 0;
  for (const [id, re] of AREA_WORDS) { const n = (t.match(new RegExp(re.source, "g")) || []).length; if (n > hits) { best = id; hits = n; } }
  return best;
}
/** The department of a request's area (the person's words, or an agent's sector). */
export function areaOf(text) {
  const t = fold(text);
  let best = null, hits = 0;
  for (const [id, re] of AREA_WORDS) {
    const n = (t.match(new RegExp(re.source, "g")) || []).length;
    if (n > hits) { best = id; hits = n; }
  }
  return best || "operacoes";
}

const READ = /^(read_file|list_dir|list_files|search_files|grep|knowledge_search|knowledge_map|memory_search|code_map|access_db|skill_search)/;
const SEARCH = /^(web_search|web_fetch|learn|browser_)/;
const CHECK = /^(check_page)/;
const SEND = /^(open|desktop_)/;

/** The station of one step of the work (a tool). */
export function stationOfTool(tool) {
  const t = String(tool || "");
  if (!t || t === "update_plan") return "recepcao";
  if (READ.test(t)) return "arquivo";
  if (SEARCH.test(t)) return "biblioteca";
  if (CHECK.test(t)) return "conferencia";
  if (/^run_command|^command_/.test(t)) return "servidores";
  if (SEND.test(t)) return "expedicao";
  return "area";
}

/**
 * The station of a person now, from its state and what it does: { room, station }. `area` is the
 * department of the request; `check` is a guard that fired in the last seconds (Conferência).
 */
export function stationOf({ state, tool = null, kind = "aurora", area = "operacoes", checkedAt = 0, now = Date.now() }) {
  if (kind === "chefe") return state === "reuniao" ? { room: "reuniao", station: null } : { room: "chefe", station: null };
  if (kind === "rh") return { room: "rh", station: null };
  if (state === "revisao" || state === "conferindo" || state === "refazendo") return { room: "revisao", station: "revisao" };
  if (checkedAt && now - checkedAt < 20_000) return { room: "conferencia", station: "conferencia" };
  if (state === "reuniao") return { room: "reuniao", station: null };
  if (state === "cafe") return { room: "cafe", station: null };
  if (state === "descanso" || state === "desligado") return { room: "lounge", station: null };
  if (state === "aguardando") return { room: "recepcao", station: "recepcao" };
  if (state === "trabalhando" || state === "cobrado") {
    const s = stationOfTool(tool);
    if (s === "recepcao" && state === "cobrado") return { room: area, station: "area" };
    return s === "area" ? { room: area, station: "area" } : { room: s, station: s === "servidores" ? "area" : s };
  }
  return { room: "recepcao", station: "recepcao" };     // pensando, chegando: the request is being understood
}

export const LINE = ["recepcao", "arquivo", "biblioteca", "area", "revisao", "conferencia", "expedicao"];
const LABEL = { recepcao: "Recepção", arquivo: "Arquivo", biblioteca: "Biblioteca", revisao: "Revisão", conferencia: "Conferência", expedicao: "Expedição" };

/**
 * The ficha of a request: the line of stations with done / now / skipped, from the steps it really
 * took. { id, title, area, areaName, stations: [{ id, label, state }], step: 1|2|3 }.
 */
export function fichaOf({ conversationId, title, request, steps = [], station = "recepcao", review = false, checks = 0, ended = false, ok = true }) {
  const area = areaOf(`${title || ""} ${request || ""}`);
  const areaName = DEPARTMENTS.find((d) => d.id === area)?.name || "Operações";
  const visited = new Set(["recepcao", ...steps.map((s) => { const st = stationOfTool(s.tool); return st === "servidores" ? "area" : st; })]);
  if (review) visited.add("revisao");
  if (checks) visited.add("conferencia");
  if (ended) { visited.add("expedicao"); }
  const nowAt = ended ? null : station;
  const reached = LINE.reduce((max, id, i) => (visited.has(id) || id === nowAt ? i : max), 0);
  const stations = LINE.map((id, i) => ({
    id: id === "area" ? area : id, label: id === "area" ? areaName : LABEL[id],
    state: id === nowAt ? "agora" : visited.has(id) ? (ended && !ok && id === "expedicao" ? "falhou" : "feito") : i < reached ? "pulado" : "falta",
  }));
  const step = ended ? 3 : LINE.indexOf(nowAt) <= 0 ? 1 : 2;
  return { id: conversationId, title: String(title || "Pedido").slice(0, 70), area, areaName, stations, step };
}
