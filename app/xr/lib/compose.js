// The scene composer: a scene as the Aurora (or a recipe) describes it — zones with their things —
// laid out on the plate like a model maker would: a fenced pasture with its gate, crops in rows, a
// wood dense at the middle and thin at the edges, a lake with stones and plants on the shore and
// boats on the water, buildings facing the street, a square with its fountain, benches and lamps,
// tents around the fire, roads and rails that vehicles follow, mountains at the back; then the
// detail pass fills the empty ground (grass, flowers, pebbles) so nothing looks bare.
// Pure (no three.js): the catalog (app/xr/assets/catalog.json) comes in; everything is in metres of
// the miniature, x right, z toward the viewer, y up. The same input gives the same scene (seeded).
import { rng, norm, singular } from "./scene.js";
import { pathLength, pointOnPath } from "./dynamics.js";
export { pathLength, pointOnPath };

export const PLATE = { width: 0.9, depth: 0.6, cols: 4, rows: 3 };
export const GROUNDS = { grama: "#4a8a3c", areia: "#e3cf9a", agua: "#2f78b5", neve: "#eef3f8", asfalto: "#4a4f57", terra: "#9a7a55", espaco: "#141833", lava: "#3a1a12", madeira: "#9b7b58", pedra: "#8a8f96" };
export const ZONES = ["cercado", "lavoura", "bosque", "lago", "quadra", "praca", "feira", "acampamento", "estacionamento", "cemiterio", "porto", "livre", "borda", "ceu", "orbita"];
const PATCH = { cercado: "#5f9a45", lavoura: "#7a5a3a", quadra: "#b9bcc2", praca: "#c9c2b2", feira: "#c9b48c", acampamento: "#8d7650", estacionamento: "#5a5f66", cemiterio: "#5b7a46" };
const ROAD_W = { rua: 0.045, terra: 0.035, trilho: 0.03 };

/** The catalog as a lookup: id -> type, and words (name, synonyms) -> id. */
export function indexCatalog(catalog) {
  const byId = new Map(); const words = new Map();
  for (const t of catalog?.types || []) {
    byId.set(t.id, t);
    for (const w of [t.id, ...String(t.sin || "").split(/\s+/), ...norm(t.nome).split(/\s+/)]) {
      if (!w) continue; const n = norm(w).replace(/[^a-z0-9_-]/g, "");
      if (n && !words.has(n)) words.set(n, t.id);
      const s = singular(n); if (s && !words.has(s)) words.set(s, t.id);
    }
  }
  return { byId, words, types: catalog?.types || [] };
}
/** A name the Aurora wrote ("vacas", "coqueiro", "T-Rex") to a type id; null when unknown. */
export function resolveType(cat, name) {
  const n = norm(name).trim(); if (!n) return null;
  if (cat.byId.has(n.replace(/\s+/g, "_"))) return n.replace(/\s+/g, "_");
  const flat = n.replace(/[^a-z0-9_ -]/g, "");
  if (cat.words.has(flat.replace(/\s+/g, "_"))) return cat.words.get(flat.replace(/\s+/g, "_"));
  for (const w of flat.split(/[\s_-]+/)) { const id = cat.words.get(w) || cat.words.get(singular(w)); if (id) return id; }
  return null;
}

// ---------------- geometry helpers ----------------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r3 = (v) => Math.round(v * 1000) / 1000;
function inEllipse(x, z, e, pad = 0) { const dx = (x - e.x) / Math.max(1e-6, e.rx + pad), dz = (z - e.z) / Math.max(1e-6, e.rz + pad); return dx * dx + dz * dz <= 1; }
/** Distance from a point to a polyline (closed or not). */
function distToPath(x, z, pts, closed) {
  let best = Infinity; const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % n]; const dx = bx - ax, dz = bz - az; const L = dx * dx + dz * dz || 1e-9;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / L, 0, 1); best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return best;
}
/** The nearest point of a polyline to a point, and how far. */
function nearestOnPath(x, z, pts, closed) {
  let best = { d: Infinity, x, z }; const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % n]; const dx = bx - ax, dz = bz - az; const L = dx * dx + dz * dz || 1e-9;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / L, 0, 1); const px = ax + t * dx, pz = az + t * dz; const d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { d, x: px, z: pz };
  }
  return best;
}
export { distToPath };
/**
 * How much ground a thing covers: the radius of its footprint (from the model's measured sides, the
 * variant used, or the widest of them), so nothing is put on a road, in the water or inside another thing.
 */
export function footprintOf(t, size, vi = null) {
  let k = 0; const list = vi != null && t?.v?.[vi]?.d ? [t.v[vi]] : t?.v || [];
  for (const v of list) if (v.d && Math.max(...v.d) > 0) k = Math.max(k, Math.hypot(v.d[0], v.d[2]) / (2 * Math.max(...v.d)));
  if (!k) k = t?.zona === "lote" || t?.zona === "construcao" || t?.zona === "centro" ? 0.6 : 0.45;
  return size * k * 0.85;
}
/** A rounded rectangle as a closed polyline (the loops vehicles drive). */
function roundedRect(x0, z0, x1, z1, r, seg = 4) {
  const pts = []; r = Math.min(r, (x1 - x0) / 2, (z1 - z0) / 2);
  const corners = [[x1 - r, z0 + r, -Math.PI / 2], [x1 - r, z1 - r, 0], [x0 + r, z1 - r, Math.PI / 2], [x0 + r, z0 + r, Math.PI]];
  for (const [cx, cz, a0] of corners) for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * (Math.PI / 2); pts.push([r3(cx + r * Math.cos(a)), r3(cz + r * Math.sin(a))]); }
  return pts;
}
function ellipseLoop(e, k = 0.6, n = 24) { const pts = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push([r3(e.x + e.rx * k * Math.cos(a)), r3(e.z + e.rz * k * Math.sin(a))]); } return pts; }

// ---------------- the composer ----------------
/**
 * spec: { titulo, chao, estrada: nenhuma|anel|grade|cruz, detalhe: 0..1, zonas: [{ tipo, onde, tam, itens: [{ tipo, qtd, anda, nome }] }], itens: [...] }
 * Returns the layout scene3d draws: ground, patches, water, roads, fences, things (with behaviour and
 * path), decor (instanced grass, flowers...), and what was asked but is not in the catalog (`missing`).
 */
