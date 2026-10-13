// The Sede's Recepção and Expedição, for real (app/headquarters.js shows them).
// Recepção: before the work, the request becomes a service order (ordem de serviço) — what to deliver
// (files, format, folder), the rules it gives (numbers per row, run it and show the result, only
// official sources), and what will be checked at the end. Deterministic (no model call), short, and it
// goes into the agent's prompt: a 4B model sees spelled out what the request only implies.
// Expedição: when the agent answers, the delivery is checked against the order (the format asked was
// written, the command asked was run, the answer says where the file is) — what can be fixed without
// the model is fixed (the path appended), the rest goes back to the agent once.
import { basename } from "node:path";
import { areaOf, areaHit, DEPARTMENTS } from "./headquarters.js";
import { numberRules } from "./numberRules.js";
import { requestedFiles } from "./codeGuards.js";
import { askedFolder, requestedFormat } from "./agentTools/files.js";

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const RUN = /\b(rode|rodar|execute|executar|roda o|rode os testes|teste e|me mostre o resultado|mostre a saida)\b/;
const OFFICIAL = /\b(fonte oficial|fontes oficiais|site oficial|planalto|diario oficial|receita federal|lei n|legislacao)\b/;
const MAKES = /\b(cri[ae]|criar|fa[cz]a|fazer|gere|gerar|monte|montar|escrev[ae]|prepar[ae]|elabor[ae]|redija|atualiz[ae]|organiz[ae]|separe|list[ae]|listar|relacion[ae]|levant[ae]|compil[ae]|exporte|salve|grave)\b/;
const FORMAT_NAME = { xlsx: "uma planilha Excel (.xlsx)", docx: "um documento Word (.docx)", pdf: "um PDF" };
const FILE_NAMES = /\b[\w-]+\.(?:py|js|ts|jsx|tsx|java|cpp|html|css|json|csv|md|txt|sql|c)\b/gi;
const plural = (w) => (w.endsWith("s") ? w : w === "real" ? "reais" : /[aeiou]l$/.test(w) ? `${w.slice(0, -1)}is` : /[rz]$/.test(w) ? `${w}es` : `${w}s`);

/**
 * The order of a request: { area, areaName, deliver: [..], files: [..], format, folder, rules: [..],
 * run, official, checks: [..] } — empty lists when the request is a question.
 */
export function serviceOrder(request, { history = [] } = {}) {
  const text = String(request || "");
  const t = fold(text);
  const area = areaOf([...history.slice(-2), text].join("\n"));
  const makes = MAKES.test(t);
  const files = makes ? requestedFiles(text) : [];
  // The file names out first: "relatorio.py" is not a request for a Word report.
  const format = makes ? requestedFormat(text.replace(FILE_NAMES, " ")) : null;
  const folder = askedFolder(text);
  const rules = !makes ? [] : numberRules([...history.slice(-4), text].join("\n")).map((r) => (r.op === "between" ? `entre ${r.n} e ${r.m} ${plural(r.unit)}` : `${{ ">": "mais de", ">=": "pelo menos", "<": "menos de", "<=": "até" }[r.op]} ${r.n} ${plural(r.unit)}`) + " em cada item (não no total)");
  const run = RUN.test(t);
  const official = OFFICIAL.test(t);
  // A Power BI asked with the data ("faça planilhas e monte um POWERBI"): the panel is part of the delivery.
  const bi = makes && /\bpower ?bi\b|\bpbix\b|\bdashboard\b|\bpainel de bi\b/.test(t);
  const deliver = [
    ...files.map((f) => `o arquivo ${f}`),
    ...(format && !files.some((f) => f.toLowerCase().endsWith(`.${format}`)) ? [FORMAT_NAME[format]] : []),
    ...(bi ? ["o painel do Power BI montado com as planilhas (powerbi action=build, com o caminho completo de cada planilha)"] : []),
  ];
  const checks = [
    ...(deliver.length ? ["o arquivo existe e a resposta diz o caminho completo"] : []),
    ...(rules.length ? ["cada item obedece às regras de número"] : []),
    ...(run ? ["o que foi pedido rodou de verdade e a resposta mostra a saída real"] : []),
    ...(official ? ["cada lei, artigo ou norma citada veio de fonte oficial consultada nesta resposta"] : []),
  ];
  const areaSure = Boolean(areaHit([...history.slice(-2), text].join("\n")));
  return { request: text.slice(0, 400), bi, area, areaSure, areaName: DEPARTMENTS.find((d) => d.id === area)?.name || "Operações", deliver, files, format, folder, rules, run, official, checks, makes };
}

