// The tools a request is offered: the ones of what it speaks of, not all 49. Their descriptions were
// ~8,700 tokens of every prompt (13/10): nothing on a GPU, minutes on a work laptop's CPU before the
// first word, and most of a 16k context. The agent still runs any tool it calls by name (chatAgent:
// offered is what it reads, the whole list is what it can run), so a narrow guess costs one step.

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * A Power BI is wanted: named ("power bi", .pbix, DAX), or "dashboard/painel/indicadores" outside a deck. In
 * "uma apresentação com um slide de dashboard" the dashboard is a slide (15/10: 2 runs in 3 built a Power BI
 * instead of the deck, and the person had asked for one from the phone).
 */
const ASKS_DECK = /\b(apresentac|slides?\b|powerpoint|pptx|deck\b)/;
const NAMES_PBI = /\b(power ?bi|pbix|pbip|dax)\b/;
export const asksDeck = (text) => ASKS_DECK.test(fold(text));
export const wantsPowerBi = (text) => { const t = fold(text); return NAMES_PBI.test(t) || (!ASKS_DECK.test(t) && /\b(bi|dashboard|painel|paineis|indicadores|kpis?|medida dax)\b/.test(t)); };

/** Always: read and write files and documents, the company's search, memory, the plan. */
export const BASE_TOOLS = ["read_file", "list_dir", "search_files", "write_document", "write_file", "edit_file", "knowledge_search", "memory_search", "memory_save", "update_plan"];

/** Each group: the words that bring it, and its tools. */
export const TOOL_GROUPS = [
  { id: "arquivos+", words: /\b(organiz|mov[ae]|renome|apag|exclu|copi[ae]r?\b|pasta|onde (esta|fica|ficou|salv)|cade|ache|encontr|procur|maiores arquivos|duplicad|repetid|chegou|novo hoje|computador|downloads|area de trabalho|desktop)/, tools: ["move_file", "organize_folder", "make_folder", "grep", "computer_map"] },
  { id: "calculo", words: /\b(quanto (e|da|fica|deu|sobra|falta)|sobra(m)?|resta(m)?|media|porcent|desconto|troco|parcela|dividi|divide|somando|soma|juros|diferenca|a mais|a menos|por pessoa|cada um|total)\b|\d\s*%/, tools: ["calculate"] },
  // The person's own bills only: "quanto temos a pagar de fornecedores" (the company's Contas a Pagar) got the
  // boleto rule and answered about "boletos" (regression 24/10).
  { id: "contas", words: { test: (t) => /\b(boletos?|faturas?|conta de (luz|agua|gas|internet|celular|telefone|condominio|energia)|minhas contas|contas\b[^.?]{0,20}\b(que|pra|para) pagar|ja paguei|vence(m)? (primeiro|antes|ate)|mais urgente)\b/.test(t) && !/\b(fornecedor|fornecedores|clientes?|a receber|empresa|setor|financeiro|inadimpl)/.test(t) }, tools: ["bills_table"] },
  { id: "web", words: /\b(internet|pesquis|busc[ae] na|google|site|pagina|link|url|http|www\.|noticia|cotacao|preco atual|hoje|atual|recente|lei|legisla|norma|jurisprud|sumula|planalto|clt|fonte oficial|document(acao|e) oficial|aprend)/, tools: ["web_search", "web_fetch", "learn"] },
  { id: "navegador", words: /\b(abr[aei]r? (o |a )?(site|pagina|navegador|link)|navegador|chrome|formulario|preench|clique|clicar|login|entr[ae] no site|envie (uma )?mensagem (no|pelo) site|http|www\.|\.com\b|youtube|instagram|whatsapp web)/, tools: ["browser_navigate", "browser_snapshot", "browser_read", "browser_click", "browser_type", "browser_fill", "browser_key", "browser_scroll", "browser_tabs"] },
  { id: "office", words: /\b(abr[aei]r? (o |a )?(excel|word|powerpoint|programa|aplicativo|app)|no excel|no word|no powerpoint|excel aberto|word aberto|planilha aberta|janela|na tela|calculadora|sistema da empresa|programa)/, tools: ["excel", "word", "powerpoint", "open", "desktop_windows", "desktop_snapshot", "desktop_click", "desktop_type", "desktop_key", "desktop_copy"] },
  { id: "powerbi", words: { test: wantsPowerBi }, tools: ["powerbi"] },
  // Made-up data in volume (28/10: "mais de 300 funcionários" came back as 20 rows written by hand).
  { id: "dados-ficticios", words: /\b(fictici|aleatori|invent[ae]|dados de (exemplo|teste)|(crie|cria|criar|gere|gera|gerar) (os |uns |alguns )?dados|massa de dados|simulad|pode gerar (os )?numeros|numeros ficticios)/, tools: ["sample_data"] },
  { id: "comandos", words: /\b(rode|rodar|execut|comando|terminal|powershell|script|instal|npm|python|node|git|compil|teste[ms]?\b|servidor|porta)/, tools: ["run_command", "command_output", "command_stop"] },
  { id: "empresa", words: /\b(index|base de conhecimento|pasta da empresa|documentos da empresa|conecte|mapa dos documentos|knowledge)/, tools: ["knowledge_setup", "knowledge_map"] },
  { id: "access", words: /\b(access|\.accdb|\.mdb|banco de dados)/, tools: ["access_db"] },
  { id: "habilidades", words: /\b(skill|habilidade)/, tools: ["skill_search", "skill_use", "skill_create"] },
  { id: "equipe", words: /\b(agente|equipe|time de|delegu|setor .* fa[cç]a|subagent)/, tools: ["agent_delegate", "agent_create", "team_request", "subagents"] },
];

/** The groups a request speaks of (their tools and their rules go in). */
export function activeGroups(request, { history = [], also = [] } = {}) {
  const text = fold([...history.slice(-2), request].join("\n"));
  return [...new Set([...TOOL_GROUPS.filter((g) => g.words.test(text)).map((g) => g.id), ...also])];
}

/**
 * The names of the tools to offer for a request (the last messages count: "e agora salve no Excel").
 * `extra`: names always added (the code tools of a code turn, an agent's own list).
 */
export function routeTools(request, { history = [], extra = [] } = {}) {
  const text = fold([...history.slice(-2), request].join("\n"));
  const names = new Set([...BASE_TOOLS, ...extra]);
  for (const g of TOOL_GROUPS) if (g.words.test(text)) for (const t of g.tools) names.add(t);
  return names;
}