export function compose(specIn, catalog, seed = "", { clear = true } = {}) {
  const cat = catalog?.byId ? catalog : indexCatalog(catalog);
  const spec = specIn && typeof specIn === "object" ? specIn : {};
  const W = PLATE.width, D = PLATE.depth, cw = W / PLATE.cols, cd = D / PLATE.rows;
  const random = rng(`${seed}|${spec.titulo || spec.title || ""}`);
  const ground = GROUNDS[norm(spec.chao || spec.ground)] ? norm(spec.chao || spec.ground) : "grama";
  const L = { title: String(spec.titulo || spec.title || "Cenário").slice(0, 60), ground, groundColor: GROUNDS[ground], width: W, depth: D, patches: [], water: [], roads: [], fences: [], things: [], decor: [], missing: [] };
  const occupied = [];                 // circles on the ground: {x, z, r}
  const free = (x, z, r, pad = 0) => Math.abs(x) <= W / 2 - r && Math.abs(z) <= D / 2 - r
    && occupied.every((o) => Math.hypot(o.x - x, o.z - z) >= o.r + r + pad)
    && L.water.every((e) => !inEllipse(x, z, e, r)) && L.roads.every((rd) => distToPath(x, z, rd.points, rd.closed) >= rd.width / 2 + r);
  const pick = (t) => Math.floor(random() * Math.max(1, t.v.length));
  // Detail (grass, flowers, pebbles) in two looks per kind: hundreds of them, few draws on a headset.
  const pickDecor = (t) => Math.floor(random() * Math.max(1, Math.min(2, t.v.length)));

  // ---- 1. What is asked: zones with things (loose things go to the zone their type prefers) ----
  const item = (raw, zoneHint) => {
    const name = typeof raw === "string" ? raw : raw?.tipo || raw?.type || raw?.id || raw?.nome || raw?.name || "";
    const id = resolveType(cat, name) || resolveType(cat, raw?.nome || "");
    if (!id) { if (name) L.missing.push(String(name).slice(0, 40)); return null; }
    const t = cat.byId.get(id);
    const qtd = clamp(Math.round(Number(typeof raw === "object" ? raw.qtd ?? raw.quantidade ?? raw.count ?? 1 : 1)) || 1, 1, 24);
    const anda = typeof raw === "object" && raw.anda ? norm(raw.anda) : typeof raw === "object" && raw.comportamento ? norm(raw.comportamento) : null;
    return { t, qtd, anda, nome: typeof raw === "object" && raw.nome && norm(raw.nome) !== norm(t.nome) ? String(raw.nome).slice(0, 40) : "", zone: zoneHint };
  };
  let zones = (Array.isArray(spec.zonas) ? spec.zonas : []).slice(0, 12).map((z) => {
    const known = ZONES.includes(norm(z?.tipo));
    const itens = (Array.isArray(z?.itens) ? z.itens : []).map((i) => item(i)).filter(Boolean);
    // A zone named after a thing ("castelo", "muralha"): an open zone with that thing in it.
    const named = !known && z?.tipo && resolveType(cat, z.tipo) ? item({ tipo: z.tipo, qtd: 1 }) : null;
    return { tipo: known ? norm(z.tipo) : "livre", onde: norm(z?.onde || ""), tam: norm(z?.tam || ""), nome: String(z?.nome || ""), itens: named ? [named, ...itens] : itens };
  });
  const loose = (Array.isArray(spec.itens) ? spec.itens : Array.isArray(spec.items) ? spec.items : []).map((i) => item(i)).filter(Boolean);
  for (const it of loose) {
    // Things in the sky, at the back or on roads/rails need no zone of their own.
    const pref = it.t.zona;
    if (["ceu", "orbita", "borda", "estrada", "trilho"].includes(pref) || it.t.onde === "ar") { (zones.find((z) => z.tipo === "_soltos") || zones[zones.push({ tipo: "_soltos", itens: [] }) - 1]).itens.push(it); continue; }
    const zt = { lote: "quadra", construcao: "livre", centro: "livre", decor: "livre", calcada: "praca", cerca: "cercado" }[pref] || pref;
    let z = zones.find((x) => x.tipo === zt && x._auto) || null;
    if (!z) { z = { tipo: ZONES.includes(zt) ? zt : "livre", onde: "", tam: "", itens: [], _auto: true }; zones.push(z); }
    z.itens.push(it);
  }
  // A lake asked as an item makes a lake zone; fish without water bring a lake.
  for (const z of zones) for (const it of [...z.itens]) if (it.t.id === "lago" && z.tipo !== "lago") { z.itens.splice(z.itens.indexOf(it), 1); zones.push({ tipo: "lago", onde: "", tam: "", itens: [] }); }
  const swimmers = zones.flatMap((z) => z.tipo === "lago" || z.tipo === "porto" ? [] : z.itens.filter((it) => it.t.onde === "agua"));
  if (swimmers.length) {
    let lake = zones.find((z) => z.tipo === "lago" || z.tipo === "porto");
    if (!lake && ground !== "agua") { lake = { tipo: "lago", onde: "", tam: swimmers.some((s) => s.t.tam > 0.1) ? "g" : "", itens: [] }; zones.push(lake); }
    if (lake) for (const z of zones) if (z !== lake) z.itens = z.itens.filter((it) => (it.t.onde === "agua" ? (lake.itens.push(it), false) : true));
  }

  // Things of the roads, the rails, the sky and the back are laid out after the zones, wherever they
  // were asked (a parking lot keeps its cars parked).
  let soltos = zones.find((z) => z.tipo === "_soltos"); if (!soltos) { soltos = { tipo: "_soltos", itens: [] }; zones.push(soltos); }
  for (const z of zones) if (z !== soltos && z.tipo !== "estacionamento") z.itens = z.itens.filter((it) => (["estrada", "trilho", "ar"].includes(it.t.onde) || it.t.zona === "borda" ? (soltos.itens.push(it), false) : true));

  // ---- 2. Roads and rails ----
  const all = zones.flatMap((z) => z.itens);
  const drives = all.filter((it) => it.t.onde === "estrada" || it.t.zona === "estrada");
  const rails = all.filter((it) => it.t.onde === "trilho");
  let estrada = norm(spec.estrada || spec.ruas || "");
  if (!["anel", "grade", "cruz", "nenhuma"].includes(estrada)) estrada = zones.some((z) => z.tipo === "quadra") && zones.filter((z) => z.tipo === "quadra").length > 1 ? "grade" : drives.length ? "anel" : "nenhuma";
  if (estrada === "nenhuma" && drives.length) estrada = "anel";
  const roadKind = ["asfalto", "neve"].includes(ground) || zones.some((z) => z.tipo === "quadra" || z.tipo === "estacionamento") ? "rua" : ground === "espaco" ? "terra" : "terra";
  const gx = [-cw, 0, cw], gz = [-cd / 2, cd / 2];          // the inner grid lines
  const loops = [];
  if (estrada === "anel") loops.push(roundedRect(-cw, -cd / 2, cw, cd / 2, 0.06));
  if (estrada === "cruz") { L.roads.push({ points: [[-W / 2, 0], [W / 2, 0]], closed: false, width: ROAD_W[roadKind], kind: roadKind }); L.roads.push({ points: [[0, -D / 2], [0, D / 2]], closed: false, width: ROAD_W[roadKind], kind: roadKind }); loops.push(roundedRect(-cw * 1.5, -cd, cw * 1.5, cd, 0.05)); }
  if (estrada === "grade") {
    // Streets on every inner line and a ring around: each block is a loop the cars go round.
    for (const x of gx) L.roads.push({ points: [[x, -D / 2 + 0.02], [x, D / 2 - 0.02]], closed: false, width: ROAD_W.rua, kind: "rua" });
    for (const z of gz) L.roads.push({ points: [[-W / 2 + 0.02, z], [W / 2 - 0.02, z]], closed: false, width: ROAD_W.rua, kind: "rua" });
    for (let c = 0; c < 2; c++) for (let r = 0; r < 1; r++) loops.push(roundedRect(gx[c], gz[r], gx[c + 1], gz[r + 1], 0.03));
    loops.push(roundedRect(-cw, -cd / 2, cw, cd / 2, 0.03));
  }
  for (const pts of loops) L.roads.push({ points: pts, closed: true, width: ROAD_W[estrada === "grade" ? "rua" : roadKind], kind: estrada === "grade" ? "rua" : roadKind, loop: true });
  if (rails.length) L.roads.push({ points: roundedRect(-W / 2 + 0.035, -D / 2 + 0.035, W / 2 - 0.035, D / 2 - 0.035, 0.09, 6), closed: true, width: ROAD_W.trilho, kind: "trilho", loop: true });

  // ---- 3. Zones on the grid (4 x 3 cells) ----
  const grid = Array.from({ length: PLATE.rows }, () => Array(PLATE.cols).fill(null));
  const wantCells = (z) => {
    if (["_soltos", "ceu", "orbita", "borda"].includes(z.tipo)) return 0;
    const bulk = z.itens.reduce((n, it) => n + it.qtd * Math.max(it.t.tam, 0.02) ** 2 * (it.t.zona === "lote" ? 2.5 : 1.6), 0);
    const byTam = { p: 1, m: 2, g: 4 }[z.tam];
    return byTam || clamp(Math.ceil(bulk / (cw * cd * 0.55)), 1, z.tipo === "lago" ? 2 : 4);
  };
  const shapes = { 1: [[1, 1]], 2: [[2, 1], [1, 2]], 3: [[3, 1], [2, 1]], 4: [[2, 2], [4, 1], [3, 1]], 6: [[3, 2]] };
  const prefer = (onde) => ({ fundo: [null, 0], tras: [null, 0], frente: [null, 2], esquerda: [0, null], direita: [3, null], centro: [1.5, 1], meio: [1.5, 1], nordeste: [3, 0], noroeste: [0, 0], sudeste: [3, 2], sudoeste: [0, 2] })[onde] || [null, null];
  const placed = [];
  const order = zones.map((z, i) => [z, wantCells(z), i]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || a[2] - b[2]);
  // Everything must fit the 12 cells: the biggest zones give up cells first (never below one).
  const cells = PLATE.cols * PLATE.rows;
  while (order.reduce((s, o) => s + o[1], 0) > cells && order.some((o) => o[1] > 1)) { const big = order.reduce((a, b) => (b[1] > a[1] ? b : a)); big[1] = big[1] === 4 ? 2 : big[1] - 1; }
  for (const [z, n] of order) {
    const [pc, pr] = prefer(z.onde); let best = null;
    for (const size of [n, 4, 3, 2, 1].filter((s, i, a) => s <= n && a.indexOf(s) === i)) {
      for (const [w, h] of shapes[size] || shapes[1]) for (let r = 0; r + h <= PLATE.rows; r++) for (let c = 0; c + w <= PLATE.cols; c++) {
        let ok = true; for (let i = 0; i < h && ok; i++) for (let j = 0; j < w && ok; j++) ok = !grid[r + i][c + j];
        if (!ok) continue;
        const cc = c + (w - 1) / 2, rr = r + (h - 1) / 2;
        const score = (pc == null ? 0 : Math.abs(cc - pc)) + (pr == null ? 0 : Math.abs(rr - pr)) * 1.2 + random() * 0.3 + (z.tipo === "lago" && rr === 1 && cc > 0.5 && cc < 2.5 ? 0.6 : 0);
        if (!best || score < best.score) best = { c, r, w, h, score };
      }
      if (best) break;
    }
    if (!best) {
      // No room left: one cell where there is least, shared (the zone is smaller than asked).
      const c = Math.floor(random() * PLATE.cols), r = Math.floor(random() * PLATE.rows); best = { c, r, w: 1, h: 1 }; z.shared = true;
    }
    for (let i = 0; i < best.h; i++) for (let j = 0; j < best.w; j++) grid[best.r + i][best.c + j] = z;
    // The zone's rectangle, inset from the cell lines (and further where a road runs).
    const x0 = -W / 2 + best.c * cw, x1 = x0 + best.w * cw, z0 = -D / 2 + best.r * cd, z1 = z0 + best.h * cd;
    const roadPad = estrada === "nenhuma" ? 0.012 : 0.035;
    z.rect = { x0: x0 + (best.c ? roadPad : 0.015), x1: x1 - (best.c + best.w < PLATE.cols ? roadPad : 0.015), z0: z0 + (best.r ? roadPad : 0.015), z1: z1 - (best.r + best.h < PLATE.rows ? roadPad : 0.015) };
    placed.push(z);
  }

  // ---- 4. Lay each zone out ----
  const put = (t, x, z, rot, opts = {}) => {
    const size = r3(t.tam * (opts.scale || 1) * (0.92 + random() * 0.16));
    const thing = { type: t.id, v: opts.v ?? pick(t), x: r3(x), y: r3(opts.y || 0), z: r3(z), rot: r3(rot), size, behavior: opts.anda || t.anda || "parado", label: opts.nome || t.nome, fixed: !!t.fixo || !!opts.fixed, zone: opts.zone || "" };
    if (opts.path != null) { thing.path = opts.path; thing.s = r3(opts.s || 0); }
    if (opts.area) thing.area = opts.area;
    L.things.push(thing);
    if (!opts.y && t.onde !== "agua" && t.onde !== "ar") occupied.push({ x, z, r: footprint(t, size, thing.v) });
    return thing;
  };
  const footprint = (t, size, vi) => (t.cerca ? size * 0.2 : footprintOf(t, size, vi) * 0.85);
  const scatter = (it, area, opts = {}) => {
    for (let k = 0; k < it.qtd; k++) {
      const v = pick(it.t); let at = null, scale = 1;
      // A big thing (a castle in a small zone) is made a little smaller before it is left out.
      for (const k of it.t.tam > 0.12 ? [1, 0.75, 0.55] : [1]) {
        const r = footprint(it.t, it.t.tam * k, v); scale = k;
        for (let a = 0; a < 60 && !at; a++) {
          const [x, z] = area.sample();
          if (opts.water ? area.contains(x, z, r * 0.5) : area.contains(x, z, r * 0.7) && free(x, z, r, opts.pad ?? 0.004)) at = [x, z];
        }
        if (!at && !opts.water) for (let a = 0; a < 40 && !at; a++) { const [x, z] = area.sample(); if (area.contains(x, z, r * 0.4) && free(x, z, r * 0.6)) at = [x, z]; }
        if (at) break;
      }
      if (!at) continue;
      put(it.t, at[0], at[1], opts.face ? opts.face(at[0], at[1]) : random() * Math.PI * 2, { v, scale, anda: it.anda, nome: it.nome, zone: opts.zone, area: opts.area, path: opts.path, s: random() });
    }
  };
  const rectArea = (R, inset = 0) => ({ sample: () => [R.x0 + inset + random() * (R.x1 - R.x0 - 2 * inset), R.z0 + inset + random() * (R.z1 - R.z0 - 2 * inset)], contains: (x, z, r = 0) => x - r >= R.x0 && x + r <= R.x1 && z - r >= R.z0 && z + r <= R.z1 });
  const ellArea = (e, k = 1) => ({ sample: () => { const a = random() * Math.PI * 2, d = Math.sqrt(random()) * k; return [e.x + Math.cos(a) * e.rx * d, e.z + Math.sin(a) * e.rz * d]; }, contains: (x, z, r = 0) => inEllipse(x, z, { x: e.x, z: e.z, rx: e.rx * k - r, rz: e.rz * k - r }) });
  const centre = (R) => [(R.x0 + R.x1) / 2, (R.z0 + R.z1) / 2];
  const T = (id) => cat.byId.get(id);
  const fenceOf = (z) => (z.itens.find((it) => it.t.cerca) || {}).t || T(z.tipo === "cemiterio" ? "grade_ferro" : "cerca");
  const fence = (R, t, gateSide) => {
    if (!t) return; const len = t.tam * 0.95; const sides = [["n", R.x0, R.z0, R.x1, R.z0], ["e", R.x1, R.z0, R.x1, R.z1], ["s", R.x1, R.z1, R.x0, R.z1], ["w", R.x0, R.z1, R.x0, R.z0]];
    for (const [side, ax, az, bx, bz] of sides) {
      const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / len)); const rot = Math.atan2(bz - az, bx - ax);
      for (let i = 0; i < n; i++) {
        if (side === gateSide && (i === Math.floor(n / 2))) continue;      // the gate: a gap in the middle of the side facing the farm
        const u = (i + 0.5) / n; L.fences.push({ type: t.id, v: 0, x: r3(ax + (bx - ax) * u), z: r3(az + (bz - az) * u), rot: r3(-rot), size: r3(Math.hypot(bx - ax, bz - az) / n * 1.02) });
      }
    }
    occupied.push(...[[R.x0, R.z0], [R.x1, R.z0], [R.x0, R.z1], [R.x1, R.z1]].map(([x, z]) => ({ x, z, r: 0.006 })));
  };
  const gateTowardCentre = (R) => { const [x, z] = centre(R); return Math.abs(x) / W > Math.abs(z) / D ? (x > 0 ? "w" : "e") : (z > 0 ? "n" : "s"); };
  const faceOut = (R) => (x, z) => { const dl = x - R.x0, dr = R.x1 - x, dt = z - R.z0, db = R.z1 - z; const m = Math.min(dl, dr, dt, db); return m === db ? 0 : m === dt ? Math.PI : m === dr ? Math.PI / 2 : -Math.PI / 2; };
  const faceTo = (cx, cz) => (x, z) => Math.atan2(cx - x, cz - z);

  for (const z of placed) {
    const R = z.rect; const [cx, cz] = centre(R); const area = rectArea(R, 0.01);
    if (PATCH[z.tipo]) L.patches.push({ shape: z.tipo === "acampamento" ? "ellipse" : "rect", x: r3(cx), z: r3(cz), w: r3(R.x1 - R.x0), d: r3(R.z1 - R.z0), color: PATCH[z.tipo], rows: z.tipo === "lavoura" });
    const things = z.itens.filter((it) => !it.t.cerca);
    switch (z.tipo) {
      case "cercado": case "cemiterio": {
        fence(R, fenceOf(z), gateTowardCentre(R));
        const inner = { x0: R.x0 + 0.015, x1: R.x1 - 0.015, z0: R.z0 + 0.015, z1: R.z1 - 0.015 };
        if (z.tipo === "cemiterio") {
          const graves = things.filter((it) => it.t.id === "lapide"); const rest = things.filter((it) => it.t.id !== "lapide");
          const n = graves.reduce((s, g) => s + g.qtd, 0) || 12; const cols = Math.max(2, Math.round(Math.sqrt(n * (inner.x1 - inner.x0) / (inner.z1 - inner.z0))));
          for (let i = 0; i < n; i++) { const c = i % cols, r = Math.floor(i / cols); const x = inner.x0 + (c + 0.5) * (inner.x1 - inner.x0) / cols, zz = inner.z0 + 0.03 + r * 0.035; if (zz < inner.z1) put(T("lapide"), x, zz, 0, { zone: "cemiterio" }); }
          for (const it of rest) scatter(it, rectArea(inner), { zone: z.tipo });
        } else for (const it of things) scatter(it, rectArea(inner), { zone: "cercado", area: inner });
        break;
      }
      case "lavoura": {
        // Rows across the field, one crop per band.
        const crops = things.filter((it) => it.t.zona === "lavoura"); const other = things.filter((it) => it.t.zona !== "lavoura");
        const list = crops.length ? crops : [{ t: T("milho") || T("trigo"), qtd: 1 }].filter((c) => c.t);
        const rows = Math.max(3, Math.floor((R.z1 - R.z0) / 0.03));
        for (let r = 0; r < rows; r++) {
          const crop = list[Math.floor(r / Math.ceil(rows / list.length)) % list.length].t; const zz = R.z0 + 0.015 + r * (R.z1 - R.z0 - 0.03) / Math.max(1, rows - 1);
          const step = Math.max(0.016, crop.tam * 0.8);
          for (let x = R.x0 + 0.012; x < R.x1 - 0.008; x += step) { L.things.push({ type: crop.id, v: pick(crop), x: r3(x + (random() - 0.5) * 0.004), y: 0, z: r3(zz), rot: r3(random() * 6.28), size: r3(crop.tam * (0.85 + random() * 0.3)), behavior: "parado", label: crop.nome, fixed: true, zone: "lavoura", crop: true }); }
        }
        occupied.push({ x: cx, z: cz, r: Math.min(R.x1 - R.x0, R.z1 - R.z0) / 2 });
        for (const it of other) scatter(it, { sample: () => [R.x0 + random() * (R.x1 - R.x0), random() < 0.5 ? R.z0 - 0.02 : R.z1 + 0.02], contains: () => true }, { zone: "lavoura" });
        break;
      }
      case "lago": case "porto": {
        const big = things.some((it) => it.t.tam > 0.12);
        const e = { x: r3(cx), z: r3(cz), rx: r3((R.x1 - R.x0) / 2 * (big ? 0.95 : 0.85)), rz: r3((R.z1 - R.z0) / 2 * (big ? 0.92 : 0.8)) };
        L.water.push(e);
        const inWater = things.filter((it) => it.t.onde === "agua" && it.t.id !== "cais"); const shore = things.filter((it) => it.t.onde !== "agua" || it.t.id === "cais");
        const loopIndex = (k) => { L.roads.push({ points: ellipseLoop(e, 0.45 + 0.25 * k, 28), closed: true, width: 0, kind: "agua", loop: true }); return L.roads.length - 1; };
        const swimPath = [loopIndex(0), loopIndex(1)];
        for (const it of inWater) {
          const lily = it.t.anda === "parado" || it.t.anda === "flutuar";
          for (let k = 0; k < it.qtd; k++) {
            if (lily) { const [x, zz] = ellArea(e, 0.85).sample(); put(it.t, x, zz, random() * 6.28, { zone: "lago" }); continue; }
            const p = swimPath[k % 2]; put(it.t, e.x, e.z, 0, { anda: "rota", path: p, s: random(), zone: "lago", nome: it.nome });
          }
        }
        // The shore: stones and plants around; the dock reaching into the water.
        const ring = Math.round((e.rx + e.rz) * 60);
        for (let i = 0; i < ring; i++) {
          const a = (i / ring) * Math.PI * 2 + random() * 0.2; const k = 1.02 + random() * 0.08; const t = random() < 0.55 ? T("pedra") : T("capim");
          if (t) L.decor.push({ type: t.id, v: pickDecor(t), x: r3(e.x + Math.cos(a) * e.rx * k), z: r3(e.z + Math.sin(a) * e.rz * k), rot: r3(random() * 6.28), size: r3(t.tam * (0.4 + random() * 0.5)) });
        }
        for (const it of shore) {
          if (it.t.id === "cais") { const a = Math.atan2(-e.z, -e.x); for (let k = 0; k < it.qtd; k++) { const aa = a + (k - (it.qtd - 1) / 2) * 0.6; put(it.t, e.x + Math.cos(aa) * e.rx * 0.88, e.z + Math.sin(aa) * e.rz * 0.88, Math.PI / 2 - aa, { zone: "lago", fixed: true }); } continue; }
          for (let k = 0; k < it.qtd; k++) { let at = null; for (let a = 0; a < 40 && !at; a++) { const aa = random() * Math.PI * 2, kk = 1.15 + random() * 0.3; const x = e.x + Math.cos(aa) * e.rx * kk, zz = e.z + Math.sin(aa) * e.rz * kk; if (free(x, zz, footprint(it.t, it.t.tam))) at = [x, zz]; } if (at) put(it.t, at[0], at[1], faceTo(e.x, e.z)(...at), { zone: "lago", anda: it.anda }); }
        }
        occupied.push({ x: e.x, z: e.z, r: 0 });
        break;
      }
      case "quadra": {
        // Buildings along the edges of the block, facing the street; the inside: trees and yards.
        const builds = things.filter((it) => ["lote", "construcao", "centro"].includes(it.t.zona)); const rest = things.filter((it) => !builds.includes(it));
        const queue = builds.flatMap((it) => Array.from({ length: it.qtd }, () => it.t));
        const edge = []; const later = [];
        const step = (len, s) => { const n = Math.max(1, Math.floor(len / s)); return Array.from({ length: n }, (_, i) => (i + 0.5) / n); };
        for (const [side, a, b, fixed, rot] of [["s", R.x0, R.x1, R.z1, 0], ["n", R.x0, R.x1, R.z0, Math.PI], ["w", R.z0, R.z1, R.x0, -Math.PI / 2], ["e", R.z0, R.z1, R.x1, Math.PI / 2]]) {
          const t = queue[0]; if (!t) break; const s = t.tam * 0.75 + 0.008;
          for (const u of step(b - a, s)) edge.push({ side, at: a + (b - a) * u, fixed, rot });
        }
        for (const slot of edge) {
          const t = queue.shift(); if (!t) break; const inset = t.tam * 0.36; const v = pick(t);
          const [x, zz] = slot.side === "s" ? [slot.at, slot.fixed - inset] : slot.side === "n" ? [slot.at, slot.fixed + inset] : slot.side === "w" ? [slot.fixed + inset, slot.at] : [slot.fixed - inset, slot.at];
          if (free(x, zz, footprint(t, t.tam, v) * 0.8)) put(t, x, zz, slot.rot, { zone: "quadra", v }); else later.push(t);
        }
        // What did not fit along the street goes inside the block.
        for (const t of [...later, ...queue]) scatter({ t, qtd: 1 }, area, { zone: "quadra", face: faceOut(R) });
        for (const it of rest) scatter(it, area, { zone: "quadra" });
        break;
      }
      case "praca": {
        const mid = things.find((it) => it.t.zona === "centro") || (T("praca_fonte") && { t: T("praca_fonte"), qtd: 1 });
        if (mid) put(mid.t, cx, cz, 0, { zone: "praca" });
        const ringR = Math.min(R.x1 - R.x0, R.z1 - R.z0) * 0.36;
        const benches = things.find((it) => it.t.id === "banco") || (T("banco") && { t: T("banco"), qtd: 4 });
        const lamps = things.find((it) => it.t.id === "poste") || (T("poste") && { t: T("poste"), qtd: 4 });
        if (benches) for (let i = 0; i < benches.qtd; i++) { const a = (i / benches.qtd) * Math.PI * 2 + 0.4; const x = cx + Math.cos(a) * ringR, zz = cz + Math.sin(a) * ringR; put(benches.t, x, zz, faceTo(cx, cz)(x, zz), { zone: "praca" }); }
        if (lamps) for (let i = 0; i < lamps.qtd; i++) { const a = (i / lamps.qtd) * Math.PI * 2; put(lamps.t, cx + Math.cos(a) * ringR * 1.35, cz + Math.sin(a) * ringR * 1.35, 0, { zone: "praca" }); }
        for (const it of things.filter((x) => x !== mid && x.t.id !== "banco" && x.t.id !== "poste")) scatter(it, area, { zone: "praca", area: R });
        break;
      }
      case "feira": case "estacionamento": {
        // Rows facing an aisle in the middle.
        const rowsT = things.filter((it) => (z.tipo === "feira" ? it.t.zona === "feira" || it.t.zona === "construcao" : it.t.onde === "estrada"));
        const rest = things.filter((it) => !rowsT.includes(it));
        const queue = rowsT.flatMap((it) => Array.from({ length: it.qtd }, () => it.t));
        for (const [zz, rot] of [[R.z0 + 0.03, 0], [R.z1 - 0.03, Math.PI]]) {
          for (let x = R.x0 + 0.03; x < R.x1 - 0.02 && queue.length; ) { const t = queue.shift(); put(t, x + t.tam * 0.35, zz, rot + (z.tipo === "estacionamento" ? Math.PI / 2 : 0), { zone: z.tipo, anda: "parado" }); x += t.tam * (z.tipo === "estacionamento" ? 0.55 : 0.85); }
        }
        for (const it of rest) scatter(it, { sample: () => [R.x0 + random() * (R.x1 - R.x0), cz + (random() - 0.5) * 0.04], contains: () => true }, { zone: z.tipo });
        break;
      }
      case "acampamento": {
        const fire = things.find((it) => it.t.id === "fogueira") || (T("fogueira") && { t: T("fogueira"), qtd: 1 });
        if (fire) put(fire.t, cx, cz, 0, { zone: "acampamento" });
        const tents = things.filter((it) => it.t.id === "barraca" || it.t.id === "cabana"); const nT = tents.reduce((s, it) => s + it.qtd, 0);
        let i = 0; for (const it of tents) for (let k = 0; k < it.qtd; k++, i++) { const a = (i / Math.max(1, nT)) * Math.PI * 2; const rr = Math.min(R.x1 - R.x0, R.z1 - R.z0) * 0.36; const x = cx + Math.cos(a) * rr, zz = cz + Math.sin(a) * rr; put(it.t, x, zz, faceTo(cx, cz)(x, zz), { zone: "acampamento" }); }
        const logs = T("tronco"); if (logs) for (let k = 0; k < 3; k++) { const a = k * 2.1 + 0.5; L.things.push({ type: logs.id, v: 0, x: r3(cx + Math.cos(a) * 0.035), y: 0, z: r3(cz + Math.sin(a) * 0.035), rot: r3(a + Math.PI / 2), size: r3(logs.tam * 0.7), behavior: "parado", label: logs.nome, fixed: false, zone: "acampamento" }); }
        for (const it of things.filter((x) => x !== fire && !tents.includes(x))) scatter(it, ellArea({ x: cx, z: cz, rx: (R.x1 - R.x0) * 0.4, rz: (R.z1 - R.z0) * 0.4 }), { zone: "acampamento" });
        break;
      }
      case "bosque": {
        // Dense in the middle, thinner at the edges; undergrowth comes with it.
        const e = { x: cx, z: cz, rx: (R.x1 - R.x0) / 2, rz: (R.z1 - R.z0) / 2 };
        const trees = things.length ? things : [{ t: T("arvore"), qtd: 6 }].filter((x) => x.t);
        for (const it of trees) scatter(it, ellArea(e, 0.95), { zone: "bosque", pad: -0.006 });
        for (const id of ["arbusto", "samambaia", "cogumelo", "toco", "pedra"]) { const t = T(id); if (!t || ground === "neve" && id === "samambaia") continue; const n = Math.round((e.rx * e.rz) * (id === "arbusto" ? 260 : 90)); for (let k = 0; k < n; k++) { const [x, zz] = ellArea(e).sample(); if (free(x, zz, t.tam * 0.25)) L.decor.push({ type: id, v: pickDecor(t), x: r3(x), z: r3(zz), rot: r3(random() * 6.28), size: r3(t.tam * (0.6 + random() * 0.6)) }); } }
        break;
      }
      case "livre": default: {
        // Buildings first (each with breathing room), then the rest around them.
        const big = things.filter((it) => ["lote", "construcao", "centro"].includes(it.t.zona)).sort((a, b) => b.t.tam - a.t.tam);
        for (const it of big) scatter(it, area, { zone: "livre", pad: 0.012, face: () => [0, Math.PI / 2, Math.PI, -Math.PI / 2][Math.floor(random() * 4)] });
        for (const it of things.filter((x) => !big.includes(x))) scatter(it, area, { zone: "livre", area: R });
      }
    }
  }

  // ---- 5. What has no zone: vehicles on roads and rails, the sky, the back, the orbits ----
  const loopsIdx = L.roads.map((r, i) => (r.loop && r.kind !== "agua" && r.kind !== "trilho" ? i : -1)).filter((i) => i >= 0);
  const railIdx = L.roads.findIndex((r) => r.kind === "trilho");
  let car = 0;
  const later = soltos.itens;
  for (const it of later) {
    if (it.t.onde === "estrada" && loopsIdx.length) for (let k = 0; k < it.qtd; k++, car++) put(it.t, 0, 0, 0, { anda: "rota", path: loopsIdx[car % loopsIdx.length], s: (car * 0.137 + random() * 0.05) % 1, nome: it.nome, zone: "estrada" });
    else if (it.t.onde === "trilho" && railIdx >= 0) {
      // A train: the engine and its cars one behind the other on the rails.
      const per = it.t.tam * 1.05 / pathLength(L.roads[railIdx].points, true);
      for (let k = 0; k < it.qtd; k++) put(it.t, 0, 0, 0, { anda: "rota", path: railIdx, s: (0.5 - (L.things.filter((t) => t.path === railIdx).length) * per + 1) % 1, nome: it.nome, zone: "trilho" });
    }
  }
  const sun = later.find((it) => it.t.id === "sol");
  for (const it of later) {
    if (it.t.onde !== "ar") continue;
    for (let k = 0; k < it.qtd; k++) {
      if (it.t.id === "sol") { put(it.t, ground === "espaco" ? 0 : W * 0.32, 0, ground === "espaco" ? 0 : -D * 0.3, { y: ground === "espaco" ? 0.12 : 0.3, zone: "ceu" }); continue; }
      if (it.t.anda === "orbitar" && sun) { const a = random() * 6.28, rr = 0.1 + (k + L.things.filter((t) => t.behavior === "orbitar").length) * 0.045; put(it.t, Math.cos(a) * rr, Math.sin(a) * rr * 0.75, 0, { y: 0.1 + random() * 0.04, zone: "orbita", anda: "orbitar" }); continue; }
      const y = it.t.id === "nuvem" ? 0.24 + random() * 0.06 : it.t.id === "estrela" ? 0.12 + random() * 0.16 : 0.13 + random() * 0.1;
      put(it.t, (random() - 0.5) * W * 0.8, (random() - 0.5) * D * 0.7, random() * 6.28, { y, anda: it.anda || (it.t.anda === "orbitar" ? "flutuar" : it.t.anda), zone: "ceu", nome: it.nome });
    }
  }
  for (const it of later.filter((x) => x.t.zona === "borda")) for (let k = 0; k < it.qtd; k++) {
    // At the back, spread along it; big things a little off the plate's edge.
    // At the back, spread along it, a bit smaller than in the open (a horizon, not a wall); at most 3.
    if (k >= 3) break; const n = Math.min(3, it.qtd);
    const x = -W / 2 + (k + 0.5 + (random() - 0.5) * 0.4) * W / n; put(it.t, clamp(x, -W / 2 + 0.08, W / 2 - 0.08), -D / 2 + 0.055, random() * 6.28, { zone: "borda", fixed: true, scale: it.t.tam > 0.2 ? 0.7 : 1 });
  }

  // ---- 6. Nothing passes through anything ----
  if (clear) clearance(L, cat);

  // ---- 7. Detail: the empty ground gets grass, flowers, pebbles (by ground type) ----
  const detail = clamp(Number(spec.detalhe ?? 0.7), 0, 1);
  const DECOR = { grama: [["capim", 1], ["flor", 0.2], ["pedrinha", 0.15], ["arbusto", 0.06]], terra: [["capim", 0.5], ["pedrinha", 0.4]], areia: [["pedrinha", 0.4], ["capim", 0.15]], neve: [["pedrinha", 0.3]], espaco: [], lava: [["pedra", 0.3]], madeira: [], asfalto: [], agua: [], pedra: [] }[ground] || [];
  const tries = Math.round(W * D * 1100 * detail);
  for (let i = 0; i < tries; i++) {
    const x = (random() - 0.5) * W * 0.98, zz = (random() - 0.5) * D * 0.98;
    const total = DECOR.reduce((s, [, w]) => s + w, 0); if (!total) break;
    let u = random() * total; const [id] = DECOR.find(([, w]) => (u -= w) < 0) || DECOR[0]; const t = T(id); if (!t) continue;
    if (!free(x, zz, 0.004)) continue;
    if (L.patches.some((p) => p.rows && Math.abs(x - p.x) < p.w / 2 && Math.abs(zz - p.z) < p.d / 2)) continue;
    L.decor.push({ type: id, v: pickDecor(t), x: r3(x), z: r3(zz), rot: r3(random() * 6.28), size: r3(t.tam * (0.45 + random() * 0.55)) });
  }
  return L;
}

