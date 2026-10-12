// The BI checked before it is handed over: each chart and card asked for its own numbers, the way the page
// shows them (with the page's default filters: the unit, the moment). A chart with no data, a single bar,
// every bar the same, dozens of bars, or a blank card is a picture that says nothing: the plan is fixed (a
// better column for its axis, or the block out) and the page is drawn again. The showcase of 11/10 passed
// every automatic check with such charts; only looking at it caught them.

const CHARTS = new Set(["clusteredBarChart", "clusteredColumnChart", "lineChart", "areaChart", "donutChart", "treemap", "waterfallChart", "funnel"]);
const MANY = new Set(["clusteredBarChart", "clusteredColumnChart", "donutChart", "treemap", "funnel"]);
const str = (v) => `"${String(v).replace(/"/g, "\"\"")}"`;

/** The page's default filters (a slicer with a value chosen) as DAX filter tables. */
function pageFilters(page) {
  return page.visuals.filter((v) => v.type === "slicer" && v.select?.length).map((v) => `TREATAS({${v.select.map(str).join(", ")}}, ${v.values})`);
}

/** The problems of a built report. ask = (cmd, args) => pbiRequest. Returns [{ page, title, why, from }]. */
export async function auditReport(plan, ask) {
  const issues = [];
  for (const page of plan.pages) {
    const filters = pageFilters(page);
    for (const v of page.visuals) {
      if (!v.from) continue;
      const label = v.title || v.values;
      if (v.type === "card" || v.type === "gauge" || v.kpi) {
        const r = await ask("query", { dax: `EVALUATE ROW("v", CALCULATE(${v.kpi || v.values}${filters.length ? `, ${filters.join(", ")}` : ""}))`, max: 2 });
        const value = r.ok ? String(r.text).split("\n")[2]?.trim() : "";
        if (r.ok && !value) issues.push({ page: page.displayName, title: label, why: "fica em branco", from: v.from });
        continue;
      }
      if (!CHARTS.has(v.type) || !v.category || !v.values) continue;
      const dax = `EVALUATE TOPN(41, FILTER(SUMMARIZECOLUMNS(${v.category}${filters.length ? `, ${filters.join(", ")}` : ""}, "v", ${v.values}), NOT ISBLANK([v])))`;
      const r = await ask("query", { dax, max: 45 });
      if (!r.ok) continue;
      const rows = String(r.text).split("\n").slice(2).filter((l) => l && !l.startsWith("…")).map((l) => l.split(" | ").pop());
      const why = !rows.length ? "não tem dados"
        : rows.length === 1 ? "mostra uma barra só"
          : rows.length >= 3 && new Set(rows).size === 1 ? "mostra tudo igual"
            : MANY.has(v.type) && rows.length > 30 ? "tem barras demais para ler" : null;
      if (why) issues.push({ page: page.displayName, title: label, why, from: v.from });
    }
  }
  return issues;
}

/**
 * The plan fixed for the problems: a chart with one bar or too many takes another column with a few
 * values (one not on the page yet), a chart with nothing to show or a blank card leaves. Returns
 * { plan, changes: [text] } or null when nothing could change.
 */
export function fixPlan(plan, issues, cat) {
  const next = JSON.parse(JSON.stringify(plan));
  const changes = [];
  for (const issue of issues) {
    const page = next.paginas.find((p) => p.nome === issue.page);
    if (!page) continue;
    if (issue.from.numero) {
      page.numeros = page.numeros.filter((n) => n !== issue.from.numero);
      changes.push(`tirei o cartão "${issue.title}" (${issue.why})`);
      continue;
    }
    const at = page.blocos.findIndex((b) => b.tipo === issue.from.tipo && b.medida === issue.from.medida && b.por === issue.from.por);
    if (at < 0) continue;
    const used = new Set(page.blocos.map((b) => b.por));
    const other = /barra só|demais/.test(issue.why) ? cat.dims.find((d) => d.distinct >= 3 && d.distinct <= 30 && !used.has(d.name) && d.name !== cat.siteColumn && d.name !== issue.from.por) : null;
    if (other) {
      page.blocos[at] = { ...page.blocos[at], tipo: ["linha", "area", "cascata"].includes(page.blocos[at].tipo) ? "barras" : page.blocos[at].tipo, por: other.name, titulo: "" };
      changes.push(`"${issue.title}" ${issue.why}: agora por ${other.name.toLowerCase()}`);
    } else {
      page.blocos.splice(at, 1);
      changes.push(`tirei "${issue.title}" (${issue.why})`);
    }
  }
  // A page left with nothing (no scene, no chart, no card) leaves too.
  next.paginas = next.paginas.filter((p) => p.cena !== "nenhuma" || p.blocos.length || p.numeros.length);
  return changes.length && next.paginas.length ? { plan: next, changes } : null;
}
