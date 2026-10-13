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
  const rules = !makes ? [] : numberRules([...history.slice(-4), text].join("\n")).map((r) => (r.op === "between" ? `entre ${r.n} e ${r.m} ${plural(r.unit)}` : `${{ ">": "mais de", ">=": "pelo menos", "<": "menos de", "<=": "até" }[r.op]} ${r.n} ${plural(r.unit)}`) + " em CADA linha");
  const run = RUN.test(t);
  const official = OFFICIAL.test(t);
  const deliver = [
    ...files.map((f) => `o arquivo ${f}`),
    ...(format && !files.some((f) => f.toLowerCase().endsWith(`.${format}`)) ? [FORMAT_NAME[format]] : []),
  ];
  const checks = [
    ...(deliver.length ? ["o arquivo existe e a resposta diz o caminho completo"] : []),
    ...(rules.length ? ["cada linha obedece às regras de número"] : []),
    ...(run ? ["o que foi pedido rodou de verdade e a resposta mostra a saída real"] : []),
    ...(official ? ["cada lei, artigo ou norma citada veio de fonte oficial consultada nesta resposta"] : []),
  ];
  const areaSure = Boolean(areaHit([...history.slice(-2), text].join("\n")));
  return { area, areaSure, areaName: DEPARTMENTS.find((d) => d.id === area)?.name || "Operações", deliver, files, format, folder, rules, run, official, checks, makes };
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
export function dispatchCheck(order, { answer = "", steps = [] } = {}) {
  if (!order?.makes) return { fix: null, missing: [] };
  const missing = [];
  const written = writtenFiles(steps);
  if (order.format && order.deliver.length && !written.some((f) => f.toLowerCase().endsWith(`.${order.format}`)) && !steps.some((s) => s.ok && ["excel", "word", "powerpoint", "powerbi"].includes(s.tool))) {
    missing.push(`${FORMAT_NAME[order.format].replace(/^uma? /, "o arquivo pedido, ")} não foi gravado (grave com write_document em .${order.format})`);
  }
  if (order.run && !steps.some((s) => s.ok && RAN.has(s.tool))) missing.push("o pedido manda rodar, e nada rodou: rode com run_command e mostre a saída real");
  // Where the file is: appended when the answer does not say it (the person goes looking for it).
  const unsaid = written.filter((f) => !String(answer).toLowerCase().includes(basename(f).toLowerCase()));
  const fix = unsaid.length && order.deliver.length ? `\n\nArquivo${unsaid.length > 1 ? "s" : ""}: ${unsaid.slice(0, 5).join("; ")}` : null;
  return { fix, missing };
}
