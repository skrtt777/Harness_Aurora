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

// ---- Looks: the same scene by night (dark control room) or by day (a light render, white and blue) ------

export const LOOKS = {
  noite: { ground: "#0F1B2D", grid: "#15253B", yard: "#13233A", road: "#1A2638", roadLine: "#C9D3E3", spot: "#2C3E5A", walls: ["#2B3A55", "#22324D", "#1A263B"], stripe: "#3A4D6E", roofText: "#DCE6F5", door: "#0B1322", chassis: "#0A0F18", cab: ["#E8EDF5", "#B8C2D3", "#95A1B6"], glass: "#1E2A3F", text: "#C9D3E3", strong: "#FFFFFF", plate: "#0B1322", plateText: "#FFFFFF", tree: ["#1F5C45", "#174A37"], trunk: "#3B4A63", fence: "#2C3E5A", queue: "#F6D365", transit: "#C3A6FA", late: "#FF8A8A", pin: "#4F9BFF" },
  dia: { ground: "#E9EFF8", grid: "#DCE5F2", yard: "#DDE6F3", road: "#C3CEDD", roadLine: "#FFFFFF", spot: "#AFC0D6", walls: ["#F4F7FC", "#E2E9F4", "#C9D5E8"], stripe: "#2F6FDB", roofText: "#2F6FDB", door: "#34425A", chassis: "#5B6B85", cab: ["#FFFFFF", "#E3EAF5", "#C5D1E3"], glass: "#2F3E57", text: "#3B4A63", strong: "#1B2A4A", plate: "#FFFFFF", plateText: "#1B2A4A", tree: ["#7CC9A0", "#5DB487"], trunk: "#8C9BB0", fence: "#B8C6DA", queue: "#B98A22", transit: "#7A4FD6", late: "#D94B4B", pin: "#2F6FDB" },
};
const lookOf = (name) => LOOKS[name] || LOOKS.noite;

/** A tree: trunk and a round top, at world (X, Y). */
function tree(cv, X, Y, L, size = 1) {
  const [bx, by] = cv.at(X, Y, 0);
  const [tx, ty] = cv.at(X, Y, 34 * size);
  return [`<line x1='${bx}' y1='${by}' x2='${tx}' y2='${ty}' stroke='${L.trunk}' stroke-width='4'/>`, `<ellipse cx='${tx}' cy='${r1(Number(ty) - 8 * size)}' rx='${r1(17 * size)}' ry='${r1(19 * size)}' fill='${L.tree[0]}'/>`, `<ellipse cx='${r1(Number(tx) + 4 * size)}' cy='${r1(Number(ty) - 4 * size)}' rx='${r1(9 * size)}' ry='${r1(11 * size)}' fill='${L.tree[1]}' opacity='0.7'/>`];
}

/**
 * The live badge: "AO VIVO · atualizado às 14:32", amber when the data is older than the limit (the
 * Aurora refreshes the open report; minutes = how late it may be). stamp: DAX of the last refresh.
 */
export function liveBadge(stamp, x, y, L, minutes = 10) {
  return [
    `<g ${FONT}><rect x='${r1(x)}' y='${r1(y)}' width='300' height='38' rx='19' fill='${L.plate}' opacity='0.92'/>`,
    `<circle cx='${r1(x + 22)}' cy='${r1(y + 19)}' r='7' fill='`, D(`IF(ISBLANK(${stamp}) || NOW() - ${stamp} > ${minutes} / 1440, ${daxText("#E8A33D")}, ${daxText("#3DDC97")})`), "'><animate attributeName='opacity' values='1;0.25;1' dur='1.6s' repeatCount='indefinite'/></circle>",
    `<text x='${r1(x + 38)}' y='${r1(y + 25)}' fill='${L.strong}' font-size='16' font-weight='700'>`, D(`IF(ISBLANK(${stamp}), "SEM ATUALIZAÇÃO", IF(NOW() - ${stamp} > ${minutes} / 1440, "DESATUALIZADO", "AO VIVO") & " · " & FORMAT(${stamp}, "dd/mm HH:nn"))`), "</text></g>",
  ];
}

// ---- The distribution centre ----------------------------------------------------------------------

/**
 * The yard of a distribution centre (or any place with bays and vehicles), isometric: the building with
 * one door per bay (up to 10), the vehicle at each bay coloured by its stage (red when late), pallets
 * going in while it loads, the queue, the road with the vehicles leaving (moving), trees and a fence;
 * by night or by day. With a unit column (CD, filial) it shows one unit: the one chosen, or the first.
 * Returns { dax, points } — points: the DAX of each bay's position, for a scatter laid over the picture
 * (a click on a bay filters the page).
 */