/** The order as a block of the prompt (null when there is nothing to spell out). */
export function orderBlock(order) {
  if (!order || (!order.deliver.length && !order.rules.length && !order.run && !order.official && !order.folder)) return null;
  return [
    `ORDEM DE SERVIÇO (Recepção, área ${order.areaName}):`,
    ...(order.deliver.length ? [`- Entregar: ${order.deliver.join("; ")}${order.folder ? ` na pasta ${order.folder}` : ""}.`] : order.folder ? [`- Trabalhar na pasta ${order.folder}.`] : []),
    ...(order.rules.length ? [`- Regras: ${order.rules.join("; ")}.`] : []),
    ...(order.run ? ["- Rodar o que fizer e mostrar a saída real (não diga que rodou sem rodar)."] : []),
    ...(order.official ? ["- Citar só o que estiver em fonte oficial consultada agora (link)."] : []),
    ...(order.checks.length ? [`- Antes de responder, confira: ${order.checks.join("; ")}.`] : []),
  ].join("\n");
}

const LEGAL_CITE = /\b(lei\s+(?:complementar\s+)?(?:n[ºo°.]*\s*)?\d[\d.]*|art(?:igo)?\.?\s*\d+|s[úu]mula\s+(?:vinculante\s+)?(?:n[ºo°.]*\s*)?\d+|resp\s*n?[ºo°.]*\s*\d|recurso especial\s+n?[ºo°.]*\s*\d|hc\s+n?[ºo°.]*\s*\d|decreto(?:-lei)?\s+(?:n[ºo°.]*\s*)?\d)/i;
export const CONSULT = /^(web_search|web_fetch|learn|browser_|read_file|knowledge_search|search_files|grep)/;
/** The legal citations of a text: [{ kind: "art"|"lei"|"sumula"|"decreto", n, text }]. */
export function citationsIn(text) {
  const out = []; const seen = new Set();
  const add = (kind, n, raw) => { const k = `${kind}:${n}`; if (!seen.has(k)) { seen.add(k); out.push({ kind, n, text: raw.trim() }); } };
  for (const m of String(text).matchAll(/\b(art(?:igo)?s?\.?)\s*(\d+)/gi)) {
    // "art. 4º da Lei nº 8.245": the article of that law (its page must have both).
    const law = /^[^.;\n]{0,40}?\b(?:da|do)\s+(?:lei|decreto)(?:-lei)?\s+(?:complementar\s+)?(?:n[ºo°.]*\s*)?(\d[\d.]*\d)/i.exec(String(text).slice(m.index + m[0].length, m.index + m[0].length + 80));
    const k = `art:${m[2]}:${law ? law[1].replace(/\./g, "") : ""}`;
    if (!seen.has(k)) { seen.add(k); out.push({ kind: "art", n: m[2], law: law ? law[1].replace(/\./g, "") : null, text: m[0].trim() + (law ? ` da Lei ${law[1]}` : "") }); }
  }
  for (const m of String(text).matchAll(/\blei\s+(?:complementar\s+)?(?:n[ºo°.]*\s*)?(\d[\d.]*\d)/gi)) add("lei", m[1].replace(/\./g, ""), m[0]);
  for (const m of String(text).matchAll(/\bs[úu]mula\s+(?:vinculante\s+)?(?:n[ºo°.]*\s*)?(\d+)/gi)) add("sumula", m[1], m[0]);
  for (const m of String(text).matchAll(/\bdecreto(?:-lei)?\s+(?:n[ºo°.]*\s*)?(\d[\d.]*\d)/gi)) add("decreto", m[1].replace(/\./g, ""), m[0]);
  return out;
}
/** Is this citation in the text read (the page of the law shows "Art. 4º", the number of the law)? */
export function citationIn(read, c) {
  // read: the texts read (one per page or document), or all of them in one string.
  const pages = Array.isArray(read) ? read.map(String) : [String(read)];
  const hasArt = (r) => new RegExp(`\\bart(?:igo)?s?\\.?\\s*${c.n}(?!\\d)`, "i").test(r);
  if (c.kind === "art") return pages.some((r) => hasArt(r) && (!c.law || r.replace(/\./g, "").includes(c.law)));
  const r = pages.join("\n");
  if (c.kind === "lei" || c.kind === "decreto") return r.replace(/\./g, "").includes(c.n);
  return new RegExp(`s[úu]mula\\s+(?:vinculante\\s+)?(?:n[ºo°.]*\\s*)?${c.n}(?!\\d)`, "i").test(r);
}

const WROTE = new Set(["write_file", "edit_file", "write_document", "create_site", "create_api", "excel", "word", "powerpoint", "powerbi"]);
const RAN = new Set(["run_command", "create_api", "check_page", "command_output"]);