/** What stays where it is put (buildings, trees, statues, things that only turn or bob in place). */
const MOVES = new Set(["passear", "voar", "orbitar", "nadar", "rota", "rodar"]);
export const standsStill = (th, t) => th.path == null && !th.y && t && t.onde !== "agua" && t.onde !== "ar" && !MOVES.has(th.behavior);
const SOLID = 0.75;             // how much of a footprint must stay clear (the rest is a model's thin edges)
/**
 * The last pass of the composer, so vehicles and walkers never go through a statue or a wall:
 * - what stands still is moved off the roads, rails and water (or left out when it does not fit),
 *   and two that stand still never stand inside each other;
 * - each walker (people, animals) gets how far it may wander (roam) before it would touch something
 *   standing, a road or the water.
 */
export function clearance(L, cat) {
  const W = L.width, D = L.depth; const T = (th) => cat.byId.get(th.type);
  const roads = L.roads.filter((r) => r.kind !== "agua");
  const kept = []; const out = [];
  const violation = (x, z, r, t) => {
    for (const rd of roads) { const n = nearestOnPath(x, z, rd.points, rd.closed); const gap = n.d - rd.width / 2 - r; if (gap < 0) return { dx: n.d > 1e-6 ? (x - n.x) / n.d : 0, dz: n.d > 1e-6 ? (z - n.z) / n.d : 1, by: -gap + 0.002 }; }
    if (t.id !== "cais") for (const e of L.water) if (inEllipse(x, z, e, r * 0.8)) { const a = Math.atan2((z - e.z) / e.rz, (x - e.x) / e.rx); const bx = e.x + Math.cos(a) * (e.rx + r * 0.8 + 0.003), bz = e.z + Math.sin(a) * (e.rz + r * 0.8 + 0.003); return { dx: bx - x, dz: bz - z, by: 1 }; }
    return null;
  };
  // The biggest first: a castle keeps its place and a lamp next to it gives way, not the other way.
  const order = L.things.map((th, i) => [th, i]).sort((a, b) => b[0].size - a[0].size || a[1] - b[1]);
  const keep = new Set();
  for (const [th] of order) {
    const t = T(th);
    if (!standsStill(th, t)) { keep.add(th); continue; }
    let x = th.x, z = th.z, ok = false, size = th.size;
    // Off the roads and the water; a big one that cannot get off is made a little smaller first.
    for (let shrink = 0; shrink < 3 && !ok; shrink++) {
      if (shrink) { size *= 0.8; if (t.tam < 0.12) break; }
      const r = footprintOf(t, size, th.v) * SOLID;
      for (let k = 0; k < 8; k++) {
        const v = violation(x, z, r, t); if (!v) { ok = true; break; }
        x += v.dx * v.by; z += v.dz * v.by;
        x = clamp(x, -W / 2 + r * 0.5, W / 2 - r * 0.5); z = clamp(z, -D / 2 + r * 0.5, D / 2 - r * 0.5);
      }
    }
    if (!ok) continue;
    const r = footprintOf(t, size, th.v) * SOLID;
    // Two standing things never inside each other (the crops of a field stand in rows on their own).
    if (!th.crop && kept.some((o) => !o.th.crop && Math.hypot(o.x - x, o.z - z) < (o.r + r) * 0.55)) continue;
    th.x = r3(x); th.z = r3(z); th.size = r3(size); kept.push({ th, x, z, r }); keep.add(th);
  }
  for (const th of L.things) if (keep.has(th)) out.push(th);
  L.things = out;
  // Walkers: away from what stands (a mountain put at the back after them, a lamp of the square) and
  // then as far as they may go without touching it, a road or the water; one with no room is left out.
  const lost = new Set();
  for (const th of L.things) {
    const t = T(th); if (th.behavior !== "passear" || th.path != null || th.y) continue;
    const rw = footprintOf(t, th.size, th.v) * SOLID;
    const nearest = () => {
      let clear = 0.045 * 1.45, from = null;
      for (const o of kept) { const g = Math.hypot(o.x - th.x, o.z - th.z) - o.r - rw; if (g < clear) { clear = g; from = o; } }
      for (const rd of roads) { const n = nearestOnPath(th.x, th.z, rd.points, rd.closed); const g = n.d - rd.width / 2 - rw; if (g < clear) { clear = g; from = n; } }
      for (const e of L.water) { const g = (Math.hypot((th.x - e.x) / e.rx, (th.z - e.z) / e.rz) - 1) * Math.min(e.rx, e.rz) - rw; if (g < clear) { clear = g; from = e; } }
      return { clear, from };
    };
    let n = nearest();
    const A = th.area || { x0: -W / 2, x1: W / 2, z0: -D / 2, z1: D / 2 };
    for (let k = 0; k < 6 && n.clear < 0 && n.from; k++) {
      const dx = th.x - n.from.x, dz = th.z - n.from.z, d = Math.hypot(dx, dz) || 1; const by = -n.clear + 0.003;
      th.x = r3(clamp(th.x + (dx / d) * by, A.x0 + rw, A.x1 - rw)); th.z = r3(clamp(th.z + (dz / d) * by, A.z0 + rw, A.z1 - rw));
      n = nearest();
    }
    if (n.clear < 0) lost.add(th); else th.roam = r3(n.clear / 1.45);
  }
  if (lost.size) L.things = L.things.filter((th) => !lost.has(th));
  return L;
}

