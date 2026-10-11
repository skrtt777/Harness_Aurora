// The Aurora's Power BI designer: from the person's spreadsheets (.xlsx, .csv) to a complete BI — a star
// semantic model (types, a Portuguese calendar, relationships, DAX measures with R$ formats) and a report
// with an overview, a detail page and a trend page. Deterministic on purpose: a small local model only
// says which files and what to call it; the quality of the model and of the pages comes from here.
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { xlsxText } from "./docText.js";
import { flowDesign, readFlow } from "./powerbiStory.js";

// ---- Reading -------------------------------------------------------------------------------------

/** "a;b;\"c;d\"" -> cells, with the delimiter found in the header line. */
function csvRows(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const head = lines[0] || "";
  const delimiter = [";", "\t", ",", "|"].map((d) => [d, head.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const parse = (line) => {
    const out = []; let cell = ""; let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quoted) { if (ch === "\"" && line[i + 1] === "\"") { cell += "\""; i += 1; } else if (ch === "\"") quoted = false; else cell += ch; }
      else if (ch === "\"") quoted = true;
      else if (ch === delimiter) { out.push(cell.trim()); cell = ""; }
      else cell += ch;
    }
    out.push(cell.trim());
    return out;
  };
  return { delimiter, rows: lines.map(parse) };
}

/** The tables of one file: [{ name, sheet?, header, rows, source }]. */
export function readSources(path) {
  const ext = extname(path).toLowerCase();
  const buffer = readFileSync(path);
  if (ext === ".csv" || ext === ".txt" || ext === ".tsv") {
    let text = buffer.toString("utf8");
    const utf8 = !text.includes("�");
    if (!utf8) text = buffer.toString("latin1");
    const { delimiter, rows } = csvRows(text);
    return [{ name: tableName(basename(path, ext)), header: rows[0], rows: rows.slice(1), source: { kind: "csv", path, delimiter, encoding: utf8 ? 65001 : 1252 } }];
  }
  if (ext === ".xlsx" || ext === ".xlsm") {
    const tables = [];
    let current = null;
    for (const line of xlsxText(buffer).split("\n")) {
      const sheet = /^## (.*)$/.exec(line);
      if (sheet) { current = { sheet: sheet[1], lines: [] }; tables.push(current); continue; }
      if (current) current.lines.push(line.split(" | "));
    }
    return tables.filter((t) => t.lines.length >= 2).map((t) => ({ name: tableName(t.sheet), sheet: t.sheet, header: t.lines[0], rows: t.lines.slice(1), source: { kind: "excel", path, sheet: t.sheet } }));
  }
  throw new Error(`O Power BI da Aurora lê planilhas .xlsx e arquivos .csv; "${basename(path)}" não é um deles.`);
}

const tableName = (text) => String(text).replace(/[_-]+/g, " ").replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim().replace(/^./, (c) => c.toUpperCase()) || "Dados";

// ---- Profiling ------------------------------------------------------------------------------------

const DATE_BR = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const DATE_ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/;
const MONEY_NAME = /valor|pre[çc]o|receita|faturamento|custo|lucro|total|venda|desconto|frete|sal[áa]rio|comiss|ticket|montante|pago|saldo|despesa|gasto|or[çc]amento|imposto|tarifa|mensalidade|r\$/i;
const UNIT_NAME = /unit[áa]rio|unit\b|p\.?\s?unit|pre[çc]o (de )?venda|pre[çc]o m[ée]dio|valor unit/i;
const QTY_NAME = /qtd|quant|unidades|itens|volume|peso|kg|litros|horas|dias/i;
const ID_NAME = /^(id|c[óo]d(igo)?|n[ºo°]|n[uú]mero|pedido|nf|nota|matr[íi]cula|cpf|cnpj|protocolo|ticket id|chamado)\b|(^|\s)id$|c[óo]digo/i;
const DIM_RANK = /produto|categoria|regi[ãa]o|cliente|vendedor|loja|canal|cidade|estado|uf|segmento|departamento|setor|status|tipo|marca|fornecedor|filial|equipe|forma de pagamento|origem|plano/i;
const COST_NAME = /custo|despesa|gasto/i;
const REVENUE_NAME = /receita|faturamento|venda|valor total|^valor$|^total$/i;