/** The files the steps of the turn wrote (the paths the tools reported). */
export function writtenFiles(steps = []) {
  const out = [];
  for (const s of steps) {
    if (!s.ok || !WROTE.has(s.tool)) continue;
    const m = /^(?:Criei|Salvei|Editei) (?:o site "[^"]*" em |a API de \S+ em )?(.+?)(?: \(|:\n|\.$|\.\s|$)/m.exec(String(s.summary || s.result || ""));
    if (m) out.push(m[1].trim());
  }
  return [...new Set(out)];
}

/**
 * The Expedição: what the delivery still lacks against the order. Returns { fix: text to append | null,
 * missing: [..] (back to the agent) }.
 */
export function dispatchCheck(order, { answer = "", steps = [], read = null } = {}) {
  const missing = [];
  let unconfirmed = [];
  // Jurídico (or "fonte oficial"): a law, an article, a súmula or a decision cited with nothing consulted
  // in this answer — not a web page, not a document — is a citation from memory, the most dangerous
  // error of a legal text (13/10, the Sede's Conferência).
  // What was delivered: the answer and the text of the documents written in this turn (a legal opinion
  // in Word cited "artigo 609 da Lei 8.245", a law of 90 articles, while the answer cited nothing).
  const delivered = [String(answer), ...steps.filter((st) => st.ok && ["write_document", "write_file"].includes(st.tool)).map((st) => String(st.args?.content ?? st.args?.text ?? ""))].join("\n");
  // A slip of the model into another script ("depende fundamentalmente da是否存在 justa causa").
  const foreign = delivered.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff]+/g);
  // Not when the request has that script or asks for another language ("traduza para o japon\u00eas").
  if (foreign && !/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff]/.test(order?.request || "") && !/tradu|japon|chin[e\u00ea]s|mandarim|coreano|russo|[a\u00e1]rabe|ucraniano|kanji|hiragana|cir[i\u00ed]lico/i.test(order?.request || "")) {
    missing.push(`o texto entregue tem trechos em outro alfabeto (${[...new Set(foreign)].slice(0, 3).join(", ")}): reescreva esses trechos em português${steps.some((st) => st.ok && st.tool === "write_document") ? " e grave o documento de novo no mesmo caminho" : ""}`);
  }
  const legal = order && ((order.area === "juridico" && order.areaSure) || order.official);
  if (legal && LEGAL_CITE.test(delivered)) {
    // The Conferência de citações: each article, law or súmula cited must be in what was read in this
    // answer (a page, a document). A search that found nothing does not confirm "Art. 601" (13/10).
    const seen = read ?? steps.filter((st) => st.ok && CONSULT.test(String(st.tool))).map((st) => String(st.result || st.summary || "")).join("\n");
    unconfirmed = citationsIn(delivered).filter((c) => !citationIn(seen, c));
    if (unconfirmed.length) {
      missing.push(`${seen.length ? "estas citações não aparecem em nada que você leu nesta resposta" : "você citou sem consultar nada nesta resposta"}: ${unconfirmed.slice(0, 6).map((c) => c.text).join(", ")}. Confirme cada uma em fonte oficial (web_fetch da página da lei no planalto.gov.br com find="Art. N" para trazer o artigo) e cite com o link, ou tire a citação e diga que não confirmou`);
    }
  }
  if (!order?.makes) return { fix: null, missing, unconfirmed };
  const written = writtenFiles(steps);
  if (order.format && order.deliver.length && !written.some((f) => f.toLowerCase().endsWith(`.${order.format}`)) && !steps.some((s) => s.ok && ["excel", "word", "powerpoint", "powerbi"].includes(s.tool))) {
    missing.push(`${FORMAT_NAME[order.format].replace(/^uma? /, "o arquivo pedido, ")} não foi gravado (grave com write_document em .${order.format})`);
  }
  if (order.bi && !steps.some((s) => s.ok && s.tool === "powerbi")) missing.push("o Power BI pedido não foi montado: chame powerbi com action=build, files com o caminho completo de TODAS as planilhas que você e os subagentes gravaram (os caminhos estão nos resultados) e goal com o pedido");
  if (order.run && !steps.some((s) => s.ok && RAN.has(s.tool))) missing.push("o pedido manda rodar, e nada rodou: rode com run_command e mostre a saída real");
  // Where the file is: appended when the answer does not say it (the person goes looking for it).
  const unsaid = written.filter((f) => !String(answer).toLowerCase().includes(basename(f).toLowerCase()));
  const fix = unsaid.length && order.deliver.length ? `\n\nArquivo${unsaid.length > 1 ? "s" : ""}: ${unsaid.slice(0, 5).join("; ")}` : null;
  return { fix, missing, unconfirmed };
}
