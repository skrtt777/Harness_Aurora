// The Aurora's Power BI designer: from the person's spreadsheets (.xlsx, .csv) to a complete BI — a star
// semantic model (types, a Portuguese calendar, relationships, DAX measures with R$ formats) and a report
// with an overview, a detail page and a trend page. Deterministic on purpose: a small local model only
// says which files and what to call it; the quality of the model and of the pages comes from here.
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { xlsxText } from "./docText.js";
import { flowDesign, momentTable, readFlow } from "./powerbiStory.js";
import { moneyDesign, readMoney } from "./powerbiMoney.js";
import { cityScene } from "./powerbiScene.js";
import { plantaScene, readSpace } from "./powerbiSpace.js";
import { mapScene, readGeo } from "./powerbiMap.js";
import { vehicleVars } from "./powerbiScene.js";
import { composePage } from "./powerbiLayout.js";
import { COLORS, autoPlan, materialize, normalizePlan } from "./powerbiPlanner.js";

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
// A moment: "11/10/2026 14:32", "2026-10-11T14:32" (the timeline of an operation needs the hour).
const TIME_PART = /[ T]\d{1,2}:\d{2}(:\d{2})?$/;
const MONEY_NAME = /valor|pre[çc]o|receita|faturamento|custo|lucro|total|venda|desconto|frete|sal[áa]rio|comiss|ticket|montante|pago|saldo|despesa|gasto|or[çc]amento|imposto|tarifa|mensalidade|r\$/i;
const UNIT_NAME = /unit[áa]rio|unit\b|p\.?\s?unit|pre[çc]o (de )?venda|pre[çc]o m[ée]dio|valor unit/i;
const QTY_NAME = /qtd|quant|unidades|itens|volume|peso|kg|litros|horas|dias/i;
const ID_NAME = /^(id|c[óo]d(igo)?|n[ºo°]|n[uú]mero|pedido|nf|nota|matr[íi]cula|cpf|cnpj|protocolo|ticket id|chamado|senha|ct-?e|os)\b|(^|\s)id$|c[óo]digo/i;
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
    if (values.length && values.every((v) => DATE_BR.test(v) || DATE_ISO.test(v) || (TIME_PART.test(v) && (DATE_BR.test(v.replace(TIME_PART, "")) || DATE_ISO.test(v))))) type = values.some((v) => TIME_PART.test(v)) ? "datahora" : "data";
    else if (values.length && values.every((v) => Number.isFinite(parseNumber(v, decimalComma)))) type = values.every((v) => Number.isInteger(parseNumber(v, decimalComma)) && !/[,.]\d/.test(v)) ? "inteiro" : "numero";
    else if (values.length && values.every((v) => /^(sim|n[ãa]o|true|false|verdadeiro|falso)$/i.test(v))) type = "sim/não";
    const percent = type === "numero" && values.some((v) => v.endsWith("%"));
    let role = "attribute";
    if (type === "data") role = "date";
    else if (type === "datahora") role = "datetime";
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
const M_TYPE = { datahora: "type datetime", data: "type date", inteiro: "Int64.Type", numero: "type number", "sim/não": "type logical", texto: "type text" };
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

/**
 * The complete design, in two steps: prepare (the data -> the measures and the catalog of what a page can
 * show) and finish (a plan -> the pages and the model). Between them the local model may write the plan
 * (app/powerbiPlanner.js); design() does both with the plan given or the automatic one.
 */
export function design(tables, options = {}) {
  const prep = prepare(tables, options);
  return finish(prep, options.plan);
}