export function yardScene(flow, { title = "Centro de distribuição", slots = 10, look = "noite", stamp = null } = {}) {
  const L = lookOf(look);
  const h = helpers(flow);
  const F = flow.fact;
  const place = col(F, flow.place);
  const site = flow.site ? col(F, flow.site) : null;
  const cv = new Canvas();
  const LEN = 600; const DEPTH = 200; const HEIGHT = 112;
  const parts = [];
  // Ground, grid, the yard, the road, the parking: the floor runs past the frame.
  cv.quiet = true;
  parts.push(cv.poly([[-120, -60, 0], [880, -60, 0], [880, 640, 0], [-120, 640, 0]], L.ground));
  for (let g = 40; g <= 800; g += 95) parts.push(`<polyline points='${cv.pts([[g, -60, 0], [g, 640, 0]])}' stroke='${L.grid}' stroke-width='1' fill='none'/>`);
  for (let g = 50; g <= 600; g += 90) parts.push(`<polyline points='${cv.pts([[-120, g, 0], [880, g, 0]])}' stroke='${L.grid}' stroke-width='1' fill='none'/>`);
  parts.push(cv.poly([[0, DEPTH, 0], [LEN, DEPTH, 0], [LEN, 420, 0], [0, 420, 0]], L.yard));
  parts.push(cv.poly([[690, -60, 0], [790, -60, 0], [790, 640, 0], [690, 640, 0]], L.road));
  parts.push(`<polyline points='${cv.pts([[740, -60, 0], [740, 640, 0]])}' stroke='${L.roadLine}' stroke-width='3' stroke-dasharray='14 12' fill='none' opacity='0.7'/>`);
  const SPOTS = 5;
  for (let j = 0; j < SPOTS; j += 1) parts.push(cv.poly([[20 + j * 82, 400, 0], [84 + j * 82, 400, 0], [84 + j * 82, 530, 0], [20 + j * 82, 530, 0]], "none", ` stroke='${L.spot}' stroke-width='1.5'`));
  // The fence around the yard, and trees along it.
  parts.push(`<polyline points='${cv.pts([[-90, -40, 0], [-90, 600, 0], [660, 600, 0]])}' stroke='${L.fence}' stroke-width='2.5' fill='none'/>`);
  cv.quiet = false;
  for (const [X, Y] of [[-60, 40], [-60, 160], [-60, 300], [-60, 470], [120, 590], [330, 590], [560, 590], [640, -20], [820, 120], [820, 420]]) parts.push(tree(cv, X, Y, L, 0.9));
  // The building.
  parts.push(cv.box(0, 0, 0, LEN, DEPTH, HEIGHT, L.walls));
  for (let r = 26; r < 100; r += 30) parts.push(`<polyline points='${cv.pts([[16, r, HEIGHT], [LEN - 16, r, HEIGHT]])}' stroke='${L.stripe}' stroke-width='5' fill='none' opacity='${look === "dia" ? 0.35 : 1}'/>`);
  const [wx, wy] = cv.at(30, 168, HEIGHT);
  parts.push(`<text transform='matrix(${r1(COS)},0.5,${r1(-COS)},0.5,${wx},${wy})' fill='${L.roofText}' ${FONT} font-size='34' font-weight='700' letter-spacing='3'>`, site ? D(safe("UPPER(LEFT(Unidade, 30))")) : xml(title.toUpperCase().slice(0, 30)), "</text>");

  // Bays.
  const n = Math.max(1, Math.min(slots, flow.placeCount || slots));
  const w = (LEN - 40) / n;
  const tw = Math.min(w * 0.62, 46);
  const fragments = [];
  const points = [];
  for (let k = 0; k < n; k += 1) {
    const cx = 20 + k * w + w / 2;
    const frag = [];
    frag.push(cv.poly([[cx - tw / 2 - 4, DEPTH, 0], [cx + tw / 2 + 4, DEPTH, 0], [cx + tw / 2 + 4, DEPTH, 66], [cx - tw / 2 - 4, DEPTH, 66]], D(`IF([@k] = "livre", ${daxText("#27AE60")}, ${daxText(L.door)})`)));
    const truck = [
      cv.box(cx - tw / 2, DEPTH + 10, 0, tw, 150, 9, [L.chassis, L.chassis, L.chassis]),
      cv.box(cx - tw / 2, DEPTH + 10, 9, tw, 118, 52, [shade("[@k]", 0), shade("[@k]", 1), shade("[@k]", 2)]),
      cv.box(cx - tw / 2 + 2, DEPTH + 132, 9, tw - 4, 30, 40, L.cab),
      cv.poly([[cx - tw / 2 + 4, DEPTH + 162, 30], [cx + tw / 2 - 6, DEPTH + 162, 30], [cx + tw / 2 - 6, DEPTH + 162, 44], [cx - tw / 2 + 4, DEPTH + 162, 44]], L.glass),
    ];
    // Loading: a pallet goes from the door into the trailer, again and again.
    const [p0x, p0y] = cv.at(cx, DEPTH - 6, 12); const [p1x, p1y] = cv.at(cx, DEPTH + 40, 12);
    const pallet = when(`[@k] IN {"carregando", "separacao", "atraso"}`, [`<g><rect x='${r1(Number(p0x) - 9)}' y='${r1(Number(p0y) - 9)}' width='18' height='14' rx='2' fill='#C99A5B'/><animateTransform attributeName='transform' type='translate' values='0 0; ${r1(Number(p1x) - Number(p0x))} ${r1(Number(p1y) - Number(p0y))}' dur='${(2.4 + (k % 3) * 0.5).toFixed(1)}s' repeatCount='indefinite'/><animate attributeName='opacity' values='0;1;1;0' dur='${(2.4 + (k % 3) * 0.5).toFixed(1)}s' repeatCount='indefinite'/></g>`]);
    const [px, py] = cv.at(cx, DEPTH + 60, 61);
    const plate = [
      `<rect x='${r1(Number(px) - 46)}' y='${r1(Number(py) - 34)}' width='92' height='26' rx='13' fill='${L.plate}' stroke='`, shade("[@k]", 0), "' stroke-width='2'/>",
      `<text x='${px}' y='${r1(Number(py) - 15)}' text-anchor='middle' fill='${L.plateText}' ${FONT} font-size='16' font-weight='700'>`, D(safe("LEFT([@placa], 9)")), "</text>",
    ];
    frag.push(when("[@k] <> \"livre\"", ["<g opacity='", D("IF([@sel] = 1, \"1\", \"0.22\")"), "'>", truck, pallet, plate, "</g>"]));
    // The chosen bay: a ring on the ground.
    const [gx, gy] = cv.at(cx, DEPTH + 90, 0);
    frag.push(when("Filtrado && [@sel] = 1 && [@k] <> \"livre\"", [`<ellipse cx='${gx}' cy='${gy}' rx='70' ry='40' fill='none' stroke='${L.pin}' stroke-width='4'><animate attributeName='stroke-opacity' values='1;0.3;1' dur='1.4s' repeatCount='indefinite'/></ellipse>`]));
    const [nx, ny] = cv.at(cx - tw / 2 - 4, DEPTH, 76);
    frag.push(`<text transform='matrix(${r1(COS)},0.5,0,1,${nx},${ny})' fill='${L.text}' ${FONT} font-size='15' font-weight='600'>`, D(safe(`LEFT(${place}, 10)`)), "</text>");
    fragments.push(`${k + 1}, ${joinDax(frag)}`);
    points.push([k + 1, Number(gx), Number(gy)]);
  }

  // The queue.
  const queue = [];
  for (let j = 0; j < SPOTS; j += 1) {
    const x = 20 + j * 82 + 16;
    queue.push(when(`nFila >= ${j + 1}`, ["<g opacity='", D(`IF(nFilaSel >= ${j + 1}, "1", "0.22")`), "'>",
      cv.box(x, 410, 0, 32, 112, 7, [L.chassis, L.chassis, L.chassis]),
      cv.box(x, 410, 7, 32, 84, 40, STATE.fila.shades),
      cv.box(x + 2, 496, 7, 28, 24, 32, L.cab),
    "</g>"]));
  }
  const [qx, qy] = cv.at(0, 440, 0);
  cv.see(Number(qx) - 150, Number(qy));
  queue.push(`<text x='${r1(Number(qx) - 16)}' y='${r1(Number(qy) + 8)}' text-anchor='end' fill='${L.queue}' ${FONT} font-size='26' font-weight='700'>`, D("FORMAT(nFila, \"0\")"), ` ${flow.queueLabel || "na fila"}</text>`);

  // The road: the vehicles in transit drive away, one after the other (a loop), red when late.
  const road = [];
  const [s0x, s0y] = cv.at(700, 560, 0); const [s1x, s1y] = cv.at(700, -40, 0);
  const dx = r1(Number(s1x) - Number(s0x)); const dy = r1(Number(s1y) - Number(s0y));
  for (let j = 0; j < 3; j += 1) {
    const late = `IF(nAtrasoTransito >= ${j + 1}, "atraso", "transito")`;
    road.push(when(`nTransito >= ${j + 1}`, [`<g opacity='`, D(`IF(nTransitoSel >= ${j + 1}, "1", "0.22")`), "'><g>",
      `<animateTransform attributeName='transform' type='translate' values='0 0; ${dx} ${dy}' dur='12s' begin='-${j * 4}s' repeatCount='indefinite'/>`,
      `<animate attributeName='opacity' values='0;1;1;1;0' dur='12s' begin='-${j * 4}s' repeatCount='indefinite'/>`,
      cv.box(700, 520, 0, 34, 118, 7, [L.chassis, L.chassis, L.chassis]),
      cv.box(700, 550, 7, 34, 88, 42, [shade(late, 0), shade(late, 1), shade(late, 2)]),
      cv.box(702, 520, 7, 30, 28, 34, L.cab),
    "</g></g>"]));
  }
  const [rx, ry] = cv.at(800, -30, 0);
  cv.see(Number(rx) + 230, Number(ry) + 40);
  road.push(
    `<text x='${r1(Number(rx) + 10)}' y='${r1(Number(ry) + 6)}' fill='${L.transit}' ${FONT} font-size='26' font-weight='700'>`, D("FORMAT(nTransito, \"0\")"), ` ${flow.transitLabel || "em trânsito"}</text>`,
    when("nAtrasoTransito > 0", [`<text x='${r1(Number(rx) + 10)}' y='${r1(Number(ry) + 36)}' fill='${L.late}' ${FONT} font-size='21'>`, D("FORMAT(nAtrasoTransito, \"0\")"), " com atraso</text>"]),
  );

  // Legend top left; the live badge top right.
  const vb = { x: cv.minX - 16, y: cv.minY - 16, w: cv.maxX - cv.minX + 32, h: cv.maxY - cv.minY + 32 };
  const legend = [];
  const legendKeys = [...flow.stages.filter((s) => s.key !== "concluido").map((s) => [s.key, s.values[0]]), ["atraso", "Atrasado"], ["livre", `${flow.place} livre`]];
  legendKeys.forEach(([key, text], i) => {
    const lx = vb.x + 24; const ly = vb.y + 34 + i * 32;
    legend.push(`<rect x='${r1(lx)}' y='${r1(ly - 16)}' width='20' height='20' rx='10' fill='${STATE[key]?.shades[1] || "#6B7A90"}'/>`);
    legend.push(`<text x='${r1(lx + 30)}' y='${r1(ly + 1)}' fill='${L.text}' ${FONT} font-size='20'>${xml(text)}</text>`);
  });
  if (stamp) legend.push(liveBadge(stamp, vb.x + vb.w - 320, vb.y + 14, L));
  // All units in view: the first one is drawn, and the scene says how to pick another.
  if (site) legend.push(when(`NOT HASONEVALUE(${site})`, [`<text x='${r1(vb.x + vb.w - 20)}' y='${r1(vb.y + 76)}' text-anchor='end' fill='${L.text}' ${FONT} font-size='17'>`, D(safe(`Unidade & " · escolha outra no filtro ${flow.site.replace(/"/g, "")}"`)), "</text>"]));

  const order = [flow.date ? `${col(F, flow.date)}, DESC` : null, flow.id ? `${col(F, flow.id)}, DESC` : null].filter(Boolean).join(", ");
  const top1 = (t) => (order ? `TOPN(1, ${t}, ${order})` : t);
  const selected = flow.id || flow.asset;
  const fila = `FILTER(Ativos, ${h.status} IN ${list(h.valuesOf(["fila"]))})`;
  const lit = (t) => (selected ? `FILTER(${t}, ${col(F, selected)} IN Visiveis)` : t);
  // The unit shown: the one chosen in the switcher, or the first one.
  const unitVars = site ? [`VAR Unidade = IF(HASONEVALUE(${site}), VALUES(${site}), CALCULATE(MIN(${site}), ALL(${site})))`, `VAR Base = FILTER(ALL(${q(F)}), ${site} = Unidade)`] : [`VAR Base = ALL(${q(F)})`];
  const docks = site ? `CALCULATETABLE(VALUES(${place}), ${site} = Unidade, REMOVEFILTERS(${q(F)}))` : `ALL(${place})`;
  const dax = [
    ...unitVars,
    `VAR Ativos = FILTER(Base, NOT ISBLANK(${h.status}) && NOT ${h.status} IN ${list(flow.done)})`,
    `VAR Visiveis = ${selected ? `VALUES(${col(F, selected)})` : `{ BLANK() }`}`,
    `VAR Filtrado = ${selected ? `ISCROSSFILTERED(${col(F, selected)})` : "FALSE()"}`,
    `VAR NaDoca = FILTER(Ativos, ${h.status} IN ${list(h.atDock)} && NOT ISBLANK(${place}))`,
    `VAR nFila = ${h.count(fila)} + 0`,
    `VAR nFilaSel = IF(Filtrado, ${h.count(lit(fila))} + 0, nFila)`,
    `VAR Transito = FILTER(Ativos, ${h.status} IN ${list(h.valuesOf(["transito"]))})`,
    `VAR nTransito = ${h.count("Transito")} + 0`,
    `VAR nTransitoSel = IF(Filtrado, ${h.count(lit("Transito"))} + 0, nTransito)`,
    `VAR nAtrasoTransito = ${h.count(`FILTER(Transito, ${h.late})`)} + 0`,
    `VAR Docas = TOPN(${n}, FILTER(${docks}, NOT ISBLANK(${place}) && ${place} <> ""), ${place}, ASC)`,
    `VAR Slots0 = ADDCOLUMNS(Docas, "@i", VAR d = ${place} RETURN COUNTROWS(FILTER(Docas, ${place} <= d)))`,
    `VAR Slots1 = ADDCOLUMNS(Slots0, "@placa", VAR d = ${place} RETURN MAXX(${top1(`FILTER(NaDoca, ${place} = d)`)}, ${h.label}), "@etapa", VAR d = ${place} RETURN MAXX(${top1(`FILTER(NaDoca, ${place} = d)`)}, ${h.status}), "@atraso", VAR d = ${place} RETURN MAXX(${top1(`FILTER(NaDoca, ${place} = d)`)}, IF(${h.late}, 1, 0)), "@id", VAR d = ${place} RETURN MAXX(${top1(`FILTER(NaDoca, ${place} = d)`)}, ${selected ? col(F, selected) : "BLANK()"}))`,
    `VAR Slots = ADDCOLUMNS(Slots1, "@k", IF(ISBLANK([@etapa]), "livre", IF([@atraso] = 1, "atraso", ${h.keyOf("[@etapa]")})), "@sel", IF(NOT Filtrado || [@id] IN Visiveis, 1, 0))`,
    // preserveAspectRatio none: the picture fills its box exactly, so a scatter over it lines up.
    `RETURN ${daxText(URL_HEAD)} & ${daxText(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='${r1(vb.x)} ${r1(vb.y)} ${r1(vb.w)} ${r1(vb.h)}' preserveAspectRatio='none'>`)}`,
    `  & ${joinDax(parts)}`,
    `  & CONCATENATEX(Slots, SWITCH([@i], ${fragments.join(",\n    ")}, ""), "", [@i], ASC)`,
    `  & ${joinDax(queue)}`,
    `  & ${joinDax(road)}`,
    `  & ${joinDax(legend)}`,
    "  & \"</svg>\"",
  ].join("\n");
  // Each bay's position in the picture (0..w, 0..h from the bottom), for the scatter laid over it.
  const index = [
    ...unitVars.slice(0, 1),
    `VAR Docas = TOPN(${n}, FILTER(${docks}, NOT ISBLANK(${place}) && ${place} <> ""), ${place}, ASC)`,
    `VAR d = SELECTEDVALUE(${place})`,
    "VAR i = IF(ISBLANK(d) || NOT d IN Docas, 0, COUNTROWS(FILTER(Docas, " + place + " <= d)))",
  ].join("\n");
  const pointX = `${index}\nRETURN SWITCH(i, ${points.map(([i, x]) => `${i}, ${r1(x - vb.x)}`).join(", ")}, BLANK())`;
  const pointY = `${index}\nRETURN SWITCH(i, ${points.map(([i, , y]) => `${i}, ${r1(vb.h - (y - vb.y))}`).join(", ")}, BLANK())`;
  return { dax, points: { category: place, x: pointX, y: pointY, w: r1(vb.w), h: r1(vb.h) } };
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

// ---- Rising boxes: a height that comes from the data ----------------------------------------------

/**
 * A box rising from the ground by h (a DAX integer expression, up to maxH units): the sides and the top
 * follow h. Coordinates that depend on it pass through INT() — a pt-BR model writes "123,5" otherwise.
 */
function rising(cv, X, Y, dx, dy, h, maxH, fills, extra = "") {
  const x1 = X + dx; const y1 = Y + dy;
  const flat = (x, y) => cv.at(x, y, 0).join(",");
  cv.at(X, Y, maxH); cv.at(x1, Y, maxH);
  const up = (x, y) => { const [sx, sy] = cv.at(x, y, 0); return [`${sx},`, D(`INT(${sy} - (${h}))`)]; };
  const poly = (points, fill) => ["<polygon points='", points.flatMap((p, i) => [i ? " " : "", p]), "' fill='", fill, `'${extra}/>`];
  return [
    poly([flat(X, y1), flat(x1, y1), up(x1, y1), up(X, y1)], fills[1]),
    poly([flat(x1, Y), flat(x1, y1), up(x1, y1), up(x1, Y)], fills[2]),
    poly([up(X, Y), up(x1, Y), up(x1, y1), up(X, y1)], fills[0]),
  ];
}
const svgOpen = (vb) => `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${r1(vb.x)} ${r1(vb.y)} ${r1(vb.w)} ${r1(vb.h)}'>`;
const frame = (cv, pad = 16, extraBottom = 0) => ({ x: cv.minX - pad, y: cv.minY - pad, w: cv.maxX - cv.minX + pad * 2, h: cv.maxY - cv.minY + pad * 2 + extraBottom });

