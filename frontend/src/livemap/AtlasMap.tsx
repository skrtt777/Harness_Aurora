import { useEffect, useMemo, useRef } from "react";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import { interpolateZoom } from "d3-interpolate";
import { Delaunay } from "d3-delaunay";
import { ACTIVITY_COLOR, edgesOf, reviewOf } from "./adapter";
import { cloudColor, viewHeight } from "./clouds";
import { SPACING, type AtlasLayout, type Ring } from "./atlas";
import type { Highlight, MapProps } from "./types";

/**
 * Memórias / Mapa Vivo — the memory as an atlas (atlas.ts lays it out), drawn on a 2D canvas like a night chart:
 *   - each section (a node of the Zeladora) is a territory in its own colour: its land, shore and contour lines
 *     are its memories' density; borders run where two sections meet; dotted routes join sections that share
 *     connections (thicker with more of them);
 *   - each memory is a settlement: a solid dot when proven (used, or written by a person), a ring while still in
 *     review; bigger when more relevant; its name appears as you zoom in (never two names on top of each other);
 *   - the Zeladora is a pale reticle walking from memory to memory along her trail, her threads reaching what she
 *     reads, her words beside her; a question to the Aurora is an orange probe with lines to every memory it weighed
 *     and bright ones to the memories it really used; what she prunes, joins, adopts and the nodes born or folded
 *     show where they happen;
 *   - the person pans (drag), zooms (wheel / pinch), clicks a memory or a territory, double-clicks to go into one;
 *     an inset in the corner shows where the view is in the whole map (click it to go there).
 * Tools: d3-contour (the terrain, in atlas.ts), d3-zoom + d3-interpolate (pan, zoom and smooth flights:
 * van Wijk & Nuij's zoom), d3-delaunay (the memory under the cursor). Nothing is invented: every dot is a stored
 * memory, every line a real connection or event.
 */
const BG = "#05070a";
const MONO = '"JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace';
const ACTIVE_MS = 9000;
const KEEPER = "#cfe9ff", PROBE = "#ff9d5c", SELECT = "#ff7aa8", FLAG = "#f2d14b", PRUNE = "#ff7a4d", INK = "#c9d4df";
const HL: Record<Highlight["kind"], string> = { recalled: PROBE, created: ACTIVITY_COLOR, search: "#9cc8ff", read: KEEPER, linked: KEEPER, flagged: FLAG, joined: "#ffffff" };
const PRUNE_MS = 3400, ARRIVAL_MS = 2600, BORN_MS = 4800, GONE_MS = 3200;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const easeOut = (u: number) => 1 - Math.pow(1 - u, 3);
const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

function pathOf(rings: Ring[]): Path2D {
  const p = new Path2D();
  for (const r of rings) { r.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y))); p.closePath(); }
  return p;
}
type Paths = { land: Path2D[]; relief: Path2D[][]; shore: Path2D; shallows: Path2D };
type View = { k: number; x: number; y: number };
type Flight = { i: ReturnType<typeof interpolateZoom>; t0: number; ms: number };
type State = {
  ids: string[]; index: Map<string, number>;
  from: Float64Array; to: Float64Array; cur: Float64Array; movedAt: number;
  paths: Paths | null; pathsAt: number; delaunay: Delaunay<number> | null;
  /** Where memories and territories were last drawn (a pruned memory, a folded node, are shown from there). */
  lastMem: Map<string, [number, number]>; lastTerr: Map<string, [number, number]>;
  view: View; flight: Flight | null; W: number; H: number; dpr: number; fitted: boolean; sized: boolean;
  keeperPos: [number, number] | null; agentKey: string; agentAt: number; agentEnded: number;
  hover: string | null; widths: Map<string, number>;
};

