// Brazil as a tile map, for any data with a state (UF) column: each state a block as tall as the number
// (sales, freight, tickets by state), and — with an origin and a destination state and a flow — every load
// on its way drawn as a truck on its route, where it should be by now (pickup -> forecast). Faithful like
// the other scenes: one truck per load in transit (up to 40, the rest written), and a live seal.
import { D, HIGHLIGHT_VARS, auroraBanner, auroraRing, daxText, joinDax, safe } from "./powerbiScene.js";

export const UFS = { AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará", PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins" };
// A tile grid close to the map: [column, row].
const GRID = { RR: [2, 0], AP: [4, 0], AM: [1, 1], PA: [3, 1], MA: [4, 1], CE: [5, 1], RN: [6, 1], AC: [0, 2], RO: [1, 2], TO: [3, 2], PI: [4, 2], PB: [6, 2], MT: [2, 3], GO: [3, 3], BA: [4, 3], PE: [5, 3], AL: [6, 3], MS: [2, 4], DF: [3, 4], MG: [4, 4], SE: [5, 4], SP: [3, 5], RJ: [4, 5], ES: [5, 5], PR: [3, 6], SC: [3, 7], RS: [3, 8] };
const fold = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const BY_NAME = Object.fromEntries(Object.entries(UFS).map(([k, v]) => [fold(v), k]));
/** "MG", "mg", "Minas Gerais" -> "MG"; anything else -> null. */
export const ufOf = (v) => { const s = String(v || "").trim(); return UFS[s.toUpperCase()] ? s.toUpperCase() : BY_NAME[fold(s)] || null; };

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const col = (table, column) => `${q(table)}[${String(column).replace(/]/g, "]]")}]`;

/** The state columns of a table: { origin?, dest } (names), or null. Codes or full names. */
export function readGeo(fact) {
  const isUf = (c) => {
    if (c.type !== "texto") return false;
    const vals = fact.rows.map((r) => r[fact.columns.indexOf(c)]).filter((v) => String(v || "").trim());
    return vals.length > 0 && vals.filter((v) => ufOf(v)).length >= vals.length * 0.9;
  };
  const geo = fact.columns.filter(isUf);
  if (!geo.length) return null;
  const origin = geo.find((c) => /origem|sa[íi]da|remetente|coleta/i.test(c.name));
  const dest = geo.find((c) => c !== origin && /destino|entrega|cliente|destinat/i.test(c.name)) || geo.find((c) => c !== origin);
  if (!dest) return null;
  const full = fact.rows.some((r) => String(r[fact.columns.indexOf(dest)] || "").trim().length > 2);
  return { fact: fact.name, origin: origin?.name || null, dest: dest.name, names: full };
}

const C = Math.cos(Math.PI / 6);
const S = 92; // tile step (world units)
const iso = (X, Y, Z = 0) => [(X - Y) * C, (X + Y) * 0.5 - Z];
const r1 = (v) => String(Math.round(v * 10) / 10);
const pts = (list) => list.map(([X, Y, Z]) => iso(X, Y, Z).map(r1).join(",")).join(" ");
const FONT = "font-family='Segoe UI, sans-serif'";
const LOOK = {
  noite: { ground: "#0F1B2D", tile: ["#22324D", "#1A263B", "#16213A"], text: "#E8EDF5", soft: "#8FA3BF", route: "#3A4D6E", hi: ["#6EA8FF", "#2F6FDB", "#2257B0"] },
  dia: { ground: "#EEF3FB", tile: ["#FFFFFF", "#E2E9F4", "#C9D5E8"], text: "#1B2A4A", soft: "#5B6B85", route: "#AFC0D6", hi: ["#6EA8FF", "#2F6FDB", "#2257B0"] },
};

/**
 * The map. spec: { geo, measure: "[Faturamento]", format, flow? (with stages, transit stage values,
 * date/due columns), look }. Returns { dax, points } (points: each state's position, for the click).
 */
