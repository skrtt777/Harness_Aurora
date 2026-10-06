import { backupBeforeChange, sha } from "../undoMoves.js";
import { existsSync, statSync } from "node:fs";
import { mkdir, open, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { IMAGE_EXTENSIONS, extractText } from "../docText.js";
import { DOCUMENT_FORMATS, renderDocument } from "../documentWriter.js";

// Binary office formats are read as their text; everything else as UTF-8.
const EXTRACTED = new Set([".docx", ".xlsx", ".pptx", ".pdf", ".rtf", ...IMAGE_EXTENSIONS]);

// Under MAX_TOOL_RESULT (4500, agentTools/index.js): a longer read lost its own "continue com
// offset" line to that cut, and the model re-read the same lines until the repeat guard stopped it.
const READ_CHUNK = 4200;
const MAX_WALK = 20000;

const foldText = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Rows of a sheet (as docText writes it: "## Planilha", then "a | b | c" lines) that match
 * "Coluna=texto", or lines containing a text. A small model reading 120 rows page by page
 * stops at the first page ("ninguém entra de férias em outubro"); a filter gives it the
 * header, only the rows that count and the total.
 */
// "Dias em atraso>30", "Início das férias>=01/10/2026": the comparison is done here, because a
// small model reading the rows put 10-day-late bills in a "more than 30 days" list (04/10/2026).
const DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
export function cellValue(text) {
  const s = String(text ?? "").trim().replace(/^R\$\s*/i, "");
  const date = s.match(DATE);
  if (date) return Date.UTC(Number(date[3]), Number(date[2]) - 1, Number(date[1]));
  // "1.234,56", "8,07%", "69062.05", "-3.12%"
  const plain = s.replace(/%$/, "");
  const number = /,\d+$/.test(plain) ? plain.replace(/\./g, "").replace(",", ".") : plain;
  return /^-?\d+(\.\d+)?$/.test(number) ? Number(number) : null;
}
const COMPARE = { ">": (a, b) => a > b, ">=": (a, b) => a >= b, "<": (a, b) => a < b, "<=": (a, b) => a <= b };

// Columns that hold codes, not quantities: never summed.
const ID_COLUMN = /matr[ií]cula|c[óo]digo|^n[º°o.]|n[uú]mero|chamado|pedido|t[ií]tulo|documento|cpf|cnpj|^ano$|^id$|telefone|ramal|cep/i;
const brNumber = (n) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2, minimumFractionDigits: Number.isInteger(n) ? 0 : 2 });

/**
 * One sheet's rows as read_file shows them: sorted if asked ("Término", "-Valor"), then the
 * totals of the numeric columns. "Qual vence primeiro?" and "quanto falta pagar?" were answered
 * wrong by a model sorting and adding in its head (05/10/2026).
 */
function sheetBlock(s, hits, sort) {
  let rows = hits;
  const columnOf = (name) => { const exact = s.header?.cells.findIndex((c) => c === name) ?? -1; return exact >= 0 ? exact : s.header?.cells.findIndex((c) => c.includes(name)) ?? -1; };
  if (sort?.col) {
    const at = columnOf(sort.col);
    if (at >= 0) {
      const key = (line) => { const cell = line.split(" | ")[at] ?? ""; const v = cellValue(cell); return v === null ? foldText(cell) : v; };
      rows = [...hits].sort((a, b) => { const x = key(a.line), y = key(b.line); const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "pt-BR"); return sort.desc ? -order : order; });
    }
  }
  const header = s.header?.line.split(" | ") || [];
  const totals = rows.length >= 2 ? header.map((name, j) => {
    if (ID_COLUMN.test(name.trim())) return null;
    const cells = rows.map(({ line }) => (line.split(" | ")[j] ?? "").trim()).filter(Boolean);
    if (!cells.length || cells.some((c) => DATE.test(c) || cellValue(c) === null)) return null;
    return `${name.trim()} = ${brNumber(cells.reduce((sum, c) => sum + cellValue(c), 0))}`;
  }).filter(Boolean) : [];
  return [
    ...[s.name, s.header?.line].filter(Boolean),
    ...rows.map(({ line, i }) => `${String(i + 1).padStart(5)}  ${line}`),
    ...(totals.length ? [`Soma das ${rows.length} linhas acima: ${totals.join("; ")}`] : []),
    "",
  ];
}