// ---- A city of the items (any domain: stores, products, cost centres, sellers) --------------------

const PALETTE = [["#6EA8FF", "#2F6FDB", "#2257B0"], ["#7FD3F7", "#4BAFD9", "#2E8FB8"], ["#C3A6FA", "#8E66D9", "#6E48B8"], ["#F6D365", "#D9A93A", "#B98A22"], ["#3DDC97", "#27AE60", "#1E8C4D"]];
const UP = ["#3DDC97", "#27AE60", "#1E8C4D"];
const DOWN = ["#FF8A8A", "#D94B4B", "#B33636"];

/**
 * The top items of a column as buildings: the height is the measure, the colour the trend (last year of
 * the data against the one before: green up, red down) or the rank. Clicking an item elsewhere lights it.
 * spec: { column: "'Vendas'[Loja]", measure: "[Faturamento]", format: "\"R$\" #,0", year?: "'Calendário'[Ano]", slots? }
 */
export function cityScene(spec) {
  const { column, measure, format = "#,0", year = null, look = "noite" } = spec;
  const L = lookOf(look);
  const n = Math.max(1, Math.min(spec.slots || 10, 10));
  // A row runs across the screen (X up, Y down): a wide panel gets a wide city; more than 6, two rows.
  const cols = n <= 6 ? n : Math.ceil(n / 2);
  const cv = new Canvas();
  const FOOT = 100; const STEP_X = 175; const STEP_Y = 210; const H = 300;
  const parts = [];
  cv.quiet = true;
  const rows = n > cols ? 2 : 1;
  const at = (k) => { const c = k % cols; const r = Math.floor(k / cols); return [c * STEP_X + r * STEP_Y, -c * STEP_X + r * STEP_Y]; };
  const [x0] = at(0); const [xl, yl] = at(cols - 1); const [, yr] = at((rows - 1) * cols);
  parts.push(cv.poly([[x0 - 70, -70, 0], [xl + FOOT + 70, yl - 70, 0], [xl + FOOT + 70 + (rows - 1) * STEP_Y, yl + FOOT + 70 + (rows - 1) * STEP_Y, 0], [x0 - 70 + (rows - 1) * STEP_Y, yr + FOOT + 70, 0]], L.ground));
  cv.quiet = false;
  const slots = [];
  const points = [];
  for (let k = 0; k < n; k += 1) {
    const [X, Y] = at(k);
    const colour = (i) => D(year ? `IF(ISBLANK([@p]) || ISBLANK([@a]), ${daxText(PALETTE[0][i])}, IF([@a] >= [@p], ${daxText(UP[i])}, ${daxText(DOWN[i])}))` : `SWITCH(TRUE(), [@i] <= 1, ${daxText(PALETTE[0][i])}, [@i] <= 3, ${daxText(PALETTE[1][i])}, ${daxText(PALETTE[2][i])})`);
    const h = `MAX(6, INT(${H} * DIVIDE([@v], Mx)))`;
    const frag = [cv.poly([[X - 14, Y - 14, 0], [X + FOOT + 14, Y - 14, 0], [X + FOOT + 14, Y + FOOT + 14, 0], [X - 14, Y + FOOT + 14, 0]], L.yard)];
    frag.push("<g opacity='", D("IF([@sel] = 1, \"1\", \"0.22\")"), "'>");
    frag.push(rising(cv, X, Y, FOOT, FOOT, h, H, [colour(0), colour(1), colour(2)]));
    // Windows: a few lit rows on the front faces, as high as the building goes.
    const [tx, ty] = cv.at(X + FOOT / 2, Y + FOOT / 2, 0);
    cv.see(Number(tx), Number(ty) - H - 80);
    frag.push(`<text x='${tx}' text-anchor='middle' fill='${L.strong}' ${FONT} font-size='22' font-weight='700' y='`, D(`INT(${ty} - (${h}) - 18)`), "'>", D(safe(`FORMAT([@v], "${format.replace(/"/g, "\"\"")}")`)), "</text>");
    if (year) frag.push(`<text x='${tx}' text-anchor='middle' ${FONT} font-size='17' y='`, D(`INT(${ty} - (${h}) - 44)`), "' fill='", D(`IF([@a] >= [@p], ${daxText("#3DDC97")}, ${daxText("#FF8A8A")})`), "'>", D(`IF(ISBLANK([@p]) || ISBLANK([@a]), "", IF([@a] >= [@p], "▲ ", "▼ ") & ${safe("FORMAT(ABS(DIVIDE([@a] - [@p], [@p])), \"0%\")")})`), "</text>");
    frag.push("</g>");
    const [lx, ly] = cv.at(X + FOOT + 14, Y + FOOT + 14, 0);
    cv.see(Number(lx) + 10, Number(ly) + 40);
    frag.push(`<text x='${r1(Number(lx) - 70)}' y='${r1(Number(ly) + 6)}' text-anchor='middle' fill='${L.text}' ${FONT} font-size='19' font-weight='600'>`, D(safe(`LEFT(${column}, 18)`)), "</text>");
    const [cxp, cyp] = cv.at(X + FOOT / 2, Y + FOOT / 2, 0);
    points.push([k + 1, Number(cxp), Number(cyp)]);
    slots.push(`${k + 1}, ${joinDax(frag)}`);
  }
  const vb = frame(cv, 20);
  const lastYear = year ? [
    `VAR AnoAtual = CALCULATE(MAX(${year}), ALLSELECTED())`,
  ] : [];
  const dax = [
    ...lastYear,
    `VAR Base = CALCULATETABLE(ADDCOLUMNS(VALUES(${column}), "@v", ${measure}), REMOVEFILTERS(${column}))`,
    `VAR Itens = TOPN(${n}, FILTER(Base, NOT ISBLANK([@v]) && [@v] > 0), [@v], DESC, ${column}, ASC)`,
    "VAR Mx = MAXX(Itens, [@v])",
    `VAR Visiveis = VALUES(${column})`,
    `VAR Filtrado = ISFILTERED(${column})`,
    `VAR S0 = ADDCOLUMNS(Itens, "@i", VAR v = [@v] VAR c = ${column} RETURN COUNTROWS(FILTER(Itens, [@v] > v || ([@v] = v && ${column} < c))) + 1, "@sel", IF(NOT Filtrado || ${column} IN Visiveis, 1, 0))`,
    year
      ? `VAR S = ADDCOLUMNS(S0, "@a", CALCULATE(${measure}, REMOVEFILTERS(${year}), ${year} = AnoAtual), "@p", CALCULATE(${measure}, REMOVEFILTERS(${year}), ${year} = AnoAtual - 1))`
      : "VAR S = S0",
    `RETURN ${daxText(URL_HEAD)} & ${daxText(svgOpen(vb).replace("'>", "' preserveAspectRatio='none'>"))} & ${joinDax(parts)}`,
    `  & CONCATENATEX(S, SWITCH([@i], ${slots.join(",\n    ")}, ""), "", [@i], ASC)`,
    "  & \"</svg>\"",
  ].join("\n");
  // Each item's position in the picture, for the scatter laid over it (a click on a building filters).
  const index = [
    "VAR c = SELECTEDVALUE(" + column + ")",
    `VAR Base = CALCULATETABLE(ADDCOLUMNS(VALUES(${column}), "@v", ${measure}), REMOVEFILTERS(${column}))`,
    `VAR Itens = TOPN(${n}, FILTER(Base, NOT ISBLANK([@v]) && [@v] > 0), [@v], DESC, ${column}, ASC)`,
    `VAR v = MAXX(FILTER(Itens, ${column} = c), [@v])`,
    `VAR i = IF(ISBLANK(v), 0, COUNTROWS(FILTER(Itens, [@v] > v || ([@v] = v && ${column} < c))) + 1)`,
  ].join("\n");
  return {
    dax,
    points: {
      category: column,
      x: `${index}\nRETURN SWITCH(i, ${points.map(([i, x]) => `${i}, ${r1(x - vb.x)}`).join(", ")}, BLANK())`,
      y: `${index}\nRETURN SWITCH(i, ${points.map(([i, , y]) => `${i}, ${r1(vb.h - (y - vb.y))}`).join(", ")}, BLANK())`,
      w: r1(vb.w), h: r1(vb.h),
    },
  };
}
// ---- Towers of a flow without a place (tickets, hiring, production orders) ------------------------

