// Geometry that comes from the data (like a BIM model's rooms in Power BI): a table whose rows have a
// position (X, Y), a size (width, depth) and maybe a floor becomes a 3D plan — each row a box where it is,
// coloured by its type, the chosen ones lit and the rest as wireframe. The coordinates are computed in DAX
// from each row's own columns, so a new row in the spreadsheet is a new box after the next refresh.
import { D, HIGHLIGHT_VARS, auroraBanner, daxText, joinDax, safe } from "./powerbiScene.js";

const X_NAME = /^(x|pos(i[çc][ãa]o)? ?x|coord(enada)? ?x|x \(m\))$/i;
const Y_NAME = /^(y|pos(i[çc][ãa]o)? ?y|coord(enada)? ?y|y \(m\))$/i;
const W_NAME = /^(largura|width|w|tamanho x|comprimento x)( \(m\))?$/i;
const D_NAME = /^(profundidade|comprimento|depth|d|tamanho y)( \(m\))?$/i;
const FLOOR = /^(andar|pavimento|piso|n[íi]vel|floor)$/i;
const NAME = /sala|espa[çc]o|ambiente|c[ôo]modo|endere[çc]o|posi[çc][ãa]o|local|room|leito|mesa|box|vaga|loja/i;
const KIND = /tipo|uso|departamento|setor|categoria|finalidade|classe/i;

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const col = (table, column) => `${q(table)}[${String(column).replace(/]/g, "]]")}]`;
const num = (v) => Number(String(v ?? "").replace(",", "."));

/** The space of a table (rows with position and size), or null. Marks those columns as geometry. */
export function readSpace(fact) {
  const find = (re) => fact.columns.find((c) => re.test(c.name.trim()) && (c.type === "numero" || c.type === "inteiro"));
  const x = find(X_NAME); const y = find(Y_NAME); const w = find(W_NAME); const d = find(D_NAME);
  if (!x || !y || !w || !d) return null;
  const floor = find(FLOOR);
  const name = fact.columns.find((c) => c.type === "texto" && NAME.test(c.name) && c.distinct >= fact.rows.length * 0.8) || fact.columns.find((c) => c.type === "texto" && c.distinct === fact.rows.length);
  if (!name) return null;
  const kind = fact.columns.find((c) => c.type === "texto" && c !== name && KIND.test(c.name) && c.distinct <= 12);
  for (const c of [x, y, w, d, floor].filter(Boolean)) c.role = "position";
  const at = (c) => fact.columns.indexOf(c);
  const vals = (c) => fact.rows.map((r) => num(r[at(c)])).filter(Number.isFinite);
  const xs = vals(x); const ys = vals(y); const ws = vals(w); const ds = vals(d); const fs = floor ? vals(floor) : [0];
  const minX = Math.min(...xs); const minY = Math.min(...ys);
  const spanX = Math.max(...fact.rows.map((r) => num(r[at(x)]) + num(r[at(w)])).filter(Number.isFinite)) - minX;
  const spanY = Math.max(...fact.rows.map((r) => num(r[at(y)]) + num(r[at(d)])).filter(Number.isFinite)) - minY;
  return {
    fact: fact.name, x: x.name, y: y.name, w: w.name, d: d.name, floor: floor?.name || null, name: name.name, kind: kind?.name || null,
    bounds: { minX, minY, spanX: Math.max(1, spanX), spanY: Math.max(1, spanY), minFloor: Math.min(...fs), floors: new Set(fs).size, maxW: Math.max(...ws), maxD: Math.max(...ds) },
  };
}

const LOOK = {
  noite: { ground: "#0F1B2D", grid: "#15253B", wire: "#3A4D6E", text: "#E8EDF5", soft: "#8FA3BF", slab: "#16263D" },
  dia: { ground: "#EEF3FB", grid: "#DCE5F2", wire: "#AFC0D6", text: "#1B2A4A", soft: "#5B6B85", slab: "#DDE6F3" },
};
const KIND_COLORS = [["#6EA8FF", "#2F6FDB", "#2257B0"], ["#3DDC97", "#27AE60", "#1E8C4D"], ["#F6D365", "#D9A93A", "#B98A22"], ["#FF8A8A", "#D94B4B", "#B33636"], ["#C3A6FA", "#8E66D9", "#6E48B8"], ["#7FD3F7", "#4BAFD9", "#2E8FB8"], ["#FFB86B", "#E8772E", "#B95A1E"], ["#D5DBE3", "#AAB4C3", "#8793A6"]];