/** "Término" (crescente) or "-Valor" (decrescente). */
export function parseSort(sort) {
  const text = String(sort || "").trim().replace(/["“”']/g, "");
  if (!text) return null;
  const desc = /^-|\b(desc|decrescente|maior)\b/i.test(text);
  return { col: foldText(text.replace(/^[-+]\s*/, "").replace(/\s*\b(asc|desc|crescente|decrescente)\b\s*$/i, "")), desc };
}

/**
 * The first cell of each row a filtered read returned ("   12  PC-2026-909 | ..."), when it looks
 * like a key (has a digit): what a document built from those rows should contain.
 */
export function rowKeys(text) {
  // The first of the first three cells that looks like an id ("PC-2026-909", "Duplicata 2592"): a
  // sheet that starts with the client's name had no key at all and the check was off (06/10).
  const keys = [...String(text).matchAll(/^\s*\d+ {2}([^\n]+)$/gm)].map((m) => m[1].split(" | ").slice(0, 3).map((c) => c.trim())
    // An id: letters with digits ("Duplicata 2592") or a plain whole number (a Matrícula "1086"),
    // never a date or an amount ("69.062,05").
    .find((c) => c.length >= 3 && c.length <= 40 && ((/\d/.test(c) && /[A-Za-zÀ-ú]/.test(c)) || /^\d{3,10}$/.test(c)) && !/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(c))).filter(Boolean);
  return [...new Set(keys)];
}

/** Keys of rows the condition left out that a document put in anyway ("18 dias" in a ">30" list). */
export function extraRows(excluded, content) {
  if (!Array.isArray(excluded) || !excluded.length) return [];
  const text = String(content);
  return excluded.filter((k) => new RegExp(`(^|[^\\p{L}\\p{N}])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u").test(text));
}

/**
 * Keys a document left out: an agent got 7 rows back and copied 2 into the spreadsheet (05/10/2026).
 * Only when the document used at least one of them (it is built from that read) and missed some.
 */
export function missingRows(keys, content) {
  if (!Array.isArray(keys) || keys.length < 2) return [];
  const text = String(content);
  const missing = keys.filter((k) => !text.includes(k));
  return missing.length && missing.length < keys.length ? missing : [];
}

/**
 * The operator the person's words give a date: "até 15/10" is <=, "a partir de" >=, "antes de" <,
 * "depois de" >. null when the request doesn't say. (Even the note with the counts was ignored:
 * the model kept filtering "Entrega prevista=15/10/2026" for "entrega até 15/10", 3 runs in 3.)
 */
export function dateIntent(request, date) {
  const [d, m] = String(date).split("/").map(Number);
  if (!d || !m) return null;
  const text = String(request || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  // The date as the person may have written it: 15/10, 15/10/2026, 15 de outubro.
  const months = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const forms = [`0?${d}/0?${m}(/\\d{2,4})?`, `0?${d} de ${months[m - 1]}`];
  for (const [words, op] of [["ate( o dia)?|no maximo ate", "<="], ["a partir d[eo]( dia)?|desde", ">="], ["antes d[eo]( dia)?", "<"], ["depois d[eo]( dia)?|apos( o dia)?", ">"]]) {
    if (forms.some((f) => new RegExp(`\\b(${words})\\s+(${f})\\b`).test(text))) return op;
  }
  return null;
}

/**
 * A CSV/TSV as the " | " table the filters read (they only knew Office sheets: a filter on a .csv
 * answered "nenhuma planilha tem as colunas"). The separator is the one the header uses most.
 */
export function csvTable(text, name = "Tabela") {
  const rows = String(text).replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!rows.length) return [];
  const sep = ["\t", ";", ","].map((s) => [s, rows[0].split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const cells = (line) => {
    const out = [];
    let cell = "", quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (c === '"' && quoted && line[i + 1] === '"') { cell += '"'; i += 1; }
      else if (c === '"') quoted = !quoted;
      else if (c === sep && !quoted) { out.push(cell.trim()); cell = ""; }
      else cell += c;
    }
    return [...out, cell.trim()].map((v) => v.replace(/ \| /g, " / "));
  };
  return [`## ${name}`, ...rows.map((l) => cells(l).join(" | "))];
}

/**
 * A sheet read whole for "contratos que terminam até 31/12/2026" was filtered by eye and 2027
 * contracts went in (3 runs in 3). The ready filter, with the sheet's own date columns.
 */
/**
 * The month a request speaks of: "esse/este/neste mês", "mês que vem", "mês passado", "em outubro
 * (de 2027)". As the first and last day, dd/mm/yyyy. (A small sheet read whole for "vencem esse
 * mês" lost one of the two October contracts, 05/10/2026.)
 */
export function monthRange(request, now = new Date()) {
  const text = String(request || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const months = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  let year = now.getFullYear(), month = null;
  if (/\b(n?esse|n?este|deste|desse) mes\b/.test(text)) month = now.getMonth();
  else if (/\b(mes que vem|proximo mes)\b/.test(text)) month = now.getMonth() + 1;
  else if (/\bmes passado\b/.test(text)) month = now.getMonth() - 1;
  else {
    const named = text.match(new RegExp(`\\b(?:em|de|no mes de)\\s+(${months.join("|")})(?:\\s+de\\s+(\\d{4}))?\\b`));
    if (named) { month = months.indexOf(named[1]); if (named[2]) year = Number(named[2]); }
  }
  if (month === null) return null;
  const first = new Date(year, month, 1), last = new Date(year, month + 1, 0);
  const fmt = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  return { from: fmt(first), to: fmt(last) };
}

/**
 * "títulos em atraso há mais de 30 dias", "mais de 5% acima do orçado": a number with a unit the
 * sheet has a column for. Read whole, the Financeiro agent picked the rows by eye and sent 22 bills
 * instead of 16 (orchestrator eval, 05/10/2026). The ready filter, with the columns of that unit.
 */
export function numberFilterHint(lines, request) {
  const text = String(request || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const at = lines.findIndex((l, i) => l.includes(" | ") && lines[i + 1]?.includes(" | "));
  if (at < 0) return "";
  const header = lines[at].split(" | ").map((c) => c.trim());
  const sample = lines[at + 1].split(" | ").map((c) => c.trim());
  const ops = { "mais de": ">", "acima de": ">", "superior a": ">", "maior que": ">", "menos de": "<", "abaixo de": "<", "inferior a": "<", "menor que": "<", "pelo menos": ">=", "no minimo": ">=", "ate": "<=" };
  // Every condition in the text: an orchestrated task carries the whole request, other parts too.
  for (const m of text.matchAll(/\b(mais de|acima de|superior a|maior que|menos de|abaixo de|inferior a|menor que|pelo menos|no minimo|ate)\s+(\d+(?:[.,]\d+)?)\s*(%|por cento|dias?\b|mes(?:es)?\b|anos?\b)/g)) {
    const unit = m[3].startsWith("%") || m[3] === "por cento" ? /%/ : m[3].startsWith("dia") ? /\bdias?\b/i : m[3].startsWith("mes") ? /\bm[eê]s(es)?\b/i : /\banos?\b/i;
    const columns = header.filter((name, j) => unit.test(name) && cellValue(sample[j] || "") !== null);
    if (!columns.length) continue;
    const value = m[2].replace(",", ".");
    // One column with that unit: the filtered rows come right here (the hint alone was ignored and
    // every area went into "áreas mais de 5% acima do orçado", agent battery 06/10).
    if (columns.length === 1) {
      const filter = `${columns[0]}${ops[m[1]]}${value}`;
      const rows = appliedRows(lines, filter);
      if (rows) return `\n(O pedido tem uma condição ("${m[0]}"). Já apliquei filter="${filter}"; a lista certa para essa condição é esta (se o pedido tem outra condição, aplique-a também), não escolha de olho na tabela inteira abaixo:\n${rows}\n)`;
    }
    return `\n(O pedido tem uma condição ("${m[0]}"): para a ferramenta comparar, leia de novo com filter=${columns.map((c) => `"${c}${ops[m[1]]}${value}"`).join(" ou ")}, em vez de escolher as linhas de olho.)`;
  }
  return "";
}

/**
 * "Quem está de férias agora?" filtered as "início em outubro" listed people starting on the 13th
 * (empresa eval rh-2, again on 05/10/2026). When the request says now/today and the sheet has a
 * start and an end date, the rows in progress today, with the filter that brings them.
 */
export function nowNote(lines, request, filter, now = new Date()) {
  if (!/\b(agora|hoje|neste momento|atualmente|em curso|vigentes? hoje)\b/i.test(String(request || ""))) return "";
  const at = lines.findIndex((l, i) => l.includes(" | ") && lines[i + 1]?.includes(" | "));
  if (at < 0) return "";
  const header = lines[at].split(" | ").map((c) => c.trim());
  const sample = lines[at + 1].split(" | ").map((c) => c.trim());
  const dated = header.filter((_, j) => DATE.test(sample[j] || ""));
  const start = dated.find((c) => /in[ií]cio|come[çc]o|sa[ií]da|desde/i.test(c));
  const end = dated.find((c) => /\bfim\b|t[ée]rmino|retorno|volta|\bat[ée]\b|final/i.test(c));
  if (!start || !end || (String(filter).includes(start) && String(filter).includes(end))) return "";
  const today = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
  const wanted = `${start}<=${today}; ${end}>=${today}`;
  const count = Number(/(\d+) linha\(s\)/.exec(filterAll(lines, wanted.split("; "), wanted))?.[1] || 0);
  return `\n(ATENÇÃO: o pedido é sobre hoje (${today}). Quem está no período HOJE é filter="${wanted}": ${count} linha(s). Se o pedido é "agora", leia de novo com esse filtro.)`;
}

/**
 * "Qual contrato vence primeiro?", "próximo imposto a vencer": an ordering, not a filter. Read whole,
 * the model compared dates by eye and answered 30/11 for 31/10 (empresa juridico-1, 05/10/2026).
 * The ready read: from today on, sorted by the due-date column.
 */
export function nextDueHint(lines, request, now = new Date()) {
  const text = String(request || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (!/\b(venc\w*|termin\w*|expir\w*|acab\w*)\b[^.?!]{0,30}\bprimeir[oa]s?\b|\bprimeir[oa]s?\b[^.?!]{0,30}\b(a vencer|venc\w*|a terminar)|\bpr[oa]xim[oa]s?\b[^.?!]{0,40}\b(a vencer|venc\w*|a terminar|termin\w*|prazo)/.test(text)) return "";
  const at = lines.findIndex((l, i) => l.includes(" | ") && lines[i + 1]?.includes(" | "));
  if (at < 0) return "";
  const header = lines[at].split(" | ").map((c) => c.trim());
  const sample = lines[at + 1].split(" | ").map((c) => c.trim());
  const col = header.find((c, j) => DATE.test(sample[j] || "") && /t[ée]rmino|venc|fim|validade|prazo|entrega/i.test(c)) || header.find((_, j) => DATE.test(sample[j] || ""));
  if (!col) return "";
  const today = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
  return `\n(O pedido é sobre o que vence/termina primeiro: leia de novo com filter="${col}>=${today}" e sort="${col}" — a primeira linha é a resposta. Não compare as datas de olho.)`;
}

/**
 * "Qual área está mais acima do orçamento?", "quem vendeu menos?": the largest or smallest, which a
 * sort answers. The direction is what the model got wrong (sort="-Término" for "vence primeiro").
 */
export function extremeHint(lines, request) {
  const text = String(request || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const most = /\b(maior|maiores|mais (acima|alto|alta|caro|cara|vendeu|gastou)|maximo|campe[aã]o)\b/.test(text);
  const least = /\b(menor|menores|mais (baixo|baixa|barato|barata)|menos|minimo)\b/.test(text);
  if (most === least) return "";
  const at = lines.findIndex((l, i) => l.includes(" | ") && lines[i + 1]?.includes(" | "));
  if (at < 0) return "";
  const header = lines[at].split(" | ").map((c) => c.trim());
  const sample = lines[at + 1].split(" | ").map((c) => c.trim());
  const numeric = header.filter((c, j) => !ID_COLUMN.test(c) && !DATE.test(sample[j] || "") && cellValue(sample[j] || "") !== null);
  if (!numeric.length) return "";
  const options = numeric.slice(0, 6).map((c) => `sort="${most ? "-" : ""}${c}"`).join(" ou ");
  return `\n(O pedido quer o ${most ? "maior" : "menor"}: leia de novo com a coluna certa, ${options} (${most ? "o sinal - põe o maior primeiro" : "sem sinal, o menor vem primeiro"}). A primeira linha é a resposta.)`;
}

export function dateFilterHint(lines, request, now = new Date()) {
  const dates = [...String(request || "").matchAll(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g)].map((m) => m[0]);
  const wanted = dates.map((d) => [d, dateIntent(request, d)]).find(([, op]) => op);
  const range = !wanted && monthRange(request, now);
  if (!wanted && !range) return "";
  const at = lines.findIndex((l, i) => l.includes(" | ") && lines[i + 1]?.includes(" | "));
  if (at < 0) return "";
  const header = lines[at].split(" | ").map((c) => c.trim());
  const sample = lines[at + 1].split(" | ").map((c) => c.trim());
  const columns = header.filter((_, j) => DATE.test(sample[j] || ""));
  if (!columns.length) return "";
  const filters = range ? columns.map((c) => `"${c}>=${range.from}; ${c}<=${range.to}"`) : columns.map((c) => `"${c}${wanted[1]}${wanted[0]}"`);
  const hint = `\n(O pedido tem ${range ? `um período (${range.from} a ${range.to})` : "uma data"}: para a ferramenta comparar, leia de novo com filter=${filters.join(" ou ")}, em vez de escolher as linhas de olho.)`;
  // The hint alone was ignored: "contratos que terminam até 31/12/2026" picked by eye let 2027 in
  // (agent battery, 06/10). When the request names the column ("terminam" → Término, "entrega" →
  // Entrega prevista), the filtered rows come right here.
  const column = requestColumn(columns, request);
  if (!column) return hint;
  const filter = range ? `${column}>=${range.from}; ${column}<=${range.to}` : `${column}${wanted[1]}${wanted[0]}`;
  const rows = appliedRows(lines, filter);
  // Every row in the period (or too many to show): the date narrows nothing, no hint at all.
  if (!rows) return everyRow.has(filter) ? "" : hint;
  return `\n(O pedido tem ${range ? `um período (${range.from} a ${range.to})` : "uma data"} na coluna ${column}. Já apliquei filter="${filter}"; a lista certa para essa data é esta (se o pedido tem outra condição, aplique-a também), não escolha de olho na tabela inteira abaixo:\n${rows}\n)`;
}

/**
 * "Valor total em atraso de cada cliente", "por fornecedor", "por área": the sums per group, ready.
 * The Controladoria agent, with the Financeiro's 16 rows in hand, went looking for a TOTAL row and
 * then for the company sheet, and gave up without the report (orchestrator eval, 06/10).
 */
export function groupHint(lines, request) {
  const text = foldText(request);
  const asked = [...text.matchAll(/\b(?:por|de cada|para cada|em cada|agrupad[oa]s? por)\s+([a-z]{4,})/g)].map((m) => m[1].slice(0, 5));
  if (!asked.length) return "";
  const sheet = parseSheets(lines).find((s) => s.header && s.rows.length > 1);
  if (!sheet) return "";
  const names = sheet.header.line.split(" | ").map((c) => c.trim());
  const key = names.findIndex((n) => asked.some((a) => foldText(n).startsWith(a)));
  if (key < 0) return "";
  const rows = sheet.rows.map((r) => r.line.replace(/^\s*\d+ {2}/, "").split(" | ").map((c) => c.trim())).filter((cells) => cells.length === names.length && !/^total/i.test(cells[0]));
  // Money and amounts add up; days, percentages and codes don't.
  const sums = names.map((n, j) => j !== key && rows.some((c) => cellValue(c[j]) !== null) && !/dias?|%|c[oó]digo|n[º°o]\b|ano|m[eê]s|data|vencimento|emiss/i.test(n) ? j : -1).filter((j) => j >= 0);
  if (!sums.length) return "";
  const groups = new Map();
  for (const cells of rows) {
    const g = groups.get(cells[key]) || { count: 0, totals: sums.map(() => 0) };
    g.count += 1;
    sums.forEach((j, i) => { g.totals[i] += cellValue(cells[j]) || 0; });
    groups.set(cells[key], g);
  }
  const money = (n) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const table = [`${names[key]} | Linhas | ${sums.map((j) => `Total ${names[j]}`).join(" | ")}`,
    ...[...groups].sort((a, b) => b[1].totals[0] - a[1].totals[0]).map(([name, g]) => `${name} | ${g.count} | ${g.totals.map(money).join(" | ")}`)];
  return `\n(Totais por ${names[key]}, já somados das ${rows.length} linhas (${groups.size} grupos); use estes números:\n${table.join("\n")}\n)`;
}

/**
 * "Abaixo do (estoque) mínimo" / "acima do máximo": a column against another. Read whole (11 rows),
 * the Logística agent left CAF-001 (310 < 1000) out of the list by eye (agent battery, 06/10).
 */
export function limitHint(lines, request) {
  const text = foldText(request);
  const below = /\b(abaixo d[oa]|menor (que|do) o?|inferior ao?)\s*(estoque\s+)?minim/.test(text);
  const above = /\b(acima d[oa]|maior (que|do) o?|superior ao?)\s*(estoque\s+)?maxim/.test(text);
  if (!below && !above) return "";
  const at = lines.findIndex((l, i) => l.includes(" | ") && lines[i + 1]?.includes(" | "));
  if (at < 0) return "";
  const header = lines[at].split(" | ").map((c) => c.trim());
  const sample = lines[at + 1].split(" | ").map((c) => c.trim());
  const numeric = header.filter((name, j) => cellValue(sample[j] || "") !== null);
  const limit = numeric.find((c) => foldText(c).includes(below ? "minim" : "maxim"));
  const amount = numeric.find((c) => c !== limit && /saldo|estoque|quantidade|qtd|atual|disponivel/.test(foldText(c)));
  if (!limit || !amount) return "";
  const filter = `${amount}${below ? "<" : ">"}${limit}`;
  const rows = appliedRows(lines, filter);
  if (!rows) return `\n(O pedido compara com o ${below ? "mínimo" : "máximo"}: leia de novo com filter="${filter}" para a ferramenta comparar, em vez de escolher de olho.)`;
  return `\n(O pedido compara com o ${below ? "mínimo" : "máximo"}. Já apliquei filter="${filter}"; a lista certa para essa condição é esta (se o pedido tem outra condição, aplique-a também), não escolha de olho na tabela inteira abaixo:\n${rows}\n)`;
}

/**
 * The rows a ready filter brings, when they help: null if it keeps every row (all the "chamados de
 * setembro" are from September: 74 rows called "the right list" for "não resolvidos" made the TI
 * agent re-read until the guard stopped it, 06/10), none, or too many to show next to the sheet.
 */
function appliedRows(lines, filter) {
  const result = filterRows(lines, filter);
  const count = Number(/(\d+) linha\(s\) com/.exec(result)?.[1] ?? NaN);
  const total = parseSheets(lines).reduce((n, s) => n + (s.header ? s.rows.filter((r) => r.line.includes(" | ")).length : 0), 0);
  if (Number.isFinite(count) && count >= total) everyRow.add(filter);
  if (!Number.isFinite(count) || count === 0 || count >= total || result.length > 2500) return null;
  return result;
}
const everyRow = new Set();

/** The one date column the request speaks of, by the stem of its name ("terminam" → "Término"). */
const COLUMN_FILLER = new Set(["data", "prevista", "previsto", "dia", "para"]);
// The verbs people use for a date column's name: "começam férias" is the column "Início das férias".
const COLUMN_SYNONYMS = [[/\b(comec|inici|sai(em|r)? de)/, " inicio"], [/\b(termin|acab|encerr|volt(am|a|em)\b)/, " termino fim retorno"], [/\b(venc)/, " vencimento"], [/\b(entreg|cheg)/, " entrega"], [/\b(admit|contrat)/, " admissao"], [/\b(pag[oa]|pagamento)/, " pagamento"]];
export function requestColumn(columns, request) {
  // The verb first: "começam as férias … com início e fim" names both columns as output, but
  // "começam" says which one the condition is on (agent battery, 06/10).
  const base = foldText(request);
  const added = COLUMN_SYNONYMS.filter(([test]) => test.test(base)).map(([, add]) => add).join("");
  if (added) {
    const byVerb = pickColumn(columns, added);
    if (byVerb) return byVerb;
  }
  return pickColumn(columns, base + added);
}

function pickColumn(columns, text) {
  // Only the words that tell the columns apart: "férias" in "Início das férias" and "Fim das férias"
  // matched both and nothing was chosen. Short words count here ("fim").
  const words = (c) => foldText(c).split(/[^a-z]+/).filter((w) => w.length >= 3 && !COLUMN_FILLER.has(w) && w !== "das" && w !== "dos").map((w) => w.slice(0, 4));
  const shared = (s) => columns.length > 1 && columns.every((c) => words(c).includes(s));
  const stems = (c) => words(c).filter((s) => !shared(s));
  const hits = columns.filter((c) => stems(c).some((s) => new RegExp(`\\b${s}`).test(text)));
  return hits.length === 1 ? hits[0] : null;
}

export function filterRows(lines, filter, { sort, request } = {}) {
  sort = typeof sort === "string" ? parseSort(sort) : sort;
  // "Coluna=15/10/2026", or "Coluna>=15/10/2026; Coluna<=15/10/2026", for a request that says
  // "até 15/10": the person's words decide the operator of a condition on that date.
  if (request && String(filter || "").trim()) {
    const words = { "<=": "até", ">=": "a partir de", "<": "antes de", ">": "depois de" };
    const changed = [];
    // "Em outubro" is the whole month: a filter that starts or ends inside it ("Início>=13/10/2026",
    // an RH agent's, 06/10) gets the month's own first and last day.
    const month = monthRange(request, process.env.HARNESS_NOW ? new Date(process.env.HARNESS_NOW) : new Date());
    const dayNumber = (d) => { const [dd, mm, yy] = d.split("/").map(Number); return yy * 10000 + mm * 100 + dd; };
    const parts = [...new Set(String(filter).replace(/["“”']/g, "").split(/\s*;\s*/).filter(Boolean).map((part) => {
      const m = part.match(/^([^=<>!]{1,60}?)\s*(>=|<=|>|<|=)\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*$/);
      if (m && month && !dateIntent(request, m[3])) {
        const inside = dayNumber(m[3]) > dayNumber(month.from) && dayNumber(m[3]) < dayNumber(month.to);
        if (inside && (m[2] === ">=" || m[2] === ">")) { changed.push(`${m[1].trim()}>=${month.from} (o pedido fala do mês inteiro)`); return `${m[1].trim()}>=${month.from}`; }
        if (inside && (m[2] === "<=" || m[2] === "<")) { changed.push(`${m[1].trim()}<=${month.to} (o pedido fala do mês inteiro)`); return `${m[1].trim()}<=${month.to}`; }
      }
      const intended = m && dateIntent(request, m[3]);
      if (!intended || intended === m[2]) return part.trim();
      changed.push(`${m[1].trim()}${intended}${m[3]} (o pedido diz "${words[intended]}" essa data)`);
      return `${m[1].trim()}${intended}${m[3]}`;
    }))];
    if (changed.length) return `${filterRows(lines, parts.join("; "), { sort })}\n(Usei ${changed.join("; ")}.)`;
  }
  // Sorting (or adding up) the whole sheet: every row of every sheet.
  if (!String(filter || "").trim()) {
    const sheets = parseSheets(lines).filter((s) => s.header && s.rows.length);
    if (!sheets.length) return "Nenhuma tabela neste arquivo.";
    return `${sheets.flatMap((s) => sheetBlock(s, s.rows, sort)).join("\n")}\n${sheets.reduce((n, s) => n + s.rows.length, 0)} linha(s)${sort ? `, em ordem de ${sort.col}${sort.desc ? " (decrescente)" : ""}` : ""}.`;
  }
  // The model copies the example literally: "Coluna=Dias em atraso>30", "\"Dias em atraso\">30".
  filter = String(filter).split(/\s*;\s*/).map((c) => c.replace(/^\s*coluna\s*[=:>]\s*(?=\S+.*[=<>])/i, "").replace(/^\s*coluna\s+(?=\S.*[=<>])/i, "").replace(/["“”']/g, "").trim()).join("; ");
  // Several conditions: "Dias em atraso>30; Situação=Em atraso" (all must hold).
  const parts = String(filter).split(/\s*;\s*/).filter(Boolean);
  if (parts.length > 1) return filterAll(lines, parts, filter, sort);
  const [, colPart, op, valuePart] = filter.match(/^([^=<>!]{1,60}?)\s*(>=|<=|!=|>|<|=)\s*(.+)$/) || [];
  if (op && op !== "=") return filterAll(lines, [filter], filter, sort);
  // "entrega até 15/10" written as "Entrega prevista=15/10/2026" brought only the 15th.
  // A plain reminder was ignored 5 times out of 5; the counts make the difference visible.
  const count = (f) => Number(/(\d+) linha\(s\)/.exec(filterAll(lines, [f], f))?.[1] || 0);
  const dateNote = op === "=" && DATE.test(String(valuePart).trim())
    ? `\n(ATENÇÃO: isto é só o dia ${valuePart.trim()}. "Até" essa data (${colPart.trim()}<=${valuePart.trim()}) dá ${count(`${colPart}<=${valuePart}`)} linha(s); "a partir de" (>=) dá ${count(`${colPart}>=${valuePart}`)}. Se o pedido é "até" ou "a partir de", leia de novo com o operador certo.)`
    : "";
  const wanted = foldText(valuePart ?? filter);
  const column = colPart ? foldText(colPart) : null;
  const sheets = [];
  let sheet = { name: "", header: null, rows: [] };
  lines.forEach((line, i) => {
    if (line.startsWith("## ")) { sheets.push(sheet = { name: line, header: null, rows: [] }); return; }
    if (!line.trim()) return;
    if (!sheet.header && line.includes(" | ")) { sheet.header = { line, i, cells: line.split(" | ").map(foldText) }; return; }
    sheet.rows.push({ line, i });
  });
  if (!sheets.includes(sheet)) sheets.unshift(sheet);
  const anyColumn = column && sheets.some((s) => s.header?.cells.some((c) => c.includes(column)));
  const out = [];
  let total = 0;
  for (const s of sheets) {
    const at = anyColumn ? (s.header?.cells.findIndex((c) => c === column) ?? -1) : -1;
    const index = anyColumn ? (at >= 0 ? at : s.header?.cells.findIndex((c) => c.includes(column)) ?? -1) : -1;
    if (anyColumn && index < 0) continue;
    const hits = s.rows.filter(({ line }) => (index >= 0 ? foldText(line.split(" | ")[index] ?? "").includes(wanted) : foldText(line).includes(wanted)));
    if (!hits.length) continue;
    total += hits.length;
    out.push(...sheetBlock(s, hits, sort));
  }
  const columns = [...new Set(sheets.flatMap((s) => s.header?.line.split(" | ") || []))].join(", ");
  if (!total) return `Nenhuma linha com "${filter}".${columns ? ` Colunas: ${columns}.` : ""}${dateNote}`;
  return `${out.join("\n")}\n${total} linha(s) com "${filter}"${column && !anyColumn ? ` (coluna "${colPart}" não existe; procurei o texto na linha inteira)` : ""}.${dateNote}`;
}
function parseSheets(lines) {
  const sheets = [];
  let sheet = { name: "", header: null, rows: [] };
  lines.forEach((line, i) => {
    if (line.startsWith("## ")) { sheets.push(sheet = { name: line, header: null, rows: [] }); return; }
    if (!line.trim()) return;
    if (!sheet.header && line.includes(" | ")) { sheet.header = { line, i, cells: line.split(" | ").map(foldText) }; return; }
    sheet.rows.push({ line, i });
  });
  if (!sheets.includes(sheet)) sheets.unshift(sheet);
  return sheets;
}

/** Every condition must hold; each names its column ("Coluna>30", "Coluna=texto"). */
function filterAll(lines, conditions, label, sort = null) {
  const parsed = conditions.map((c) => {
    const [, col, op, value] = c.match(/^([^=<>!]{1,60}?)\s*(>=|<=|!=|>|<|=)\s*(.+)$/) || [];
    return col ? { col: foldText(col), op, text: foldText(value), number: cellValue(value.trim()), raw: c } : null;
  });
  const sheets = parseSheets(lines);
  const headerCells = sheets.flatMap((s) => s.header?.cells || []);
  const columns = [...new Set(sheets.flatMap((s) => s.header?.line.split(" | ") || []))].join(", ");
  // "Saldo<Estoque mínimo": the other side is a column of the same row.
  for (const p of parsed) if (p && COMPARE[p.op] && p.number === null && headerCells.some((c) => c === p.text || c.includes(p.text))) p.otherCol = p.text;
  const bad = parsed.find((p) => !p || (COMPARE[p.op] && p.number === null && !p.otherCol));
  if (bad !== undefined) return `Condição inválida: "${bad?.raw || conditions[parsed.indexOf(bad)]}". Use Coluna>número, Coluna>=dd/mm/aaaa, Coluna<OutraColuna, Coluna=texto ou Coluna!=texto, separadas por ";".${columns ? ` Colunas: ${columns}.` : ""}`;
  const out = [];
  let total = 0;
  let found = false;
  for (const s of sheets) {
    const columnOf = (name) => {
      const exact = s.header?.cells.findIndex((c) => c === name) ?? -1;
      if (exact >= 0) return exact;
      const part = s.header?.cells.findIndex((c) => c.includes(name)) ?? -1;
      if (part >= 0) return part;
      // Accents lost on the way ("Situa o", "Situa??o" for Situação: 3 runs in a row, 06/10): each gap
      // stands for up to 3 characters.
      const pieces = String(name).split(/[^a-z0-9]+/).filter(Boolean);
      if (pieces.length < 2) return -1;
      const loose = new RegExp(`^${pieces.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".{1,3}")}`);
      return s.header?.cells.findIndex((c) => loose.test(c)) ?? -1;
    };
    const indexes = parsed.map((p) => columnOf(p.col));
    const others = parsed.map((p) => (p.otherCol ? columnOf(p.otherCol) : null));
    if (indexes.some((i) => i < 0) || others.some((i) => i !== null && i < 0)) continue;
    found = true;
    const hits = s.rows.filter(({ line }) => {
      const cells = line.split(" | ");
      return parsed.every((p, k) => {
        const cell = cells[indexes[k]] ?? "";
        if (p.op === "=") return foldText(cell).includes(p.text);
        if (p.op === "!=") return !foldText(cell).includes(p.text);
        const value = cellValue(cell);
        const against = others[k] !== null ? cellValue(cells[others[k]] ?? "") : p.number;
        return value !== null && against !== null && COMPARE[p.op](value, against);
      });
    });
    if (!hits.length) continue;
    total += hits.length;
    out.push(...sheetBlock(s, hits, sort));
  }
  if (!found) return `Nenhuma planilha tem as colunas de "${label}".${columns ? ` Colunas: ${columns}.` : ""}`;
  if (!total) return `Nenhuma linha com "${label}".`;
  return `${out.join("\n")}\n${total} linha(s) com "${label}".`;
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".venv", "venv", "__pycache__", "dist", "build", ".next", ".cache", "$recycle.bin", "appdata"]);

export function expandPath(input, knownFolders = {}, base) {
  let text = String(input || "").trim().replace(/^["'`]+|["'`,;]+$/g, "");
  if (!text) throw new Error("Informe o caminho.");
  if (text === "~" || text.startsWith("~/") || text.startsWith("~\\")) text = join(homedir(), text.slice(1));
  // Windows (%USERPROFILE%) and PowerShell ($env:USERPROFILE, $HOME) variables,
  // and the doubled backslashes small models copy from JSON (UNC prefix kept).
  text = text.replace(/%([A-Z_]+)%/gi, (m, name) => process.env[name] ?? m)
    .replace(/\$env:([A-Z_][A-Z0-9_]*)/gi, (m, name) => process.env[name] ?? process.env[name.toUpperCase()] ?? m)
    .replace(/^\$HOME(?=$|[\\/])/i, homedir());
  text = text.replace(/^(\\\\)?/, "$1").replace(/(?!^)\\{2,}/g, "\\").replace(/\/{2,}/g, "/");
  if (!isAbsolute(text)) {
    // "Desktop/notas.txt", "área de trabalho\\x" → the real known folder;
    // anything else is relative to the project folder (or the Desktop).
    const [head, ...rest] = text.split(/[\\/]/);
    // With a project folder, relative is relative to it (as the agent is told): organizing a folder
    // into "Documentos/" sent the files to the user's Documents. The user's folders go by full path.
    const alias = base ? null : { desktop: "desktop", "área de trabalho": "desktop", "area de trabalho": "desktop", documents: "documents", documentos: "documents", downloads: "downloads" }[head.toLowerCase()];
    // "planilha-1/x.csv" inside the folder planilha-1 means the folder itself: a small model
    // repeats the project's name, and the file landed in planilha-1\planilha-1 (unless that exists).
    if (base && rest.length && head.toLowerCase() === basename(base).toLowerCase() && !existsSync(join(base, head))) text = rest.join("/");
    text = alias && knownFolders[alias] ? join(knownFolders[alias], ...rest) : join(base || knownFolders.desktop || homedir(), text);
  }
  return resolve(text);
}

// Resolves symlinks/junctions through the nearest existing ancestor, so a
// link inside an allowed folder can't be used to reach outside it.
async function realish(path) {
  let current = path;
  const tail = [];
  for (;;) {
    try { return join(await realpath(current), ...tail.reverse()); }
    catch {
      const parent = dirname(current);
      if (parent === current) return path;
      tail.push(current.slice(parent.length).replace(/^[\\/]/, ""));
      current = parent;
    }
  }
}

export async function isInsideRoots(path, roots = []) {
  const real = await realish(path);
  for (const root of roots) {
    const realRoot = await realish(resolve(root));
    const rel = relative(realRoot.toLowerCase(), real.toLowerCase());
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel) && !rel.split(sep).includes(".."))) return true;
  }
  return false;
}

const full = (path, ctx) => expandPath(path, ctx.knownFolders, ctx.workspace);
/**
 * `before` matched line by line ignoring leading (and trailing) spaces; only a unique match counts.
 * `after` is re-indented by the difference between the file's indentation and the model's.
 */
export function looseReplace(text, before, after) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const raw = before.replace(/\r\n/g, "\n").split("\n");
  while (raw.length && !raw[0].trim()) raw.shift();
  while (raw.length && !raw.at(-1).trim()) raw.pop();
  const want = raw.map((l) => l.trim());
  if (!want.length) return null;
  const hits = [];
  for (let i = 0; i + want.length <= lines.length; i += 1) if (want.every((w, k) => lines[i + k].trim() === w)) hits.push(i);
  if (hits.length !== 1) return null;
  const at = hits[0];
  const indent = (s) => s.match(/^\s*/)[0].length;
  // The difference shows on the first indented line (a top-level first line has 0 on both sides).
  const k = Math.max(0, raw.findIndex((l, j) => indent(l) > 0 || indent(lines[at + j]) > 0));
  const delta = indent(lines[at + k]) - indent(raw[k]);
  const fixed = after.replace(/\r\n/g, "\n").split("\n").map((l) => (!l.trim() ? l : delta >= 0 ? " ".repeat(delta) + l : l.replace(new RegExp(`^ {0,${-delta}}`), "")));
  return [...lines.slice(0, at), ...fixed, ...lines.slice(at + want.length)].join(eol);
}

// "to" may be a folder (ends with a slash, or an existing folder): the file keeps its name there.
function moveTarget({ from, to }, ctx) {
  const target = full(to, ctx);
  // "relatorio.pdf" → "...\Documentos" (no slash, folder not created yet) renamed the PDF to a
  // file called "Documentos". A target with no extension, for a source that has one, is a folder.
  const looksLikeFolder = !existsSync(target) && !extname(target) && Boolean(extname(String(from)));
  const isFolder = /[\\/]$/.test(String(to)) || looksLikeFolder || (existsSync(target) && statSafe(target)?.isDirectory());
  return isFolder ? join(target, basename(String(from))) : target;
}
function statSafe(path) { try { return statSync(path); } catch { return null; } }

// Documents write_document created while the app runs: those (only those) may be replaced.
const OWN_DOCUMENTS = new Set();
// The format wins over a missing or wrong extension ("proposta" + docx → proposta.docx).
export const humanSize = (bytes) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1).replace(".", ",")} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1).replace(".", ",")} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} bytes`);

/**
 * Downloads twice: "boleto (1).pdf", "boleto - Cópia.pdf", "boleto(2).pdf" next to "boleto.pdf"
 * with the same size. Pairs [original, copy].
 */
export function likelyCopies(files) {
  const base = (name) => name.replace(/\s*(\(\d+\)|- c[óo]pia( \(\d+\))?|- copy( \(\d+\))?)(?=\.[^.]+$|$)/i, "").toLowerCase();
  const byKey = new Map();
  const pairs = [];
  for (const f of [...files].sort((a, b) => a.name.length - b.name.length)) {
    if (f.size === null || f.size === undefined) continue;
    const key = `${base(f.name)}|${f.size}`;
    if (byKey.has(key)) pairs.push([byKey.get(key), f.name]);
    else byKey.set(key, f.name);
  }
  return pairs;
}

/**
 * Where a NEW file lands. An automatic run (schedule, file, team) has nobody to say yes: a file aimed
 * outside the agent's folders goes into its own folder instead of being refused and lost (it invented
 * a "...-saida" folder next to the watched one, agent battery 06/10). The result names the path.
 */
export function landing(file, ctx) {
  const automatic = ctx.env?.AGENT_RUN_TRIGGER && ctx.env.AGENT_RUN_TRIGGER !== "manual";
  if (!automatic || !ctx.workspace || existsSync(file)) return file;
  const roots = [ctx.workspace, ...(ctx.workspaceRoots || [])].filter(Boolean);
  const inside = roots.some((r) => { const rel = relative(r, file); return !rel || (!rel.startsWith("..") && !isAbsolute(rel)); });
  return inside ? file : join(ctx.workspace, basename(file));
}

/**
 * A date in a file name is not a path: "Contas a Pagar - Até 15/10/2026.xlsx" became the folders
 * "Até 15\10\" holding "2026.xlsx" (agent battery, 06/10). dd/mm/yyyy in the last part of the path
 * (the name, and the folder pieces the slashes made of it) becomes dd-mm-yyyy.
 */
export function undatedSlashes(path) {
  return String(path).replace(/(\d{1,2})[\\/](\d{1,2})[\\/](\d{4})(?=[^\\/]*$)/, "$1-$2-$3");
}

function documentPath(args, ctx) {
  // Small models name the field after other tools ("file_path", "filename").
  const path = args.path || args.file_path || args.filePath || args.filename || args.file || args.name;
  const format = args.format;
  // "planilha-1/contratos.xlsx" inside the folder planilha-1 meant the folder itself,
  // not a new planilha-1\planilha-1 (a small model repeats the project's name).
  if (ctx.workspace && !isAbsolute(String(path || ""))) {
    const [head, ...rest] = String(path).split(/[\\/]/);
    if (rest.length && head.toLowerCase() === basename(ctx.workspace).toLowerCase() && !existsSync(join(ctx.workspace, head))) return documentPath({ ...args, path: rest.join("/"), file_path: undefined, filePath: undefined, filename: undefined, file: undefined, name: undefined }, ctx);
  }
  if (!String(path || "").trim()) throw new Error('Falta "path": informe o caminho com o nome do arquivo (ex.: C:\\Users\\voce\\Documents\\proposta_atualizada.docx) e o "content" completo em markdown.');
  const file = landing(full(undatedSlashes(path), ctx), ctx);
  const ext = extname(file).slice(1).toLowerCase();
  let wanted = DOCUMENT_FORMATS.includes(String(format || "").toLowerCase()) ? String(format).toLowerCase() : DOCUMENT_FORMATS.includes(ext) ? ext : "docx";
  // Asked for a "planilha", it wrote funcionarios_ferias.md (agents eval, 05/10/2026): the person's
  // words decide over a plain-text format. A deliberate .md/.txt request stays.
  const asked = requestedFormat(ctx.request);
  if (asked && ["md", "txt"].includes(wanted)) wanted = asked;
  // "Crie um documento" saved as a spreadsheet lost the text around the table (kit de mídia, 05/10).
  if (asked === "docx" && wanted === "xlsx") wanted = "docx";
  // "Gere uma planilha…" delivered as a PDF (agent battery, 06/10): unless PDF or Word was named too.
  if (asked === "xlsx" && ["pdf", "docx"].includes(wanted) && !/\b(pdf|word|docx)\b/i.test(String(ctx.request || ""))) wanted = "xlsx";
  return ext === wanted ? file : `${DOCUMENT_FORMATS.includes(ext) ? file.slice(0, -ext.length - 1) : file}.${wanted}`;
}

/** The format the person's words ask for: planilha → xlsx, Word/relatório → docx, PDF → pdf. */
export function requestedFormat(request) {
  const text = String(request || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/\b(markdown|\.md|texto puro|\.txt)\b/.test(text)) return null;
  if (/\b(planilha|excel|xlsx)\b/.test(text)) return "xlsx";
  if (/\bpdf\b/.test(text)) return "pdf";
  if (/\b(word|docx|relatorio|documento)\b/.test(text)) return "docx";
  return null;
}

// Explicit folder, else the project, else the person's usual folders.
const searchRoots = ({ path }, ctx) => (path ? [full(path, ctx)] : ctx.workspace ? [ctx.workspace] : (ctx.workspaceRoots?.length ? ctx.workspaceRoots : personalFolders(ctx)).filter((p) => existsSync(p)));

const fold = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Where a file the person mentions by name usually lives. */
export function personalFolders(ctx = {}) {
  const f = ctx.knownFolders || {};
  const home = f.home || homedir();
  return [...new Set([ctx.workspace, f.desktop, f.documents, f.downloads, join(home, "OneDrive"), join(home, "Desktop"), join(home, "Documents"), join(home, "Downloads")].filter(Boolean))];
}

/**
 * Finds files by name (accent/case-insensitive; with or without extension)
 * in the person's folders: exact name first, then same name without
 * extension, then names containing it; newest first within each.
 */
export async function findFilesByName(name, roots, { limit = 5, signal } = {}) {
  const wanted = fold(String(name).replace(/\uFFFD/g, "").split(/[\\/]/).pop().trim());
  if (wanted.length < 3) return [];
  const stem = wanted.replace(/\.[a-z0-9]{1,5}$/, "");
  const hits = [];
  const seen = new Set();
  for (const root of roots) {
    const stack = [[root, 0]];
    let visited = 0;
    while (stack.length && visited < 15000 && !signal?.aborted) {
      const [dir, depth] = stack.pop();
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        visited += 1;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { if (depth < 5 && !SKIP_DIRS.has(entry.name.toLowerCase()) && !entry.name.startsWith(".")) stack.push([path, depth + 1]); continue; }
        if (!entry.isFile() || seen.has(path.toLowerCase())) continue;
        const base = fold(entry.name);
        const rank = base === wanted ? 0 : base.replace(/\.[a-z0-9]{1,5}$/, "") === stem ? 1 : stem.length >= 8 && base.includes(stem) ? 2 : -1;
        if (rank < 0) continue;
        seen.add(path.toLowerCase());
        hits.push({ path, rank, mtime: (await stat(path).catch(() => ({ mtimeMs: 0 }))).mtimeMs });
      }
    }
  }
  return hits.sort((a, b) => a.rank - b.rank || b.mtime - a.mtime).slice(0, limit).map((h) => h.path);
}

/**
 * The path as given if it exists; otherwise the same file name found in the
 * person's folders — models often guess the folder (Desktop vs Downloads) or
 * mangle accents ("\\�rea de Trabalho").
 */
export async function resolveExisting(path, ctx, { directory = false } = {}) {
  const target = full(path, ctx);
  const info = await stat(target).catch(() => null);
  if (info && (directory ? info.isDirectory() : true)) return target;
  if (directory) throw new Error(`A pasta ${target} não existe.`);
  // "Jurídico\Contratos Vigentes.xlsx" as knowledge_map shows it is relative to the company folder,
  // not to the agent's own (seen in 3 of 3 runs, once followed by 12 blind searches); "%20" too.
  const rel = (() => {
    const raw = decodeURIComponent(String(path).replace(/%(?![0-9a-f]{2})/gi, "%25"));
    if (!isAbsolute(raw)) return raw;
    const inside = ctx.workspace && relative(ctx.workspace, raw);
    return inside && !inside.startsWith("..") && !isAbsolute(inside) ? inside : null;
  })();
  // A sector agent's root is the sector folder (F:\EmpresaIA\Jurídico) and the model writes the path
  // from the company folder ("Jurídico\Contratos Vigentes.xlsx"): its parent is tried too.
  for (const root of rel ? ctx.knowledgeRoots || [] : []) {
    for (const candidate of [join(root, rel), join(dirname(root), rel)]) {
      if ((await isInsideRoots(candidate, [root])) && (await stat(candidate).catch(() => null))?.isFile()) return candidate;
    }
  }
  const found = await findFilesByName(target, personalFolders(ctx), { limit: 3, signal: ctx.signal });
  if (found.length) return found[0];
  // "Desvio Orçado x Realizado 2026.xlsx" for "Orçamento 2026 - Orçado x Realizado.xlsx": the
  // closest real name in the company folders, instead of a dead end the model retries.
  const close = await closestKnowledgeFile(target, ctx.knowledgeRoots || []);
  throw new Error(`O arquivo ${target} não existe${close ? `. O arquivo da empresa com nome mais parecido é ${close}: leia esse caminho completo` : ` e não encontrei "${target.split(/[\\/]/).pop()}" na pasta do projeto, Área de Trabalho, Documentos, Downloads nem OneDrive. Peça o caminho ao usuário`}.`);
}

/** The file under the company folders whose name shares the most words (2 at least) with `wanted`. */
export async function closestKnowledgeFile(wanted, roots = [], { limit = 3000 } = {}) {
  const words = (s) => new Set(foldText(basename(String(s)).replace(/\.[^.]+$/, "")).split(/[^a-z0-9]+/).filter((w) => w.length >= 3));
  const want = words(wanted);
  const ext = extname(String(wanted)).toLowerCase();
  if (want.size < 2) return null;
  let best = null, bestScore = 1, seen = 0;
  for (const root of roots) {
    for await (const file of walk(root)) {
      if (++seen > limit) break;
      if (ext && extname(file).toLowerCase() !== ext) continue;
      // By stem too: "Vigência" and "Vigentes" are the same word for this purpose.
      const score = [...words(file)].filter((w) => [...want].some((x) => x === w || (x.length >= 5 && w.length >= 5 && x.slice(0, 5) === w.slice(0, 5)))).length;
      if (score > bestScore) { best = file; bestScore = score; }
    }
  }
  return best;
}

/** "src/**\/*.ts" → RegExp over forward-slash relative paths. */
export function globToRegExp(pattern) {
  const source = String(pattern).replace(/\\/g, "/").replace(/^\.\//, "");
  let out = "";
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    if (c === "*" && source[i + 1] === "*") { out += source[i + 2] === "/" ? "(?:.*/)?" : ".*"; i += source[i + 2] === "/" ? 2 : 1; }
    else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else if (c === "{") { const end = source.indexOf("}", i); if (end > i) { out += `(?:${source.slice(i + 1, end).split(",").map((s) => s.replace(/[.+^$()|[\]\\]/g, "\\$&")).join("|")})`; i = end; } else out += "\\{"; }
    else out += /[.+^$()|[\]\\]/.test(c) ? `\\${c}` : c;
  }
  return new RegExp(`^${source.includes("/") ? "" : "(?:.*/)?"}${out}$`, "i");
}

async function* walk(root, signal) {
  const stack = [root];
  let seen = 0;
  while (stack.length) {
    if (signal?.aborted) return;
    const dir = stack.pop();
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (++seen > MAX_WALK) return;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name.toLowerCase()) && !entry.name.startsWith(".")) stack.push(path); }
      else if (entry.isFile()) yield path;
    }
  }
}

const rel = (root, path) => relative(root, path).split(sep).join("/");

async function looksBinary(path) {
  const handle = await open(path, "r");
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(1024), 0, 1024, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally { await handle.close(); }
}

export const fileTools = [
  {
    name: "list_dir",
    description: "Lista arquivos e pastas de um diretório, com tamanho e data de cada arquivo, e avisa de cópias prováveis (\"foto (1).jpg\" igual a \"foto.jpg\"). Caminhos relativos partem da pasta do projeto; aceita também Desktop, Documentos e Downloads. Para \"os maiores\" use sort=\"tamanho\"; para \"o que chegou por último\", sort=\"data\".",
    parameters: { type: "object", properties: { path: { type: "string", description: "pasta (padrão: pasta do projeto)" }, sort: { type: "string", enum: ["nome", "tamanho", "data"], description: "opcional: tamanho (maiores primeiro) ou data (mais recentes primeiro)" } } },
    stage: (a) => `Listando ${a.path || "a pasta do projeto"}…`,
    describe: (a, ctx) => ({ kind: "read", paths: [full(a.path || ".", ctx)] }),
    async run({ path, sort }, ctx) {
      const dir = full(path || ".", ctx);
      const entries = await readdir(dir, { withFileTypes: true });
      // Sizes and dates: "quais os maiores arquivos?", "o que baixei essa semana?" had only names to go on.
      const items = await Promise.all(entries.slice(0, 400).map(async (e) => {
        if (e.isDirectory()) return { name: e.name, dir: true };
        try { const st = await stat(join(dir, e.name)); return { name: e.name, size: st.size, mtime: st.mtimeMs }; } catch { return { name: e.name, size: null, mtime: 0 }; }
      }));
      const order = String(sort || "").toLowerCase();
      if (order.startsWith("tam")) items.sort((a, b) => (b.size ?? -1) - (a.size ?? -1));
      else if (order.startsWith("dat")) items.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
      const day = (ms) => new Date(ms).toLocaleDateString("pt-BR");
      const lines = items.slice(0, 200).map((i) => (i.dir ? `[pasta] ${i.name}` : `        ${i.name} — ${i.size === null ? "?" : humanSize(i.size)}, ${day(i.mtime)}`));
      const copies = likelyCopies(items.filter((i) => !i.dir));
      const copyNote = copies.length ? `\nCópias prováveis (mesmo nome com (1)/- Cópia e mesmo tamanho): ${copies.slice(0, 15).map(([a, b]) => `"${b}" = "${a}"`).join("; ")}${copies.length > 15 ? "…" : ""}` : "";
      return `${dir}${order.startsWith("tam") ? " (maiores primeiro)" : order.startsWith("dat") ? " (mais recentes primeiro)" : ""}\n${lines.join("\n") || "(vazio)"}${entries.length > 200 ? `\n… mais ${entries.length - 200}` : ""}${copyNote}`;
    },
  },
  {
    name: "search_files",
    description: "Procura arquivos pelo nome: um nome ou parte dele (ex.: \"MARU_MEDIA_KIT\", \"relatorio\") ou um padrão glob (\"**/*.py\", \"src/**/App.tsx\"). Sem path, procura na pasta do projeto ou, sem projeto, na Área de Trabalho, Documentos, Downloads e OneDrive. Ignora node_modules, .git e pastas ocultas.",
    parameters: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string", description: "pasta onde procurar (opcional)" } }, required: ["pattern"] },
    stage: (a) => `Procurando ${a.pattern}…`,
    describe: (a, ctx) => ({ kind: "read", paths: searchRoots(a, ctx) }),
    async run({ pattern, path }, ctx) {
      const roots = searchRoots({ path }, ctx);
      // A bare name is a "contains" search, accent- and case-insensitive.
      const glob = /[*?{]/.test(pattern) ? pattern : `*${fold(String(pattern).replace(/\.[a-z0-9]{1,5}$/i, ""))}*`;
      const regex = globToRegExp(glob);
      const found = [];
      for (const root of roots) {
        for await (const file of walk(root, ctx.signal)) {
          if (regex.test(fold(rel(root, file)))) found.push(roots.length > 1 ? file : rel(root, file));
          if (found.length >= 200) break;
        }
      }
      return found.length ? `${roots.length > 1 ? "" : `${roots[0]}\n`}${found.join("\n")}${found.length >= 200 ? "\n… (limite de 200)" : ""}` : `Nenhum arquivo com "${pattern}" em ${roots.join("; ")}.`;
    },
  },
  {
    name: "grep",
    description: "Procura um texto ou expressão regular DENTRO dos arquivos e devolve arquivo:linha: trecho. Use glob para filtrar, ex.: \"**/*.js\".",
    parameters: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" }, glob: { type: "string" }, ignoreCase: { type: "boolean" } }, required: ["pattern"] },
    stage: (a) => `Procurando "${a.pattern}" nos arquivos…`,
    describe: (a, ctx) => ({ kind: "read", paths: [full(a.path || ".", ctx)] }),
    async run({ pattern, path, glob, ignoreCase = true }, ctx) {
      const root = full(path || ".", ctx);
      let regex;
      try { regex = new RegExp(pattern, ignoreCase ? "i" : ""); } catch { regex = new RegExp(String(pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), ignoreCase ? "i" : ""); }
      const filter = glob ? globToRegExp(glob) : null;
      const target = await stat(root).catch(() => null);
      if (!target) throw new Error(`${root} não existe.`);
      const files = target.isFile() ? [root] : walk(root, ctx.signal);
      const hits = [];
      for await (const file of files) {
        if (filter && !filter.test(rel(root, file))) continue;
        const info = await stat(file).catch(() => null);
        if (!info || info.size > 1_000_000 || await looksBinary(file).catch(() => true)) continue;
        const lines = (await readFile(file, "utf8")).split(/\r?\n/);
        lines.forEach((line, i) => { if (hits.length < 100 && regex.test(line)) hits.push(`${target.isFile() ? file : rel(root, file)}:${i + 1}: ${line.trim().slice(0, 200)}`); });
        if (hits.length >= 100) break;
      }
      return hits.length ? hits.join("\n") + (hits.length >= 100 ? "\n… (limite de 100)" : "") : `Nada encontrado para "${pattern}".`;
    },
  },
  {
    name: "read_file",
    description: "Lê um arquivo com números de linha: texto, código, e também Word (.docx), Excel (.xlsx), PowerPoint (.pptx), PDF (inclusive escaneado) e imagens com texto (lidas por OCR). Para arquivos grandes use offset (linha inicial, a partir de 1) e limit (quantidade de linhas). Para contar ou listar linhas de uma planilha (quem, quantos, quais) use filter: \"Coluna=texto\" (ex.: \"Situação=Aberto\"), comparação de número ou data (\"Dias em atraso>30\", \"Desvio (%)>5\", \"Início das férias>=01/10/2026; Início das férias<=31/10/2026\"), diferente (\"Situação!=Resolvido\"), entre duas colunas (\"Saldo<Estoque mínimo\") ou só um texto; condições separadas por \";\" valem juntas. Para \"qual vence primeiro\", \"o maior\", \"os 3 mais caros\" use sort: \"Coluna\" (crescente) ou \"-Coluna\" (decrescente), com ou sem filter. Devolve o cabeçalho, as linhas que batem, a soma das colunas numéricas e o total: use esse resultado em vez de comparar, ordenar ou somar de cabeça.",
    parameters: { type: "object", properties: { path: { type: "string" }, offset: { type: "integer" }, limit: { type: "integer" }, filter: { type: "string", description: "opcional: \"Coluna=texto\", \"Coluna>30\", \"Coluna>=01/10/2026\" (várias com ;) ou texto que a linha precisa conter" }, sort: { type: "string", description: "opcional: \"Coluna\" para ordem crescente, \"-Coluna\" para decrescente" } }, required: ["path"] },
    stage: (a) => `Lendo ${a.path}…`,
    async describe(a, ctx) {
      const path = await resolveExisting(a.path, ctx).catch(() => full(a.path, ctx));
      // A paid chat only sees a restricted company document with consent.
      if (ctx.provider && ctx.provider !== "local" && (await ctx.isRestricted?.(path))) return { kind: "share", summary: `Ler ${path} (documento interno não liberado para IA paga)` };
      return { kind: "read", paths: [path] };
    },
    async run({ path, offset = 1, limit = 400, filter, sort }, ctx) {
      const file = await resolveExisting(path, ctx);
      const office = EXTRACTED.has(extname(file).toLowerCase());
      if (!office && (await stat(file)).size > 5_000_000) throw new Error("Arquivo grande demais (mais de 5 MB).");
      const lines = (office ? await extractText(file) : await readFile(file, "utf8")).split(/\r?\n/);
      ctx.onFileRead?.(file);
      (ctx.readFiles ??= new Set()).add(file.toLowerCase());
      if (String(filter || "").trim() || String(sort || "").trim()) {
        // Corrected once per filter: a model that asks the same again after the note gets it as written
        // (fighting it, the tool made an agent give up on "=15/10/2026").
        const key = `${file}|${String(filter || "").trim()}`;
        ctx.correctedFilters ??= new Set();
        const request = ctx.correctedFilters.has(key) ? null : ctx.request;
        const table = /\.(csv|tsv)$/i.test(file) ? csvTable(lines.join("\n"), basename(file)) : lines;
        const today = process.env.HARNESS_NOW ? new Date(process.env.HARNESS_NOW) : new Date();
        const rows = filterRows(table, String(filter || ""), { sort, request }) + (filter ? nowNote(table, ctx.request, filter, today) : "");
        const corrected = request && rows.includes("\n(Usei ");
        if (corrected) ctx.correctedFilters.add(key);
        let found = `${file}\n${rows}`;
        // Asked again as written after the correction ("=15/10/2026" for "até 15/10"), the rows the
        // request means stay the ones the document is checked against: an agent copied the 2 rows of
        // the literal re-read instead of the 7 (agent battery, 2 runs in 5, 06/10).
        ctx.correctedRows ??= new Map();
        const intended = !request && ctx.correctedRows.get(key);
        if (corrected) ctx.correctedRows.set(key, rowKeys(found));
        if (intended?.length) found += `\n(Este é o filtro como você escreveu. O pedido fala de um período: a lista certa são as ${intended.length} linha(s) da leitura anterior (${intended.slice(0, 12).join(", ")}${intended.length > 12 ? "…" : ""}). Use aquelas.)`;
        ctx.lastRows = intended?.length ? intended : rowKeys(found);
        // When the request decided the condition (a corrected filter), the rows outside it are known too.
        ctx.excludedRows = corrected || intended?.length ? rowKeys(filterRows(table, "")).filter((k) => !ctx.lastRows.includes(k)) : [];
        ctx.anchorRows = ctx.lastRows;
        return found.length > READ_CHUNK ? `${found.slice(0, READ_CHUNK)}\n… (resultado grande: use um filtro mais específico ou combine condições com ";")` : found;
      }
      const start = Math.max(1, Number(offset) || 1);
      const count = Math.min(Math.max(1, Number(limit) || 400), 2000);
      const sheet = /\.(xlsx|csv|tsv)$/i.test(file);
      let text = "";
      for (let i = start - 1; i < Math.min(lines.length, start - 1 + count); i += 1) {
        const line = `${String(i + 1).padStart(5)}  ${lines[i]}\n`;
        if (text.length + line.length > READ_CHUNK) {
          const columns = sheet ? lines.find((l) => l.includes(" | ")) : null;
          text += `… (cortado; continue com offset=${i + 1}${columns ? `, ou use filter para trazer só as linhas que interessam, ex.: filter="${columns.split(" | ")[0]}=texto" ou "Coluna>número". Colunas: ${columns.slice(0, 400)}` : ""})\n`;
          break;
        }
        text += line;
      }
      const shown = start - 1 + count < lines.length ? `\n(linhas ${start}–${Math.min(lines.length, start - 1 + count)} de ${lines.length})` : "";
      // Read whole, a sheet was filtered "by eye" and 10-day-late bills went into a >30 list.
      // The ready filter for the request's date or number. A cut read needs it most: the Financeiro
      // agent re-read the same cut sheet until the repetition guard stopped it (05/10/2026).
      let ready = "", tip = "";
      if (sheet && text) {
        const table = /\.(csv|tsv)$/i.test(file) ? csvTable(lines.join("\n")) : lines;
        const now = process.env.HARNESS_NOW ? new Date(process.env.HARNESS_NOW) : new Date();
        ready = (nextDueHint(table, ctx.request, now) || dateFilterHint(table, ctx.request, now) || numberFilterHint(table, ctx.request) || limitHint(table, ctx.request) || extremeHint(table, ctx.request)) + groupHint(table, ctx.request);
        // Rows the tool already filtered for the request are what the document is checked against.
        // The ready filter covers ONE condition of the request ("até 15/10" of "a pagar e até 15/10"):
        // its rows are not all owed (demanding them pushed paid bills into the list, 06/10), but the
        // rows it leaves out must not go in.
        if (ready.includes("Já apliquei filter=")) {
          ctx.lastRows = [];
          ctx.anchorRows = rowKeys(ready);
          ctx.excludedRows = rowKeys(filterRows(table, "")).filter((k) => !ctx.anchorRows.includes(k));
        } else { ctx.excludedRows = []; ctx.anchorRows = []; }
        tip = ready ? "" : text.includes("… (cortado") ? "" : `\n(Para listar só as linhas que atendem a uma condição, leia de novo com filter, ex.: "Coluna>30" ou "Coluna=texto": a ferramenta faz a comparação.)`;
        // "Quantos títulos tinha a planilha?": the line numbers (3 to 18) were counted as 15 instead
        // of 16, 3 runs in 3 (06/10). The count, ready.
        const counts = parseSheets(table).filter((s) => s.header && s.rows.length).map((s) => {
          const data = s.rows.filter((r) => r.line.includes(" | ") && !/^\s*(\d+ {2})?total\b/i.test(r.line));
          return `${s.name.replace(/^##\s*/, "") || "Tabela"}: ${data.length} linha(s) de dados`;
        });
        if (counts.length) tip = `\n(${counts.join("; ")}, sem contar o cabeçalho nem a linha de total.)${tip}`;
      }
      // The ready filter goes first: a read near the 4.2k chunk plus the tip passed the executor's
      // 4.5k limit and the tip at the end was cut away; the model re-read the same sheet (05/10/2026).
      return `${file}${ready}\n${text || "(vazio)"}${shown}${tip}`;
    },
  },
  {
    name: "write_file",
    description: "Cria ou substitui um arquivo de TEXTO (código, .txt, .md, .csv, .json…) com o conteúdo informado. Cria as pastas que faltarem. Word, Excel, PDF e PowerPoint: use write_document.",
    parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
    stage: (a) => `Salvando ${a.path}…`,
    describe: (a, ctx) => ({ kind: "write", paths: [landing(full(a.path, ctx), ctx)], summary: `Salvar ${landing(full(a.path, ctx), ctx)}` }),
    async run({ path, content }, ctx) {
      const file = landing(full(path, ctx), ctx);
      // Text written into a .xlsx is a file Excel refuses (an agent delivered one, 05/10/2026).
      if (/\.(xlsx|docx|pdf|pptx)$/i.test(file)) throw new Error(`write_file grava texto e ${extname(file)} é binário: use write_document com o mesmo caminho e o conteúdo em markdown (tabelas | a | b |).`);
      // A "planilha" typed as CSV text: title lines over the header and "R$ 69.062,05" split by its
      // comma, and Excel in Portuguese opens a comma CSV in one column (agent run, 06/10).
      if (/\.csv$/i.test(file) && requestedFormat(ctx.request) === "xlsx") throw new Error(`Foi pedida uma planilha: grave com write_document em .xlsx (${basename(file).replace(/\.csv$/i, ".xlsx")}), com a tabela em markdown | a | b |. Um .csv digitado abre torto no Excel em português.`);
      await mkdir(dirname(file), { recursive: true });
      // Replacing a file the person had loses what was there: a copy goes to Desfazer.
      await changeFile(file, String(content ?? ""), ctx);
      return `Salvei ${file} (${Buffer.byteLength(String(content ?? ""))} bytes).`;
    },
  },
  {
    name: "write_document",
    description: "Cria um documento NOVO (Word .docx, Excel .xlsx, PDF, .md ou .csv) a partir de texto em markdown simples: # títulos, - listas e tabelas | a | b |. Use para \"crie um documento/relatório/planilha/proposta\". Para corrigir um documento que você mesma criou, chame de novo com o mesmo caminho: ele é atualizado. Nunca sobrescreve um arquivo do usuário: se o nome já existe, salva com (2). Responda com o caminho que esta ferramenta devolver.",
    parameters: { type: "object", properties: { path: { type: "string", description: "Caminho com o nome do arquivo, ex.: Documentos/proposta_atualizada.docx" }, format: { type: "string", enum: DOCUMENT_FORMATS }, content: { type: "string", description: "Conteúdo completo em markdown simples" } }, required: ["path", "content"] },
    stage: (a) => `Criando ${a.path || a.file_path || a.filename || "o documento"}…`,
    describe: (a, ctx) => ({ kind: "write", paths: [documentPath(a, ctx)], summary: `Criar ${documentPath(a, ctx)}` }),
    async run(args, ctx) {
      let file = documentPath(args, ctx);
      const format = extname(file).slice(1).toLowerCase();
      // A list missing rows of the read it came from is not written the first time: written and
      // flagged, the agent saved the full list under another name and left the 2-row sheet beside
      // it (agent battery, 06/10). Asked again (a top 3 is a fair subset), it is written.
      const body = String(args.content ?? args.text ?? args.markdown ?? "");
      let gaps = missingRows(ctx.lastRows, body);
      // From a ready filter (one condition of the request), fewer than half of its rows is a list cut
      // short, not another condition at work: 1 of 7 orders "até 15/10" went out (06/10).
      const anchorGaps = missingRows(ctx.anchorRows, body);
      let reference = ctx.lastRows || [];
      if (!gaps.length && (ctx.anchorRows || []).length >= 3 && anchorGaps.length > ctx.anchorRows.length / 2) { gaps = anchorGaps; reference = ctx.anchorRows; }
      // Rows the condition left out, in a document built from that read (it has some of the right ones).
      const extras = [...(ctx.lastRows || []), ...(ctx.anchorRows || [])].some((k) => body.includes(k)) ? extraRows(ctx.excludedRows, body) : [];
      ctx.heldDocuments ??= new Set();
      // What was kept of a call cut at the output limit: written only whole, and never over a file
      // (a cut write replaced a correct 16-row sheet with a 2-row one, 06/10).
      if (args.__salvaged) {
        const short = [...new Set([...missingRows(ctx.lastRows, body), ...missingRows(ctx.anchorRows, body)])];
        if (short.length || existsSync(file)) throw new Error(`Sua chamada foi cortada no limite de saída e o que chegou ${short.length ? `não tem todas as linhas (faltam ${short.slice(0, 12).join(", ")})` : "substituiria um arquivo que já existe"}: nada foi gravado. Grave de novo só a tabela, sem introdução nem análise.`);
      }
      if ((gaps.length || extras.length) && !ctx.heldDocuments.has(file.toLowerCase())) {
        ctx.heldDocuments.add(file.toLowerCase());
        const problems = [
          ...(gaps.length ? [`o último filtro trouxe ${reference.length} linha(s) e o documento tem só ${reference.length - gaps.length}. Faltam: ${gaps.slice(0, 20).join(", ")}${gaps.length > 20 ? "…" : ""}`] : []),
          ...(extras.length ? [`o documento tem linha(s) que não atendem à condição do pedido: ${extras.slice(0, 20).join(", ")}${extras.length > 20 ? "…" : ""}. Tire essas`] : []),
        ];
        throw new Error(`Não gravei ainda: ${problems.join("; ")}. Chame write_document de novo com o mesmo caminho e só as linhas certas (as do filtro); se o pedido é mesmo assim, repita igual que eu gravo.`);
      }
      // A file Aurora created is updated in place (a redo made "... (2).md" next to its own first try).
      for (let n = 2; existsSync(file) && !OWN_DOCUMENTS.has(file.toLowerCase()); n += 1) file = documentPath(args, ctx).replace(/(\.[^.\\/]+)$/, ` (${n})$1`);
      const bytes = await renderDocument(format, args.content ?? args.text ?? args.markdown ?? "");
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, bytes);
      OWN_DOCUMENTS.add(file.toLowerCase());
      const missing = missingRows(ctx.lastRows, args.content ?? args.text ?? args.markdown ?? "");
      const content = String(args.content ?? args.text ?? args.markdown ?? "");
      let note = missing.length ? `\nATENÇÃO: o último filtro trouxe ${ctx.lastRows.length} linha(s) e o documento tem só ${ctx.lastRows.length - missing.length}. Faltam: ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? "…" : ""}. Se o pedido é a lista inteira, grave de novo no mesmo caminho com todas as linhas.` : "";
      // A table built from the excerpt of a company sheet the context showed, never read whole:
      // an orchestrated Financeiro wrote its overdue list that way, 3 runs in 3 (05/10/2026).
      const unread = (ctx.excerptSheets || []).filter((p) => !ctx.readFiles?.has(p.toLowerCase()));
      if (!note && unread.length && unread.length === (ctx.excerptSheets || []).length && /\|[^\n]*\|/.test(content)) {
        note = `\nATENÇÃO: você montou a tabela só com um TRECHO de ${unread.map((p) => basename(p)).join(", ")} (o contexto mostra só parte das linhas). Leia a planilha com read_file e filter (ex.: a condição do pedido) e grave de novo no mesmo caminho com todas as linhas.`;
      }
      return `Criei ${file} (${format.toUpperCase()}, ${bytes.length} bytes).${note}`;
    },
  },
  {
    // Organizing a folder needs moving and renaming; through run_command a small model wrote
    // shell one-liners that were hard to check. Never overwrites, never deletes.
    name: "move_file",
    description: "Move ou renomeia um arquivo ou pasta (ex.: organizar Downloads em subpastas por tipo). Para levar vários arquivos à mesma pasta numa chamada, use files (lista) e to com a pasta. Cria a pasta de destino se faltar. Nunca sobrescreve: se o destino já existe, salva com (2). Não apaga nada.",
    parameters: { type: "object", properties: { from: { type: "string", description: "Caminho atual (um arquivo)" }, files: { type: "array", items: { type: "string" }, description: "Vários arquivos que vão para a mesma pasta (to)" }, to: { type: "string", description: "Novo caminho completo, com o nome, ou uma pasta terminada em \\ ou /" } }, required: ["to"] },
    stage: (a) => `Movendo ${moveSources(a).length > 1 ? `${moveSources(a).length} arquivos` : moveSources(a)[0] || ""}…`,
    describe: (a, ctx) => {
      const pairs = moveSources(a).map((from) => [full(from, ctx), moveTarget({ from, to: moveFolder(a) }, ctx)]);
      return { kind: "write", paths: pairs.flat(), summary: pairs.map(([f, t]) => `Mover ${f} para ${t}`).join("; ") };
    },
    async run(args, ctx) {
      const sources = moveSources(args);
      if (!sources.length) throw new Error("Diga o arquivo (from) ou a lista de arquivos (files).");
      if (sources.length === 1) return moveOne(sources[0], moveFolder(args), ctx);
      // Several files, one folder: a small model organizing Downloads listed the folder five times
      // and moved one file per call. Each file goes or says why not; one failure stops nothing.
      const lines = [];
      for (const from of sources) lines.push(await moveOne(from, moveFolder(args), ctx).catch((error) => `ERRO em ${from}: ${error.message}`));
      const failed = lines.filter((l) => l.startsWith("ERRO")).length;
      return `${lines.join("\n")}\n${sources.length - failed} de ${sources.length} arquivo(s) movido(s).`;
    },
  },
  {
    // "Organize my Downloads" is the most common personal task; a real Downloads folder has hundreds
    // of files, and moving them one call at a time is where a small model gets lost.
    name: "organize_folder",
    description: "Organiza os arquivos soltos de uma pasta em subpastas por tipo, de uma vez. Sem groups: Documentos, Planilhas, Apresentações, Imagens, Vídeos, Áudio, Compactados, Instaladores, Código, Outros. Se a pessoa disser as subpastas e os tipos de cada uma, passe-os em groups (ex.: \"Documentos: pdf, docx, txt; Imagens: jpg, png\"). Só mexe nos arquivos soltos (não nas subpastas), nunca sobrescreve nem apaga, e tudo pode ser desfeito.",
    parameters: { type: "object", properties: { path: { type: "string", description: "A pasta a organizar (ex.: Downloads)" }, groups: { type: "string", description: "Opcional: as subpastas da pessoa, \"Pasta: ext, ext; Outra: ext\"" } }, required: ["path"] },
    stage: (a) => `Organizando ${a.path}…`,
    describe: (a, ctx) => ({ kind: "write", paths: [full(a.path, ctx)], summary: `Organizar os arquivos soltos de ${full(a.path, ctx)} em subpastas por tipo` }),
    async run({ path, groups }, ctx) {
      // Only when it was asked: "tem algum arquivo repetido aqui?" reorganized the whole folder
      // (battery, 06/10). Moving many files is the person's call.
      if (ctx.request && !ORGANIZE_ASKED.test(fold(ctx.request))) throw new Error("A pessoa não pediu para organizar a pasta: não mova nada. Responda o que ela perguntou (para ver a pasta, use list_dir) e, se achar útil, ofereça organizar.");
      const dir = await resolveExisting(path, ctx, { directory: true });
      const entries = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile() && !e.name.startsWith(".") && !/^desktop\.ini$|^thumbs\.db$/i.test(e.name) && !/\.(crdownload|part|tmp)$/i.test(e.name));
      if (!entries.length) return `Não há arquivos soltos em ${dir}: nada a organizar.`;
      // The person's own folders ("Documentos (pdf, docx, txt), Imagens (jpg, png)…"): with them the
      // model went back to moving file by file with commands and misplaced one (05/10/2026).
      const own = parseGroups(groups);
      const counts = {}, errors = [], left = [];
      for (const entry of entries) {
        const kind = own.length ? own.find(([, exts]) => exts.has(extname(entry.name).slice(1).toLowerCase()))?.[0] : fileKind(entry.name);
        if (!kind) { left.push(entry.name); continue; }
        try { await moveOne(join(dir, entry.name), join(dir, kind) + sep, ctx); counts[kind] = (counts[kind] || 0) + 1; }
        catch (error) { errors.push(`${entry.name}: ${error.message}`); }
      }
      const moved = Object.values(counts).reduce((a, b) => a + b, 0);
      return `Organizei ${dir}: ${moved} arquivo(s) movido(s) — ${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(", ")}.${left.length ? `\nFicaram soltos (nenhuma das pastas pedidas é para eles): ${left.slice(0, 20).join(", ")}.` : ""}${errors.length ? `\nNão movidos (${errors.length}): ${errors.slice(0, 10).join("; ")}` : ""}\nNada foi apagado; a pessoa pode desfazer.`;
    },
  },
  {
    name: "edit_file",
    description: "Edita um arquivo trocando um trecho exato (before) por outro (after). Leia o arquivo antes e copie o trecho literalmente.",
    parameters: { type: "object", properties: { path: { type: "string" }, before: { type: "string" }, after: { type: "string" } }, required: ["path", "before", "after"] },
    stage: (a) => `Editando ${a.path}…`,
    describe: (a, ctx) => ({ kind: "write", paths: [full(a.path, ctx)], summary: `Editar ${full(a.path, ctx)}` }),
    async run({ path, before, after }, ctx) {
      return editFile({ path, before, after }, ctx);
    },
  },
];