/**
 * One tower per open stage, as tall as how many are in it, the late ones as a red cap; the finished ones
 * as a flat green block at the end. With one item selected, its stage is outlined.
 */
export function stageTowers(flow) {
  const h = helpers(flow);
  const F = flow.fact;
  const open = flow.stages.filter((s) => s.key !== "concluido");
  const done = flow.stages.find((s) => s.key === "concluido");
  const cv = new Canvas();
  const W = 130; const GAP = 90; const H = 280;
  const parts = [];
  cv.quiet = true;
  parts.push(cv.poly([[-50, -50, 0], [(open.length + 1) * (W + GAP), -50, 0], [(open.length + 1) * (W + GAP), W + 90, 0], [-50, W + 90, 0]], "#0F1B2D"));
  cv.quiet = false;
  const one = [flow.asset, flow.id].filter(Boolean).map((c) => `HASONEVALUE(${col(F, c)})`).join(" || ") || "FALSE()";
  open.forEach((s, i) => {
    const X = i * (W + GAP);
    const nVar = `n${i}`; const lVar = `l${i}`;
    const tall = `MAX(4, INT(${H} * DIVIDE(${nVar}, Mx)))`;
    const red = `INT(${H} * DIVIDE(${lVar}, Mx))`;
    parts.push(cv.poly([[X - 12, -12, 0], [X + W + 12, -12, 0], [X + W + 12, W + 12, 0], [X - 12, W + 12, 0]], "#16263D"));
    parts.push(when(`${nVar} > 0`, rising(cv, X, 0, W, W, tall, H, STATE[s.key]?.shades || PALETTE[0])));
    // The red cap: the top part of the tower, as thick as the late share.
    parts.push(when(`${lVar} > 0`, capParts(cv, X, W, tall, red)));
    const [tx, ty] = cv.at(X + W / 2, W / 2, 0);
    parts.push(`<text x='${tx}' text-anchor='middle' fill='#FFFFFF' ${FONT} font-size='30' font-weight='700' y='`, D(`INT(${ty} - (${tall}) - 22)`), "'>", D(`FORMAT(${nVar}, "#,0")`), "</text>");
    parts.push(when(`${lVar} > 0`, [`<text x='${tx}' text-anchor='middle' fill='#FF8A8A' ${FONT} font-size='18' y='`, D(`INT(${ty} - (${tall}) - 54)`), "'>", D(`FORMAT(${lVar}, "#,0")`), " atrasados</text>"]));
    parts.push(when(`Uma && Atual = ${flow.stages.indexOf(s) + 1}`, [`<circle cx='${tx}' cy='${r1(Number(ty) + 8)}' r='96' fill='none' stroke='#FFFFFF' stroke-width='3' opacity='0.8'/>`]));
    const [lx, ly] = cv.at(X + W + 12, W + 12, 0);
    cv.see(Number(lx) + 20, Number(ly) + 44);
    parts.push(`<text x='${r1(Number(lx) - 60)}' y='${r1(Number(ly) + 14)}' text-anchor='middle' fill='#C9D3E3' ${FONT} font-size='21' font-weight='600'>${xml(s.values[0].slice(0, 20))}</text>`);
    if (i < open.length - 1 || done) {
      const [ax, ay] = cv.at(X + W + 22, W / 2, 0); const [bx, by] = cv.at(X + W + GAP - 22, W / 2, 0);
      parts.push(`<line x1='${ax}' y1='${ay}' x2='${bx}' y2='${by}' stroke='#3A4D6E' stroke-width='5' stroke-dasharray='10 8'/>`);
    }
  });
  if (done) {
    const X = open.length * (W + GAP);
    parts.push(cv.box(X, 0, 0, W, W, 26, STATE.livre.shades));
    const [tx, ty] = cv.at(X + W / 2, W / 2, 26);
    parts.push(`<text x='${tx}' y='${r1(Number(ty) - 30)}' text-anchor='middle' fill='#3DDC97' ${FONT} font-size='30' font-weight='700'>`, D("FORMAT(nFeitos, \"#,0\")"), "</text>");
    const [lx, ly] = cv.at(X + W + 12, W + 12, 0);
    cv.see(Number(lx) + 20, Number(ly) + 44);
    parts.push(`<text x='${r1(Number(lx) - 60)}' y='${r1(Number(ly) + 14)}' text-anchor='middle' fill='#C9D3E3' ${FONT} font-size='21' font-weight='600'>${xml(done.values[0].slice(0, 20))}</text>`);
  }
  const order = [flow.date ? `${col(F, flow.date)}, DESC` : null, flow.id ? `${col(F, flow.id)}, DESC` : null].filter(Boolean).join(", ");
  const vb = frame(cv, 20);
  return [
    `VAR Uma = ${one}`,
    `VAR Atual = MAXX(${order ? `TOPN(1, ${q(F)}, ${order})` : q(F)}, ${h.rankOf})`,
    ...open.flatMap((s, i) => [
      `VAR n${i} = CALCULATE(COUNTROWS(${q(F)}), ${h.status} IN ${list(s.values)}) + 0`,
      `VAR l${i} = ${flow.due ? `COUNTROWS(FILTER(CALCULATETABLE(${q(F)}, ${h.status} IN ${list(s.values)}), ${h.late})) + 0` : "0"}`,
    ]),
    `VAR Mx = MAX(1, ${open.map((_, i) => `n${i}`).reduce((a, b) => `MAX(${a}, ${b})`)})`,
    `VAR nFeitos = ${done ? `CALCULATE(COUNTROWS(${q(F)}), ${h.status} IN ${list(done.values)}) + 0` : "0"}`,
    `RETURN ${daxText(URL_HEAD)} & ${daxText(svgOpen(vb))} & ${joinDax(parts)} & "</svg>"`,
  ].join("\n");
}

