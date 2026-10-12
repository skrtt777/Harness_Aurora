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
import { faces, roomKit } from "./powerbiPlaces.js";
// What the Aurora points at (the 'Destaque' table she writes when asked "mostra…"), and her note.
export const HIGHLIGHT_VARS = ["VAR Destacados = VALUES('Destaque'[Valor])", "VAR NotaAurora = MAXX('Destaque', 'Destaque'[Nota]) & \"\""];
/** A pulsing ring the Aurora draws around what she was asked to show. */
export const auroraRing = (x, y, rx, ry) => `<ellipse cx='${x}' cy='${y}' rx='${rx}' ry='${ry}' fill='none' stroke='${'#B04BFF'}' stroke-width='5'><animate attributeName='stroke-opacity' values='1;0.25;1' dur='1.1s' repeatCount='indefinite'/></ellipse>`;
/** Her note across the top of a scene ("Aurora: a Doca 03 está parada há 40 min"). */
export function auroraBanner(vb) {
  return [`<g ${"font-family='Segoe UI, sans-serif'"}>`, D(`IF(NotaAurora = "", "", "<rect x='${Math.round(vb.x + vb.w * 0.2)}' y='${Math.round(vb.y + 8)}' width='${Math.round(vb.w * 0.6)}' height='40' rx='20' fill='%23B04BFF' opacity='0.92'/><text x='${Math.round(vb.x + vb.w / 2)}' y='${Math.round(vb.y + 35)}' text-anchor='middle' font-size='20' font-weight='700' fill='%23FFFFFF'>" & ${safe("\"Aurora: \" & LEFT(NotaAurora, 80)")} & "</text>")`), "</g>"];
}
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
// An empty list is not DAX ("IN {}"): a value no status has stands in.
const list = (values) => (values.length ? `{${values.map((v) => `"${String(v).replace(/"/g, "\"\"")}"`).join(", ")}}` : "{\"(nenhum)\"}");

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
 * The entities as they are at a moment, one row each, from `base`: an entity (a plate, a ticket) is in
 * one place only — the place of its latest active record. "@where": "doca" (being served at a place, with
 * "@doca"), "filalocal" (waiting in a place's own line), "fila" (waiting, no place yet), "estrada" (on its
 * way). With the time each stage began (flow.timeline) the stage is the one in force at `at` (any moment:
 * a replay of the past, or the next hours — a stage not reached yet comes from the average time between
 * stages in the history, marked "@prev" = 1, drawn as a ghost). The scene and the cards use this same DAX.
 */
export function vehicleVars(flow, base = `ALL(${q(flow.fact)})`, at = null) {
  const h = helpers(flow);
  const F = flow.fact;
  const place = flow.place ? col(F, flow.place) : "BLANK()";
  const order = [flow.date ? `${col(F, flow.date)}, DESC` : null, flow.id ? `${col(F, flow.id)}, DESC` : null].filter(Boolean).join(", ");
  const top1 = (t) => (order ? `TOPN(1, ${t}, ${order})` : `TOPN(1, ${t}, 1, ASC)`);
  const key = flow.asset ? col(F, flow.asset) : flow.id ? col(F, flow.id) : null;
  const serviceStages = h.valuesOf(["separacao", "carregando"]);
  const queueStages = h.valuesOf(["fila"]);
  const roadStages = h.valuesOf(["transito"]);
  const times = flow.timeline;
  const T = at || "NOW()";
  let active; let statusExpr; let lateExpr; let prevExpr;
  if (times) {
    // The stage in force at T, from the stage times; the next one forecast from the history's averages.
    const ranks = Object.keys(times).map(Number).sort((a, b) => a - b);
    const t = (r) => col(F, times[r]);
    const label = (r) => `"${String(flow.stages.find((st) => st.rank === r)?.values[0] || "").replace(/"/g, "\"\"")}"`;
    const rankAt = (moment) => `SWITCH(TRUE(), ${[...ranks].reverse().map((r) => `NOT ISBLANK(${t(r)}) && ${t(r)} <= ${moment}, ${r}`).join(", ")}, 0)`;
    const avg = (r, r2) => `AVERAGEX(FILTER(ALL(${q(F)}), NOT ISBLANK(${t(r)}) && NOT ISBLANK(${t(r2)}) && ${t(r2)} >= ${t(r)}), ${t(r2)} - ${t(r)})`;
    const forecast = ranks.slice(0, -1).map((r, i) => `RAgora = ${r} && T > NOW() && ISBLANK(${t(ranks[i + 1])}) && ${t(r)} + ${avg(r, ranks[i + 1])} <= T, ${ranks[i + 1]}`).join(", ");
    active = `FILTER(ADDCOLUMNS(${base}, "@r", VAR RAgora = ${rankAt("MIN(T, NOW())")} RETURN IF(T > NOW(), SWITCH(TRUE(), ${forecast ? `${forecast}, ` : ""}RAgora), ${rankAt("T")}), "@p", VAR RAgora = ${rankAt("MIN(T, NOW())")} RETURN IF(T > NOW() && ${rankAt("MIN(T, NOW())")} <> IF(T > NOW(), SWITCH(TRUE(), ${forecast ? `${forecast}, ` : ""}RAgora), RAgora), 1, 0)), [@r] >= ${ranks[0]} && [@r] < 5)`;
    statusExpr = `SWITCH([@r], ${ranks.filter((r) => r < 5).map((r) => `${r}, ${label(r)}`).join(", ")}, "")`;
    lateExpr = flow.due ? `IF(${col(F, flow.due)} < T, 1, 0)` : "0";
    prevExpr = "[@p]";
  } else {
    active = `FILTER(${base}, NOT ISBLANK(${h.status}) && NOT ${h.status} IN ${list(flow.done)})`;
    statusExpr = h.status;
    lateExpr = `IF(${h.late}, 1, 0)`;
    prevExpr = "0";
  }
  const latest = (expr) => (key ? `VAR v = ${key} RETURN MAXX(${top1(`FILTER(Ativos, ${key} = v)`)}, ${expr})` : expr);
  const rows = key ? `SUMMARIZE(Ativos, ${key})` : "Ativos";
  // Waiting with a place (the checkout's own line) is "filalocal" when there are serving stages too.
  const hasService = serviceStages.length > 0;
  return [
    `VAR T = ${T}`,
    `VAR Ativos = ${active}`,
    `VAR Veiculos0 = ADDCOLUMNS(${rows}, "@st", ${latest(statusExpr)} & "", "@doca", ${latest(place)} & "", "@atraso", ${latest(lateExpr)} + 0, "@id", ${latest(flow.id ? col(F, flow.id) : key || "BLANK()")} & "", "@nome", ${latest(h.label)} & "", "@prev", ${latest(prevExpr)} + 0${flow.colorBy ? `, "@cor", ${latest(col(F, flow.colorBy.column))} & ""` : ""})`,
    `VAR Veiculos = ADDCOLUMNS(Veiculos0, "@where", SWITCH(TRUE(), [@st] IN ${list(roadStages)}, "estrada", ${hasService ? `[@st] IN ${list(serviceStages)} && [@doca] <> "", "doca", [@st] IN ${list(queueStages)} && [@doca] <> "", "filalocal", ` : `[@st] IN ${list(queueStages)} && [@doca] <> "", "doca", `}[@st] IN ${list([...serviceStages, ...queueStages])}, "fila", "outro"))`,
  ];
}

