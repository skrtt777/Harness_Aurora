// Pictures drawn by DAX measures: an SVG built from the data each time the report asks (Power BI shows a
// measure of category ImageUrl in the Image visual and in tables). The geometry is computed here, once —
// an isometric distribution centre with its docks, the queue and the road; a stage tracker; progress bars;
// a detail card — and the DAX only fills in colours, labels and counts, so it stays simple and fast.

// ---- SVG pieces as DAX ----------------------------------------------------------------------------

/** A static piece of SVG as a DAX string, ready for a data: URL ("%" and "#" escaped). */
export const daxText = (s) => `"${String(s).replace(/%/g, "%25").replace(/#/g, "%23").replace(/"/g, "\"\"")}"`;
/** Data text inside the picture: escaped for XML and for the data: URL. */
export const safe = (expr) => `SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(${expr} & "", "&", "&amp;"), "<", "&lt;"), "%", "%25"), "#", "%23")`;
/** A dynamic piece: DAX that returns SVG text. */
export const D = (dax) => ({ dax });
/** Static strings and dynamic pieces (nested arrays allowed) -> one DAX string expression. */
export function joinDax(parts) {
  const out = [];
  let buffer = "";
  for (const p of [parts].flat(Infinity)) {
    if (p === null || p === undefined || p === "") continue;
    if (typeof p === "string") { buffer += p; continue; }
    if (buffer) out.push(daxText(buffer));
    buffer = "";
    out.push(`(${p.dax})`);
  }
  if (buffer) out.push(daxText(buffer));
  return out.length ? out.join(" & ") : "\"\"";
}
const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const when = (condition, parts) => D(`IF(${condition}, ${joinDax(parts)}, "")`);
const URL_HEAD = "data:image/svg+xml;utf8,";
const FONT = "font-family='Segoe UI, sans-serif'";

// ---- Isometric geometry ---------------------------------------------------------------------------

const COS = Math.cos(Math.PI / 6);
const r1 = (v) => String(Math.round(v * 10) / 10);
export const iso = (X, Y, Z = 0) => [(X - Y) * COS, (X + Y) * 0.5 - Z];

/** Collects the extent of everything drawn, for the viewBox. */
class Canvas {
  constructor() { this.minX = Infinity; this.minY = Infinity; this.maxX = -Infinity; this.maxY = -Infinity; }
  see(x, y) { if (this.quiet) return; this.minX = Math.min(this.minX, x); this.maxX = Math.max(this.maxX, x); this.minY = Math.min(this.minY, y); this.maxY = Math.max(this.maxY, y); }
  pts(list) { return list.map(([X, Y, Z]) => { const [x, y] = iso(X, Y, Z); this.see(x, y); return `${r1(x)},${r1(y)}`; }).join(" "); }
  poly(list, fill, extra = "") { return [`<polygon points='${this.pts(list)}' fill='`, fill, `'${extra}/>`]; }
  /** A box from (X, Y, Z) with sizes; fills = [top, front-left (Y face), front-right (X face)]. */
  box(X, Y, Z, dx, dy, dz, fills, extra = "") {
    const x1 = X + dx; const y1 = Y + dy; const z1 = Z + dz;
    return [
      this.poly([[X, y1, Z], [x1, y1, Z], [x1, y1, z1], [X, y1, z1]], fills[1], extra),
      this.poly([[x1, Y, Z], [x1, y1, Z], [x1, y1, z1], [x1, Y, z1]], fills[2], extra),
      this.poly([[X, Y, z1], [x1, Y, z1], [x1, y1, z1], [X, y1, z1]], fills[0], extra),
    ];
  }
  at(X, Y, Z = 0) { const [x, y] = iso(X, Y, Z); this.see(x, y); return [r1(x), r1(y)]; }
}