export default function AtlasMap(props: MapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef(props); live.current = props;
  const zoomRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const S = useRef<State>({
    ids: [], index: new Map(), from: new Float64Array(0), to: new Float64Array(0), cur: new Float64Array(0), movedAt: 0,
    paths: null, pathsAt: 0, delaunay: null, lastMem: new Map(), lastTerr: new Map(),
    view: { k: 1, x: 0, y: 0 }, flight: null, W: 800, H: 500, dpr: 1, fitted: false, sized: false,
    keeperPos: null, agentKey: "", agentAt: 0, agentEnded: 0, hover: null, widths: new Map(),
  });
  const { layout } = props;
  const scratch = useMemo(() => document.createElement("canvas").getContext("2d")!, []);

  // ---------- a new layout: settlements glide from where they were, the terrain is rebuilt ----------
  useMemo(() => {
    const s = S.current, now = performance.now();
    const ids = [...layout.nodes.keys()];
    const from = new Float64Array(ids.length * 2), to = new Float64Array(ids.length * 2);
    ids.forEach((id, i) => {
      const p = layout.nodes.get(id)!;
      to[i * 2] = p[0]; to[i * 2 + 1] = p[1];
      const old = s.index.get(id);
      const c = layout.clouds[layout.cloudOf.get(id) ?? 0];
      // A memory seen for the first time rises from its territory's middle.
      from[i * 2] = old !== undefined ? s.cur[old * 2] : c ? c.x : p[0];
      from[i * 2 + 1] = old !== undefined ? s.cur[old * 2 + 1] : c ? c.y : p[1];
      s.lastMem.set(id, [p[0], p[1]]);
    });
    for (const t of layout.atlas.territories) if (t) s.lastTerr.set(t.id, t.label);
    s.ids = ids; s.index = new Map(ids.map((id, i) => [id, i]));
    s.from = from; s.to = to; s.cur = new Float64Array(from); s.movedAt = now;
    s.paths = {
      land: layout.atlas.territories.map((t) => pathOf(t?.land || [])),
      relief: layout.atlas.territories.map((t) => (t?.relief || []).map(pathOf)),
      shore: pathOf(layout.atlas.shore), shallows: pathOf(layout.atlas.shallows),
    };
    s.pathsAt = now;
    s.delaunay = ids.length ? new Delaunay(to) : null;
  }, [layout]);

  // ---------- the view: d3-zoom for the person's hand, smooth flights for the camera commands ----------
  const fitScale = (L: AtlasLayout, W: number, H: number) => Math.min(W / (2 * L.halfW + 60), H / (2 * L.halfH + 60));
  const apply = (cx: number, cy: number, k: number) => {
    const c = canvasRef.current, z = zoomRef.current, s = S.current; if (!c || !z) return;
    z.transform(select(c), zoomIdentity.translate(s.W / 2 - cx * k, s.H / 2 - cy * k).scale(k));
  };
  const flyTo = (cx: number, cy: number, k: number, instant = false) => {
    const s = S.current, v = s.view;
    const from: [number, number, number] = [(s.W / 2 - v.x) / v.k, (s.H / 2 - v.y) / v.k, s.W / v.k];
    const to: [number, number, number] = [cx, cy, s.W / k];
    const i = interpolateZoom(from, to);
    if (instant || live.current.settings.reducedMotion) { s.flight = null; apply(cx, cy, k); return; }
    s.flight = { i, t0: performance.now(), ms: clamp(i.duration * 0.75, 450, 2000) };
  };
  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const z = d3zoom<HTMLCanvasElement, unknown>().scaleExtent([0.02, 60]).on("zoom", (e) => {
      S.current.view = { k: e.transform.k, x: e.transform.x, y: e.transform.y };
      if (e.sourceEvent) { S.current.flight = null; live.current.onUserMove(); }
    });
    zoomRef.current = z;
    select(c).call(z).on("dblclick.zoom", null);
    return () => { select(c).on(".zoom", null); };
  }, []);
  // Zoom limits from the map's size: from a little more than all of it to its settlements up close.
  useEffect(() => {
    const s = S.current, z = zoomRef.current; if (!z) return;
    const k = fitScale(layout, s.W, s.H);
    z.scaleExtent([k * 0.45, Math.max(k * 20, 6)]);
    const b = layout.atlas.bounds, m = Math.max(b.x1 - b.x0, b.y1 - b.y0);
    z.translateExtent([[b.x0 - m, b.y0 - m], [b.x1 + m, b.y1 + m]]);
    if (!s.fitted) { s.fitted = true; apply(0, 0, k); }
  }, [layout]);
  useEffect(() => {
    const cmd = props.camera; if (!cmd) return;
    const s = S.current;
    flyTo(cmd.target[0], cmd.target[1], s.H / viewHeight(cmd.distance));
  }, [props.camera?.key]);

  // ---------- size ----------
  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ro = new ResizeObserver(() => {
      const s = S.current, r = c.getBoundingClientRect();
      const cx = (s.W / 2 - s.view.x) / s.view.k, cy = (s.H / 2 - s.view.y) / s.view.k;
      s.W = Math.max(1, r.width); s.H = Math.max(1, r.height); s.dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.round(s.W * s.dpr); c.height = Math.round(s.H * s.dpr);
      // The first real size: the whole map, then the camera's last command again (it was measured on a guess).
      if (!s.sized) {
        s.sized = true; apply(0, 0, fitScale(live.current.layout, s.W, s.H));
        const cmd = live.current.camera; if (cmd) { s.flight = null; apply(cmd.target[0], cmd.target[1], s.H / viewHeight(cmd.distance)); }
      } else if (s.fitted) apply(cx, cy, s.view.k);
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  // ---------- the hand: hover, click, double click, the inset ----------
  const inset = () => {
    const s = S.current, b = live.current.layout.atlas.bounds;
    const w = Math.min(176, s.W * 0.22), h = Math.min(120, (w * (b.y1 - b.y0)) / (b.x1 - b.x0));
    return { x: 22, y: s.H - 22 - h, w, h, sc: Math.min(w / (b.x1 - b.x0), h / (b.y1 - b.y0)), b };
  };
  const hit = (sx: number, sy: number): { id?: string; terr?: string; inset?: [number, number] } => {
    const s = S.current, v = s.view, P = live.current, L = P.layout;
    const box = inset();
    if (sx >= box.x && sx <= box.x + box.w && sy >= box.y && sy <= box.y + box.h) return { inset: [box.b.x0 + (sx - box.x) / box.sc, box.b.y0 + (sy - box.y) / box.sc] };
    const wx = (sx - v.x) / v.k, wy = (sy - v.y) / v.k;
    if (s.delaunay && s.ids.length) {
      const i = s.delaunay.find(wx, wy);
      const d = Math.hypot(s.cur[i * 2] - wx, s.cur[i * 2 + 1] - wy) * v.k;
      const n = P.graph.nodes.find((x) => x.id === s.ids[i]);
      if (d <= Math.max(9, radius(n?.relevance || 0, v.k) + 5)) return { id: s.ids[i] };
    }
    const paths = s.paths;
    if (paths) for (const t of L.atlas.territories) if (t && scratch.isPointInPath(paths.land[t.index], wx, wy, "evenodd")) return { terr: t.id };
    return {};
  };
  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    let down: [number, number] | null = null;
    const local = (e: MouseEvent): [number, number] => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const move = (e: PointerEvent) => {
      const [x, y] = local(e); const h = hit(x, y);
      const id = h.id || null;
      c.style.cursor = h.id || h.inset ? "pointer" : h.terr ? "zoom-in" : "grab";
      if (id !== S.current.hover) { S.current.hover = id; live.current.onHover(id); }
    };
    const leave = () => { if (S.current.hover) { S.current.hover = null; live.current.onHover(null); } };
    const pdown = (e: PointerEvent) => { down = local(e); };
    const click = (e: MouseEvent) => {
      const [x, y] = local(e);
      if (down && Math.hypot(x - down[0], y - down[1]) > 4) return;
      const h = hit(x, y), P = live.current;
      if (h.inset) { flyTo(h.inset[0], h.inset[1], S.current.view.k); P.onUserMove(); return; }
      if (h.id) P.onSelect(h.id);
      else if (h.terr) P.onCluster(h.terr, false);
      else P.onSelect(null);
    };
    const dbl = (e: MouseEvent) => { const [x, y] = local(e); const h = hit(x, y); const id = h.terr || (h.id ? live.current.graph.nodes.find((n) => n.id === h.id)?.clusterId : undefined); if (id) live.current.onCluster(id, true); };
    c.addEventListener("pointermove", move); c.addEventListener("pointerleave", leave); c.addEventListener("pointerdown", pdown);
    c.addEventListener("click", click); c.addEventListener("dblclick", dbl);
    return () => { c.removeEventListener("pointermove", move); c.removeEventListener("pointerleave", leave); c.removeEventListener("pointerdown", pdown); c.removeEventListener("click", click); c.removeEventListener("dblclick", dbl); };
  }, []);

  // ---------- drawing, every frame ----------
  useEffect(() => {
    let raf = 0;
    const loop = (now: number) => { raf = requestAnimationFrame(loop); if (!document.hidden) draw(now); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const draw = (now: number) => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    const s = S.current, P = live.current, L = P.layout, A = L.atlas, paths = s.paths; if (!paths) return;
    const { graph, settings, highlights, keeper, agent, selectedId, hoveredId, focusClusterId } = P;
    const motion = !settings.paused && !settings.reducedMotion;
    const clock = Date.now();
    // The flight under way.
    if (s.flight) {
      const u = clamp((now - s.flight.t0) / s.flight.ms, 0, 1);
      const [cx, cy, w] = s.flight.i(easeInOut(u));
      apply(cx, cy, s.W / w);
      if (u >= 1) s.flight = null;
    }
    // Settlements gliding to a new layout.
    const mu = easeOut(clamp((now - s.movedAt) / 900, 0, 1));
    for (let i = 0; i < s.cur.length; i += 1) s.cur[i] = s.from[i] + (s.to[i] - s.from[i]) * mu;
    const v = s.view, k = v.k, W = s.W, H = s.H;
    const sx = (x: number) => x * k + v.x, sy = (y: number) => y * k + v.y;
    const nodeOf = new Map(graph.nodes.map((n) => [n.id, n]));
    const clusterOf = new Map(graph.clusters.map((x) => [x.id, x]));
    const kFit = fitScale(L, W, H);
    const zoomIn = k / kFit;
    const flagged = new Set<string>(); for (const f of keeper?.flags || []) { flagged.add(f.id); if (f.otherId) flagged.add(f.otherId); }
    const pos = (id: string | null | undefined): [number, number] | null => { if (!id) return null; const i = s.index.get(id); return i === undefined ? null : [s.cur[i * 2], s.cur[i * 2 + 1]]; };

    // Heat: a territory glows while something happens in it.
    const heat = new Float32Array(L.clouds.length);
    for (const [id, h] of highlights) {
      const age = now - h.at; if (age > ACTIVE_MS && h.kind !== "search") continue;
      const ci = L.cloudOf.get(id); if (ci !== undefined) heat[ci] = Math.min(1, heat[ci] + 0.35 * (h.kind === "search" ? 0.5 : 1 - age / ACTIVE_MS));
    }
    for (const [id, st] of P.sections) if (st.state === "lendo") { const ci = L.clouds.findIndex((x) => x.id === id); if (ci >= 0) heat[ci] = Math.min(1, heat[ci] + 0.45); }
    const focusIndex = focusClusterId ? L.clouds.findIndex((x) => x.id === focusClusterId) : -1;
    const dimOf = (ci: number) => (focusIndex >= 0 && ci !== focusIndex ? 0.42 : 1);

    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W * 0.45, H * 0.45, 0, W * 0.45, H * 0.45, Math.max(W, H) * 0.75);
    glow.addColorStop(0, "rgba(22,34,48,0.55)"); glow.addColorStop(1, "rgba(5,7,10,0)");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

    // ----- the atlas grid (references: A–J across, 1–n down) -----
    const b = A.bounds, cell = (b.x1 - b.x0) / 10;
    ctx.save();
    ctx.setTransform(s.dpr * k, 0, 0, s.dpr * k, s.dpr * v.x, s.dpr * v.y);
    ctx.strokeStyle = "rgba(140,170,200,0.055)"; ctx.lineWidth = 1 / k;
    ctx.beginPath();
    for (let i = 0; i <= 10; i += 1) { ctx.moveTo(b.x0 + i * cell, b.y0); ctx.lineTo(b.x0 + i * cell, b.y1); }
    for (let y = b.y0; y <= b.y1 + 0.1; y += cell) { ctx.moveTo(b.x0, y); ctx.lineTo(b.x1, y); }
    ctx.stroke();

    // ----- the sea: shallows, then the shore's glow -----
    const terrainIn = clamp((now - s.pathsAt) / 700, 0, 1);
    ctx.globalAlpha = terrainIn;
    ctx.setLineDash([2 / k, 5 / k]); ctx.strokeStyle = "rgba(76,195,255,0.16)"; ctx.lineWidth = 1 / k; ctx.stroke(paths.shallows); ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(76,195,255,0.035)"; ctx.lineWidth = 16 / k; ctx.stroke(paths.shore);
    ctx.strokeStyle = "rgba(76,195,255,0.06)"; ctx.lineWidth = 6 / k; ctx.stroke(paths.shore);

    // ----- the territories: land, relief, border -----
    for (const t of A.territories) {
      if (!t) continue;
      const col = cloudColor(t.index), d = dimOf(t.index), h = heat[t.index], on = t.index === focusIndex;
      ctx.fillStyle = col;
      ctx.globalAlpha = terrainIn * d * (0.06 + 0.1 * h + (on ? 0.04 : 0));
      ctx.fill(paths.land[t.index], "evenodd");
      ctx.strokeStyle = col; ctx.lineWidth = 0.8 / k;
      // Relief: each level a little brighter (the dense middle of a territory glows), every other line stronger.
      paths.relief[t.index].forEach((p, lv) => {
        ctx.globalAlpha = terrainIn * d * (0.03 + 0.05 * h); ctx.fill(p, "evenodd");
        ctx.globalAlpha = terrainIn * d * ((lv % 2 ? 0.2 : 0.09) + 0.12 * h); ctx.stroke(p);
      });
      ctx.globalAlpha = terrainIn * d * (0.5 + 0.4 * h + (on ? 0.2 : 0)); ctx.lineWidth = (on ? 1.6 : 1.1) / k; ctx.stroke(paths.land[t.index]);
    }
    ctx.globalAlpha = 1;

    // ----- routes: sections that share connections, joined by dotted lines between their names -----
    const terrById = new Map(A.territories.filter(Boolean).map((t) => [t.id, t]));
    const maxBridge = Math.max(1, ...graph.bridges.map((x) => x.count));
    ctx.lineCap = "round";
    for (const br of graph.bridges.slice(0, 40)) {
      const ta = terrById.get(br.a), tb = terrById.get(br.b); if (!ta || !tb) continue;
      const [ax, ay] = ta.label, [bx, by] = tb.label;
      const mx = (ax + bx) / 2, my = (ay + by) / 2, nx = -(by - ay) * 0.18, ny = (bx - ax) * 0.18;
      const lit = focusIndex < 0 || ta.index === focusIndex || tb.index === focusIndex;
      ctx.strokeStyle = `rgba(200,215,230,${(lit ? 0.12 : 0.04) + (lit ? 0.22 : 0.05) * (br.count / maxBridge)})`;
      ctx.lineWidth = (0.8 + 1.6 * (br.count / maxBridge)) / k;
      ctx.setLineDash([0.1 / k, 6 / k]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx + nx, my + ny, bx, by); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    // From here on, screen space.
    const curve = (a: [number, number], z: [number, number], bend = 0.16) => {
      const ax = sx(a[0]), ay = sy(a[1]), zx = sx(z[0]), zy = sy(z[1]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo((ax + zx) / 2 - (zy - ay) * bend, (ay + zy) / 2 + (zx - ax) * bend, zx, zy);
    };
    const along = (a: [number, number], z: [number, number], u: number, bend = 0.16): [number, number] => {
      const ax = sx(a[0]), ay = sy(a[1]), zx = sx(z[0]), zy = sy(z[1]);
      const qx = (ax + zx) / 2 - (zy - ay) * bend, qy = (ay + zy) / 2 + (zx - ax) * bend;
      return [(1 - u) * (1 - u) * ax + 2 * (1 - u) * u * qx + u * u * zx, (1 - u) * (1 - u) * ay + 2 * (1 - u) * u * qy + u * u * zy];
    };

    // ----- connections: of the memory in hand (bright), of the territory in focus (faint) -----
    const handId = selectedId || hoveredId;
    if (focusIndex >= 0 && !handId) {
      const mine = new Set(L.clouds[focusIndex].ids);
      ctx.lineWidth = 0.7; ctx.strokeStyle = cloudColor(focusIndex); ctx.globalAlpha = 0.16;
      for (const e of graph.edges) if (mine.has(e.from) && mine.has(e.to)) { const a = pos(e.from), z = pos(e.to); if (a && z) { curve(a, z, 0.1); ctx.stroke(); } }
    }
    for (const id of [selectedId, hoveredId !== selectedId ? hoveredId : null]) {
      const a = pos(id); if (!a || !id) continue;
      for (const e of edgesOf(graph, id).slice(0, 60)) {
        const other = e.from === id ? e.to : e.from, z = pos(other); if (!z) continue;
        const ci = L.cloudOf.get(other) ?? 0;
        ctx.strokeStyle = cloudColor(ci); ctx.globalAlpha = id === selectedId ? 0.75 : 0.5; ctx.lineWidth = e.kind === "relacao" ? 1.4 : 0.9;
        ctx.setLineDash(e.kind === "relacao" ? [] : [3, 3]);
        curve(a, z); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;

    // ----- the Zeladora's threads and marks -----
    for (const l of keeper?.links || []) {
      const age = clock - l.at; if (age > 8000) continue;
      const a = pos(l.from), z = pos(l.to); if (!a || !z) continue;
      ctx.strokeStyle = KEEPER; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.8 * (1 - age / 8000);
      curve(a, z, 0.22); ctx.stroke();
    }
    for (const f of keeper?.flags || []) {
      const a = pos(f.id), z = pos(f.otherId); if (!a || !z) continue;
      ctx.strokeStyle = FLAG; ctx.lineWidth = 1; ctx.globalAlpha = 0.45; ctx.setLineDash([4, 4]);
      curve(a, z, 0.22); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;

    // ----- the settlements -----
    const reading = P.readSet;
    const zf = radiusZoom(k);
    for (let i = 0; i < s.ids.length; i += 1) {
      const id = s.ids[i], n = nodeOf.get(id); if (!n) continue;
      const x = sx(s.cur[i * 2]), y = sy(s.cur[i * 2 + 1]);
      if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
      const ci = L.cloudOf.get(id) ?? 0, col = cloudColor(ci);
      const r = (1.7 + 2.3 * n.relevance) * zf;
      const review = reviewOf(n.memory, flagged.has(id)) !== "comprovada";
      const twinkle = motion && !review ? 0.88 + 0.12 * Math.sin(now / 900 + (i % 17)) : 1;
      ctx.globalAlpha = dimOf(ci) * (reading && !reading.has(id) ? 0.35 : 1) * twinkle;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      if (review) { ctx.fillStyle = BG; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, r * 0.38); ctx.stroke(); }
      else { ctx.fillStyle = mix(col, "#ffffff", 0.3); ctx.fill(); }
      if (flagged.has(id)) { ctx.globalAlpha = 0.9; ctx.fillStyle = FLAG; ctx.beginPath(); ctx.moveTo(x + r + 1, y - r - 7); ctx.lineTo(x + r + 7, y - r - 4.5); ctx.lineTo(x + r + 1, y - r - 2); ctx.fill(); ctx.fillRect(x + r, y - r - 7, 1, 8); }
      const h = highlights.get(id);
      if (h) {
        const age = now - h.at, col2 = HL[h.kind];
        if (h.kind === "search") { ctx.globalAlpha = 0.9; ctx.strokeStyle = col2; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2); ctx.stroke(); }
        else if (age < ACTIVE_MS) {
          const fade = 1 - age / ACTIVE_MS;
          ctx.globalAlpha = 0.9 * fade; ctx.strokeStyle = col2; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.arc(x, y, r + 3.5, 0, Math.PI * 2); ctx.stroke();
          if (motion && age < 4800) { const u = (age % 1600) / 1600; ctx.globalAlpha = 0.6 * (1 - u) * fade; ctx.beginPath(); ctx.arc(x, y, r + 4 + u * 18, 0, Math.PI * 2); ctx.stroke(); }
        }
      }
      if (id === selectedId || id === hoveredId) {
        ctx.globalAlpha = 1; ctx.strokeStyle = id === selectedId ? SELECT : "#ffffff"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2); ctx.stroke();
        if (id === selectedId) { ctx.beginPath(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(x + dx * (r + 8), y + dy * (r + 8)); ctx.lineTo(x + dx * (r + 13), y + dy * (r + 13)); } ctx.stroke(); }
      }
    }
    ctx.globalAlpha = 1;

    // ----- what she does to the shape of the map -----
    for (const g of keeper?.growth || []) {
      const age = clock - g.at;
      if (g.kind === "prune" && age < PRUNE_MS && g.id) {
        const p = s.lastMem.get(g.id); if (!p) continue;
        const u = age / PRUNE_MS, x = sx(p[0]), y = sy(p[1]) + 18 * u * u;
        ctx.globalAlpha = 1 - u; ctx.strokeStyle = PRUNE; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5); ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5); ctx.stroke();
      } else if ((g.kind === "arrival" || g.kind === "adopt") && age < ARRIVAL_MS && g.id) {
        const p = pos(g.id); if (!p) continue;
        const u = age / ARRIVAL_MS;
        ctx.globalAlpha = 1 - u; ctx.strokeStyle = ACTIVITY_COLOR; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(sx(p[0]), sy(p[1]), 4 + 24 * easeOut(u), 0, Math.PI * 2); ctx.stroke();
      } else if ((g.kind === "born" || g.kind === "gone") && g.section) {
        const ms = g.kind === "born" ? BORN_MS : GONE_MS; if (age >= ms) continue;
        const p = terrById.get(g.section)?.label || s.lastTerr.get(g.section); if (!p) continue;
        const u = age / ms, ci = L.clouds.findIndex((x) => x.id === g.section);
        ctx.globalAlpha = 1 - u; ctx.strokeStyle = ci >= 0 ? cloudColor(ci) : "#b9a2ff"; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(sx(p[0]), sy(p[1]), g.kind === "born" ? 10 + 70 * easeOut(u) : 70 * (1 - easeOut(u)) + 4, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // Memories pulled into one.
    for (const m of P.merges) {
      const age = clock - m.at; if (age > 1600) continue;
      const u = easeInOut(age / 1600);
      for (const f of m.from) {
        const x = sx(f[0] + (m.to[0] - f[0]) * u), y = sy(f[1] + (m.to[1] - f[1]) * u);
        ctx.globalAlpha = 1 - u * 0.6; ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // ----- a question to the Aurora: the probe -----
    if (agent && agent.key !== s.agentKey) { s.agentKey = agent.key; s.agentAt = now; s.agentEnded = 0; }
    if (agent?.ended && !s.agentEnded) s.agentEnded = now;
    const agentFade = !agent ? 0 : s.agentEnded ? clamp(1 - (now - s.agentEnded) / 5000, 0, 1) : 1;
    if (agent?.target && agentFade > 0) {
      const tgt: [number, number] = [agent.target[0], agent.target[1]];
      for (const tn of agent.tentacles) {
        const p = pos(tn.id); if (!p) continue;
        const shown = clamp((now - s.agentAt - tn.order * 70) / 400, 0, 1); if (!shown) continue;
        const strong = tn.kind !== "scanned", col = tn.kind === "created" ? ACTIVITY_COLOR : PROBE;
        ctx.strokeStyle = col; ctx.lineWidth = strong ? 1.8 : 0.8; ctx.globalAlpha = agentFade * shown * (strong ? 0.85 : 0.12 + 0.3 * tn.strength);
        curve(tgt, p, 0.12); ctx.stroke();
        if (strong && motion) { const [x, y] = along(tgt, p, ((now - s.agentAt) / 1300 + tn.order * 0.13) % 1, 0.12); ctx.fillStyle = "#ffe2c9"; ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill(); }
      }
      const x = sx(tgt[0]), y = sy(tgt[1]);
      ctx.globalAlpha = agentFade; ctx.strokeStyle = PROBE; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(x, y - 9); ctx.lineTo(x + 9, y); ctx.lineTo(x, y + 9); ctx.lineTo(x - 9, y); ctx.closePath(); ctx.stroke();
      ctx.fillStyle = PROBE; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
      if (motion && !agent.ended) { const u = ((now - s.agentAt) % 1800) / 1800; ctx.globalAlpha = (1 - u) * 0.7; ctx.beginPath(); ctx.arc(x, y, 10 + u * 46, 0, Math.PI * 2); ctx.stroke(); }
    }
    ctx.globalAlpha = 1;

    // ----- the Zeladora -----
    const boxes: [number, number, number, number][] = [];
    const free = (x: number, y: number, w: number, h: number) => { for (const q of boxes) if (x < q[0] + q[2] && x + w > q[0] && y < q[1] + q[3] && y + h > q[1]) return false; return true; };
    const kp = keeper?.current ? pos(keeper.current) : null;
    if (kp) {
      if (!s.keeperPos || !motion) s.keeperPos = [kp[0], kp[1]];
      else { s.keeperPos[0] += (kp[0] - s.keeperPos[0]) * 0.1; s.keeperPos[1] += (kp[1] - s.keeperPos[1]) * 0.1; }
      const me = s.keeperPos;
      // Her trail: where she has just been.
      const trail = (keeper!.trail || []).map(pos).filter(Boolean) as [number, number][];
      ctx.strokeStyle = KEEPER; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
      for (let j = 0; j < trail.length - 1; j += 1) { ctx.globalAlpha = 0.5 * (1 - j / trail.length); ctx.beginPath(); ctx.moveTo(sx(trail[j][0]), sy(trail[j][1])); ctx.lineTo(sx(trail[j + 1][0]), sy(trail[j + 1][1])); ctx.stroke(); }
      ctx.setLineDash([]);
      // Her threads to what she has just read.
      for (const [id, at] of Object.entries(keeper!.trailAt || {})) {
        const age = clock - at; if (age > 2600) continue;
        const p = pos(id); if (!p) continue;
        ctx.globalAlpha = 0.7 * (1 - age / 2600); ctx.lineWidth = 1.2; curve(me, p, 0.2); ctx.stroke();
      }
      const x = sx(me[0]), y = sy(me[1]);
      const halo = ctx.createRadialGradient(x, y, 0, x, y, 34); halo.addColorStop(0, "rgba(207,233,255,0.22)"); halo.addColorStop(1, "rgba(207,233,255,0)");
      ctx.globalAlpha = 1; ctx.fillStyle = halo; ctx.fillRect(x - 34, y - 34, 68, 68);
      ctx.strokeStyle = KEEPER; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.stroke();
      const spin = motion ? now / 2400 : 0;
      ctx.beginPath();
      for (let q = 0; q < 4; q += 1) { const a = spin + (q * Math.PI) / 2; ctx.moveTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14); ctx.lineTo(x + Math.cos(a) * 19, y + Math.sin(a) * 19); }
      ctx.stroke();
      ctx.fillStyle = KEEPER; ctx.beginPath(); ctx.moveTo(x, y - 4.5); ctx.lineTo(x + 4.5, y); ctx.lineTo(x, y + 4.5); ctx.lineTo(x - 4.5, y); ctx.fill();
      boxes.push([x - 20, y - 20, 40, 40]);
      const say = keeper!.saying && clock - keeper!.saying.at < 8000 ? keeper!.saying.text : "zeladora";
      chip(ctx, s, `zeladora · ${say.replace(/^zeladora · /, "")}`.slice(0, 64), x, y - 9, KEEPER, boxes, W);
    } else s.keeperPos = null;
    ctx.globalAlpha = 1;

    // ----- names: the memories in hand or in an event, then the territories, then the rest as room allows -----
    if (settings.labels) {
      type LS = CanvasRenderingContext2D & { letterSpacing?: string };
      const room = SPACING * k;
      const want: { id: string; p: number }[] = [];
      for (let i = 0; i < s.ids.length; i += 1) {
        const id = s.ids[i], x = sx(s.cur[i * 2]), y = sy(s.cur[i * 2 + 1]);
        if (x < 0 || y < 0 || x > W || y > H) continue;
        const h = highlights.get(id), hot = h && (h.kind === "search" || now - h.at < ACTIVE_MS);
        const pri = id === selectedId ? 1e4 : id === hoveredId ? 9e3 : id === keeper?.current ? 8e3 : hot ? 5e3 : room >= 26 ? (nodeOf.get(id)?.relevance || 0) * 100 + (focusIndex >= 0 && L.cloudOf.get(id) === focusIndex ? 50 : 0) : -1;
        if (pri >= 0) want.push({ id, p: pri });
      }
      want.sort((p, q) => q.p - p.p);
      let placed = 0;
      const memoryLabel = (id: string, p: number) => {
        const n = nodeOf.get(id); if (!n) return;
        const q = pos(id)!; const x = sx(q[0]), y = sy(q[1]);
        const r = (1.7 + 2.3 * n.relevance) * zf;
        const h = highlights.get(id);
        const note = h?.note && now - h.at < ACTIVE_MS ? ` · ${h.note}` : "";
        const text = (n.label.length > 32 ? `${n.label.slice(0, 31)}…` : n.label) + note;
        ctx.font = `400 11px ${MONO}`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
        const w = textWidth(ctx, s, text);
        // On its right, else on its left.
        let lx = x + r + 6;
        if (!free(lx - 2, y - 7, w + 4, 14)) { lx = x - r - 6 - w; if (!free(lx - 2, y - 7, w + 4, 14) && p < 9e3) return; }
        boxes.push([lx - 2, y - 7, w + 4, 14]); placed += 1;
        ctx.globalAlpha = (p >= 5e3 ? 1 : 0.82) * dimOf(L.cloudOf.get(id) ?? 0);
        ctx.lineWidth = 3; ctx.strokeStyle = "rgba(5,7,10,0.9)"; ctx.strokeText(text, lx, y);
        ctx.fillStyle = id === selectedId ? "#ffd6e4" : h && p >= 5e3 ? mix(HL[h.kind], "#ffffff", 0.35) : INK; ctx.fillText(text, lx, y);
      };
      for (const { id, p } of want) if (p >= 5e3) memoryLabel(id, p);
      // Territories: their name on their land (on two lines when it is wider than the land), fading up close.
      const terrFade = clamp(1.5 - zoomIn / 6, 0.28, 1);
      const order = A.territories.filter(Boolean).sort((p, q) => (clusterOf.get(q.id)?.nodeIds.length || 0) - (clusterOf.get(p.id)?.nodeIds.length || 0));
      for (const t of order) {
        const cl = clusterOf.get(t.id); if (!cl) continue;
        const n = cl.nodeIds.length, x = sx(t.label[0]), y = sy(t.label[1]);
        if (x < -200 || x > W + 200 || y < -40 || y > H + 40) continue;
        const size = clamp(9.5 + 1.5 * Math.log2(n + 1), 10, 16) * clamp(Math.sqrt(zoomIn), 1, 1.3);
        ctx.font = `600 ${size.toFixed(1)}px ${MONO}`;
        (ctx as LS).letterSpacing = `${(size * 0.12).toFixed(1)}px`;
        const whole = cl.label.toUpperCase();
        const fits = ctx.measureText(whole).width <= Math.max(90, t.room * k * 2.2);
        const lines = fits ? [whole] : whole.split(/\s*·\s*/).filter(Boolean);
        const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
        const lh = size * 1.12, top = y - (lines.length * lh) / 2;
        const st = P.sections.get(t.id);
        const sub = `${n} ${n === 1 ? "memória" : "memórias"}${st?.state === "lendo" ? ` · zeladora ${st.read}/${st.total}` : ""}`;
        const bh = lines.length * lh + 14;
        if (!free(x - w / 2 - 4, top - 2, w + 8, bh)) { (ctx as LS).letterSpacing = "0px"; continue; }
        boxes.push([x - w / 2 - 4, top - 2, w + 8, bh]);
        const col = cloudColor(t.index), d = dimOf(t.index);
        ctx.globalAlpha = terrFade * d; ctx.textAlign = "center"; ctx.textBaseline = "top";
        ctx.lineWidth = 4; ctx.strokeStyle = "rgba(5,7,10,0.85)"; ctx.fillStyle = mix(col, "#ffffff", 0.3);
        lines.forEach((l, j) => { ctx.strokeText(l, x, top + j * lh); ctx.fillText(l, x, top + j * lh); });
        (ctx as LS).letterSpacing = "1px";
        ctx.font = `400 9px ${MONO}`; ctx.fillStyle = "#7d8898"; ctx.globalAlpha = terrFade * d * 0.9;
        ctx.fillText(sub.toUpperCase(), x, top + lines.length * lh + 2);
        (ctx as LS).letterSpacing = "0px";
      }
      for (const { id, p } of want) { if (placed > 160) break; if (p < 5e3) memoryLabel(id, p); }
    }
    ctx.globalAlpha = 1;

    // ----- the frame: grid references at the edges -----
    ctx.font = `400 9.5px ${MONO}`; ctx.fillStyle = "#3e4b5c"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.strokeStyle = "rgba(140,170,200,0.12)"; ctx.lineWidth = 1; ctx.strokeRect(8.5, 8.5, W - 17, H - 17);
    for (let i = 0; i < 10; i += 1) { const x = sx(b.x0 + (i + 0.5) * cell); if (x > 20 && x < W - 20) ctx.fillText(String.fromCharCode(65 + i), x, H - 14); }
    let row = 1;
    for (let y = b.y0; y < b.y1; y += cell, row += 1) { const yy = sy(y + cell / 2); if (yy > 20 && yy < H - 20) ctx.fillText(String(row), 15, yy); }

    // ----- the inset: the whole map, and where the view is -----
    const box = inset();
    ctx.fillStyle = "rgba(8,11,16,0.88)"; ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.strokeStyle = "rgba(140,170,200,0.22)"; ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
    ctx.save();
    ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
    ctx.setTransform(s.dpr * box.sc, 0, 0, s.dpr * box.sc, s.dpr * (box.x - box.b.x0 * box.sc), s.dpr * (box.y - box.b.y0 * box.sc));
    for (const t of A.territories) if (t) { ctx.globalAlpha = 0.55 + 0.45 * heat[t.index]; ctx.fillStyle = cloudColor(t.index); ctx.fill(paths.land[t.index], "evenodd"); }
    ctx.globalAlpha = 1; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.2 / box.sc;
    ctx.strokeRect(-v.x / k, -v.y / k, W / k, H / k);
    ctx.restore();
  };

  return <canvas ref={canvasRef} className="lm-atlas" aria-label="Mapa das memórias: cada território é um nódulo, cada ponto uma memória" />;
}

/** How much the settlements grow as the view comes closer (in pixels per unit of relevance). */
const radiusZoom = (k: number) => clamp((k * SPACING) / 15, 0.75, 2.3);
const radius = (relevance: number, k: number) => (1.7 + 2.3 * relevance) * radiusZoom(k);

const rgbCache = new Map<string, [number, number, number]>();
const rgb = (hex: string): [number, number, number] => {
  let v = rgbCache.get(hex);
  if (!v) { const n = parseInt(hex.slice(1), 16); v = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; rgbCache.set(hex, v); }
  return v;
};
const mixCache = new Map<string, string>();
function mix(a: string, b: string, t: number): string {
  const key = `${a}${b}${t}`; let m = mixCache.get(key);
  if (!m) { const p = rgb(a), q = rgb(b); m = `rgb(${p.map((x, i) => Math.round(x + (q[i] - x) * t)).join(",")})`; mixCache.set(key, m); }
  return m;
}
function textWidth(ctx: CanvasRenderingContext2D, s: { widths: Map<string, number> }, text: string): number {
  const key = `${ctx.font}|${text}`; let w = s.widths.get(key);
  if (w === undefined) { w = ctx.measureText(text).width; if (s.widths.size > 4000) s.widths.clear(); s.widths.set(key, w); }
  return w;
}
/** A small tag on the map (what the Zeladora is doing), kept clear of the names already there. */
function chip(ctx: CanvasRenderingContext2D, s: { widths: Map<string, number> }, text: string, cx: number, y: number, col: string, boxes: [number, number, number, number][], W: number) {
  ctx.font = `400 10.5px ${MONO}`;
  const w = textWidth(ctx, s, text) + 12;
  // Beside her on the right, or on the left near the right edge.
  const x = cx + 24 + w > W - 12 ? cx - 24 - w : cx + 24;
  ctx.globalAlpha = 0.92; ctx.fillStyle = "rgba(5,7,10,0.9)"; ctx.fillRect(x, y, w, 18);
  ctx.strokeStyle = col; ctx.globalAlpha = 0.45; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 17);
  ctx.globalAlpha = 1; ctx.fillStyle = col; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(text, x + 6, y + 9.5);
  boxes.push([x, y, w, 18]);
}
