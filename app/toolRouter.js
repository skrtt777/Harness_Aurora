// The tools a request is offered: the ones of what it speaks of, not all 49. Their descriptions were
// ~8,700 tokens of every prompt (13/10): nothing on a GPU, minutes on a work laptop's CPU before the
// first word, and most of a 16k context. The agent still runs any tool it calls by name (chatAgent:
// offered is what it reads, the whole list is what it can run), so a narrow guess costs one step.

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Always: read and write files and documents, the company's search, memory, the plan. */
export const BASE_TOOLS = ["read_file", "list_dir", "search_files", "write_document", "write_file", "edit_file", "knowledge_search", "memory_search", "memory_save", "update_plan"];

/** Each group: the words that bring it, and its tools. */
export const TOOL_GROUPS = [
  { id: "arquivos+", words: /\b(organiz|mov[ae]|renome|apag|exclu|copi[ae]r?\b|pasta|onde (esta|fica|ficou|salv)|cade|ache|encontr|procur|maiores arquivos|duplicad|repetid|chegou|novo hoje|computador|downloads|area de trabalho|desktop)/, tools: ["move_file", "organize_folder", "grep", "computer_map"] },
  { id: "web", words: /\b(internet|pesquis|busc[ae] na|google|site|pagina|link|url|http|www\.|noticia|cotacao|preco atual|hoje|atual|recente|lei|legisla|norma|jurisprud|sumula|planalto|clt|fonte oficial|document(acao|e) oficial|aprend)/, tools: ["web_search", "web_fetch", "learn"] },
  { id: "navegador", words: /\b(abr[aei]r? (o |a )?(site|pagina|navegador|link)|navegador|chrome|formulario|preench|clique|clicar|login|entr[ae] no site|envie (uma )?mensagem (no|pelo) site|http|www\.|\.com\b|youtube|instagram|whatsapp web)/, tools: ["browser_navigate", "browser_snapshot", "browser_read", "browser_click", "browser_type", "browser_fill", "browser_key", "browser_scroll", "browser_tabs"] },
  { id: "office", words: /\b(abr[aei]r? (o |a )?(excel|word|powerpoint|programa|aplicativo|app)|no excel|no word|no powerpoint|excel aberto|word aberto|planilha aberta|janela|na tela|calculadora|sistema da empresa|programa)/, tools: ["excel", "word", "powerpoint", "open", "desktop_windows", "desktop_snapshot", "desktop_click", "desktop_type", "desktop_key", "desktop_copy"] },
  { id: "powerbi", words: /\b(power ?bi|bi|pbix|dashboard|painel|paineis|indicadores|kpis?|medida dax|dax)\b/, tools: ["powerbi"] },
  { id: "comandos", words: /\b(rode|rodar|execut|comando|terminal|powershell|script|instal|npm|python|node|git|compil|teste[ms]?\b|servidor|porta)/, tools: ["run_command", "command_output", "command_stop"] },
  { id: "empresa", words: /\b(index|base de conhecimento|pasta da empresa|documentos da empresa|conecte|mapa dos documentos|knowledge)/, tools: ["knowledge_setup", "knowledge_map"] },
  { id: "access", words: /\b(access|\.accdb|\.mdb|banco de dados)/, tools: ["access_db"] },
  { id: "habilidades", words: /\b(skill|habilidade)/, tools: ["skill_search", "skill_use", "skill_create"] },
  { id: "equipe", words: /\b(agente|equipe|time de|delegu|setor .* fa[cç]a|subagent)/, tools: ["agent_delegate", "team_request", "subagents"] },
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
