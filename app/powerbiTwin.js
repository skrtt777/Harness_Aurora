// The digital twin outside Power BI: the open report's state as JSON, from the same DAX as its scenes, so
// any other viewer (VR, Unreal) shows exactly what the report shows. Contract: docs/GEMEO_DIGITAL_CONTRATO.md.
import { vehicleVars } from "./powerbiScene.js";

const q = (name) => `'${String(name).replace(/'/g, "''")}'`;
const col = (table, column) => `${q(table)}[${String(column).replace(/]/g, "]]")}]`;
const str = (v) => `"${String(v).replace(/"/g, "\"\"")}"`;
const rowsOf = (reply) => (reply?.ok ? String(reply.text || "").split("\n").slice(2).filter((l) => l && !l.startsWith("…")).map((l) => l.split(" | ")) : []);

/** The DAX the twin asks, per unit (CD, loja…): who is where, and every place that exists there. */
export function twinQueries(flow) {
  const F = flow.fact;
  const units = flow.site && flow.siteValues?.length ? flow.siteValues : [null];
  return units.map((unit) => {
    const base = unit == null ? q(F) : `FILTER(ALL(${q(F)}), ${col(F, flow.site)} = ${str(unit)})`;
    const entities = `EVALUATE\n${vehicleVars(flow, base).join("\n")}\nRETURN SELECTCOLUMNS(Veiculos, "n", [@nome], "i", [@id], "s", [@st], "w", [@where], "d", [@doca], "a", [@atraso])`;
    const places = flow.place ? `EVALUATE FILTER(CALCULATETABLE(VALUES(${col(F, flow.place)})${unit == null ? "" : `, ${col(F, flow.site)} = ${str(unit)}`}), ${col(F, flow.place)} <> "")` : null;
    return { unit, entities, places };
  });
}

/**
 * The state of a watched report now (see the contract). ask = (cmd, args) => pbiRequest.
 */
export async function twinState(w, ask) {
  const flow = w.watch?.flow || null;
  const state = { version: 1, title: w.title, kind: flow?.place ? "operacao" : "numeros", updatedAt: new Date().toISOString(), lastRefresh: new Date(w.lastRefresh || Date.now()).toISOString(), glyph: flow?.glyph || null, noun: flow?.vehicles || null, placeLabel: flow?.place || null, units: [], entities: [], numbers: {}, highlight: { values: [], note: "" }, notes: (w.notes || []).slice(0, 6) };
  if (w.watch?.numbers?.length) {
    const r = await ask("query", { dax: `EVALUATE ROW(${w.watch.numbers.map((n, i) => `"m${i}", [${n.replace(/]/g, "]]")}]`).join(", ")})`, max: 2 });
    const values = rowsOf(r)[0] || [];
    w.watch.numbers.forEach((n, i) => { if (values[i] !== undefined && values[i] !== "") state.numbers[n] = values[i]; });
  }
  const hl = rowsOf(await ask("query", { dax: "EVALUATE 'Destaque'", max: 25 }));
  state.highlight = { values: hl.map((r) => r[0]).filter(Boolean), note: hl.find((r) => r[1])?.[1] || "" };
  if (!flow?.place) return state;
  for (const { unit, entities, places } of twinQueries(flow)) {
    const list = rowsOf(await ask("query", { dax: entities, max: 3000 })).map(([name, id, status, where, place, late]) => ({ name, id, status, where, place: place || "", late: late === "1", unit }));
    const placeNames = places ? rowsOf(await ask("query", { dax: places, max: 200 })).map((r) => r[0]).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })) : [];
    const at = (p, where) => list.filter((e) => e.place === p && e.where === where).map((e) => e.name);
    state.units.push({
      name: unit,
      places: placeNames.map((p) => ({ name: p, serving: at(p, "doca"), waiting: at(p, "filalocal") })),
      queue: list.filter((e) => e.where === "fila").map((e) => e.name),
      road: list.filter((e) => e.where === "estrada").map((e) => e.name),
      counts: { total: list.length, serving: list.filter((e) => e.where === "doca").length, waiting: list.filter((e) => e.where === "filalocal" || e.where === "fila").length, road: list.filter((e) => e.where === "estrada").length, late: list.filter((e) => e.late).length },
    });
    state.entities.push(...list);
  }
  return state;
}