const KINDS = [
  ["Documentos", /\.(pdf|docx?|odt|rtf|txt|md|epub)$/i],
  ["Planilhas", /\.(xlsx?|xlsm|ods|csv|tsv)$/i],
  ["Apresentações", /\.(pptx?|odp|key)$/i],
  ["Imagens", /\.(jpe?g|png|gif|webp|bmp|svg|heic|tiff?|ico|psd)$/i],
  ["Vídeos", /\.(mp4|mkv|mov|avi|wmv|webm|m4v)$/i],
  ["Áudio", /\.(mp3|wav|flac|m4a|ogg|aac|opus)$/i],
  ["Compactados", /\.(zip|rar|7z|tar|gz|bz2|xz)$/i],
  ["Instaladores", /\.(exe|msi|msix|appx|dmg|pkg|deb|rpm|apk|iso)$/i],
  ["Código", /\.(js|mjs|ts|tsx|py|java|c|cpp|cs|go|rs|rb|php|html?|css|json|xml|ya?ml|sh|ps1|bat|sql)$/i],
];
/**
 * "Documentos: pdf, docx; Imagens (jpg, png)" or { Documentos: ["pdf"] } → [["Documentos", Set{pdf, docx}], …].
 * Extensions without the dot, lower case.
 */
const ORGANIZE_ASKED = /\b(organiz|arrum|separ|ajeit|agrup|limp|bagun|class(e|i)fi|ponha em pastas|por tipo|em subpastas|deixe em ordem)/;