/** The top slab of a tower, red, `red` units thick (the late ones). */
function capParts(cv, X, W, tall, red) {
  const x1 = X + W; const y1 = W;
  const at = (x, y, z) => { const [sx, sy] = cv.at(x, y, 0); return [`${sx},`, D(`INT(${sy} - (${z}))`)]; };
  const low = `MAX(0, (${tall}) - MAX(4, ${red}))`;
  const poly = (points, fill) => ["<polygon points='", points.flatMap((p, i) => [i ? " " : "", p]), `' fill='${fill}'/>`];
  return [
    poly([at(X, y1, low), at(x1, y1, low), at(x1, y1, tall), at(X, y1, tall)], STATE.atraso.shades[1]),
    poly([at(x1, 0, low), at(x1, y1, low), at(x1, y1, tall), at(x1, 0, tall)], STATE.atraso.shades[2]),
    poly([at(X, 0, tall), at(x1, 0, tall), at(x1, y1, tall), at(X, y1, tall)], STATE.atraso.shades[0]),
  ];
}

// ---- Where the money goes (finance) ---------------------------------------------------------------

/**
 * Money in by category on the left, the cash in the middle, money out by category on the right, each band
 * as thick as its value; what is left over (or missing) closes the picture. spec: { category,
 * income: "[Entradas no período]", outgo: "[Saídas no período]", top? }.
 */