/** A number written in Brazilian or plain form ("1.234,56", "1234.56", "R$ 10", "15%"), or NaN. */
export function parseNumber(raw, decimalComma) {
  let s = String(raw ?? "").trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (!s || !/^-?[\d.,]+%?$/.test(s)) return NaN;
  const percent = s.endsWith("%");
  s = s.replace(/%$/, "");
  if (decimalComma) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return percent ? n / 100 : n;
}

/** Column types and roles of one table. */
export function profile(table) {
  const { header, rows, source } = table;
  // Brazilian CSVs write "1.234,56"; a spreadsheet's numbers come plain ("1234.56") from the reader.
  const sample = rows.slice(0, 400);
  const decimalComma = source.kind === "csv" && sample.some((r) => r.some((v) => /^-?(R\$\s*)?\d{1,3}(\.\d{3})*,\d+$|^-?\d+,\d+$/.test(String(v).trim())));
  const columns = header.map((rawName, i) => {
    const name = String(rawName || `Coluna ${i + 1}`).trim() || `Coluna ${i + 1}`;
    const values = rows.map((r) => String(r[i] ?? "").trim()).filter(Boolean);
    const distinct = new Set(values).size;
    let type = "texto";
    if (values.length && values.every((v) => DATE_BR.test(v) || DATE_ISO.test(v))) type = "data";
    else if (values.length && values.every((v) => Number.isFinite(parseNumber(v, decimalComma)))) type = values.every((v) => Number.isInteger(parseNumber(v, decimalComma)) && !/[,.]\d/.test(v)) ? "inteiro" : "numero";
    else if (values.length && values.every((v) => /^(sim|n[ãa]o|true|false|verdadeiro|falso)$/i.test(v))) type = "sim/não";
    const percent = type === "numero" && values.some((v) => v.endsWith("%"));
    let role = "attribute";
    if (type === "data") role = "date";
    else if ((type === "inteiro" || type === "texto") && ID_NAME.test(name) && distinct > rows.length * 0.5) role = "id";
    else if (type === "numero" || type === "inteiro") {
      if (percent) role = "percent";
      else if (UNIT_NAME.test(name)) role = "unitPrice";
      else if (MONEY_NAME.test(name)) role = "money";
      else if (QTY_NAME.test(name) || type === "inteiro") role = "quantity";
      else role = "value";
    } else if (type === "texto") role = distinct <= Math.max(60, rows.length * 0.6) ? "dimension" : "attribute";
    return { name, type, role, distinct, sample: values.slice(0, 3) };
  });
  return { ...table, decimalComma, columns };
}

// ---- Model ----------------------------------------------------------------------------------------

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const col = (table, column) => `${q(table)}[${String(column).replace(/]/g, "]]")}]`;
const mString = (s) => `"${String(s).replace(/"/g, "\"\"")}"`;
const M_TYPE = { data: "type date", inteiro: "Int64.Type", numero: "type number", "sim/não": "type logical", texto: "type text" };
const MONEY = "\"R$\" #,0.00";
const MONEY_ROUND = "\"R$\" #,0";
const INT = "#,0";
const DEC = "#,0.00";
const PCT = "0.0%";