export function parseGroups(groups) {
  if (!groups) return [];
  const entries = typeof groups === "object" ? Object.entries(groups)
    : String(groups).split(/\s*(?:;|\n)\s*/).map((part) => part.match(/^\s*([^:(]+?)\s*[:(]\s*([^)]*)\)?\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]);
  return entries.map(([name, exts]) => [String(name).trim(), new Set((Array.isArray(exts) ? exts : String(exts).split(/[\s,]+/)).map((e) => String(e).replace(/^\./, "").toLowerCase()).filter(Boolean))])
    .filter(([name, exts]) => name && exts.size);
}

/** The subfolder a file goes to when a folder is organized by type. */
export const fileKind = (name) => KINDS.find(([, re]) => re.test(name))?.[0] || "Outros";

/** The files a move_file call names: files (a list) and/or from. */
function moveSources(args) {
  const list = Array.isArray(args.files) ? args.files : typeof args.files === "string" ? args.files.split(/\s*[,;\n]\s*/) : [];
  return [...new Set([...list, ...(args.from ? [args.from] : [])].map((f) => String(f).trim()).filter(Boolean))];
}
/** Several files go to a folder even when "to" has no trailing slash. */
function moveFolder(args) {
  return moveSources(args).length > 1 && !/[\\/]$/.test(String(args.to)) ? `${args.to}/` : args.to;
}