// Status colours, three shades each (top, left, right faces) and the flat one.
export const STATE = {
  fila: { label: "Na fila", shades: ["#F6D365", "#D9A93A", "#B98A22"] },
  separacao: { label: "Em separação", shades: ["#7FD3F7", "#4BAFD9", "#2E8FB8"] },
  carregando: { label: "Carregando", shades: ["#6EA8FF", "#2F6FDB", "#2257B0"] },
  transito: { label: "Em trânsito", shades: ["#C3A6FA", "#8E66D9", "#6E48B8"] },
  atraso: { label: "Atrasado", shades: ["#FF8A8A", "#D94B4B", "#B33636"] },
  livre: { label: "Doca livre", shades: ["#3DDC97", "#27AE60", "#1E8C4D"] },
};
const shade = (keyExpr, i) => D(`SWITCH(${keyExpr}, ${Object.entries(STATE).map(([k, s]) => `"${k}", ${daxText(s.shades[i])}`).join(", ")}, ${daxText("#6B7A90")})`);

// ---- Model references -----------------------------------------------------------------------------

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const col = (table, column) => `${q(table)}[${String(column).replace(/]/g, "]]")}]`;
const list = (values) => `{${values.map((v) => `"${String(v).replace(/"/g, "\"\"")}"`).join(", ")}}`;

/**
 * The flow of a story as DAX helpers. flow: { fact, status, stages: [{ rank, key, values: [...] }],
 * done: [...values], place?, asset?, id?, date?, due?, driver?, details: [{ label, column, date? }] }.
 */
function helpers(flow) {
  const F = flow.fact;
  const status = col(F, flow.status);
  // The position of each stage in this flow (1..n): with 3 stages the middle one is 67% done, not 60%.
  const ranks = flow.stages.flatMap((s, i) => s.values.map((v) => `"${v.replace(/"/g, "\"\"")}", ${i + 1}`));
  const rankOf = `SWITCH(${status}, ${ranks.join(", ")}, BLANK())`;
  const valuesOf = (keys) => flow.stages.filter((s) => keys.includes(s.key)).flatMap((s) => s.values);
  const atDock = valuesOf(["separacao", "carregando"]).length ? valuesOf(["separacao", "carregando"]) : valuesOf(["fila"]);
  const order = [flow.date ? `${col(F, flow.date)}, DESC` : null, flow.id ? `${col(F, flow.id)}, DESC` : null].filter(Boolean).join(", ");
  const latest = (table) => (order ? `TOPN(1, ${table}, ${order})` : `TOPN(1, ${table}, 1, DESC)`);
  const label = flow.asset ? col(F, flow.asset) : flow.id ? col(F, flow.id) : status;
  const keyOf = (statusExpr) => `SWITCH(TRUE(), ${flow.stages.filter((s) => s.key !== "concluido").map((s) => `${statusExpr} IN ${list(s.values)}, "${s.key}"`).join(", ")}, "concluido")`;
  return {
    F, status, rankOf, atDock, latest, label, keyOf,
    maxRank: flow.stages.length,
    active: `FILTER(${q(F)}, NOT ISBLANK(${status}) && NOT ${status} IN ${list(flow.done)})`,
    late: flow.due ? `${col(F, flow.due)} < TODAY()` : "FALSE()",
    count: flow.asset ? (t) => `COUNTROWS(DISTINCT(SELECTCOLUMNS(${t}, "a", ${col(F, flow.asset)})))` : (t) => `COUNTROWS(${t})`,
    valuesOf,
  };
}

// ---- The distribution centre ----------------------------------------------------------------------

/**
 * The yard of a distribution centre, isometric: the warehouse with one door per dock (up to 10), the
 * vehicle at each dock coloured by its stage (red when late), the queue and the road with the vehicles
 * in transit. Returns the DAX of a measure (category ImageUrl).
 */
