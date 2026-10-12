// What each page says, in one sentence by the Aurora, under its title: built from the numbers the page
// itself shows (asked after the report loads: each card's value, each chart's leader and its share), the
// local model only puts them in words, and a sentence with a number the facts do not have is not used
// (then the facts themselves, joined). Kept in the report's 'Resumo' table; the header reads it.
import { narrate } from "./powerbiChanges.js";

const str = (v) => `"${String(v).replace(/"/g, "\"\"")}"`;
const rowsOf = (r) => (r?.ok ? String(r.text || "").split("\n").slice(2).filter((l) => l && !l.startsWith("…")).map((l) => l.split(" | ")) : []);
const CHARTS = new Set(["clusteredBarChart", "clusteredColumnChart", "donutChart", "treemap", "funnel"]);
const lower = (s) => (/^\p{Lu}{2}/u.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));

/** The facts of one page: [text], from its cards and its charts, with its default filters. */
export async function pageFacts(page, plan, ask) {
  const filters = page.visuals.filter((v) => v.type === "slicer" && v.select?.length).map((v) => `TREATAS({${v.select.map(str).join(", ")}}, ${v.values})`);
  const ctx = filters.length ? `, ${filters.join(", ")}` : "";
  const formatOf = (ref) => plan.measureList.find((x) => `[${x.name}]` === ref)?.format;
  const facts = [];
  for (const v of page.visuals.filter((x) => x.kpi || x.type === "card").slice(0, 4)) {
    const ref = v.kpi || v.values; const f = formatOf(ref);
    const r = await ask("query", { dax: `EVALUATE ROW("v", ${f ? `FORMAT(CALCULATE(${ref}${ctx}), ${str(f)})` : `CALCULATE(${ref}${ctx})`})`, max: 2 });
    const value = rowsOf(r)[0]?.[0];
    if (value) facts.push(`${v.from?.numero || v.title}: ${value}`);
  }
  // (A chart over time is a trend, not a ranking: the cards already say the last month.)
  for (const v of page.visuals.filter((x) => CHARTS.has(x.type) && x.category && x.values && !/Calend[áa]rio/.test(x.category)).slice(0, 3)) {
    const f = formatOf(v.values);
    const r = await ask("query", { dax: `EVALUATE VAR T = FILTER(SUMMARIZECOLUMNS(${v.category}${ctx}, "v", ${v.values}), NOT ISBLANK([v])) VAR Total = SUMX(T, [v]) RETURN TOPN(1, ADDCOLUMNS(T, "f", ${f ? `FORMAT([v], ${str(f)})` : "[v] & \"\""}, "p", FORMAT(DIVIDE([v], Total), "0%"), "n", COUNTROWS(T)), [v], DESC)`, max: 3 });
    const [row] = rowsOf(r);
    if (!row) continue;
    const [name, , value, share, count] = row;
    const what = v.values.replace(/^\[|\]$/g, "");
    facts.push(Number(count) > 1 && !/%/.test(f || "") ? `${what}: ${name} lidera com ${value} (${share} do total)` : `${what}: ${name} com ${value}`);
  }
  return facts;
}

/** The 'Resumo' table: one sentence per page. */
export function summaryTable(rows) {
  const list = rows.length ? rows.map(([page, text]) => `{${str(page)}, ${str(text)}}`) : ["{\"\", \"\"}"];
  return `DATATABLE("Página", STRING, "Texto", STRING, {${list.join(", ")}})`;
}

/** Writes the summaries of the report's pages; returns [[page, text]]. */
export async function writeSummaries(plan, ask, askModel, env = {}) {
  const rows = [];
  for (const page of plan.pages) {
    const facts = await pageFacts(page, plan, ask).catch(() => []);
    if (!facts.length) continue;
    const text = await narrate(facts, askModel, env, "o que esta página do painel mostra de mais importante para quem decide, começando direto pelo fato (sem \"este painel\" nem \"esta página\")", 125).catch(() => facts.join(". "));
    rows.push([page.displayName, String(text).replace(/\s+/g, " ").trim().slice(0, 200)]);
  }
  if (rows.length) await ask("apply", { ops: [{ op: "tableExpression", name: "Resumo", expression: summaryTable(rows) }] });
  return rows;
}

/** The header of a page drawn by a measure: its title and, under it, the Aurora's sentence (or its question). */
export function headerMeasure({ page, fallback, dark, width }) {
  const text = dark ? "%23FFFFFF" : "%231B2A4A"; const soft = dark ? "%238FA3BF" : "%235B6B85";
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "\"\"").replace(/%/g, "%25").replace(/#/g, "%23");
  // About 7.2 px per character at 14 px: the sentence cut to the header's width.
  const chars = Math.max(40, Math.floor((width - 10) / 7.2));
  return [
    `VAR R = CALCULATE(MAX('Resumo'[Texto]), 'Resumo'[Página] = ${str(page)})`,
    `VAR Linha = IF(R = "", ${str(fallback)}, R)`,
    `VAR Curta = IF(LEN(Linha) > ${chars}, LEFT(Linha, ${chars - 1}) & "…", Linha)`,
    `RETURN "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${width} 72' preserveAspectRatio='xMinYMid meet'><text x='2' y='34' font-family='Segoe UI Semibold, Segoe UI, sans-serif' font-size='28' font-weight='700' fill='${text}'>${esc(page)}</text><text x='2' y='60' font-family='Segoe UI, sans-serif' font-size='14' fill='" & IF(R = "", "${soft}", "${dark ? "%23C3D3EA" : "%233B4A63"}") & "'>" & IF(R = "", "", "✦ ") & SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(Curta, "&", "&amp;"), "<", "&lt;"), "%", "%25"), "#", "%23") & "</text></svg>"`,
  ].join("\n");
}

export { lower };
