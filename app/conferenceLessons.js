// The Sede's Conferência teaching the Aurora: a guard that held a delivery back becomes a short lesson in
// her memory (the same memories the teacher's lessons go to), so the next request of that kind brings
// it back before the work, not after the mistake. Deterministic: no paid teacher, one lesson per kind
// of mistake and area (createMemory dedupes the same title).
import { createMemory } from "./store.js";
import { areaHit, DEPARTMENTS } from "./headquarters.js";

const AREA_NAME = Object.fromEntries(DEPARTMENTS.map((d) => [d.id, d.name]));

/** The lessons of the checks of one answer: [{ title, content, tags }]. */
export function conferenceLessons(checks = [], request = "") {
  const area = areaHit(request);
  const where = area ? AREA_NAME[area] : null;
  const kinds = new Set(checks.map((c) => c.check));
  const items = (name) => checks.filter((c) => c.check === name).flatMap((c) => c.items || []).map(String);
  const out = [];
  const add = (title, content, tags) => out.push({ title: `${where ? `${where}: ` : ""}${title}`.slice(0, 80), content, tags: ["licao", "conferencia", ...(area ? [area] : []), ...tags] });
  const cited = [...items("unconfirmed_citations"), ...items("dispatch").filter((m) => /citaç/.test(m))];
  if (kinds.has("unconfirmed_citations") || cited.length) {
    add("confirme cada citação antes de usar", "Antes de citar artigo, lei, súmula ou decisão, leia a página oficial (web_search e depois web_fetch no planalto.gov.br ou no site do tribunal, com find=\"Art. N\" para trazer o artigo) e cite com o link. Uma citação que não está no que foi lido é tirada ou marcada como não confirmada.", ["citacao", "fonte oficial"]);
  }
  if (kinds.has("requested_files_missing")) add("crie todos os arquivos que o pedido nomeia", "Quando o pedido nomeia arquivos (ex.: jogos.csv e relatorio.py), crie cada um com esse nome, na pasta pedida, antes de responder; confira com list_dir.", ["arquivos"]);
  if (kinds.has("claimed_run")) add("rode de verdade antes de dizer que rodou", "Se o pedido manda rodar ou testar, rode com run_command e mostre a saída real; nunca descreva um resultado que não rodou.", ["rodar", "codigo"]);
  if (kinds.has("claimed_delivery") || kinds.has("claimed_delivery_final")) add("grave o arquivo antes de dizer que criou", "Só diga que criou ou salvou um arquivo depois que write_document ou write_file respondeu \"Criei\"/\"Salvei\" com o caminho; responda com esse caminho.", ["entrega"]);
  if (items("dispatch").some((m) => /não foi gravado/.test(m))) add("entregue no formato pedido", "Quando o pedido diz planilha, Excel, Word ou PDF, grave o arquivo nesse formato com write_document antes de responder, e diga o caminho completo.", ["formato", "entrega"]);
  if (items("dispatch").some((m) => /outro alfabeto/.test(m))) add("escreva só em português", "Revise o texto antes de gravar: nada de palavras em outro alfabeto (chinês, russo) no meio de um texto em português.", ["idioma"]);
  return out;
}

/** Saves the lessons of an answer's checks (global, or the project's), never failing the turn. */
export async function rememberConference(checks, { request, projectId = null, conversationId = null, env = process.env } = {}) {
  const lessons = conferenceLessons(checks, request);
  const saved = [];
  for (const l of lessons) {
    try { saved.push(await createMemory({ scope: projectId ? "project" : "global", projectId: projectId || undefined, conversationId, title: l.title, content: l.content, tags: l.tags, kind: "extracted", source: "Lição da Conferência (Sede)", env })); }
    catch { /* a lesson that cannot be saved is skipped */ }
  }
  return saved;
}
