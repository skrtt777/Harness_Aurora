// The Power BI the Aurora keeps open, as a miniature: the same state as its scene
// (docs/GEMEO_DIGITAL_CONTRATO.md). One object per entity, where it is; places free in green; the
// colour of the stage, or of the risk/priority when the data has it; the rest written ("N de N").
// Pure (no three.js): the same function runs in the browser, in the headset and in the tests.
// Units: metres of the miniature, x to the right, y up, z toward the viewer (three.js axes); the
// whole miniature fits in about 0.5 m, the size of a table top.

export const COLORS = {
  fila: "#f6d365", separacao: "#4bafd9", carregando: "#2f6fdb", transito: "#8e66d9", atraso: "#d94b4b",
  livre: "#27ae60", ocupado: "#2b3a55", piso: "#0d1626", texto: "#d9ebff", destaque: "#b04bff",
};
const PLACE_SHAPE = {
  // depth (z), width share of the step, height; in metres of the miniature.
  armazem: [0.012, 0.8, 0.06], loja: [0.035, 0.45, 0.02], clinica: [0.032, 0.5, 0.012], salao: [0.016, 0.85, 0.022], fabrica: [0.03, 0.7, 0.04],
};
const PLACE_COLOR = { clinica: "#d9e1ed", fabrica: "#5c6b80" };

/** A layout from the twin's JSON and the unit chosen (empty: the first). */
export function twinLayout(state, wanted = "") {
  const L = { title: state?.title || "", operation: state?.kind === "operacao", units: [], numbers: [], notes: [], note: "", unit: "", environment: "", glyph: "", noun: state?.noun || "", items: [], places: [], drawn: 0, total: 0, width: 0.5, depth: 0.5, live: liveLabel(state?.lastRefresh) };
  if (!state) return L;
  L.numbers = Object.entries(state.numbers || {}).slice(0, 6).map(([k, v]) => ({ name: k, value: String(v) }));
  L.notes = (state.notes || []).slice(0, 3).map((n) => `${n.when || ""} ${n.text || ""}`.trim());
  L.note = state.highlight?.note || "";
  const lit = new Set(state.highlight?.values || []);
  if (!L.operation || !state.units?.length) return L;
  L.units = state.units.map((u) => u.name);
  const unit = state.units.find((u) => u.name === wanted) || state.units[0];
  L.unit = unit.name || "";
  L.glyph = state.glyph || "volume";
  L.environment = state.environment || (L.glyph === "veiculo" ? "armazem" : "");
  const vehicles = L.glyph === "veiculo"; const people = L.glyph === "pessoa";
  const byName = new Map((state.entities || []).filter((e) => (e.unit ?? null) === (unit.name ?? null)).map((e) => [e.name, e]));
  const stageOf = new Map((state.stages || []).map((s) => [s.label, s.key]));
  const palette = new Map((state.colorBy?.values || []).map(([v, c]) => [String(v).toLowerCase(), c]));
  const colourOf = (e) => {
    if (!e) return COLORS.carregando;
    if (e.color && palette.has(String(e.color).toLowerCase())) return palette.get(String(e.color).toLowerCase());
    if (e.late) return COLORS.atraso;
    const key = stageOf.get(e.status);
    return COLORS[key] || (e.where === "estrada" ? COLORS.transito : e.where === "fila" || e.where === "filalocal" ? COLORS.fila : COLORS.carregando);
  };
  const kind = vehicles ? "veiculo" : people ? "pessoa" : "volume";
  const size = vehicles ? [0.022, 0.022, 0.05] : people ? [0.014, 0.032, 0.014] : [0.022, 0.022, 0.022];
  const add = (name, x, z, rot = 0) => {
    const e = byName.get(name);
    L.items.push({ kind, name, x, y: 0, z, rot, size, color: colourOf(e), highlight: lit.has(name), late: !!e?.late, status: e?.status || "", place: e?.place || "", waited: e?.waited ?? null, id: e?.id || "" });
    L.drawn += 1;
  };
  // The places in a row at the back; who is served in front of each; its own line toward the viewer.
  const places = unit.places || [];
  const step = vehicles ? 0.07 : 0.045;
  const width = Math.max(0.3, places.length * step);
  const x0 = -width / 2 + step / 2;
  const backZ = -0.2;
  const shape = PLACE_SHAPE[L.environment] || PLACE_SHAPE.fabrica;
  places.forEach((p, i) => {
    const x = x0 + i * step;
    const serving = p.serving || []; const waiting = p.waiting || [];
    const free = !serving.length && !waiting.length;
    const docks = vehicles || L.environment === "armazem";
    L.places.push({ name: p.name, short: shortName(p.name, state.placeLabel), x, y: shape[2] / 2, z: backZ, w: step * shape[1], h: shape[2], d: shape[0], free, highlight: lit.has(p.name),
      color: docks ? (free ? COLORS.livre : COLORS.ocupado) : PLACE_COLOR[L.environment] || COLORS.ocupado, busy: serving.length });
    serving.slice(0, 3).forEach((n, k) => add(n, vehicles ? x : x + (k - (Math.min(3, serving.length) - 1) / 2) * 0.016, vehicles ? backZ + 0.04 + k * 0.06 : backZ + 0.04));
    waiting.slice(0, vehicles ? 2 : 4).forEach((n, k) => add(n, x, (vehicles ? backZ + 0.16 : backZ + 0.08) + k * (vehicles ? 0.06 : 0.024)));
  });
  // The general line in rows, nearest the viewer; the way out on the left (turned back).
  const cols = vehicles ? 5 : 10;
  (unit.queue || []).slice(0, 20).forEach((n, k) => add(n, -width / 2 + 0.03 + (k % cols) * (vehicles ? 0.03 : 0.024), 0.06 + Math.floor(k / cols) * (vehicles ? 0.06 : 0.03)));
  (unit.road || []).slice(0, 8).forEach((n, k) => add(n, -width / 2 - 0.06 - (k % 2) * 0.03, backZ + 0.02 + Math.floor(k / 2) * 0.07, Math.PI));
  L.total = Math.round(unit.counts?.total ?? L.drawn);
  L.width = width + 0.2; L.depth = 0.46;
  L.seal = { text: `${L.drawn === L.total ? "✓" : "◐"} ${L.drawn} de ${L.total} desenhados`, ok: L.drawn === L.total };
  // What did not fit, written (never a decoration that looks like data).
  const left = (unit.queue?.length || 0) - Math.min(20, unit.queue?.length || 0);
  L.extra = left > 0 ? `+${left} na fila` : "";
  return L;
}

/** "Doca 03" -> "03" when the place label is the prefix; the name otherwise. */
export function shortName(name, label) {
  const s = String(name || "");
  if (!label) return s;
  const rest = s.replace(new RegExp(`^${String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "");
  return rest || s;
}

/** "ao vivo · 14:05" (amber after 10 minutes: "desatualizado"). */
export function liveLabel(iso, now = Date.now()) {
  if (!iso) return { text: "", stale: false };
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return { text: "", stale: false };
  const stale = now - at.getTime() > 10 * 60_000;
  const hh = String(at.getHours()).padStart(2, "0"); const mm = String(at.getMinutes()).padStart(2, "0");
  return { text: `${stale ? "desatualizado" : "ao vivo"} · ${hh}:${mm}`, stale };
}

/** "18 min", "2 h 10". */
export function waitText(minutes) {
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60); const m = Math.round(minutes % 60);
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}