/**
 * The plan: every row a box at its place (floors stacked), coloured by its kind; with a selection the
 * chosen boxes keep their colour and the others become wireframe. Returns { dax, points }.
 */
export function plantaScene(space, { look = "noite", label = null } = {}) {
  const L = LOOK[look] || LOOK.noite;
  const F = space.fact;
  const b = space.bounds;
  const K = 700 / Math.max(b.spanX, b.spanY);
  const H = 46;
  // Floors exploded upwards by the plan's own depth: a floor never hides the one under it.
  const FLOOR_H = Math.round(Math.max(140, (b.spanY * K) / 2 + 2 * H));
  const c = (n) => col(F, n);
  const C = 0.866;
  // World -> screen, as DAX on the row's columns (all integers: a pt-BR model writes "12,5").
  const X0 = `((${c(space.x)} - ${b.minX}) * ${K})`;
  const Y0 = `((${c(space.y)} - ${b.minY}) * ${K})`;
  const W = `(${c(space.w)} * ${K})`;
  const Dd = `(${c(space.d)} * ${K})`;
  const Z0 = space.floor ? `((${c(space.floor)} - ${b.minFloor}) * ${FLOOR_H})` : "0";
  // (Parentheses: Y and Z are often sums — "Y0 + D", "Z0 + H" — and "X - Y0 + D" mirrored the tops.)
  const sx = (X, Y) => `INT(((${X}) - (${Y})) * ${C})`;
  const sy = (X, Y, Z) => `INT(((${X}) + (${Y})) / 2 - (${Z}))`;
  const corner = { a: [X0, Y0], b: [`${X0} + ${W}`, Y0], c: [`${X0} + ${W}`, `${Y0} + ${Dd}`], d: [X0, `${Y0} + ${Dd}`] };
  const pt = (k, z) => [sx(...corner[k]), sy(...corner[k], z)];
  const zTop = `${Z0} + ${H}`;
  // The frame: from the extremes of the plan.
  const ext = { x0: -b.spanY * K * C - 40, x1: b.spanX * K * C + 40, y0: -(b.floors - 1) * FLOOR_H - H - 70, y1: (b.spanX + b.spanY) * K / 2 + 40 };
  const vb = { x: ext.x0, y: ext.y0, w: ext.x1 - ext.x0, h: ext.y1 - ext.y0 };
  const kindIndex = space.kind ? `MOD(COUNTROWS(FILTER(ALL(${c(space.kind)}), ${c(space.kind)} < EARLIER(${c(space.kind)}))) + 0, ${KIND_COLORS.length})` : "0";
  const shade = (i) => `SWITCH(Cor, ${KIND_COLORS.map((s, n) => `${n}, ${daxText(s[i])}`).join(", ")}, ${daxText(KIND_COLORS[0][i])})`;
  const face = (keys, z, i) => joinDax([
    "<polygon points='", ...keys.flatMap((k, n) => [n ? " " : "", D(pt(k[0], k[1] === "top" ? zTop : z)[0]), ",", D(pt(k[0], k[1] === "top" ? zTop : z)[1])]), "' ",
    D(`IF(Aceso, "fill='" & ${shade(i)} & "'", "fill='none' stroke='" & ${daxText(L.wire)} & "' stroke-width='1.5'")`), "/>",
  ]);
  const box = [
    face([["d", "base"], ["c", "base"], ["c", "top"], ["d", "top"]], Z0, 1),
    face([["b", "base"], ["c", "base"], ["c", "top"], ["b", "top"]], Z0, 2),
    face([["a", "top"], ["b", "top"], ["c", "top"], ["d", "top"]], Z0, 0),
  ].join(" & ");
  const [tx, ty] = [sx(`${X0} + ${W} / 2`, `${Y0} + ${Dd} / 2`), sy(`${X0} + ${W} / 2`, `${Y0} + ${Dd} / 2`, zTop)];
  const text = `IF(${c(space.w)} * ${c(space.d)} * ${K * K} > 2600, "<text text-anchor='middle' font-family='Segoe UI' font-size='13' font-weight='600' fill='" & IF(Aceso, ${daxText("#FFFFFF")}, ${daxText(L.soft)}) & "' x='" & ${tx} & "' y='" & (${ty} + 5) & "'>" & ${safe(`LEFT(${c(space.name)}, 16)`)} & "</text>", "")`;
  const ring = `IF(${c(space.name)} IN Destacados, "<ellipse fill='none' stroke='%23B04BFF' stroke-width='5' rx='60' ry='34' cx='" & ${tx} & "' cy='" & (${ty} + 4) & "'><animate attributeName='stroke-opacity' values='1;0.25;1' dur='1.1s' repeatCount='indefinite'/></ellipse>", "")`;
  const each = `VAR Cor = ${kindIndex}\nVAR Aceso = NOT Filtrado || ${c(space.name)} IN Escolhidos || ${c(space.name)} IN Destacados\nRETURN ${box} & ${text} & ${ring}`;
  const legend = space.kind ? `CONCATENATEX(ADDCOLUMNS(ALL(${c(space.kind)}), "@i", COUNTROWS(FILTER(ALL(${c(space.kind)}), ${c(space.kind)} < EARLIER(${c(space.kind)}))) + 0), "<rect x='${Math.round(vb.x + 20)}' y='" & INT(${Math.round(vb.y + 18)} + [@i] * 28) & "' width='18' height='18' rx='9' fill='" & SWITCH(MOD([@i], ${KIND_COLORS.length}), ${KIND_COLORS.map((s, n) => `${n}, ${daxText(s[1])}`).join(", ")}) & "'/><text font-family='Segoe UI' font-size='17' fill='${L.text.replace("#", "%23")}' x='${Math.round(vb.x + 46)}' y='" & INT(${Math.round(vb.y + 33)} + [@i] * 28) & "'>" & ${safe(c(space.kind))} & "</text>", "", [@i], ASC)` : "\"\"";
  const floorsLabel = space.floor ? `"<text font-family='Segoe UI' font-size='15' fill='${L.soft.replace("#", "%23")}' x='${Math.round(vb.x + vb.w - 20)}' y='${Math.round(vb.y + 30)}' text-anchor='end'>" & ${safe(`"${space.floor}s: " & CONCATENATEX(VALUES(${c(space.floor)}), ${c(space.floor)}, ", ", ${c(space.floor)}, ASC)`)} & "</text>"` : "\"\"";
  const dax = [
    `VAR Escolhidos = VALUES(${c(space.name)})`,
    `VAR Filtrado = ISCROSSFILTERED(${c(space.name)})`,
    // Painter's order: lower floors first, then from the back (small X + Y) to the front.
    `VAR Salas = ALL(${q(F)})`,
    ...HIGHLIGHT_VARS,
    `RETURN ${daxText("data:image/svg+xml;utf8,")} & ${daxText(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='${Math.round(vb.x)} ${Math.round(vb.y)} ${Math.round(vb.w)} ${Math.round(vb.h)}' preserveAspectRatio='none'><rect x='${Math.round(vb.x)}' y='${Math.round(vb.y)}' width='${Math.round(vb.w)}' height='${Math.round(vb.h)}' fill='${L.ground}'/>`)}`,
    `  & CONCATENATEX(Salas, ${each.split("\n").join(" ")}, "", ${space.floor ? `${c(space.floor)}, ASC, ` : ""}${c(space.x)} + ${c(space.y)}, ASC)`,
    `  & ${legend} & ${floorsLabel} & ${joinDax(auroraBanner(vb))}`,
    "  & \"</svg>\"",
  ].join("\n");
  // Each room's centre, for the scatter laid over the plan (a click on a room filters the page).
  const at = (expr) => `VAR n = SELECTEDVALUE(${c(space.name)})\nVAR r = FILTER(ALL(${q(F)}), ${c(space.name)} = n)\nRETURN IF(ISBLANK(n), BLANK(), MAXX(r, ${expr}))`;
  const pointX = at(`${sx(`${X0} + ${W} / 2`, `${Y0} + ${Dd} / 2`)} - (${Math.round(vb.x)})`);
  const pointY = at(`${Math.round(vb.h)} - (${sy(`${X0} + ${W} / 2`, `${Y0} + ${Dd} / 2`, zTop)} - (${Math.round(vb.y)}))`);
  return { dax, points: { category: c(space.name), x: pointX, y: pointY, w: Math.round(vb.w), h: Math.round(vb.h) }, label };
}