function mExpression(t) {
  const types = t.columns.map((c) => `{${mString(c.name)}, ${M_TYPE[c.type]}}`).join(", ");
  if (t.source.kind === "csv") {
    return [
      "let",
      `    Fonte = Csv.Document(File.Contents(${mString(t.source.path)}), [Delimiter=${mString(t.source.delimiter)}, Columns=${t.header.length}, Encoding=${t.source.encoding}, QuoteStyle=QuoteStyle.Csv]),`,
      "    Cabecalhos = Table.PromoteHeaders(Fonte, [PromoteAllScalars=true]),",
      `    Tipos = Table.TransformColumnTypes(Cabecalhos, {${types}}, ${mString(t.decimalComma ? "pt-BR" : "en-US")})`,
      "in",
      "    Tipos",
    ].join("\n");
  }
  return [
    "let",
    `    Fonte = Excel.Workbook(File.Contents(${mString(t.source.path)}), null, true),`,
    `    Planilha = Fonte{[Item=${mString(t.source.sheet)},Kind="Sheet"]}[Data],`,
    "    Cabecalhos = Table.PromoteHeaders(Planilha, [PromoteAllScalars=true]),",
    // pt-BR: a date typed as text in the sheet ("15/03/2025") is read as day/month.
    `    Tipos = Table.TransformColumnTypes(Cabecalhos, {${types}}, "pt-BR")`,
    "in",
    "    Tipos",
  ].join("\n");
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
function calendarDax(fact, dateColumn) {
  const ref = col(fact, dateColumn);
  return [
    // Power BI computes this table on opening, before the data is loaded: with the fact still empty the
    // dates were blank and CALENDAR failed with a dialog. Today stands in until the data arrives.
    `VAR Inicio = DATE(YEAR(COALESCE(MIN(${ref}), TODAY())), 1, 1)`,
    // Up to the last month with data (to December, the trend charts showed empty future months).
    `VAR Fim = EOMONTH(COALESCE(MAX(${ref}), TODAY()), 0)`,
    "RETURN",
    "ADDCOLUMNS(",
    "    CALENDAR(Inicio, Fim),",
    "    \"Ano\", YEAR([Date]),",
    "    \"Trimestre\", \"T\" & QUARTER([Date]),",
    "    \"Mês nº\", MONTH([Date]),",
    `    "Mês", SWITCH(MONTH([Date]), ${MONTHS.map((m, i) => `${i + 1}, "${m}"`).join(", ")}),`,
    "    \"Ano-mês nº\", YEAR([Date]) * 100 + MONTH([Date]),",
    `    "Mês/ano", SWITCH(MONTH([Date]), ${MONTHS.map((m, i) => `${i + 1}, "${m}"`).join(", ")}) & "/" & YEAR([Date]),`,
    "    \"Dia da semana nº\", WEEKDAY([Date], 2),",
    `    "Dia da semana", SWITCH(WEEKDAY([Date], 2), ${WEEKDAYS.map((d, i) => `${i + 1}, "${d}"`).join(", ")})`,
    ")",
  ].join("\n");
}
const CALENDAR_COLUMNS = [
  { name: "Data", source: "Date", type: "data", format: "dd/mm/yyyy", key: "True" },
  { name: "Ano", type: "inteiro", format: "0" },
  { name: "Trimestre", type: "texto" },
  { name: "Mês nº", type: "inteiro", hidden: "True" },
  { name: "Mês", type: "texto", sortBy: "Mês nº" },
  { name: "Ano-mês nº", type: "inteiro", hidden: "True" },
  { name: "Mês/ano", type: "texto", sortBy: "Ano-mês nº" },
  { name: "Dia da semana nº", type: "inteiro", hidden: "True" },
  { name: "Dia da semana", type: "texto", sortBy: "Dia da semana nº" },
];

const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
/** pedido -> pedidos, venda -> vendas, nota fiscal -> notas fiscais, chamado -> chamados. */
export function plural(word) {
  if (!word) return "";
  return word.split(" ").map((w, i) => (i > 0 && !/^(fiscal|fiscais)$/.test(w) ? w : /[sz]$/.test(w) ? w : /al$/.test(w) ? w.replace(/al$/, "ais") : /[aeiouáéó]$/.test(w) ? `${w}s` : /m$/.test(w) ? w.replace(/m$/, "ns") : `${w}es`)).join(" ");
}

// What each page is about, in the words a request uses.
const PAGE_WORDS = [
  [/^(Operação|Acompanhamento)$/, /opera[çc]|p[áa]tio|doca|rastre|acompanh|agora|tempo real|caminh|fila|status|etapa/i],
  [/^(Entregas|Visão geral)$/, /entrega|vis[ãa]o geral|resumo|indicador|kpi|prazo|faturamento|vendas/i],
  [/^Detalhamento$/, /detalh|tabela|lista|por (cliente|produto|item)/i],
  [/^Tendência$/, /tend[êe]ncia|evolu|m[êe]s a m[êe]s|hist[óo]ric|sazonal|ano a ano/i],
];
const wordsOf = (page) => PAGE_WORDS.find(([name]) => name.test(page.displayName))?.[1] || null;

/**
 * The pages the request asks for: "sem a tendência" drops it; "só a operação" / "uma página" keeps what
 * it names; what it names comes first. Without a goal, all of them in the designed order.
 */
export function pagesFor(pages, goal = "") {
  const g = String(goal || "");
  if (!g.trim()) return pages;
  const without = [...g.matchAll(/\bsem (?:a |o |as |os )?([\p{L} ]{3,30})/giu)].map((x) => x[1]);
  let kept = pages.filter((p) => !without.some((w) => wordsOf(p)?.test(w)));
  const named = kept.filter((p) => wordsOf(p)?.test(g.replace(/\bsem (?:a |o |as |os )?[\p{L} ]{3,30}/giu, "")));
  // (In JS "\b" does not see "só" as a word: letters by Unicode.)
  if (/(?<!\p{L})(s[óo]|apenas|somente)(?!\p{L})|uma (s[óo] )?(p[áa]gina|tela)/iu.test(g) && named.length) kept = named;
  else kept = [...named, ...kept.filter((p) => !named.includes(p))];
  return kept.length ? kept : pages;
}

/**
 * The complete design. tables: profiled tables. Returns { model, measures (name -> table), report
 * pages, summary } for app/powerbi.js.
 */
export function design(tables, { title, goal = "" } = {}) {
  if (!tables.length) throw new Error("Nenhuma tabela com dados (cabeçalho e pelo menos uma linha) nos arquivos.");
  // Unique table names.
  const seen = new Map();
  for (const t of tables) { const n = seen.get(t.name) || 0; seen.set(t.name, n + 1); if (n) t.name = `${t.name} ${n + 1}`; }
  // The fact: the table with values and most rows.
  const score = (t) => t.rows.length * (t.columns.some((c) => ["money", "quantity", "value"].includes(c.role)) ? 10 : 1);
  const fact = [...tables].sort((a, b) => score(b) - score(a))[0];
  // Dimension tables: another table whose column (same name as one in the fact) is unique there.
  const relationships = [];
  for (const t of tables) {
    if (t === fact) continue;
    for (const c of t.columns) {
      const inFact = fact.columns.find((f) => f.name.toLowerCase() === c.name.toLowerCase() && f.type === c.type);
      if (inFact && c.distinct === t.rows.length && t.rows.length > 0) { relationships.push({ from: col(fact.name, inFact.name), to: col(t.name, c.name), dim: t, key: c.name }); break; }
    }
  }
  const factCol = (role) => fact.columns.filter((c) => c.role === role);
  const date = factCol("date")[0];
  const money = factCol("money");
  const main = money.find((c) => REVENUE_NAME.test(c.name)) || money.find((c) => !COST_NAME.test(c.name)) || money[0];
  const cost = money.find((c) => COST_NAME.test(c.name) && c !== main);
  const qty = factCol("quantity")[0];
  const unit = factCol("unitPrice")[0];
  const id = factCol("id")[0];

  // ---- Measures, in the fact table, grouped in display folders.
  const measures = [];
  // extra: { table } for a measure of another table (the stock), { category: "ImageUrl" } for a picture.
  const add = (name, expression, format, folder, description, extra = {}) => { measures.push({ name, expression, format, folder, description, ...extra }); return name; };
  const m = (name) => `[${name}]`;
  // "Pedido" / "Nº do pedido" -> "Qtd. de pedidos"; no id column -> "Qtd. de registros".
  const things = id ? plural(lower(id.name).replace(/^(n[ºo°]|n[uú]mero|c[óo]digo|id)\s*(d[oa]s?\s+)?/i, "").trim()) || "registros" : "registros";
  const count = id
    ? add(`Qtd. de ${things}`, `DISTINCTCOUNT(${col(fact.name, id.name)})`, INT, "Principais", `Quantos ${things} diferentes`)
    : add("Qtd. de registros", `COUNTROWS(${q(fact.name)})`, INT, "Principais", "Quantas linhas");
  let mainMeasure = null;
  // A measure cannot share its name with a column of the same table ("Valor total"): sales money is
  // "Faturamento"; others get "total" unless their name already says it.
  const columnNames = new Set(fact.columns.map((c) => c.name.toLowerCase()));
  const sumName = (c) => { const n = /total$/i.test(c.name) ? `${c.name.replace(/\s*total$/i, "")} (soma)` : `${c.name} total`; return columnNames.has(n.toLowerCase()) ? `Soma de ${lower(c.name)}` : n; };
  if (main) mainMeasure = add(REVENUE_NAME.test(main.name) || /venda|receita|faturamento/i.test(fact.name) ? "Faturamento" : sumName(main), `SUM(${col(fact.name, main.name)})`, MONEY, "Principais", `Soma de ${main.name}`);
  for (const c of money) if (c !== main) add(sumName(c), `SUM(${col(fact.name, c.name)})`, MONEY, "Valores", `Soma de ${c.name}`);
  const qtyMeasure = qty ? add(sumName(qty), `SUM(${col(fact.name, qty.name)})`, qty.type === "inteiro" ? INT : DEC, "Principais", `Soma de ${qty.name}`) : null;
  for (const c of factCol("quantity").slice(1)) add(sumName(c), `SUM(${col(fact.name, c.name)})`, c.type === "inteiro" ? INT : DEC, "Valores");
  for (const c of factCol("value")) add(sumName(c), `SUM(${col(fact.name, c.name)})`, DEC, "Valores");
  for (const c of factCol("percent")) add(`${c.name} médio`, `AVERAGE(${col(fact.name, c.name)})`, PCT, "Valores");
  if (unit) add(`${unit.name.replace(/unit[áa]rio/i, "médio")}`.replace(/^(.*)$/, (s) => (s === unit.name ? `${unit.name} médio` : s)), `AVERAGE(${col(fact.name, unit.name)})`, MONEY, "Valores", `Média de ${unit.name}`);
  // No money column but price x quantity: the revenue is computed.
  if (!mainMeasure && unit && qty) mainMeasure = add("Faturamento", `SUMX(${q(fact.name)}, ${col(fact.name, unit.name)} * ${col(fact.name, qty.name)})`, MONEY, "Principais", `${unit.name} x ${qty.name}, linha a linha`);
  // A flow of work (orders through docks and trucks, tickets through stages): the BI is about it.
  const flow = readFlow(fact, tables);
  const headline = flow?.logistics ? count : mainMeasure || qtyMeasure || count;
  let ticket = null;
  // "Ticket médio" for sales; otherwise "Custo médio por chamado".
  const one = id ? lower(id.name).replace(/^(n[ºo°]|n[uú]mero|c[óo]digo|id)\s*(d[oa]s?\s+)?/i, "").trim() || "registro" : "registro";
  if (mainMeasure) ticket = add(mainMeasure === "Faturamento" ? "Ticket médio" : `${mainMeasure.replace(/\s*(total|\(soma\))$/i, "")} médio por ${one}`, `DIVIDE(${m(mainMeasure)}, ${m(count)})`, MONEY, "Principais", `${mainMeasure} por ${one}`);
  let margin = null;
  if (mainMeasure && cost) {
    const profit = add("Lucro", `${m(mainMeasure)} - ${m(`${cost.name} total`)}`, MONEY, "Principais");
    margin = add("Margem %", `DIVIDE(${m(profit)}, ${m(mainMeasure)})`, PCT, "Principais");
  }
  add("% do total", `DIVIDE(${m(headline)}, CALCULATE(${m(headline)}, ALLSELECTED()))`, PCT, "Comparações", `Participação de cada item em ${headline}`);
  // Time: needs the calendar.
  let momChange = null; let yoyChange = null; let ytd = null; let previousMonth = null; let previousYear = null;
  const years = date ? new Set(fact.rows.map((r) => (String(r[fact.columns.indexOf(date)] || "").match(/\d{4}/) || [""])[0]).filter(Boolean)) : new Set();
  if (date) {
    const cal = "'Calendário'[Data]";
    // Month comparisons only where one month is in view (in a total row they meant nothing).
    const oneMonth = "HASONEVALUE('Calendário'[Ano-mês nº])";
    previousMonth = add(`${headline} mês anterior`, `IF(${oneMonth}, CALCULATE(${m(headline)}, DATEADD(${cal}, -1, MONTH)))`, measures.find((x) => x.name === headline).format, "Tempo");
    momChange = add("Variação % mensal", `VAR Atual = ${m(headline)}\nVAR Anterior = ${m(previousMonth)}\nRETURN IF(${oneMonth} && NOT ISBLANK(Anterior), DIVIDE(Atual - Anterior, Anterior))`, PCT, "Tempo", "Comparado ao mês anterior");
    ytd = add(`${headline} no ano`, `TOTALYTD(${m(headline)}, ${cal})`, measures.find((x) => x.name === headline).format, "Tempo", "Acumulado de janeiro até a data");
    if (years.size > 1) {
      previousYear = add(`${headline} ano anterior`, `CALCULATE(${m(headline)}, SAMEPERIODLASTYEAR(${cal}))`, measures.find((x) => x.name === headline).format, "Tempo");
      yoyChange = add("Variação % anual", `VAR Atual = ${m(headline)}\nVAR Anterior = ${m(previousYear)}\nRETURN IF(HASONEVALUE('Calendário'[Ano]) && NOT ISBLANK(Anterior), DIVIDE(Atual - Anterior, Anterior))`, PCT, "Tempo", "Comparado ao mesmo período do ano anterior");
    }
  }

  // ---- Dimensions for the visuals: from the dimension tables first, then the fact's own.
  const dims = [];
  for (const r of relationships) for (const c of r.dim.columns) if (c.role === "dimension" && c.name !== r.key) dims.push({ ref: col(r.dim.name, c.name), name: c.name, distinct: c.distinct });
  for (const c of fact.columns) if (c.role === "dimension") dims.push({ ref: col(fact.name, c.name), name: c.name, distinct: c.distinct });
  const PRIORITY = ["produto", "categoria", "transportadora", "loja", "filial", "regi", "cliente", "vendedor", "canal", "segmento", "departamento", "setor", "status", "tipo", "cidade", "estado"];
  const rank = (d) => { const i = PRIORITY.findIndex((p) => d.name.toLowerCase().includes(p)); return (i < 0 ? 100 : i) * 1000 + Math.abs(d.distinct - 8); };
  dims.sort((a, b) => rank(a) - rank(b));
  const small = dims.filter((d) => d.distinct >= 2 && d.distinct <= 7);
  const barDim = dims.find((d) => d.distinct > 2) || dims[0];
  const donutDim = small.find((d) => d !== barDim) || dims.find((d) => d !== barDim);
  const thirdDim = dims.find((d) => d !== barDim && d !== donutDim);
  const reportTitle = title || `Painel de ${lower(fact.name)}`.replace(/^Painel de (.)/, (s, c) => `Painel de ${c}`);
  const months = date ? new Set(fact.rows.map((r) => String(r[fact.columns.indexOf(date)] || "").replace(/^\d{1,2}\//, "").slice(0, 7))).size : 0;

  const pages = [];
  const dark = Boolean(flow);
  const header = (subtitle) => ({ type: "textbox", x: 24, y: 8, w: 760, h: 76, paragraphs: [
    { textRuns: [{ value: reportTitle, textStyle: { fontWeight: "bold", fontSize: "20pt", color: dark ? "#FFFFFF" : "#1B2A4A" } }] },
    { textRuns: [{ value: subtitle, textStyle: { fontSize: "10pt", color: dark ? "#8FA3BF" : "#5B6B85" } }] },
  ] });
  const slicers = () => {
    const s = [];
    if (date) s.push({ type: "slicer", x: 800, y: 8, w: 150, h: 76, values: "'Calendário'[Ano]", dropdown: true });
    if (barDim) s.push({ type: "slicer", x: date ? 962 : 800, y: 8, w: 150, h: 76, values: barDim.ref, dropdown: true });
    if (donutDim) s.push({ type: "slicer", x: date ? 1124 : 962, y: 8, w: date ? 132 : 150, h: 76, values: donutDim.ref, dropdown: true });
    return s;
  };
  const sources = [...new Set(tables.map((t) => basename(t.source.path)))].join(", ");

  // Page 0, with a flow: the operation as it is now.
  let op = null;
  if (flow) {
    op = flowDesign(flow, { add, title: reportTitle, subtitle: `Agora · fonte: ${sources} · ${fact.rows.length.toLocaleString("pt-BR")} linhas`, count });
    pages.push(op.page);
  }

  // Page 1: overview.
  // (The monthly change is blank in a card with no month picked: it goes to the trend page.)
  // Deliveries: the count, on time, the freight and the late ones; otherwise money first.
  const freight = flow?.logistics ? measures.find((x) => /frete/i.test(x.name) && /total|soma/i.test(x.name))?.name : null;
  const kpis = (flow?.logistics ? [count, op?.onTime, freight, op?.lateDone || ticket] : [headline, count !== headline ? count : null, ticket || qtyMeasure, margin || (ticket ? qtyMeasure : null) || ytd]).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, 4);
  const kpiW = Math.floor((1232 - (kpis.length - 1) * 16) / kpis.length);
  const overview = [header(`Fonte: ${sources} · ${fact.rows.length.toLocaleString("pt-BR")} linhas`), ...slicers()];
  kpis.forEach((k, i) => overview.push({ type: "card", x: 24 + i * (kpiW + 16), y: 92, w: kpiW, h: 108, values: m(k), title: k }));
  if (date) overview.push({ type: months > 14 ? "lineChart" : "clusteredColumnChart", x: 24, y: 216, w: 760, h: 488, title: `${headline} por mês`, category: "'Calendário'[Mês/ano]", values: m(headline), labels: months <= 14, sort: { by: "'Calendário'[Mês/ano]", desc: false } });
  else if (thirdDim) overview.push({ type: "clusteredColumnChart", x: 24, y: 216, w: 760, h: 488, title: `${headline} por ${lower(thirdDim.name)}`, category: thirdDim.ref, values: m(headline), labels: true, sort: { by: m(headline) } });
  const carrier = flow?.logistics && op?.onTime ? dims.find((d) => /transportadora|empresa|parceiro/i.test(d.name)) : null;
  const destination = flow?.logistics && op?.lateDone ? dims.find((d) => /cidade|destino|uf\b|regi/i.test(d.name)) : null;
  if (carrier || destination) {
    // Who delivers on time, and where the delays go.
    if (carrier) overview.push({ type: "clusteredBarChart", x: 800, y: 216, w: 456, h: destination ? 236 : 488, title: `${op.onTime.replace(/ %$/, "")} por ${lower(carrier.name)}`, category: carrier.ref, values: m(op.onTime), labels: true, sort: { by: m(op.onTime), desc: false } });
    if (destination) overview.push({ type: "clusteredBarChart", x: 800, y: carrier ? 468 : 216, w: 456, h: carrier ? 236 : 488, title: `${op.lateDone} por ${lower(destination.name)}`, category: destination.ref, values: m(op.lateDone), labels: true, sort: { by: m(op.lateDone) } });
  } else {
  if (barDim) overview.push({ type: "clusteredBarChart", x: 800, y: 216, w: 456, h: donutDim ? 236 : 488, title: `${headline} por ${lower(barDim.name)}`, category: barDim.ref, values: m(headline), labels: true, sort: { by: m(headline) } });
  if (donutDim) overview.push({ type: "donutChart", x: 800, y: barDim ? 468 : 216, w: 456, h: barDim ? 236 : 488, title: `Participação por ${lower(donutDim.name)}`, category: donutDim.ref, values: m(headline), labels: true });
  }
  pages.push({ displayName: flow?.logistics ? "Entregas" : "Visão geral", visuals: overview });

  // Page 2: detail.
  const detail = [header("Detalhamento: clique num item para filtrar a página"), ...slicers()];
  const tableFields = [...dims.slice(0, 2).map((d) => d.ref), ...[...new Set([headline, count, ticket, qtyMeasure, margin, "% do total"].filter(Boolean))].map(m)];
  detail.push({ type: "tableEx", x: 24, y: 92, w: 760, h: 612, title: "Resumo", values: tableFields.slice(0, 7), sort: { by: m(headline) } });
  const sideDims = dims.filter((d) => d !== dims[0]).slice(0, 2).length ? dims.slice(1, 3) : dims.slice(0, 1);
  sideDims.forEach((d, i) => detail.push({ type: i === 0 ? "clusteredBarChart" : "treemap", x: 800, y: 92 + i * 314, w: 456, h: sideDims.length > 1 ? 298 : 612, title: `${headline} por ${lower(d.name)}`, category: d.ref, values: m(headline), labels: i === 0, sort: i === 0 ? { by: m(headline) } : undefined }));
  pages.push({ displayName: "Detalhamento", visuals: detail });

  // Page 3: trend.
  if (date) {
    const trend = [header("Tendência: mês a mês e acumulado no ano"), ...slicers()];
    // Several years: one line per year over jan-dez (the classic comparison); one year: month by month.
    trend.push(previousYear
      ? { type: "lineChart", x: 24, y: 92, w: 1232, h: 300, title: `${headline} por mês, ano a ano`, category: "'Calendário'[Mês]", series: "'Calendário'[Ano]", values: m(headline), sort: { by: "'Calendário'[Mês]", desc: false } }
      : { type: "lineChart", x: 24, y: 92, w: 1232, h: 300, title: `${headline} mês a mês`, category: "'Calendário'[Mês/ano]", values: m(headline), labels: true, sort: { by: "'Calendário'[Mês/ano]", desc: false } });
    trend.push({ type: "clusteredColumnChart", x: 24, y: 408, w: 600, h: 296, title: `${ytd}`, category: "'Calendário'[Mês/ano]", values: m(ytd), sort: { by: "'Calendário'[Mês/ano]", desc: false } });
    trend.push({ type: "tableEx", x: 640, y: 408, w: 616, h: 296, title: "Mês a mês", values: ["'Calendário'[Mês/ano]", m(headline), m(previousMonth), m(momChange), ...(yoyChange ? [m(yoyChange)] : [])], sort: { by: "'Calendário'[Mês/ano]", desc: false } });
    pages.push({ displayName: "Tendência", visuals: trend });
  }

  const chosen = pagesFor(pages, goal);
  pages.splice(0, pages.length, ...chosen);

  // ---- Model spec for PbiHost.Build
  const modelTables = tables.map((t) => ({
    name: t.name,
    m: mExpression(t),
    columns: t.columns.map((c) => ({
      name: c.name, type: c.type,
      ...(c.type === "data" ? { format: "dd/mm/yyyy" } : c.role === "money" || c.role === "unitPrice" ? { format: MONEY } : c.role === "percent" ? { format: PCT } : c.type === "inteiro" && c.role !== "id" ? { format: INT } : c.type === "numero" ? { format: DEC } : {}),
      summarize: "none",
      ...(c.role === "date" && t === fact ? { hidden: "True" } : {}),
    })),
    measures: measures.filter((x) => (x.table || fact.name) === t.name).map(({ table, ...x }) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== null && v !== undefined && v !== ""))),
  }));
  const modelRelationships = relationships.map(({ from, to }) => ({ from, to }));
  if (date) {
    modelTables.push({ name: "Calendário", dax: calendarDax(fact.name, date.name), dateTable: "True", columns: CALENDAR_COLUMNS });
    modelRelationships.push({ from: col(fact.name, date.name), to: "'Calendário'[Data]" });
  }
  const measureTable = Object.fromEntries(measures.map((x) => [x.name, x.table || fact.name]));

  const summary = [
    `Fato: ${fact.name} (${fact.rows.length} linhas; ${fact.columns.map((c) => `${c.name}: ${c.type}`).join(", ")}).`,
    relationships.length ? `Relações: ${relationships.map((r) => `${r.from} → ${r.to}`).join("; ")}.` : "",
    date ? `Calendário em português ligado a ${fact.name}[${date.name}].` : "Sem coluna de data: sem páginas de tempo.",
    `Medidas: ${measures.map((x) => x.name).join(", ")}.`,
    flow ? `Fluxo: ${flow.status} (${flow.stages.map((x) => x.values[0]).join(" → ")})${flow.place ? `; cena com as ${flow.place.toLowerCase()}s` : ""}${flow.asset ? `; ${flow.vehicles} por ${flow.asset}` : ""}.` : "",
    `Páginas: ${pages.map((p) => `${p.displayName} (${p.visuals.length} visuais)`).join(", ")}.`,
  ].filter(Boolean).join("\n");
  return { name: reportTitle, fact: fact.name, headline, model: { name: reportTitle, culture: "pt-BR", tables: modelTables, relationships: modelRelationships }, measures: measureTable, pages, summary, measureList: measures, palette: { dark }, flow };
}