export function yardScene(flow, { title = "Centro de distribuição", slots = 10 } = {}) {
  const h = helpers(flow);
  const F = flow.fact;
  const place = col(F, flow.place);
  const cv = new Canvas();
  const LEN = 600; const DEPTH = 200; const HEIGHT = 112;
  const parts = [];
  // Ground, with a grid; the yard in front of the docks; the road on the right. The floor runs past the
  // frame (an isometric floor is a tall diamond): the frame fits what is on it.
  cv.quiet = true;
  parts.push(cv.poly([[-30, -30, 0], [820, -30, 0], [820, 610, 0], [-30, 610, 0]], "#0F1B2D"));
  for (let g = 40; g <= 800; g += 95) parts.push(`<polyline points='${cv.pts([[g, -30, 0], [g, 610, 0]])}' stroke='#15253B' stroke-width='1' fill='none'/>`);
  for (let g = 50; g <= 600; g += 90) parts.push(`<polyline points='${cv.pts([[-30, g, 0], [820, g, 0]])}' stroke='#15253B' stroke-width='1' fill='none'/>`);
  parts.push(cv.poly([[0, DEPTH, 0], [LEN, DEPTH, 0], [LEN, 420, 0], [0, 420, 0]], "#13233A"));
  parts.push(cv.poly([[690, -30, 0], [790, -30, 0], [790, 610, 0], [690, 610, 0]], "#1A2638"));
  parts.push(`<polyline points='${cv.pts([[740, -30, 0], [740, 610, 0]])}' stroke='#C9D3E3' stroke-width='2' stroke-dasharray='14 12' fill='none' opacity='0.5'/>`);
  // Parking for the queue: painted spots.
  const SPOTS = 5;
  for (let j = 0; j < SPOTS; j += 1) parts.push(cv.poly([[20 + j * 82, 400, 0], [84 + j * 82, 400, 0], [84 + j * 82, 530, 0], [20 + j * 82, 530, 0]], "none", " stroke='#2C3E5A' stroke-width='1.5'"));
  cv.quiet = false;
  // The warehouse.
  parts.push(cv.box(0, 0, 0, LEN, DEPTH, HEIGHT, ["#2B3A55", "#22324D", "#1A263B"]));
  for (let r = 26; r < 100; r += 30) parts.push(`<polyline points='${cv.pts([[16, r, HEIGHT], [LEN - 16, r, HEIGHT]])}' stroke='#3A4D6E' stroke-width='5' fill='none'/>`);
  // The name painted on the roof.
  const [wx, wy] = cv.at(30, 168, HEIGHT);
  parts.push(`<text transform='matrix(${r1(COS)},0.5,${r1(-COS)},0.5,${wx},${wy})' fill='#DCE6F5' ${FONT} font-size='34' font-weight='700' letter-spacing='3'>${xml(title.toUpperCase().slice(0, 30))}</text>`);

  // Docks: geometry for each slot, the data filled in per slot.
  const n = Math.max(1, Math.min(slots, flow.placeCount || slots));
  const w = (LEN - 40) / n;
  const tw = Math.min(w * 0.62, 46);
  const fragments = [];
  for (let k = 0; k < n; k += 1) {
    const xs = 20 + k * w;
    const cx = xs + w / 2;
    const frag = [];
    frag.push(cv.poly([[cx - tw / 2 - 4, DEPTH, 0], [cx + tw / 2 + 4, DEPTH, 0], [cx + tw / 2 + 4, DEPTH, 66], [cx - tw / 2 - 4, DEPTH, 66]], D("IF([@k] = \"livre\", " + daxText("#1E8C4D") + ", " + daxText("#0B1322") + ")")));
    // The vehicle: chassis, trailer coloured by the stage, cab.
    const truck = [
      cv.box(cx - tw / 2, DEPTH + 10, 0, tw, 150, 9, ["#0A0F18", "#0A0F18", "#0A0F18"]),
      cv.box(cx - tw / 2, DEPTH + 10, 9, tw, 118, 52, [shade("[@k]", 0), shade("[@k]", 1), shade("[@k]", 2)]),
      cv.box(cx - tw / 2 + 2, DEPTH + 132, 9, tw - 4, 30, 40, ["#E8EDF5", "#B8C2D3", "#95A1B6"]),
      cv.poly([[cx - tw / 2 + 4, DEPTH + 162, 30], [cx + tw / 2 - 6, DEPTH + 162, 30], [cx + tw / 2 - 6, DEPTH + 162, 44], [cx - tw / 2 + 4, DEPTH + 162, 44]], "#1E2A3F"),
    ];
    const [px, py] = cv.at(cx, DEPTH + 60, 61);
    const plate = [
      `<rect x='${r1(Number(px) - 46)}' y='${r1(Number(py) - 34)}' width='92' height='26' rx='5' fill='#0B1322' stroke='`, shade("[@k]", 0), "' stroke-width='2'/>",
      `<text x='${px}' y='${r1(Number(py) - 15)}' text-anchor='middle' fill='#FFFFFF' ${FONT} font-size='17' font-weight='600'>`, D(safe("LEFT([@placa], 9)")), "</text>",
    ];
    // With a selection (a click on the table, a slicer) the yard stays whole: the chosen ones lit, the others dim.
    frag.push(when("[@k] <> \"livre\"", ["<g opacity='", D("IF([@sel] = 1, \"1\", \"0.22\")"), "'>", truck, plate, "</g>"]));
    const [nx, ny] = cv.at(cx - tw / 2 - 4, DEPTH, 76);
    frag.push(`<text transform='matrix(${r1(COS)},0.5,0,1,${nx},${ny})' fill='#C9D3E3' ${FONT} font-size='15' font-weight='600'>`, D(safe(`LEFT(${place}, 10)`)), "</text>");
    fragments.push(`${k + 1}, ${joinDax(frag)}`);
  }

  // The queue: one vehicle per spot (up to 5), and the count.
  const queue = [];
  for (let j = 0; j < SPOTS; j += 1) {
    const x = 20 + j * 82 + 16;
    queue.push(when(`nFila >= ${j + 1}`, ["<g opacity='", D(`IF(nFilaSel >= ${j + 1}, "1", "0.22")`), "'>",
      cv.box(x, 410, 0, 32, 112, 7, ["#0A0F18", "#0A0F18", "#0A0F18"]),
      cv.box(x, 410, 7, 32, 84, 40, STATE.fila.shades),
      cv.box(x + 2, 496, 7, 28, 24, 32, ["#E8EDF5", "#B8C2D3", "#95A1B6"]),
    "</g>"]));
  }
  const [qx, qy] = cv.at(0, 440, 0);
  cv.see(Number(qx) - 150, Number(qy));
  queue.push(`<text x='${r1(Number(qx) - 16)}' y='${r1(Number(qy) + 8)}' text-anchor='end' fill='#F6D365' ${FONT} font-size='26' font-weight='700'>`, D("FORMAT(nFila, \"0\")"), ` ${flow.queueLabel || "na fila"}</text>`);

  // The road: up to 3 vehicles leaving, red when late, and the counts.
  const road = [];
  for (let j = 0; j < 3; j += 1) {
    const y = 270 - j * 165;
    road.push(when(`nTransito >= ${j + 1}`, ["<g opacity='", D(`IF(nTransitoSel >= ${j + 1}, "1", "0.22")`), "'>",
      cv.box(700, y, 0, 34, 118, 7, ["#0A0F18", "#0A0F18", "#0A0F18"]),
      cv.box(700, y + 30, 7, 34, 88, 42, [shade(`IF(nAtrasoTransito >= ${j + 1}, "atraso", "transito")`, 0), shade(`IF(nAtrasoTransito >= ${j + 1}, "atraso", "transito")`, 1), shade(`IF(nAtrasoTransito >= ${j + 1}, "atraso", "transito")`, 2)]),
      cv.box(702, y, 7, 30, 28, 34, ["#E8EDF5", "#B8C2D3", "#95A1B6"]),
    "</g>"]));
  }
  const [rx, ry] = cv.at(800, -30, 0);
  cv.see(Number(rx) + 230, Number(ry) + 40);
  road.push(
    `<text x='${r1(Number(rx) + 10)}' y='${r1(Number(ry) + 6)}' fill='#C3A6FA' ${FONT} font-size='26' font-weight='700'>`, D("FORMAT(nTransito, \"0\")"), ` ${flow.transitLabel || "em trânsito"}</text>`,
    when("nAtrasoTransito > 0", [`<text x='${r1(Number(rx) + 10)}' y='${r1(Number(ry) + 36)}' fill='#FF8A8A' ${FONT} font-size='21'>`, D("FORMAT(nAtrasoTransito, \"0\")"), " com atraso</text>"]),
  );

  // Legend, top left (empty sky in an isometric scene).
  const vb = { x: cv.minX - 16, y: cv.minY - 16, w: cv.maxX - cv.minX + 32, h: cv.maxY - cv.minY + 32 };
  const legend = [];
  const legendKeys = [...flow.stages.filter((s) => s.key !== "concluido").map((s) => [s.key, s.values[0]]), ["atraso", "Atrasado"], ["livre", STATE.livre.label]];
  legendKeys.forEach(([key, text], i) => {
    const lx = vb.x + 24; const ly = vb.y + 34 + i * 32;
    legend.push(`<rect x='${r1(lx)}' y='${r1(ly - 16)}' width='20' height='20' rx='4' fill='${STATE[key]?.shades[1] || "#6B7A90"}'/>`);
    legend.push(`<text x='${r1(lx + 30)}' y='${r1(ly + 1)}' fill='#C9D3E3' ${FONT} font-size='20'>${xml(text)}</text>`);
  });

  const order = [flow.date ? `${col(F, flow.date)}, DESC` : null, flow.id ? `${col(F, flow.id)}, DESC` : null].filter(Boolean).join(", ");
  const top1 = (t) => (order ? `TOPN(1, ${t}, ${order})` : t);
  // The whole yard (no filter: it is the place as it is now); what the filters keep is what is lit.
  const selected = flow.id || flow.asset;
  const fila = `FILTER(Ativos, ${h.status} IN ${list(h.valuesOf(["fila"]))})`;
  const lit = (t) => (selected ? `FILTER(${t}, ${col(F, selected)} IN Visiveis)` : t);
  return [
    `VAR Ativos = FILTER(ALL(${q(F)}), NOT ISBLANK(${h.status}) && NOT ${h.status} IN ${list(flow.done)})`,
    `VAR Visiveis = ${selected ? `VALUES(${col(F, selected)})` : `{ BLANK() }`}`,
    `VAR Filtrado = ${selected ? `ISCROSSFILTERED(${col(F, selected)})` : "FALSE()"}`,
    `VAR NaDoca = FILTER(Ativos, ${h.status} IN ${list(h.atDock)} && NOT ISBLANK(${place}))`,
    `VAR nFila = ${h.count(fila)} + 0`,
    `VAR nFilaSel = IF(Filtrado, ${h.count(lit(fila))} + 0, nFila)`,
    `VAR Transito = FILTER(Ativos, ${h.status} IN ${list(h.valuesOf(["transito"]))})`,
    `VAR nTransito = ${h.count("Transito")} + 0`,
    `VAR nTransitoSel = IF(Filtrado, ${h.count(lit("Transito"))} + 0, nTransito)`,
    `VAR nAtrasoTransito = ${h.count(`FILTER(Transito, ${h.late})`)} + 0`,
    `VAR Docas = TOPN(${n}, FILTER(ALL(${place}), NOT ISBLANK(${place}) && ${place} <> ""), ${place}, ASC)`,
    `VAR Slots0 = ADDCOLUMNS(Docas, "@i", VAR d = ${place} RETURN COUNTROWS(FILTER(Docas, ${place} <= d)))`,
    `VAR Slots1 = ADDCOLUMNS(Slots0, "@placa", VAR d = ${place} RETURN MAXX(${top1(`FILTER(NaDoca, ${place} = d)`)}, ${h.label}), "@etapa", VAR d = ${place} RETURN MAXX(${top1(`FILTER(NaDoca, ${place} = d)`)}, ${h.status}), "@atraso", VAR d = ${place} RETURN MAXX(${top1(`FILTER(NaDoca, ${place} = d)`)}, IF(${h.late}, 1, 0)), "@id", VAR d = ${place} RETURN MAXX(${top1(`FILTER(NaDoca, ${place} = d)`)}, ${selected ? col(F, selected) : "BLANK()"}))`,
    `VAR Slots = ADDCOLUMNS(Slots1, "@k", IF(ISBLANK([@etapa]), "livre", IF([@atraso] = 1, "atraso", ${h.keyOf("[@etapa]")})), "@sel", IF(NOT Filtrado || [@id] IN Visiveis, 1, 0))`,
    `RETURN ${daxText(URL_HEAD)} & ${daxText(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='${r1(vb.x)} ${r1(vb.y)} ${r1(vb.w)} ${r1(vb.h)}'>`)}`,
    `  & ${joinDax(parts)}`,
    `  & CONCATENATEX(Slots, SWITCH([@i], ${fragments.join(",\n    ")}, ""), "", [@i], ASC)`,
    `  & ${joinDax(queue)}`,
    `  & ${joinDax(road)}`,
    `  & ${joinDax(legend)}`,
    "  & \"</svg>\"",
  ].join("\n");
}

// ---- Stage tracker --------------------------------------------------------------------------------

/**
 * The stages in a row, each with how many are there now; with one vehicle or order selected, its own
 * path: done stages green, the current one lit (red when late), the rest dim.
 */
export function trackerScene(flow) {
  const h = helpers(flow);
  const F = flow.fact;
  const stages = flow.stages;
  const W = 1200; const H = 136;
  const step = (W - 160) / Math.max(1, stages.length - 1);
  const one = [flow.asset, flow.id].filter(Boolean).map((c) => `HASONEVALUE(${col(F, c)})`).join(" || ") || "FALSE()";
  const parts = [];
  stages.forEach((s, i) => {
    const x = 80 + i * step;
    if (i > 0) parts.push(`<line x1='${r1(x - step + 34)}' y1='46' x2='${r1(x - 34)}' y2='46' stroke-width='5' stroke='`, D(`IF(Uma && Atual >= ${i + 1}, ${daxText("#27AE60")}, ${daxText("#2A3A55")})`), "'/>");
    const fill = D(`IF(Uma, IF(Atual > ${i + 1}, ${daxText("#27AE60")}, IF(Atual = ${i + 1}, IF(Atrasado, ${daxText("#D94B4B")}, ${daxText(STATE[s.key]?.shades[1] || "#2F80ED")}), ${daxText("#1C2A40")})), ${daxText(STATE[s.key]?.shades[1] || "#27AE60")})`);
    parts.push(`<circle cx='${r1(x)}' cy='46' r='34' fill='`, fill, "'/>");
    parts.push(when(`Uma && Atual = ${i + 1}`, `<circle cx='${r1(x)}' cy='46' r='42' fill='none' stroke='#FFFFFF' stroke-width='2' opacity='0.6'/>`));
    parts.push(`<text x='${r1(x)}' y='55' text-anchor='middle' fill='#FFFFFF' ${FONT} font-size='25' font-weight='700'>`, D(`IF(Uma, IF(Atual > ${i + 1}, "✓", "${i + 1}"), FORMAT(CALCULATE(COUNTROWS(${q(F)}), ${h.status} IN ${list(s.values)}) + 0, "#,0"))`), "</text>");
    const anchor = i === 0 ? "start" : i === stages.length - 1 ? "end" : "middle";
    const lx = i === 0 ? x - 40 : i === stages.length - 1 ? x + 40 : x;
    parts.push(`<text x='${r1(lx)}' y='122' text-anchor='${anchor}' fill='#C9D3E3' ${FONT} font-size='22'>${xml(s.values[0])}</text>`);
  });
  const order = [flow.date ? `${col(F, flow.date)}, DESC` : null, flow.id ? `${col(F, flow.id)}, DESC` : null].filter(Boolean).join(", ");
  return [
    `VAR Uma = ${one}`,
    `VAR Linha = ${order ? `TOPN(1, ${q(F)}, ${order})` : q(F)}`,
    `VAR Atual = MAXX(Linha, ${h.rankOf})`,
    `VAR Atrasado = MAXX(Linha, IF(NOT ${h.status} IN ${list(flow.done)} && ${h.late}, 1, 0)) = 1`,
    `RETURN ${daxText(URL_HEAD)} & ${daxText(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${W} ${H}'>`)} & ${joinDax(parts)} & "</svg>"`,
  ].join("\n");
}

// ---- Progress bar (one per row of a table) --------------------------------------------------------

/** How far along the latest active record in the row is: a bar and the percentage. */
export function progressBar(flow) {
  const h = helpers(flow);
  const F = flow.fact;
  const order = [flow.date ? `${col(F, flow.date)}, DESC` : null, flow.id ? `${col(F, flow.id)}, DESC` : null].filter(Boolean).join(", ");
  const bar = [
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 24'><rect x='0' y='8' width='150' height='9' rx='4.5' fill='#22324D'/><rect x='0' y='8' height='9' rx='4.5' width='",
    D("INT(150 * Pct)"), "' fill='", D(`IF(Atrasado, ${daxText("#D94B4B")}, ${daxText("#2F80ED")})`), "'/>",
    `<text x='158' y='17' fill='#C9D3E3' ${FONT} font-size='12'>`, D("FORMAT(Pct * 100, \"0\")"), "%</text></svg>",
  ];
  return [
    `VAR Linha = ${order ? `TOPN(1, ${h.active}, ${order})` : h.active}`,
    `VAR Etapa = MAXX(Linha, ${h.rankOf})`,
    `VAR Pct = DIVIDE(Etapa, ${h.maxRank})`,
    `VAR Atrasado = MAXX(Linha, IF(${h.late}, 1, 0)) = 1`,
    `RETURN IF(ISBLANK(Etapa), BLANK(), ${daxText(URL_HEAD)} & ${joinDax(bar)})`,
  ].join("\n");
}

// ---- Detail card ----------------------------------------------------------------------------------

/** The selected vehicle (or order): its name big, then its details; with none selected, how to pick. */
export function detailCard(flow, { pick = "Escolha um item na tabela ou no filtro" } = {}) {
  const F = flow.fact;
  const key = flow.asset || flow.id;
  const order = [flow.date ? `${col(F, flow.date)}, DESC` : null, flow.id ? `${col(F, flow.id)}, DESC` : null].filter(Boolean).join(", ");
  const h = helpers(flow);
  const rows = flow.details.slice(0, 5);
  // The record in progress, or the last one when none is (a table cannot come out of an IF in DAX).
  const pickValue = (expr) => `IF(TemAtiva, MAXX(Ativa, ${expr}), MAXX(Ultima, ${expr}))`;
  const value = (d) => (d.date ? `FORMAT(${pickValue(col(F, d.column))}, "dd/mm/yyyy")` : pickValue(col(F, d.column)));
  // The name and its stage on top; the details in two columns (the card is wide and short).
  const body = [
    `<text x='20' y='50' fill='#FFFFFF' ${FONT} font-size='44' font-weight='700'>`, D(safe(`SELECTEDVALUE(${col(F, key)})`)), "</text>",
    "<rect x='300' y='20' rx='15' height='34' width='", D("24 + 12 * LEN(Etapa & IF(Atrasado, \" · atrasado\", \"\"))"), "' fill='", D(`IF(Atrasado, ${daxText("#D94B4B")}, ${daxText("#2F6FDB")})`), "'/>",
    `<text x='312' y='44' fill='#FFFFFF' ${FONT} font-size='21' font-weight='600'>`, D(safe("Etapa & IF(Atrasado, \" · atrasado\", \"\")")), "</text>",
    ...rows.map((d, i) => {
      const x = 20 + (i % 2) * 310; const y = 104 + Math.floor(i / 2) * 64;
      return [
        `<text x='${x}' y='${y}' fill='#8FA3BF' ${FONT} font-size='19'>${xml(d.label)}</text>`,
        `<text x='${x}' y='${y + 28}' fill='#E8EDF5' ${FONT} font-size='24' font-weight='600'>`, D(safe(`LEFT(${value(d)}, 22)`)), "</text>",
      ];
    }),
  ];
  const empty = [
    `<text x='20' y='54' fill='#C9D3E3' ${FONT} font-size='30' font-weight='600'>${xml(pick)}</text>`,
    `<text x='20' y='96' fill='#8FA3BF' ${FONT} font-size='22'>para ver os detalhes e a etapa de cada um.</text>`,
  ];
  const height = 104 + Math.ceil(rows.length / 2) * 64 - 20;
  return [
    `VAR Uma = HASONEVALUE(${col(F, key)})`,
    `VAR Ativa = ${order ? `TOPN(1, ${h.active}, ${order})` : h.active}`,
    `VAR Ultima = ${order ? `TOPN(1, ${q(F)}, ${order})` : q(F)}`,
    "VAR TemAtiva = COUNTROWS(Ativa) > 0",
    `VAR Etapa = ${pickValue(h.status)} & ""`,
    `VAR Atrasado = TemAtiva && MAXX(Ativa, IF(${h.late}, 1, 0)) = 1`,
    // The hint alone in a short frame, so it reads as large as the details.
    `RETURN ${daxText(URL_HEAD)} & IF(Uma, ${daxText(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 ${height}'>`)} & ${joinDax(body)}, ${daxText("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 124'>")} & ${joinDax(empty)}) & "</svg>"`,
  ].join("\n");
}