/** The types to tell the Aurora about for a request: those its words and themes point to, plus the basics. */
export function relevantTypes(catalog, text, limit = 45) {
  const cat = catalog?.byId ? catalog : indexCatalog(catalog);
  const ws = norm(text).replace(/[^a-z0-9 -]/g, " ").split(/\s+/).filter((w) => w.length > 2).map(singular);
  const score = (t) => {
    let s = 0; const tags = String(t.tags).split(/\s+/); const words = [t.id, ...String(t.sin).split(/\s+/), norm(t.nome)].map((w) => singular(norm(w)));
    for (const w of ws) { if (words.includes(w)) s += 6; if (tags.some((g) => singular(g) === w)) s += 3; }
    return s;
  };
  const named = cat.types.map((t) => [t, score(t)]).filter(([, s]) => s > 0);
  const themes = new Set(named.filter(([, s]) => s >= 3).flatMap(([t]) => String(t.tags).split(/\s+/)).filter((g) => !["animal", "gente", "veiculo", "natureza"].includes(g)));
  const out = new Map(named.map(([t, s]) => [t.id, s]));
  for (const t of cat.types) { const n = String(t.tags).split(/\s+/).filter((g) => themes.has(g)).length; if (n) out.set(t.id, (out.get(t.id) || 0) + n); }
  for (const id of ["pessoa", "arvore", "arbusto", "flor", "pedra", "lago", "cerca", "poste", "banco", "nuvem"]) if (cat.byId.has(id) && !out.has(id)) out.set(id, 0.5);
  return [...out].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => cat.byId.get(id));
}