/** The cards that count the entities exactly as the scene draws them (at the same moment). */
export function vehicleMeasures(flow, at = null) {
  const head = vehicleVars(flow, q(flow.fact), at).join("\n");
  const count = (where) => `${head}\nRETURN COUNTROWS(FILTER(Veiculos, [@where] IN ${list(where)})) + 0`;
  return { patio: count(["doca", "filalocal", "fila"]), docas: count(["doca"]), fila: count(["filalocal", "fila"]), estrada: count(["estrada"]) };
}

/**
 * Any operation where things are served at places, isometric and faithful to the data — a distribution
 * centre (trucks at docks), a supermarket (customers at checkouts), a clinic (patients at rooms), a
 * factory (orders at machines). What is drawn follows the data's own words: vehicles (a plate), people
 * (a ticket, a customer) or loads (an order, a cargo); docks get doors, checkouts and counters get a
 * counter, machines a workstation. Every one is drawn where it is now (its latest active record) and
 * always visible: up to 3 being served at each place and 4 waiting in that place's own line (more is
 * written as "+N"), the general queue (10 vehicles, 20 people or 15 loads), the way out (8). With a unit
 * column the scene shows the unit chosen and asks for one when all are in view. Each drawn object
 * carries a class (v doca, v filalocal, v fila, v estrada) so a test counts them. Returns { dax, points }.
 */