/** The data read, the measures made, and the catalog for a plan. */
export function prepare(tables, { title, goal = "" } = {}) {
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
  // Rows with a place (X, Y, size): the geometry columns are not summed, they draw the plan.
  const space = readSpace(fact);
  const factCol = (role) => fact.columns.filter((c) => c.role === role);
  // No day column but a moment one ("Hora de chegada"): the calendar goes by its day, a column made here.
  const moment = factCol("datetime")[0];
  const date = factCol("date")[0] || (moment ? { name: "Dia", type: "data", role: "date", fromMoment: moment.name } : null);
  const dateAt = date ? fact.columns.indexOf(date.fromMoment ? moment : date) : -1;
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
  // A plan's rows are its rooms (desks, bays): "Qtd. de salas", not "de registros".
  const spaceThings = space ? plural(lower(space.name)) : null;
  const count = id
    ? add(`Qtd. de ${things}`, `DISTINCTCOUNT(${col(fact.name, id.name)})`, INT, "Principais", `Quantos ${things} diferentes`)
    : add(`Qtd. de ${spaceThings || "registros"}`, `COUNTROWS(${q(fact.name)})`, INT, "Principais", "Quantas linhas");
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
  // "Ocupação média" is already an average: "Ocupação (média)" (the column keeps its own name).
  for (const c of factCol("percent")) add(/m[ée]di[ao]$/i.test(c.name) ? `${c.name.replace(/\s*m[ée]di[ao]$/i, "")} (média)` : `${c.name} médio`, `AVERAGE(${col(fact.name, c.name)})`, PCT, "Valores");
  if (unit) add(`${unit.name.replace(/unit[áa]rio/i, "médio")}`.replace(/^(.*)$/, (s) => (s === unit.name ? `${unit.name} médio` : s)), `AVERAGE(${col(fact.name, unit.name)})`, MONEY, "Valores", `Média de ${unit.name}`);
  // No money column but price x quantity: the revenue is computed.
  if (!mainMeasure && unit && qty) mainMeasure = add("Faturamento", `SUMX(${q(fact.name)}, ${col(fact.name, unit.name)} * ${col(fact.name, qty.name)})`, MONEY, "Principais", `${unit.name} x ${qty.name}, linha a linha`);
  // What the data is about decides the first page and its scene: a flow of work (orders through docks
  // and trucks, tickets through stages), money in and out (a ledger), or — any other data — the items
  // as a city. "sem cena" in the request keeps the classic pages.
  // ("simples" is not "without scenes": a simple panel for the owner still shows where the money goes.)
  const plainPages = /sem (a |as )?cenas?|sem 3d|sem desenhos?/i.test(goal);
  const flow = plainPages ? null : readFlow(fact, tables);
  const ledger = plainPages ? null : readMoney(fact, relationships, (v) => parseNumber(v, fact.decimalComma));
  const reportTitle = title || `Painel de ${lower(fact.name)}`.replace(/^Painel de (.)/, (s, c) => `Painel de ${c}`);
  const sources = [...new Set(tables.map((t) => basename(t.source.path)))].join(", ");
  const fin = ledger ? moneyDesign(ledger, { add, hasCalendar: Boolean(date) }) : null;
  // Money: the detail and the trend follow what goes out (where the money goes); the balance is on top.
  const headline = fin ? fin.outgo : flow?.logistics ? count : mainMeasure || qtyMeasure || count;
  // A ledger's plain sum adds money in and money out together: no "Faturamento" (nor ticket) from it.
  if (fin && mainMeasure) { measures.splice(measures.findIndex((x) => x.name === mainMeasure), 1); mainMeasure = null; }
  let ticket = null;
  // "Ticket médio" for sales; otherwise "Custo médio por chamado".
  const one = id ? lower(id.name).replace(/^(n[ºo°]|n[uú]mero|c[óo]digo|id)\s*(d[oa]s?\s+)?/i, "").trim() || "registro" : space ? lower(space.name) : "registro";
  if (mainMeasure) ticket = add(mainMeasure === "Faturamento" ? "Ticket médio" : `${mainMeasure.replace(/\s*(total|\(soma\))$/i, "")} médio por ${one}`, `DIVIDE(${m(mainMeasure)}, ${m(count)})`, MONEY, "Principais", `${mainMeasure} por ${one}`);
  let margin = null;
  if (mainMeasure && cost) {
    const profit = add("Lucro", `${m(mainMeasure)} - ${m(`${cost.name} total`)}`, MONEY, "Principais");
    margin = add("Margem %", `DIVIDE(${m(profit)}, ${m(mainMeasure)})`, PCT, "Principais");
  }
  add("% do total", `DIVIDE(${m(headline)}, CALCULATE(${m(headline)}, ALLSELECTED()))`, PCT, "Comparações", `Participação de cada item em ${headline}`);
  // Time: needs the calendar.
  let momChange = null; let yoyChange = null; let ytd = null; let previousMonth = null; let previousYear = null;
  const years = date ? new Set(fact.rows.map((r) => (String(r[dateAt] || "").match(/\d{4}/) || [""])[0]).filter(Boolean)) : new Set();
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
  const months = date ? new Set(fact.rows.map((r) => String(r[dateAt] || "").replace(/^\d{1,2}\//, "").slice(0, 7))).size : 0;

  // ---- The catalog: every number, scene and block a page can have. The plan (the local model's, or
  // the automatic one) chooses among them; nothing is placed here.
  // When the data was last refreshed: a table recalculated on each refresh (the Aurora refreshes the open
  // report when the files change and at least every 10 minutes); the scenes show it in their live badge.
  const stamp = add("Última atualização", "MAX('Atualização'[Atualizado em])", "dd/mm/yyyy HH:mm", "Operação", "Quando os dados foram atualizados pela última vez");
  const story = flow ? flowDesign(flow, { add, title: reportTitle, count, stamp: m(stamp) }) : null;
  const scenes = { ...(story?.scenes || {}), ...(fin?.scenes || {}) };
  const cities = new Map();
  if (!plainPages) {
    // A city needs a few items to compare: 4 to 30 (not a status, not money in/out, not a yes/no).
    const skip = new Set([flow?.status, ledger?.direction?.column].filter(Boolean));
    for (const d of dims.filter((x) => x.distinct >= 4 && x.distinct <= 30 && !skip.has(x.name)).slice(0, 5)) {
      scenes[`cidade de ${d.name}`] = {
        covers: [d.name],
        desc: `os ${lower(d.name)}s como prédios: altura = ${headline}, cor = último ano contra o anterior (clicar acende)`,
        make: ({ look = "noite" } = {}) => {
          const key = `${d.name}|${look}`;
          if (!cities.has(key)) {
            const made = cityScene({ column: d.ref, measure: m(headline), format: measures.find((x) => x.name === headline)?.format || "#,0", year: previousYear ? "'Calendário'[Ano]" : null, look });
            const suffix = look === "dia" ? " (dia)" : "";
            cities.set(key, { made, url: add(`Cena: ${d.name}${suffix}`, made.dax, null, "Cenas", `Os ${lower(d.name)}s como prédios`, { category: "ImageUrl" }), x: add(`${d.name} X${suffix}`, made.points.x, "0", "Cenas", "Posição na cena (para o clique)"), y: add(`${d.name} Y${suffix}`, made.points.y, "0", "Cenas", "Posição na cena (para o clique)") });
          }
          const c = cities.get(key);
          return { type: "image", scene: true, look, url: m(c.url), title: `${headline} por ${lower(d.name)}`, overlay: { category: d.ref, x: m(c.x), y: m(c.y), w: Number(c.made.points.w), h: Number(c.made.points.h) } };
        },
      };
    }
  }
  if (space && !plainPages) {
    const plans = new Map();
    scenes.planta = {
      covers: [space.name, space.kind, space.floor].filter(Boolean),
      desc: `a planta em 3D feita dos dados: cada ${lower(space.name)} é um bloco onde está${space.floor ? `, ${lower(space.floor)}s empilhados` : ""}${space.kind ? `, colorido por ${lower(space.kind)}` : ""}; clicar num(a) acende e deixa o resto em aramado`,
      make: ({ look = "noite" } = {}) => {
        if (!plans.has(look)) {
          const made = plantaScene(space, { look });
          const suffix = look === "dia" ? " (dia)" : "";
          plans.set(look, { made, url: add(`Planta${suffix}`, made.dax, null, "Cenas", "A planta desenhada pelos dados", { category: "ImageUrl" }), x: add(`Planta X${suffix}`, made.points.x, "0", "Cenas", "Posição na planta (para o clique)"), y: add(`Planta Y${suffix}`, made.points.y, "0", "Cenas", "Posição na planta (para o clique)") });
        }
        const p = plans.get(look);
        return { type: "image", scene: true, look, url: m(p.url), title: `Planta: ${lower(space.name)}s`, overlay: { category: p.made.points.category, x: m(p.x), y: m(p.y), w: p.made.points.w, h: p.made.points.h } };
      },
    };
  }
  // States (UF): Brazil as a tile map, the number by state; with origin, destination and a flow, every
  // load on its way drawn on its route.
  const geo = plainPages ? null : readGeo(fact);
  if (geo) {
    const maps = new Map();
    const withRoutes = Boolean(flow && geo.origin && flow.stages.some((st) => st.key === "transito"));
    scenes.mapa = {
      covers: [geo.dest, geo.origin].filter(Boolean),
      desc: `o Brasil em blocos por estado: a altura é ${headline} em cada UF${withRoutes ? "; cada carga a caminho é um caminhão na sua rota (origem → destino), onde deve estar agora" : ""}; clicar num estado filtra`,
      make: ({ look = "noite" } = {}) => {
        if (!maps.has(look)) {
          const made = mapScene({ geo, measure: m(headline), format: measures.find((x) => x.name === headline)?.format || "#,0", flow: withRoutes ? flow : null, look, vehicleVars: withRoutes ? vehicleVars(flow, q(fact.name)) : null });
          const suffix = look === "dia" ? " (dia)" : "";
          maps.set(look, { made, url: add(`Mapa${suffix}`, made.dax, null, "Cenas", "O Brasil por estado, desenhado pelos dados", { category: "ImageUrl" }), x: add(`Mapa X${suffix}`, made.points.x, "0", "Cenas", "Posição do estado (para o clique)"), y: add(`Mapa Y${suffix}`, made.points.y, "0", "Cenas", "Posição do estado (para o clique)") });
        }
        const g = maps.get(look);
        return { type: "image", scene: true, look, url: m(g.url), title: withRoutes ? "Cargas a caminho, por rota" : `${headline} por estado`, overlay: { category: g.made.points.category, x: m(g.x), y: m(g.y), w: g.made.points.w, h: g.made.points.h } };
      },
    };
  }
  const kind = flow?.logistics ? "logistica" : flow ? "fluxo" : fin ? "financas" : space ? "espacos" : "geral";
  const generic = [headline, count !== headline ? count : null, ticket || qtyMeasure, margin || ytd].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
  const keys = fin ? { income: fin.income, outgo: fin.outgo, balance: fin.balance, margin: fin.margin, execution: fin.execution, headline }
    : story ? { kpis: story.kpis, count, onTime: story.onTime, lateDone: story.lateDone, headline }
      : { kpis: generic, headline };
  const numbers = measures.filter((x) => !x.category && x.format).map((x) => x.name);
  // A card shows the number alone: not a share, nor a month-on-month change (blank without one month).
  const cardable = numbers.filter((n) => !/% do total|mês anterior|Variação %|ano anterior/.test(n));
  const principal = [...new Set([...(keys.kpis || []), keys.income, keys.outgo, keys.balance, keys.margin, keys.execution, keys.onTime, keys.lateDone, headline].filter(Boolean))];
  const flowSlicers = flow ? [flow.details.find((x) => /transportadora|empresa|parceiro|equipe|respons/i.test(x.column))?.column, flow.asset, flow.place].filter(Boolean).map((c) => col(fact.name, c)) : [];
  const cat = {
    title: reportTitle, sources, rows: fact.rows.length, kind, keys, months,
    // Where each measure lives: one of another table (the stock) cannot be grouped by the fact's columns.
    foreign: new Set(measures.filter((x) => x.table && x.table !== fact.name).map((x) => x.name)),
    numbers, cardable, principal, money: new Set(measures.filter((x) => x.format === MONEY).map((x) => x.name)),
    dims: dims.slice(0, 14).map(({ name, ref, distinct }) => ({ name, ref, distinct })),
    time: date ? ["mês", "trimestre", "ano", "dia da semana"] : [],
    scenes, specials: {
      ...(story?.specials || {}), ...(fin?.specials || {}),
      notas_aurora: { desc: "o que mudou desde a última atualização (a Aurora escreve a cada atualização, no máximo a cada 10 min)", make: () => ({ type: "tableEx", float: true, title: "O que mudou (Aurora)", values: ["'Notas da Aurora'[Quando]", "'Notas da Aurora'[Texto]"], totals: false, sort: { by: "'Notas da Aurora'[Quando]", desc: true } }) },
    },
    // The unit switcher (CD, filial) comes first, like the switcher of a control room.
    slicerRefs: [flow?.timeline ? "'Momento'[Quando]" : null, story?.site, ...flowSlicers, ...(fin?.slicers || []), barDim?.ref, donutDim?.ref].filter(Boolean),
    // The unit switcher opens on one unit (single choice): the cards and the yard look at the same one.
    slicerDefaults: { ...(story?.site && story.siteFirst ? { [story.site]: story.siteFirst } : {}), ...(flow?.timeline ? { "'Momento'[Quando]": "Agora" } : {}) },
    stories: [
      flow ? `Há um fluxo de etapas em ${flow.status}: ${flow.stages.map((x) => x.values[0]).join(" → ")}${flow.place ? `, com ${lower(flow.place)}s` : ""}${flow.asset ? ` e ${flow.vehicles} (${flow.asset})` : ""}.` : "",
      fin ? `É dinheiro entrando e saindo${ledger.category ? ` por ${lower(ledger.category.column)}` : ""}${ledger.budget ? ", com orçamento" : ""}.` : "",
      space ? `Cada linha é um(a) ${lower(space.name)} com posição e tamanho (dá para desenhar a planta).` : "",
      date ? `Tem datas (${months} meses).` : "Não tem datas.",
    ].filter(Boolean),
    related: (a, b) => [headline, count, ticket, "% do total"].includes(b),
  };
  // What the Aurora compares after each refresh: the main numbers and, for an operation, each entity.
  const watch = {
    numbers: cardable.filter((n) => principal.includes(n)).slice(0, 8),
    badUp: cardable.filter((n) => /atras|fila|aguard|sa[íi]das|custo|despesa|estour/i.test(n)),
    place: flow?.place || null,
    entities: flow && (flow.asset || flow.id) ? `EVALUATE\n${vehicleVars(flow, q(fact.name)).join("\n")}\nRETURN SELECTCOLUMNS(Veiculos, "n", [@nome], "w", [@where], "d", [@doca], "a", [@atraso])` : null,
  };
  return { cat, goal, tables, fact, relationships, date, measures, flow, fin, ledger, headline, reportTitle, userTitle: title, watch };
}

/** The pages from a plan (or the automatic one), and the model. */
export function finish(prep, rawPlan = null) {
  const { cat, goal, tables, fact, relationships, date, measures, flow, fin, ledger, headline } = prep;
  const plan = (rawPlan && (rawPlan.planner ? rawPlan : normalizePlan(rawPlan, cat, goal))) || autoPlan(cat, goal);
  const reportTitle = prep.userTitle || plan.titulo || prep.reportTitle;
  const dark = plan.estilo.tema === "escuro";
  const style = { dark, text: dark ? "#FFFFFF" : "#1B2A4A", soft: dark ? "#8FA3BF" : "#5B6B85", pin: COLORS[plan.estilo.cor] || "#4F9BFF" };
  const pages = plan.paginas.map((p) => {
    // Light pages get the scenes by day; the night pictures (tracker, detail) keep a dark frame there.
    const visuals = composePage(materialize(p, cat, dark ? "noite" : "dia"), style, reportTitle);
    if (!dark) for (const v of visuals) if (v.type === "image" && !(v.scene && v.look === "dia")) { v.background = "#0B1220"; v.titleColor = "#E8EDF5"; }
    return { displayName: p.nome, visuals };
  });

  // ---- Model spec for PbiHost.Build
  const modelTables = tables.map((t) => ({
    name: t.name,
    m: mExpression(t),
    columns: t.columns.map((c) => ({
      name: c.name, type: c.type,
      ...(c.type === "datahora" ? { format: "dd/mm/yyyy HH:mm" } : c.type === "data" ? { format: "dd/mm/yyyy" } : c.role === "money" || c.role === "unitPrice" ? { format: MONEY } : c.role === "percent" ? { format: PCT } : c.type === "inteiro" && c.role !== "id" ? { format: INT } : c.type === "numero" ? { format: DEC } : {}),
      summarize: "none",
      ...(c.role === "date" && t === fact ? { hidden: "True" } : {}),
    })),
    ...(t === fact && date?.fromMoment ? { extraColumns: [{ name: "Dia", type: "data", expression: `DATE(YEAR(${col(fact.name, date.fromMoment)}), MONTH(${col(fact.name, date.fromMoment)}), DAY(${col(fact.name, date.fromMoment)}))`, format: "dd/mm/yyyy", hidden: "True" }] } : {}),
    measures: measures.filter((x) => (x.table || fact.name) === t.name).map(({ table, ...x }) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== null && v !== undefined && v !== ""))),
  }));
  const modelRelationships = relationships.map(({ from, to }) => ({ from, to }));
  // The timeline: one moment chosen at a time (the cards and the scene follow it).
  if (flow?.timeline) modelTables.push({ name: "Momento", dax: momentTable(), columns: [{ name: "Minutos", type: "inteiro", hidden: "True" }, { name: "Quando", type: "texto", sortBy: "Minutos" }] });
  // What changed since the last refresh, written by the Aurora (app/powerbiChanges.js).
  modelTables.push({ name: "Notas da Aurora", dax: "DATATABLE(\"Quando\", STRING, \"Texto\", STRING, {{\"\", \"\"}})", columns: [{ name: "Quando", type: "texto" }, { name: "Texto", type: "texto" }] });
  // What the Aurora shows when asked ("mostra a doca 3"): she rewrites this table; the scenes ring it.
  modelTables.push({ name: "Destaque", dax: "DATATABLE(\"Valor\", STRING, \"Nota\", STRING, {{\"\", \"\"}})", hidden: "True", columns: [{ name: "Valor", type: "texto" }, { name: "Nota", type: "texto" }] });
  modelTables.push({ name: "Atualização", dax: "ROW(\"Atualizado em\", NOW())", hidden: "True", columns: [{ name: "Atualizado em", type: "data", format: "dd/mm/yyyy HH:mm" }] });
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
    fin ? `Dinheiro: ${fin.income} e ${fin.outgo}${ledger.category ? ` por ${ledger.category.column}` : ""}${ledger.budget ? `; orçamento em ${ledger.budget.table}[${ledger.budget.column}]` : ""}; cena do fluxo do dinheiro.` : "",
    flow ? `Fluxo: ${flow.status} (${flow.stages.map((x) => x.values[0]).join(" → ")})${flow.place ? `; cena com as ${flow.place.toLowerCase()}s` : ""}${flow.asset ? `; ${flow.vehicles} por ${flow.asset}` : ""}.` : "",
    `Plano (${plan.planner}): ${plan.paginas.map((p) => `${p.nome} [${p.layout}${p.cena !== "nenhuma" ? `, cena ${p.cena}` : ""}] — ${p.pergunta}`).join("; ")}. Estilo: ${plan.estilo.tema}, ${plan.estilo.cor}, ${plan.estilo.tom}.`,
    `Páginas: ${pages.map((p) => `${p.displayName} (${p.visuals.length} visuais)`).join(", ")}.`,
  ].filter(Boolean).join("\n");
  return { name: reportTitle, fact: fact.name, headline, model: { name: reportTitle, culture: "pt-BR", tables: modelTables, relationships: modelRelationships }, measures: measureTable, pages, summary, measureList: measures, palette: { dark, accent: COLORS[plan.estilo.cor], tone: plan.estilo.tom }, flow, ledger: fin ? ledger : null, plan, watch: prep.watch };
}