async function moveOne(fromArg, to, ctx) {
  // The exact path only: read_file's tolerant lookup found a same-named file in a subfolder
  // and moved that one instead.
  const from = full(fromArg, ctx);
  if (!existsSync(from)) {
    // "notacoes.txt" for "anotacoes.txt": name the closest file and show what is there.
    let names = [];
    try { names = (await readdir(dirname(from))).slice(0, 40); } catch { /* folder missing */ }
    const wanted = foldText(basename(from));
    const close = names.find((n) => foldText(n).includes(wanted) || wanted.includes(foldText(n))) || names.find((n) => foldText(n).slice(-8) === wanted.slice(-8));
    throw new Error(`${from} não existe.${close ? ` Você quis dizer "${close}"?` : ""}${names.length ? ` Nessa pasta: ${names.join(", ")}.` : ""}`);
  }
  let target = moveTarget({ from, to }, ctx);
  if (resolve(from) === resolve(target)) return `${from} já está nesse lugar.`;
  for (let n = 2; existsSync(target); n += 1) target = moveTarget({ from, to }, ctx).replace(/(\.[^.\\/]+)?$/, (ext) => ` (${n})${ext}`);
  await mkdir(dirname(target), { recursive: true });
  await rename(from, target);
  ctx.onMove?.(from, target);
  return `Movi ${from} para ${target}.`;
}