export function yardScene(flow, { title = "Operação", look = "noite", stamp = null, at = null } = {}) {
  const L = lookOf(look);
  const h = helpers(flow);
  const F = flow.fact;
  const place = col(F, flow.place);
  const site = flow.site ? col(F, flow.site) : null;
  const G = flow.glyph || "veiculo";
  const cv = new Canvas();
  const LEN = 640; const DEPTH = 200; const HEIGHT = 112;
  const QUEUE0 = { veiculo: 10, pessoa: 20, volume: 15 }[G];
  const ROAD = 8;
  const hasRoad = flow.stages.some((st) => st.key === "transito");
  // The room of this area (a shop, a clinic, a hall, a factory): app/powerbiPlaces.js. Vehicles at docks
  // keep the warehouse drawn below.
  const env = G === "veiculo" ? "armazem" : flow.environment || "fabrica";
  const n = Math.max(1, Math.min(16, flow.placeCount || 10));
  const w = (LEN - 40) / n;
  const kit = env === "armazem" ? null : roomKit(env, { cv, look, LEN, DEPTH, n, w, hasRoad, D, safe, siteName: site ? "Unidade" : null, title });
  // The general queue's ground: parking spots for vehicles, a marked line for people, a bay for loads.
  const QUEUE = kit ? kit.QUEUE : QUEUE0;
  const spot = kit ? kit.spot : {
    veiculo: (j) => [20 + (j % 5) * 82, 520 + Math.floor(j / 5) * 140],
    pessoa: (j) => [40 + (j % 10) * 46, 560 + Math.floor(j / 10) * 70],
    volume: (j) => [40 + (j % 5) * 70, 540 + Math.floor(j / 5) * 70],
  }[G];
  const parts = [];
  cv.quiet = true;
  if (kit) {
    parts.push(kit.floor);
    if (hasRoad) {
      parts.push(cv.poly([[720, -60, 0], [880, -60, 0], [880, 800, 0], [720, 800, 0]], L.road));
      parts.push(`<polyline points='${cv.pts([[800, -60, 0], [800, 800, 0]])}' stroke='${L.roadLine}' stroke-width='3' stroke-dasharray='14 12' fill='none' opacity='0.7'/>`);
    }
    cv.quiet = false;
    parts.push(kit.queueGround, kit.backdrop);
  } else {
  parts.push(cv.poly([[-120, -60, 0], [920, -60, 0], [920, 800, 0], [-120, 800, 0]], L.ground));
  for (let g = 40; g <= 880; g += 95) parts.push(`<polyline points='${cv.pts([[g, -60, 0], [g, 800, 0]])}' stroke='${L.grid}' stroke-width='1' fill='none'/>`);
  for (let g = 50; g <= 760; g += 90) parts.push(`<polyline points='${cv.pts([[-120, g, 0], [920, g, 0]])}' stroke='${L.grid}' stroke-width='1' fill='none'/>`);
  parts.push(cv.poly([[0, DEPTH, 0], [LEN, DEPTH, 0], [LEN, 470, 0], [0, 470, 0]], L.yard));
  if (hasRoad) {
    parts.push(cv.poly([[720, -60, 0], [880, -60, 0], [880, 800, 0], [720, 800, 0]], L.road));
    parts.push(`<polyline points='${cv.pts([[800, -60, 0], [800, 800, 0]])}' stroke='${L.roadLine}' stroke-width='3' stroke-dasharray='14 12' fill='none' opacity='0.7'/>`);
  }
  if (G === "veiculo") for (let j = 0; j < QUEUE; j += 1) { const [x, y] = spot(j); parts.push(cv.poly([[x, y, 0], [x + 64, y, 0], [x + 64, y + 130, 0], [x, y + 130, 0]], "none", ` stroke='${L.spot}' stroke-width='1.5'`)); }
  parts.push(`<polyline points='${cv.pts([[-90, -40, 0], [-90, 790, 0], [690, 790, 0]])}' stroke='${L.fence}' stroke-width='2.5' fill='none'/>`);
  cv.quiet = false;
  for (const [X, Y] of [[-60, 40], [-60, 220], [-60, 420], [-60, 640], [480, 760], [660, 740], [690, -20], ...(hasRoad ? [[905, 160], [905, 520]] : [])]) parts.push(tree(cv, X, Y, L, 0.9));
  parts.push(cv.box(0, 0, 0, LEN, DEPTH, HEIGHT, L.walls));
  for (let r = 26; r < 100; r += 30) parts.push(`<polyline points='${cv.pts([[16, r, HEIGHT], [LEN - 16, r, HEIGHT]])}' stroke='${L.stripe}' stroke-width='5' fill='none' opacity='${look === "dia" ? 0.35 : 1}'/>`);
  const [wx, wy] = cv.at(30, 168, HEIGHT);
  parts.push(`<text transform='matrix(${r1(COS)},0.5,${r1(-COS)},0.5,${wx},${wy})' fill='${L.roofText}' ${FONT} font-size='34' font-weight='700' letter-spacing='3'>`, site ? D(safe("UPPER(LEFT(Unidade, 30))")) : xml(title.toUpperCase().slice(0, 30)), "</text>");
  }

  // The glyphs: each drawn object in its own colour (the stage, red when late), dimmed when a selection
  // hides it, ghostly when it is a forecast.
  const keyOf = `IF([@atraso] = 1, "atraso", ${h.keyOf("[@st]")})`;
  const open = (where) => [`<g class='v ${where}' opacity='`, D(`IF(NOT Filtrado || [@id] IN Visiveis, IF([@prev] = 1, "0.5", "1"), "0.22")`), "'>"];
  const byColour = flow.colorBy ? (i) => D(`SWITCH(LOWER([@cor]), ${flow.colorBy.values.map(([v, hex]) => `"${String(v).toLowerCase().replace(/"/g, "\"\"")}", ${daxText(faces(hex)[i])}`).join(", ")}, ${daxText(faces("#8EA0BC")[i])})`) : null;
  // With a colour column (risk, priority) the entity wears it; its stage is where it stands.
  const colours = (key) => (byColour && key !== `"fila"` ? [byColour(0), byColour(1), byColour(2)] : [shade(key, 0), shade(key, 1), shade(key, 2)]);
  const vehicle = (x, y, tw, key, where) => [open(where), cv.box(x, y, 0, tw, 150, 9, [L.chassis, L.chassis, L.chassis]), cv.box(x, y, 9, tw, 118, 52, colours(key)), cv.box(x + 2, y + 122, 9, tw - 4, 30, 40, L.cab), "</g>"];
  const person = (x, y, key, where, seat = false) => {
    const z = seat ? 16 : 0; const body = seat ? 30 : 42;
    const [hx, hy] = cv.at(x, y, z + body + 12);
    // Past the limit with a colour column: a red mark over the head (the colour already says the risk).
    const late = byColour && key !== `"fila"` ? when("[@atraso] = 1", [`<circle cx='${hx}' cy='${r1(Number(hy) - 24)}' r='8' fill='#E53935'/><text x='${hx}' y='${r1(Number(hy) - 19)}' text-anchor='middle' fill='#FFFFFF' ${FONT} font-size='12' font-weight='800'>!</text>`]) : "";
    return [open(where), cv.box(x - 10, y - 10, z, 20, 20, body, colours(key)), `<ellipse cx='${hx}' cy='${hy}' rx='11' ry='12' fill='${look === "dia" ? "#E9B98F" : "#C99A73"}'/>`, late, "</g>"];
  };
  const load = (x, y, key, where) => [open(where), cv.box(x - 18, y - 18, 0, 36, 36, 6, ["#D9B27C", "#C99A5B", "#A87E45"]), cv.box(x - 15, y - 15, 6, 30, 30, 28, colours(key)), "</g>"];
  const glyph = (x, y, key, where, tw = 34) => (G === "veiculo" ? vehicle(x - tw / 2, y, tw, key, where) : G === "pessoa" ? person(x, y + 20, key, where) : load(x, y + 20, key, where));

  // The places: up to 16 drawn; more is written.
  const tw = Math.min(w * 0.62, 46);
  const fragments = [];
  const points = [];
  for (let k = 0; k < n; k += 1) {
    const cx = 20 + k * w + w / 2;
    const frag = [];
    const free = D(`IF([@n] + [@f] = 0, ${daxText("#27AE60")}, ${daxText(L.door)})`);
    if (kit) frag.push(kit.place(cx, k, free));
    else if (G === "veiculo") frag.push(cv.poly([[cx - tw / 2 - 4, DEPTH, 0], [cx + tw / 2 + 4, DEPTH, 0], [cx + tw / 2 + 4, DEPTH, 66], [cx - tw / 2 - 4, DEPTH, 66]], free));
    else {
      // A counter (checkout, desk) or a workstation in front of the wall; its top green when free.
      const cw = Math.min(w * 0.7, 54);
      frag.push(cv.box(cx - cw / 2, DEPTH + 8, 0, cw, G === "pessoa" ? 22 : 40, G === "pessoa" ? 28 : 18, [free, L.walls[1], L.walls[2]]));
    }
    // Being served: up to three, side by side (vehicles one behind the other).
    const at = (xy, key, where, seat) => (G === "pessoa" ? person(xy[0], xy[1], key, where, seat) : load(xy[0], xy[1], key, where));
    const served = kit ? [0, 1, 2].map((i) => when(`[@n] >= ${i + 1}`, at(kit.served(cx, i), keyOf, "doca"))) : [0, 1, 2].map((i) => when(`[@n] >= ${i + 1}`, G === "veiculo"
      ? (i === 0 ? glyph(cx, DEPTH + 10, keyOf, "doca", tw) : [open("doca"), cv.box(cx - tw / 2 + 4, DEPTH + 172 + (i - 1) * 70, 0, tw - 8, 60, 30, colours(keyOf)), cv.box(cx - tw / 2 + 6, DEPTH + 218 + (i - 1) * 70, 30, tw - 12, 14, 18, L.cab), "</g>"])
      : glyph(cx + (i - 1) * Math.min(18, w / 3), DEPTH + (G === "pessoa" ? 36 : 14), keyOf, "doca")));
    frag.push(served);
    // That place's own line: up to four waiting behind, the rest written.
    const lineStep = G === "veiculo" ? 0 : G === "pessoa" ? 36 : 42;
    if (kit) frag.push([0, 1, 2, 3].map((i) => when(`[@f] >= ${i + 1}`, at(kit.line(cx, i), `"fila"`, "filalocal", Boolean(kit.seated)))));
    else if (G !== "veiculo") frag.push([0, 1, 2, 3].map((i) => when(`[@f] >= ${i + 1}`, glyph(cx, DEPTH + 70 + i * lineStep, `"fila"`, "filalocal"))));
    else frag.push([0, 1].map((i) => when(`[@f] >= ${i + 1}`, [open("filalocal"), cv.box(cx - tw / 2 + 4, DEPTH + 330 + i * 64, 0, tw - 8, 56, 30, STATE.fila.shades), "</g>"])));
    const shown = G === "veiculo" ? 2 : 4;
    const [ox, oy] = kit ? cv.at(kit.line(cx, shown)[0], kit.line(cx, shown)[1] - 8, 0) : cv.at(cx, DEPTH + (G === "veiculo" ? 470 : 70 + shown * lineStep + 14), 0);
    frag.push(when(`[@f] > ${shown}`, [`<text x='${ox}' y='${oy}' text-anchor='middle' fill='${L.queue}' ${FONT} font-size='15' font-weight='700'>+`, D(`[@f] - ${shown}`), "</text>"]));
    if (G === "veiculo") {
      const [p0x, p0y] = cv.at(cx, DEPTH - 6, 12); const [p1x, p1y] = cv.at(cx, DEPTH + 40, 12);
      const dur = (2.4 + (k % 3) * 0.5).toFixed(1);
      frag.push(when(`[@n] > 0 && [@st] IN ${list(h.atDock)}`, `<g><rect x='${r1(Number(p0x) - 9)}' y='${r1(Number(p0y) - 9)}' width='18' height='14' rx='2' fill='#C99A5B'/><animateTransform attributeName='transform' type='translate' values='0 0; ${r1(Number(p1x) - Number(p0x))} ${r1(Number(p1y) - Number(p0y))}' dur='${dur}s' repeatCount='indefinite'/><animate attributeName='opacity' values='0;1;1;0' dur='${dur}s' repeatCount='indefinite'/></g>`));
    }
    // The name of the one being served, over it ("+2" when there are more).
    // The tag: over the vehicle, or over the head of the one being served.
    const [px, py] = kit ? cv.at(...kit.tag(cx)) : cv.at(cx, DEPTH + (G === "veiculo" ? 60 : 56), G === "veiculo" ? 61 : 92);
    const pw = G === "veiculo" ? (n > 10 ? 70 : 92) : 70;
    const lift = n > 10 && k % 2 ? 30 : 0;
    frag.push(when("[@n] > 0", [
      `<rect x='${r1(Number(px) - pw / 2)}' y='${r1(Number(py) - 34 - lift)}' width='${pw}' height='26' rx='13' fill='${L.plate}' stroke='`, shade(keyOf, 0), "' stroke-width='2'/>",
      `<text x='${px}' y='${r1(Number(py) - 15 - lift)}' text-anchor='middle' fill='${L.plateText}' ${FONT} font-size='${n > 10 ? 13 : 15}' font-weight='700'>`, D(safe(`LEFT([@nome], 9) & IF([@n] > 1, " +" & ([@n] - 1), "")`)), "</text>",
    ]));
    const [gx, gy] = cv.at(cx, DEPTH + 90, 0);
    frag.push(when(`${place} IN Destacados || [@nome] IN Destacados`, auroraRing(gx, gy, G === "veiculo" ? 84 : 56, G === "veiculo" ? 48 : 32)));
    frag.push(when("Filtrado && [@n] > 0 && [@id] IN Visiveis", [`<ellipse cx='${gx}' cy='${gy}' rx='${G === "veiculo" ? 70 : 46}' ry='${G === "veiculo" ? 40 : 26}' fill='none' stroke='${L.pin}' stroke-width='4'><animate attributeName='stroke-opacity' values='1;0.3;1' dur='1.4s' repeatCount='indefinite'/></ellipse>`]));
    const [nx, ny] = kit ? cv.at(...kit.label(cx)) : cv.at(cx - tw / 2 - 4, DEPTH, G === "veiculo" ? 76 : 98);
    // In a room the place's number is painted on the floor at its door (the legend says what it is).
    if (kit) frag.push(`<text transform='matrix(${r1(COS)},0.5,${r1(-COS)},0.5,${nx},${ny})' fill='${L.text}' ${FONT} font-size='${n > 10 ? 15 : 19}' font-weight='800'>`, D(safe(`VAR p = TRIM(SUBSTITUTE(${place}, ${JSON.stringify(String(flow.place))}, "")) RETURN LEFT(IF(p = "", ${place}, p), 8)`)), "</text>");
    else frag.push(`<text transform='matrix(${r1(COS)},0.5,0,1,${nx},${ny})' fill='${L.text}' ${FONT} font-size='${n > 10 ? 12 : 15}' font-weight='600'>`, D(safe(`LEFT(${place}, 10)`)), "</text>");
    fragments.push(`${k + 1}, ${joinDax(frag)}`);
    points.push([k + 1, Number(gx), Number(gy)]);
  }

  // The general queue (waiting with no place yet) and the way out.
  const queueSlots = [];
  for (let j = 0; j < QUEUE; j += 1) {
    const [x, y] = spot(j);
    const [mx, my] = cv.at(x + (G === "veiculo" ? 32 : 0), y + (G === "veiculo" ? 60 : 0), 0);
    const drawn = G === "veiculo" ? vehicle(x + 16, y + 6, 32, keyOf, "fila") : kit && G === "pessoa" ? person(x, y, keyOf, "fila", Boolean(kit.seated)) : kit ? load(x, y, keyOf, "fila") : glyph(x, y - 20, keyOf, "fila");
    queueSlots.push(`${j + 1}, ${joinDax([drawn, when("[@nome] IN Destacados", auroraRing(mx, my, 40, 24))])}`);
  }
  const roadSlots = [];
  if (hasRoad) {
    for (let j = 0; j < ROAD; j += 1) {
      const lane = j % 2; const pos = Math.floor(j / 2);
      const X = 735 + lane * 80; const Y = 560 - pos * 165;
      const [a0x, a0y] = cv.at(X, Y, 0); const [a1x, a1y] = cv.at(X, Y - 40, 0);
      const moving = `<animateTransform attributeName='transform' type='translate' values='0 0; ${r1(Number(a1x) - Number(a0x))} ${r1(Number(a1y) - Number(a0y))}; 0 0' dur='${(5 + (j % 3)).toFixed(0)}s' repeatCount='indefinite'/>`;
      // Loads and people go out by vehicle too: a van carrying them, coloured by their stage.
      const [mx, my] = cv.at(X + 17, Y - 60, 0);
      roadSlots.push(`${j + 1}, ${joinDax(["<g>", moving, vehicle(X, Y - 120, 34, keyOf, "estrada"), when("[@nome] IN Destacados", auroraRing(mx, my, 50, 30)), "</g>"])}`);
    }
  }
  const [qx, qy] = cv.at(0, G === "veiculo" ? 620 : 590, 0);
  cv.see(Number(qx) - 170, Number(qy));
  const [rx, ry] = cv.at(900, -40, 0);
  if (hasRoad) cv.see(Number(rx) + 250, Number(ry) + 60);
  const counts = [
    `<text x='${r1(Number(qx) - 16)}' y='${r1(Number(qy) + 8)}' text-anchor='end' fill='${L.queue}' ${FONT} font-size='26' font-weight='700'>`, D("FORMAT(nFila + nFilaLocal, \"0\")"), ` ${xml(flow.queueLabel || "na fila")}</text>`,
    when(`nFila > ${QUEUE}`, [`<text x='${r1(Number(qx) - 16)}' y='${r1(Number(qy) + 34)}' text-anchor='end' fill='${L.queue}' ${FONT} font-size='18'>`, D(`"+" & (nFila - ${QUEUE}) & " fora do desenho"`), "</text>"]),
    hasRoad ? [
      `<text x='${r1(Number(rx) + 10)}' y='${r1(Number(ry) + 6)}' fill='${L.transit}' ${FONT} font-size='26' font-weight='700'>`, D("FORMAT(nEstrada, \"0\")"), ` ${xml(flow.transitLabel || "em trânsito")}</text>`,
      when("nAtrasoEstrada > 0", [`<text x='${r1(Number(rx) + 10)}' y='${r1(Number(ry) + 36)}' fill='${L.late}' ${FONT} font-size='21'>`, D("FORMAT(nAtrasoEstrada, \"0\")"), " com atraso</text>"]),
      when(`nEstrada > ${ROAD}`, [`<text x='${r1(Number(rx) + 10)}' y='${r1(Number(ry) + 62)}' fill='${L.transit}' ${FONT} font-size='18'>`, D(`"+" & (nEstrada - ${ROAD}) & " fora do desenho"`), "</text>"]),
    ] : "",
  ];

  const vb = { x: cv.minX - 16, y: cv.minY - 16, w: cv.maxX - cv.minX + 32, h: cv.maxY - cv.minY + 32 };
  const legend = [];
  const legendKeys = flow.colorBy
    ? [...flow.colorBy.values.map(([v, hex]) => [hex, v]), ["#E53935", "! passou do limite"], [STATE.livre.shades[1], `${flow.place} livre`]]
    : [...flow.stages.filter((s) => s.key !== "concluido").map((s) => [s.key, s.values[0]]), ["atraso", "Atrasado"], ["livre", `${flow.place} livre`]];
  if (flow.colorBy) legend.push(`<text x='${r1(vb.x + 24)}' y='${r1(vb.y + 28)}' fill='${L.strong}' ${FONT} font-size='18' font-weight='700'>${xml(flow.colorBy.column)}</text>`);
  legendKeys.forEach(([key, text], i) => {
    const lx = vb.x + 24; const ly = vb.y + 34 + (flow.colorBy ? 30 : 0) + i * 32;
    legend.push(`<rect x='${r1(lx)}' y='${r1(ly - 16)}' width='20' height='20' rx='10' fill='${key.startsWith("#") ? key : STATE[key]?.shades[1] || "#6B7A90"}'/>`);
    legend.push(`<text x='${r1(lx + 30)}' y='${r1(ly + 1)}' fill='${L.text}' ${FONT} font-size='20'>${xml(text)}</text>`);
  });
  if (stamp) legend.push(liveBadge(stamp, vb.x + vb.w - 320, vb.y + 14, L));
  legend.push(auroraBanner(vb));
  if (flow.timeline) legend.push(`<text x='${r1(vb.x + vb.w - 20)}' y='${r1(vb.y + 100)}' text-anchor='end' ${FONT} font-size='24' font-weight='800' fill='`, D(`IF(T > NOW() + 1 / 1440, ${daxText(L.transit)}, ${daxText(L.queue)})`), "'>", D(`IF(T < NOW() - 1 / 1440, "REPRISE · " & FORMAT(T, "dd/mm HH:nn"), IF(T > NOW() + 1 / 1440, "PREVISÃO · " & FORMAT(T, "dd/mm HH:nn") & " (fantasmas)", ""))`), "</text>");
  legend.push(when(`nDocas > ${n}`, [`<text x='${r1(vb.x + vb.w - 20)}' y='${r1(vb.y + 76)}' text-anchor='end' fill='${L.text}' ${FONT} font-size='17'>`, D(`"+" & (nDocas - ${n}) & " ${xml(flow.placePlural || `${flow.place.toLowerCase()}s`)} fora do desenho"`), "</text>"]));
  // The fidelity seal: what is drawn against what the data has, counted live ("✓ 22 de 22").
  const sealX = vb.x + vb.w - 20; const sealY = vb.y + vb.h - 18;
  legend.push(`<text x='${r1(sealX)}' y='${r1(sealY)}' text-anchor='end' ${FONT} font-size='18' font-weight='700' fill='`, D(`IF(nDesenhados = nTotal, ${daxText("#27AE60")}, ${daxText(L.queue)})`), "'>", D(`IF(nDesenhados = nTotal, "✓ ", "◐ ") & nDesenhados & " de " & nTotal & " desenhados" & IF(nDesenhados = nTotal, "", " (o resto está escrito)")`), "</text>");

  const selected = flow.id || flow.asset;
  const unitVars = site ? [`VAR Unidade = IF(HASONEVALUE(${site}), VALUES(${site}), BLANK())`, `VAR Base = FILTER(ALL(${q(F)}), ${site} = Unidade)`] : [`VAR Base = ALL(${q(F)})`];
  const docks = site ? `CALCULATETABLE(VALUES(${place}), ${site} = Unidade, REMOVEFILTERS(${q(F)}))` : `ALL(${place})`;
  const svgHead = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${r1(vb.x)} ${r1(vb.y)} ${r1(vb.w)} ${r1(vb.h)}' preserveAspectRatio='none'>`;
  const askUnit = site ? [
    `IF(ISBLANK(Unidade), ${daxText(URL_HEAD)} & ${daxText(svgHead)} & ${joinDax([cv.poly([[-120, -60, 0], [920, -60, 0], [920, 800, 0], [-120, 800, 0]], L.ground)])}`,
    `  & ${daxText(`<text x='${r1(vb.x + vb.w / 2)}' y='${r1(vb.y + vb.h / 2 - 10)}' text-anchor='middle' fill='${L.strong}' ${FONT} font-size='34' font-weight='700'>Escolha uma ${xml(flow.site)} no filtro</text><text x='${r1(vb.x + vb.w / 2)}' y='${r1(vb.y + vb.h / 2 + 30)}' text-anchor='middle' fill='${L.text}' ${FONT} font-size='22'>`)} & ${safe(`"A cena desenha uma unidade por vez (há " & COUNTROWS(ALL(${site})) & "); os números acima somam todas."`)} & "</text></svg>",`,
  ] : [];
  const capServed = 3; const capLine = G === "veiculo" ? 2 : 4;
  const dax = [
    ...unitVars,
    ...vehicleVars(flow, "Base", at),
    ...HIGHLIGHT_VARS,
    `VAR Visiveis = ${selected ? `VALUES(${col(F, selected)})` : "{ BLANK() }"}`,
    `VAR Filtrado = ${selected ? "COUNTROWS(FILTER(Veiculos, NOT [@id] IN Visiveis)) > 0" : "FALSE()"}`,
    "VAR NaDoca = FILTER(Veiculos, [@where] = \"doca\")",
    "VAR NaFilaLocal = FILTER(Veiculos, [@where] = \"filalocal\")",
    "VAR Fila = FILTER(Veiculos, [@where] = \"fila\")",
    "VAR Estrada = FILTER(Veiculos, [@where] = \"estrada\")",
    "VAR nFila = COUNTROWS(Fila) + 0",
    "VAR nFilaLocal = COUNTROWS(NaFilaLocal) + 0",
    "VAR nEstrada = COUNTROWS(Estrada) + 0",
    "VAR nAtrasoEstrada = COUNTROWS(FILTER(Estrada, [@atraso] = 1)) + 0",
    `VAR TodasDocas = FILTER(${docks}, NOT ISBLANK(${place}) && ${place} <> "")`,
    "VAR nDocas = COUNTROWS(TodasDocas) + 0",
    `VAR Docas = TOPN(${n}, TodasDocas, ${place}, ASC)`,
    `VAR Slots0 = ADDCOLUMNS(Docas, "@i", VAR d = ${place} RETURN COUNTROWS(FILTER(Docas, ${place} <= d)), "@n", VAR d = ${place} & "" RETURN COUNTROWS(FILTER(NaDoca, [@doca] = d)) + 0, "@f", VAR d = ${place} & "" RETURN COUNTROWS(FILTER(NaFilaLocal, [@doca] = d)) + 0)`,
    `VAR Slots1 = ADDCOLUMNS(Slots0, "@nome", VAR d = ${place} & "" RETURN MINX(FILTER(NaDoca, [@doca] = d), [@nome]))`,
    `VAR DocaVeic = ADDCOLUMNS(Slots1, "@st", VAR v = [@nome] RETURN MAXX(FILTER(NaDoca, [@nome] = v), [@st]), "@atraso", VAR v = [@nome] RETURN MAXX(FILTER(NaDoca, [@nome] = v), [@atraso]) + 0, "@id", VAR v = [@nome] RETURN MAXX(FILTER(NaDoca, [@nome] = v), [@id]), "@prev", VAR v = [@nome] RETURN MAXX(FILTER(NaDoca, [@nome] = v), [@prev]) + 0${flow.colorBy ? `, "@cor", VAR v = [@nome] RETURN MAXX(FILTER(NaDoca, [@nome] = v), [@cor])` : ""})`,
    `VAR FilaN = ADDCOLUMNS(Fila, "@j", VAR v = [@nome] & "|" & [@id] RETURN COUNTROWS(FILTER(Fila, [@nome] & "|" & [@id] <= v)))`,
    `VAR EstradaN = ADDCOLUMNS(Estrada, "@j", VAR v = [@nome] & "|" & [@id] RETURN COUNTROWS(FILTER(Estrada, [@nome] & "|" & [@id] <= v)))`,
    // What is drawn (capped per place, per line, per queue, per road) against everything there is.
    `VAR nTotal = COUNTROWS(FILTER(Veiculos, [@where] IN {"doca", "filalocal", "fila", "estrada"})) + 0`,
    `VAR nDesenhados = SUMX(TOPN(${n}, Slots0, [@i], ASC), MIN([@n], ${capServed}) + MIN([@f], ${capLine})) + MIN(nFila, ${QUEUE}) + ${hasRoad ? `MIN(nEstrada, ${ROAD})` : "0"}`,
    `RETURN ${askUnit.length ? askUnit.join("\n") : ""}`,
    `  ${daxText(URL_HEAD)} & ${daxText(svgHead)}`,
    `  & ${joinDax(parts)}`,
    `  & CONCATENATEX(DocaVeic, SWITCH([@i], ${fragments.join(",\n    ")}, ""), "", [@i], ASC)`,
    `  & CONCATENATEX(FilaN, SWITCH([@j], ${queueSlots.join(",\n    ")}, ""), "", [@j], ASC)`,
    hasRoad ? `  & CONCATENATEX(EstradaN, SWITCH([@j], ${roadSlots.join(",\n    ")}, ""), "", [@j], DESC)` : "",
    `  & ${joinDax(counts)}`,
    `  & ${joinDax(legend)}`,
    `  & "</svg>"${askUnit.length ? ")" : ""}`,
  ].filter(Boolean).join("\n");
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
  const FOOT = 100; const STEP_X = 175; const STEP_Y = 330; const H = 300;
  const parts = [];
  cv.quiet = true;
  const rows = n > cols ? 2 : 1;
  // The second row further back and half a step aside: in front of the first it hid its buildings (11/10).
  const at = (k) => { const c = k % cols; const r = Math.floor(k / cols); return [c * STEP_X + r * (STEP_Y + 90), -c * STEP_X + r * (STEP_Y - 90)]; };
  const [ax, ay] = at(0); const [bx, by] = at(cols - 1); const [ex, ey] = at((rows - 1) * cols + cols - 1); const [dx, dy] = at((rows - 1) * cols);
  parts.push(cv.poly([[ax - 70, ay - 70, 0], [bx + FOOT + 70, by - 70, 0], [ex + FOOT + 70, ey + FOOT + 70, 0], [dx - 70, dy + FOOT + 70, 0]], L.ground));
  cv.quiet = false;
  const slots = [];
  const points = [];
  for (let k = 0; k < n; k += 1) {
    const [X, Y] = at(k);
    const colour = (i) => D(year ? `IF(ISBLANK([@p]) || ISBLANK([@a]), ${daxText(PALETTE[0][i])}, IF([@a] >= [@p], ${daxText(UP[i])}, ${daxText(DOWN[i])}))` : `SWITCH(TRUE(), [@i] <= 1, ${daxText(PALETTE[0][i])}, [@i] <= 3, ${daxText(PALETTE[1][i])}, ${daxText(PALETTE[2][i])})`);
    const h = `MAX(6, INT(${H} * DIVIDE([@v], Mx)))`;
    const frag = [cv.poly([[X - 14, Y - 14, 0], [X + FOOT + 14, Y - 14, 0], [X + FOOT + 14, Y + FOOT + 14, 0], [X - 14, Y + FOOT + 14, 0]], L.yard)];
    frag.push(when(`${column} IN Destacados`, auroraRing(...cv.at(X + FOOT / 2, Y + FOOT / 2, 0), 110, 64)));
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
    // Faithful: what does not fit is said, never left out silently.
    "VAR nFora = COUNTROWS(FILTER(Base, NOT ISBLANK([@v]) && [@v] > 0)) - COUNTROWS(Itens)",
    `VAR Visiveis = VALUES(${column})`,
    ...HIGHLIGHT_VARS,
    `VAR Filtrado = ISFILTERED(${column})`,
    `VAR S0 = ADDCOLUMNS(Itens, "@i", VAR v = [@v] VAR c = ${column} RETURN COUNTROWS(FILTER(Itens, [@v] > v || ([@v] = v && ${column} < c))) + 1, "@sel", IF(NOT Filtrado || ${column} IN Visiveis, 1, 0))`,
    year
      ? `VAR S = ADDCOLUMNS(S0, "@a", CALCULATE(${measure}, REMOVEFILTERS(${year}), ${year} = AnoAtual), "@p", CALCULATE(${measure}, REMOVEFILTERS(${year}), ${year} = AnoAtual - 1))`
      : "VAR S = S0",
    `RETURN ${daxText(URL_HEAD)} & ${daxText(svgOpen(vb).replace("'>", "' preserveAspectRatio='none'>"))} & ${joinDax(parts)}`,
    `  & CONCATENATEX(S, SWITCH([@i], ${slots.join(",\n    ")}, ""), "", [@i], ASC)`,
    `  & ${joinDax(auroraBanner(vb))}`,
    `  & IF(nFora > 0, "<text x='${r1(vb.x + vb.w - 20)}' y='${r1(vb.y + 30)}' text-anchor='end' font-family='Segoe UI' font-size='20' fill='${L.text.replace("#", "%23")}'>+" & nFora & " fora do desenho (os ${n} maiores aparecem)</text>", "")`,
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