export function moneyFlowScene({ category, income, outgo, top = 6 }) {
  const W = 1400; const H = 330; const TOP = 70; const GAP = 10; const MIN = 34;
  const xL = 300; const xC = 640; const xR = 1080; const NODE = 26;
  const side = (name, measure, extraName, extraExpr) => [
    `VAR ${name}0 = TOPN(${top}, FILTER(ADDCOLUMNS(VALUES(${category}), "@v", ${measure}), [@v] > 0), [@v], DESC, ${category}, ASC)`,
    `VAR ${name}Resto = ${measure} - SUMX(${name}0, [@v])`,
    `VAR ${name}1 = UNION(SELECTCOLUMNS(${name}0, "@n", ${category} & "", "@v", [@v]), FILTER(ROW("@n", "Outras", "@v", ${name}Resto), [@v] > 0.5), FILTER(ROW("@n", "${extraName}", "@v", ${extraExpr}), [@v] > 0.5))`,
    `VAR ${name}2 = ADDCOLUMNS(${name}1, "@o", VAR v = [@v] VAR c = [@n] RETURN SWITCH(c, "Outras", 90, "${extraName}", 91, 1 + COUNTROWS(FILTER(${name}1, NOT [@n] IN {"Outras", "${extraName}"} && ([@v] > v || ([@v] = v && [@n] < c))))))`,
    `VAR ${name} = ADDCOLUMNS(${name}2, "@c", VAR o = [@o] RETURN SUMX(FILTER(${name}2, [@o] < o), [@v]), "@y", VAR o = [@o] RETURN SUMX(FILTER(${name}2, [@o] < o), MAX(${MIN}, INT([@v] * K))) + COUNTROWS(FILTER(${name}2, [@o] < o)) * ${GAP}, "@h", MAX(2, INT([@v] * K)))`,
  ];
  const band = (left) => {
    const x1 = left ? xL + NODE : xC + NODE; const x2 = left ? xC : xR; const xm = Math.round((x1 + x2) / 2);
    const nodeMid = `INT(${TOP} + [@y] + MAX(${MIN}, [@h]) / 2)`;
    const cashMid = `INT(${TOP} + [@c] * K + [@h] / 2)`;
    const [a, b] = left ? [nodeMid, cashMid] : [cashMid, nodeMid];
    const colourIn = `IF([@n] = "Falta no caixa", ${daxText("#FF8A8A")}, ${daxText("#3DDC97")})`;
    const colourOut = `IF([@n] = "Sobra no caixa", ${daxText("#3DDC97")}, SWITCH(MOD([@o], 4), 1, ${daxText("#FF8A8A")}, 2, ${daxText("#FFB86B")}, 3, ${daxText("#C3A6FA")}, ${daxText("#7FD3F7")}))`;
    const colour = left ? colourIn : colourOut;
    const nodeX = left ? xL : xR;
    const tx = left ? xL - 14 : xR + NODE + 14; const anchor = left ? "end" : "start";
    return joinDax([
      `<path fill='none' stroke-opacity='0.38' d='M${x1} `, D(a), ` C${xm} `, D(a), ` ${xm} `, D(b), ` ${x2} `, D(b), "' stroke='", D(colour), "' stroke-width='", D("[@h]"), "'/>",
      `<rect x='${nodeX}' width='${NODE}' rx='4' y='`, D(`INT(${TOP} + [@y] + MAX(${MIN}, [@h]) / 2 - [@h] / 2)`), "' height='", D("[@h]"), "' fill='", D(colour), "'/>",
      `<text x='${tx}' text-anchor='${anchor}' fill='#E8EDF5' ${FONT} font-size='19' font-weight='600' y='`, D(`${nodeMid} - 2`), "'>", D(safe("LEFT([@n], 24)")), "</text>",
      `<text x='${tx}' text-anchor='${anchor}' fill='#8FA3BF' ${FONT} font-size='16' y='`, D(`${nodeMid} + 18`), "'>", D(safe("FORMAT([@v], \"R$ #,0\") & \"  ·  \" & FORMAT(DIVIDE([@v], Tot), \"0%\")")), "</text>",
    ]);
  };
  return [
    `VAR Ent = ${income} + 0`,
    `VAR Sai = ${outgo} + 0`,
    "VAR Tot = MAX(1, MAX(Ent, Sai))",
    `VAR K = DIVIDE(${H}, Tot)`,
    ...side("Ins", income, "Falta no caixa", "Sai - Ent"),
    ...side("Outs", outgo, "Sobra no caixa", "Ent - Sai"),
    "VAR Alto = MAX(MAXX(Ins, [@y] + MAX(" + MIN + ", [@h])), MAXX(Outs, [@y] + MAX(" + MIN + ", [@h])))",
    `RETURN ${daxText(URL_HEAD)} & "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${W} " & INT(${TOP} + MAX(Alto, ${H}) + 40) & "'>"`,
    `  & ${joinDax([
      `<text x='${xL + NODE}' y='38' text-anchor='end' fill='#3DDC97' ${FONT} font-size='22' font-weight='700'>ENTRADAS · `, D(safe("FORMAT(Ent, \"R$ #,0\")")), "</text>",
      `<text x='${xR}' y='38' fill='#FF8A8A' ${FONT} font-size='22' font-weight='700'>SAÍDAS · `, D(safe("FORMAT(Sai, \"R$ #,0\")")), "</text>",
    ])}`,
    "  & CONCATENATEX(Ins, " + band(true) + ", \"\", [@o], ASC)",
    "  & CONCATENATEX(Outs, " + band(false) + ", \"\", [@o], ASC)",
    `  & ${joinDax([
      `<rect x='${xC}' y='${TOP}' width='${NODE}' rx='4' height='`, D(`INT(Tot * K)`), "' fill='#6EA8FF'/>",
      `<text x='${xC + NODE / 2}' y='${TOP - 30}' text-anchor='middle' fill='#FFFFFF' ${FONT} font-size='22' font-weight='700'>CAIXA</text>`,
      `<text x='${xC + NODE / 2}' text-anchor='middle' ${FONT} font-size='21' font-weight='700' y='`, D(`INT(${TOP} + Tot * K + 30)`), "' fill='", D(`IF(Ent >= Sai, ${daxText("#3DDC97")}, ${daxText("#FF8A8A")})`), "'>", D(`IF(Ent >= Sai, "Saldo +", "Saldo −") & ${safe("FORMAT(ABS(Ent - Sai), \"R$ #,0\")")}`), "</text>",
    ])}`,
    "  & \"</svg>\"",
  ].join("\n");
}

// ---- Execution of a target or budget (one per row of a table) -------------------------------------

/**
 * How much of the target was reached: the bar, the 100% mark and the percentage. For spending
 * (lowerIsBetter) over 100% is red; for a goal, under 100% is the warning.
 */
export function targetBar({ actual, target, lowerIsBetter = false }) {
  const good = daxText("#3DDC97"); const warn = daxText("#F6D365"); const bad = daxText("#FF8A8A");
  const colour = lowerIsBetter ? `IF(Pct > 1, ${bad}, IF(Pct > 0.9, ${warn}, ${good}))` : `IF(Pct >= 1, ${good}, IF(Pct >= 0.8, ${warn}, ${bad}))`;
  return [
    `VAR Pct = DIVIDE(${actual}, ${target})`,
    `RETURN IF(ISBLANK(Pct), BLANK(), ${daxText(URL_HEAD)} & ${joinDax([
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 24'><rect x='0' y='7' width='150' height='10' rx='5' fill='#22324D'/><rect x='0' y='7' height='10' rx='5' width='",
      D("INT(MIN(150, 120 * Pct))"), "' fill='", D(colour), "'/><line x1='120' y1='3' x2='120' y2='21' stroke='#E8EDF5' stroke-width='2'/>",
      `<text x='156' y='17' fill='#C9D3E3' ${FONT} font-size='12'>`, D("FORMAT(Pct * 100, \"0\")"), "%</text></svg>",
    ])})`,
  ].join("\n");
}