/** Writes over an existing file keeping a copy of before, so "Desfazer" can put it back. */
async function changeFile(file, content, ctx) {
  const backup = await backupBeforeChange(file);
  await writeFile(file, content, "utf8");
  if (backup) ctx.onEdit?.({ file, backup, after: sha(Buffer.from(content, "utf8")) });
}

async function editFile({ path, before, after }, ctx) {
  const file = full(path, ctx);
  const text = await readFile(file, "utf8");
  const count = text.split(String(before)).length - 1;
  if (count > 1) throw new Error(`O trecho 'before' aparece ${count} vezes; inclua mais contexto para ser único.`);
  if (before && count === 1) {
    await changeFile(file, text.replace(String(before), () => String(after ?? "")), ctx);
    return `Editei ${file}.`;
  }
  // The model copies code with its own indentation (4 spaces for a 2-space file) and never
  // matched: the same lines, ignoring leading spaces, found once, are replaced re-indented.
  const loose = before ? looseReplace(text, String(before), String(after ?? "")) : null;
  if (loose) {
    await changeFile(file, loose, ctx);
    return `Editei ${file} (o trecho batia ignorando a indentação; mantive a do arquivo).`;
  }
  throw new Error("O trecho 'before' não existe no arquivo. Leia o arquivo e copie o trecho exato (sem os números de linha).");
}