export function mapScene({ geo, measure, format = "#,0", flow = null, look = "noite", vehicleVars = null }) {
  const L = LOOK[look] || LOOK.noite;
  const F = geo.fact;
  const dest = col(F, geo.dest);
  const origin = geo.origin ? col(F, geo.origin) : null;
  // With routes the blocks stay low (still as tall as the number), so every truck on its way shows.
  const H = flow && origin && vehicleVars ? 46 : 150;
  // The frame from the grid's corners.
  const corners = Object.values(GRID).flatMap(([c, r]) => [iso(c * S, r * S, 0), iso(c * S + 80, r * S + 80, H + 60)]);
  const minX = Math.min(...corners.map((p) => p[0])) - 60; const maxX = Math.max(...corners.map((p) => p[0])) + 60;
  const minY = Math.min(...corners.map((p) => p[1])) - 90; const maxY = Math.max(...corners.map((p) => p[1])) + 60;
  const vb = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  // States drawn back to front.
  const order = Object.entries(GRID).sort((a, b) => (a[1][0] + a[1][1]) - (b[1][0] + b[1][1]));
  // A state's code from a value that may be its name ("Minas Gerais" -> "MG").
  const codeOf = (expr) => (geo.names ? `SWITCH(${expr}, ${Object.entries(UFS).map(([k, v]) => `"${v}", "${k}"`).join(", ")}, ${expr})` : expr);
  const valueOf = (code) => geo.names ? `CALCULATE(${measure}, ${dest} IN {"${code}", "${UFS[code]}"})` : `CALCULATE(${measure}, ${dest} = "${code}")`;
  const tiles = order.map(([code, [c, r]], i) => {
    const X = c * S; const Y = r * S; const w = 80;
    const h = `MAX(4, INT(${H} * DIVIDE(V${i}, Mx)))`;
    const up = (x, y) => { const [sx, sy] = iso(x, y, 0); return [`${r1(sx)},`, D(`INT(${r1(sy)} - (${h}))`)]; };
    const flat = (x, y) => iso(x, y, 0).map(r1).join(",");
    const poly = (points, fill) => ["<polygon points='", points.flatMap((p, k) => [k ? " " : "", p]), "' fill='", fill, "'/>"];
    const lit = (k) => D(`IF(V${i} > 0, ${daxText(L.hi[k])}, ${daxText(L.tile[k])})`);
    const [tx, ty] = iso(X + w / 2, Y + w / 2, 0);
    return [
      D(`IF(${geo.names ? `"${code}" IN Destacados || "${UFS[code]}" IN Destacados` : `"${code}" IN Destacados`}, ${daxText(auroraRing(r1(tx), r1(ty), 70, 40))}, "")`),
      poly([flat(X, Y + w), flat(X + w, Y + w), up(X + w, Y + w), up(X, Y + w)], lit(1)),
      poly([flat(X + w, Y), flat(X + w, Y + w), up(X + w, Y + w), up(X + w, Y)], lit(2)),
      poly([up(X, Y), up(X + w, Y), up(X + w, Y + w), up(X, Y + w)], lit(0)),
      `<text x='${r1(tx)}' text-anchor='middle' ${FONT} font-size='18' font-weight='700' fill='${L.text}' y='`, D(`INT(${r1(ty)} - (${h}) + 6)`), `'>${code}</text>`,
      `<text x='${r1(tx)}' text-anchor='middle' ${FONT} font-size='14' fill='${L.soft}' y='`, D(`INT(${r1(ty)} - (${h}) - 14)`), "'>", D(`IF(V${i} > 0, ${safe(`FORMAT(V${i}, "${format.replace(/"/g, "\"\"")}")`)}, "")`), "</text>",
    ];
  });
  const tileVars = order.map(([code], i) => `VAR V${i} = ${valueOf(code)} + 0`);
  // The loads on their way: each a small truck on its route, at its share of the way by now.
  let roads = []; let roadVars = []; let seal = [];
  if (flow && origin && vehicleVars) {
    const centre = (codeExpr, axis) => `SWITCH(${codeExpr}, ${Object.entries(GRID).map(([k, [c, r]]) => `"${k}", ${r1(iso(c * S + 40, r * S + 40, 0)[axis])}`).join(", ")}, BLANK())`;
    const oc = codeOf("[@o]"); const dc = codeOf("[@d]");
    const F2 = flow.fact;
    const order2 = [flow.date ? `${col(F2, flow.date)}, DESC` : null, flow.id ? `${col(F2, flow.id)}, DESC` : null].filter(Boolean).join(", ");
    const key = flow.asset ? col(F2, flow.asset) : col(F2, flow.id);
    const lat = (expr) => `VAR v = [@key] RETURN MAXX(TOPN(1, FILTER(Ativos, ${key} = v), ${order2}), ${expr})`;
    const progress = flow.date && flow.due ? `MIN(0.9, MAX(0.1, DIVIDE(NOW() - ${col(F2, flow.date)}, ${col(F2, flow.due)} - ${col(F2, flow.date)})))` : "0.5";
    roadVars = [
      ...vehicleVars,
      "VAR Rota0 = ADDCOLUMNS(SELECTCOLUMNS(FILTER(Veiculos, [@where] = \"estrada\"), \"@key\", [@nome], \"@atraso\", [@atraso]), " +
        `"@o", ${lat(origin)}, "@d", ${lat(dest)}, "@p", ${lat(progress)})`,
      `VAR Rota = ADDCOLUMNS(Rota0, "@j", VAR k = [@key] RETURN COUNTROWS(FILTER(Rota0, [@key] <= k)), "@x", INT(${centre(oc, 0)} + (${centre(dc, 0)} - ${centre(oc, 0)}) * [@p]), "@y", INT(${centre(oc, 1)} + (${centre(dc, 1)} - ${centre(oc, 1)}) * [@p]) - 30)`,
      "VAR nRota = COUNTROWS(Rota) + 0",
    ];
    // A small truck drawn at (0,0), moved to its place on the route.
    const truck = `<polygon points='${pts([[-10, -26, 0], [10, -26, 0], [10, 26, 0], [-10, 26, 0]])}' fill='%23000000' opacity='0.15'/>` +
      `<polygon points='${pts([[-9, -22, 22], [9, -22, 22], [9, 10, 22], [-9, 10, 22]])}' fill='`;
    roads = [
      // The routes (origin -> destination) of the loads on their way, faint.
      D(`CONCATENATEX(Rota, "<line stroke='${L.route.replace("#", "%23")}' stroke-width='3' stroke-dasharray='6 6' x1='" & INT(${centre(oc, 0)}) & "' y1='" & INT(${centre(oc, 1)} - 30) & "' x2='" & INT(${centre(dc, 0)}) & "' y2='" & INT(${centre(dc, 1)} - 30) & "'/>", "")`),
      D(`CONCATENATEX(FILTER(Rota, [@j] <= 40), "<g class='v estrada' transform='translate(" & [@x] & "," & [@y] & ")'>${truck.replace(/'/g, "'")}" & IF([@atraso] = 1, "%23D94B4B", "%238E66D9") & "'/><polygon points='${pts([[-9, 10, 0], [9, 10, 0], [9, 10, 22], [-9, 10, 22]])}' fill='%23E8EDF5'/></g>", "", [@j], ASC)`),
    ];
    seal = [
      `<text x='${r1(vb.x + vb.w - 20)}' y='${r1(vb.y + vb.h - 18)}' text-anchor='end' ${FONT} font-size='18' font-weight='700' fill='`, D(`IF(nRota <= 40, ${daxText("#27AE60")}, ${daxText("#B98A22")})`), "'>", D(`IF(nRota <= 40, "✓ " & nRota & " de " & nRota, "◐ 40 de " & nRota) & " a caminho desenhados" & IF(nRota > 40, " (+" & (nRota - 40) & " fora do desenho)", "")`), "</text>",
    ];
  }
  const dax = [
    ...tileVars,
    `VAR Mx = MAX(1, ${order.map((_, i) => `V${i}`).reduce((a, b) => `MAX(${a}, ${b})`)})`,
    ...HIGHLIGHT_VARS,
    ...roadVars,
    `RETURN ${daxText("data:image/svg+xml;utf8,")} & ${daxText(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='${r1(vb.x)} ${r1(vb.y)} ${r1(vb.w)} ${r1(vb.h)}' preserveAspectRatio='none'><rect x='${r1(vb.x)}' y='${r1(vb.y)}' width='${r1(vb.w)}' height='${r1(vb.h)}' fill='${L.ground}'/>`)}`,
    `  & ${joinDax(tiles)}`,
    roads.length ? `  & ${joinDax(roads)}` : "",
    seal.length ? `  & ${joinDax(seal)}` : "",
    `  & ${joinDax(auroraBanner(vb))}`,
    "  & \"</svg>\"",
  ].filter(Boolean).join("\n");
  // Each state's centre, for the scatter over the map (a click on a state filters the page).
  const cx = `SWITCH(${codeOf(`SELECTEDVALUE(${dest})`)}, ${Object.entries(GRID).map(([k, [c, r]]) => `"${k}", ${r1(iso(c * S + 40, r * S + 40, 0)[0] - vb.x)}`).join(", ")}, BLANK())`;
  const cy = `SWITCH(${codeOf(`SELECTEDVALUE(${dest})`)}, ${Object.entries(GRID).map(([k, [c, r]]) => `"${k}", ${r1(vb.h - (iso(c * S + 40, r * S + 40, 0)[1] - vb.y))}`).join(", ")}, BLANK())`;
  return { dax, points: { category: dest, x: cx, y: cy, w: Math.round(vb.w), h: Math.round(vb.h) } };
}
