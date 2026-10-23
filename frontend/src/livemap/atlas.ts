// Memórias / Mapa Vivo — the atlas: the Aurora's memory drawn as a map (AtlasMap.tsx draws it). Pure and tested.
//   - each section (a node of the Zeladora) is a territory: its memories' density makes its land, its shore and
//     its relief (contour lines), and where two sections meet the border runs where neither outweighs the other;
//   - each memory is a settlement of its territory, placed by meaning: the territory sits where its memories sit
//     in the semantic atlas, and inside it neighbours in meaning (the atlas's measured neighbours) are drawn
//     together, never on top of each other;
//   - nothing is decoration: no land without memories, no relief that is not their density.
// The result is a CloudLayout (every memory a point, every section a "cloud" with a centre and a radius, z = 0),
// so the rest of the map (the Zeladora, the probe, the panels, the camera commands) works on it unchanged.
// World units, y down (as the screen).
import { contours } from "d3-contour";
import type { MemoryGraph } from "./adapter";
import type { MemoryGraphSnapshot } from "../api";
import type { Cloud, CloudLayout } from "./clouds";
import type { Vec3 } from "./layout";

/** A stable number in [0, 1) from a string (FNV-1a; the same as layout.ts's, kept here so this file stands alone). */
function hash01(text: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1_000_003) / 1_000_003;
}

export type Ring = [number, number][];
export type Territory = {
  id: string; index: number;
  /** Its land (polygons as rings: outer and holes), in world units. */
  land: Ring[];
  /** Its relief: contour lines of its memories' density, one list of rings per level (low to high). */
  relief: Ring[][];
  /** Where its name goes (the point of its land farthest from its border) and how much room it has there. */
  label: [number, number]; room: number;
};
export type AtlasInfo = {
  territories: Territory[];
  /** All land together (its shore) and the shallows around it. */
  shore: Ring[]; shallows: Ring[];
  bounds: { x0: number; y0: number; x1: number; y1: number };
  /** Settlements closer than this would touch: the drawing scales its dots from it. */
  spacing: number;
};
export type AtlasLayout = CloudLayout & { atlas: AtlasInfo };
export type Detail = "alta" | "media" | "baixa";

/** Distance kept between two memories (world units). */
export const SPACING = 22;
const GAP = 34;
/** A territory's radius from its number of memories (its area grows with them). */
export const territoryRadius = (n: number) => SPACING * 0.7 * Math.sqrt(Math.max(1, n)) + 30;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export function layoutAtlas(graph: MemoryGraph, snap: Pick<MemoryGraphSnapshot, "atlas"> | null = null, detail: Detail = "alta"): AtlasLayout {
  const atlasPts = new Map((snap?.atlas?.points || []).map((p) => [p.id, p]));
  const relevance = new Map(graph.nodes.map((n) => [n.id, n.relevance]));
  const sorted = [...graph.clusters].filter((c) => c.nodeIds.length).sort((a, b) => b.nodeIds.length - a.nodeIds.length || (a.id < b.id ? -1 : 1));

  // ---------- the territories: where their memories are in the atlas (the first two axes), never overlapping ----------
  const xy = (id: string) => { const p = atlasPts.get(id)?.position; return p && p.length >= 2 ? [p[0], p[1]] : null; };
  const mean = (pts: number[][]) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  const means = sorted.map((c) => { const pts = c.nodeIds.map(xy).filter(Boolean) as number[][]; return pts.length ? mean(pts) : null; });
  const known = means.filter(Boolean) as number[][];
  const m0 = known.length ? mean(known) : [0, 0];
  const spread = known.length > 1 ? Math.sqrt(known.reduce((s, p) => s + (p[0] - m0[0]) ** 2 + (p[1] - m0[1]) ** 2, 0) / known.length) || 1 : 1;
  const radii = sorted.map((c) => territoryRadius(c.nodeIds.length));
  const total = Math.sqrt(radii.reduce((s, r) => s + r * r, 0)) * 1.25;
  const T = sorted.map((c, i) => {
    const m = means[i];
    const a = i * GOLDEN + hash01(c.id, 1) * 0.3, far = total * 0.9 * Math.sqrt((i + 0.5) / sorted.length);
    // Wider than tall (the screen).
    const x = m ? ((m[0] - m0[0]) / spread) * total * 1.25 : Math.cos(a) * far * 1.25;
    const y = m ? ((m[1] - m0[1]) / spread) * total * 0.8 : Math.sin(a) * far * 0.8;
    return { c, i, x, y, r: radii[i] };
  });
  for (let it = 0; it < 320; it += 1) {
    let moved = 0;
    for (let i = 0; i < T.length; i += 1) for (let j = i + 1; j < T.length; j += 1) {
      const a = T[i], b = T[j];
      let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d < 1e-6) { const q = hash01(a.c.id + b.c.id, 3) * Math.PI * 2; dx = Math.cos(q); dy = Math.sin(q); d = 1; }
      const need = a.r + b.r + GAP;
      if (d >= need) continue;
      const push = (need - d) / d, wa = b.r / (a.r + b.r), wb = a.r / (a.r + b.r);
      a.x -= dx * push * wa; a.y -= dy * push * wa; b.x += dx * push * wb; b.y += dy * push * wb;
      moved += need - d;
    }
    // A weak pull to the middle (more across than along: the map stays wide).
    for (const t of T) { t.x *= 0.997; t.y *= 0.99; }
    if (moved < 0.01 && it > 30) break;
  }

  // ---------- the settlements: each memory where its meaning puts it inside its territory ----------
  const pos = new Map<string, [number, number]>();
  for (const t of T) {
    const ids = [...t.c.nodeIds].sort((a, b) => (relevance.get(b) || 0) - (relevance.get(a) || 0) || (a < b ? -1 : 1));
    const pts = ids.map(xy);
    const have = pts.filter(Boolean) as number[][];
    const cm = have.length ? mean(have) : [0, 0];
    const rms = have.length > 1 ? Math.sqrt(have.reduce((s, p) => s + (p[0] - cm[0]) ** 2 + (p[1] - cm[1]) ** 2, 0) / have.length) || 1 : 1;
    const scale = (t.r * 0.45) / rms;
    ids.forEach((id, k) => {
      const p = pts[k];
      // Without the atlas: a sunflower, the most relevant in the middle.
      const sun: [number, number] = [Math.cos(k * GOLDEN) * SPACING * 0.62 * Math.sqrt(k + 0.5), Math.sin(k * GOLDEN) * SPACING * 0.62 * Math.sqrt(k + 0.5)];
      const jx = (hash01(id, 5) - 0.5) * 2, jy = (hash01(id, 6) - 0.5) * 2;
      pos.set(id, p && have.length > 1 ? [t.x + (p[0] - cm[0]) * scale + jx, t.y + (p[1] - cm[1]) * scale + jy] : [t.x + sun[0] + jx, t.y + sun[1] + jy]);
    });
    relax(ids, pos, t, atlasPts);
  }

  // ---------- centred, then the terrain ----------
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of T) { x0 = Math.min(x0, t.x - t.r); x1 = Math.max(x1, t.x + t.r); y0 = Math.min(y0, t.y - t.r); y1 = Math.max(y1, t.y + t.r); }
  if (!T.length) { x0 = -200; x1 = 200; y0 = -120; y1 = 120; }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  for (const t of T) { t.x -= cx; t.y -= cy; }
  for (const [id, p] of pos) pos.set(id, [p[0] - cx, p[1] - cy]);
  const bounds = { x0: x0 - cx - 60, y0: y0 - cy - 60, x1: x1 - cx + 60, y1: y1 - cy + 60 };
  const terrain = buildTerrain(T.map((t) => ({ id: t.c.id, index: t.i, x: t.x, y: t.y, ids: t.c.nodeIds })), pos, relevance, bounds, detail);

  const nodes = new Map<string, Vec3>();
  const cloudOf = new Map<string, number>();
  const clusters = new Map<string, { center: Vec3; radius: number }>();
  const clouds: Cloud[] = T.map((t) => ({ id: t.c.id, index: t.i, x: t.x, y: t.y, z: 0, r: t.r, ids: t.c.nodeIds }));
  for (const t of T) {
    clusters.set(t.c.id, { center: [t.x, t.y, 0], radius: t.r });
    for (const id of t.c.nodeIds) { const p = pos.get(id)!; nodes.set(id, [p[0], p[1], 0]); cloudOf.set(id, t.i); }
  }
  const halfW = Math.max(160, (bounds.x1 - bounds.x0) / 2 - 30), halfH = Math.max(110, (bounds.y1 - bounds.y0) / 2 - 30);
  const R = Math.max(200, ...T.map((t) => Math.hypot(t.x, t.y) + t.r));
  return { nodes, clusters, core: [0, 0, 0], clouds, cloudOf, R, halfW, halfH, atlas: { ...terrain, bounds, spacing: SPACING } };
}

/** Inside a territory: neighbours in meaning pulled together, nobody closer than SPACING, everyone inside its land. */
function relax(ids: string[], pos: Map<string, [number, number]>, t: { x: number; y: number; r: number }, atlasPts: Map<string, { neighbors: { id: string; similarity: number }[] }>) {
  if (ids.length < 2) { if (ids[0]) pos.set(ids[0], [t.x, t.y]); return; }
  const mine = new Set(ids);
  const P = ids.map((id) => pos.get(id)!);
  const index = new Map(ids.map((id, i) => [id, i]));
  const pairs: [number, number, number][] = [];
  ids.forEach((id, i) => { for (const n of atlasPts.get(id)?.neighbors || []) if (mine.has(n.id) && id < n.id) pairs.push([i, index.get(n.id)!, n.similarity]); });
  const limit = t.r - SPACING * 0.9;
  for (let it = 0; it < 140; it += 1) {
    const cool = 1 - it / 140;
    for (const [a, b, s] of pairs) {
      const pa = P[a], pb = P[b];
      const dx = pb[0] - pa[0], dy = pb[1] - pa[1], d = Math.hypot(dx, dy);
      if (d < SPACING * 1.3) continue;
      const k = 0.03 * s * cool * (d - SPACING * 1.3) / d;
      pa[0] += dx * k; pa[1] += dy * k; pb[0] -= dx * k; pb[1] -= dy * k;
    }
    // Nobody on top of anybody (a grid of SPACING cells: only the nearby ones are compared).
    const grid = new Map<string, number[]>();
    P.forEach((p, i) => { const key = `${Math.floor(p[0] / SPACING)},${Math.floor(p[1] / SPACING)}`; const g = grid.get(key); if (g) g.push(i); else grid.set(key, [i]); });
    P.forEach((p, i) => {
      const gx = Math.floor(p[0] / SPACING), gy = Math.floor(p[1] / SPACING);
      for (let ox = -1; ox <= 1; ox += 1) for (let oy = -1; oy <= 1; oy += 1) for (const j of grid.get(`${gx + ox},${gy + oy}`) || []) {
        if (j <= i) continue;
        const q = P[j];
        let dx = q[0] - p[0], dy = q[1] - p[1], d = Math.hypot(dx, dy);
        if (d >= SPACING) continue;
        // Two on the same spot: apart along a direction of their own.
        if (d < 1e-6) { const a = hash01(ids[i] + ids[j], 7) * Math.PI * 2; dx = Math.cos(a) * 1e-3; dy = Math.sin(a) * 1e-3; d = 1e-3; }
        const push = ((SPACING - d) / d) * 0.5;
        p[0] -= dx * push; p[1] -= dy * push; q[0] += dx * push; q[1] += dy * push;
      }
    });
    for (const p of P) {
      const dx = p[0] - t.x, dy = p[1] - t.y, d = Math.hypot(dx, dy);
      if (d > limit) { p[0] = t.x + (dx / d) * limit; p[1] = t.y + (dy / d) * limit; }
    }
  }
}

/** Kernel width of the density (world units): a memory's land reaches about 1.6 of it. */
const SIGMA = SPACING * 1.15;
const LAND = 0.25;

/**
 * The terrain from the memories' density: for each territory a field (a gaussian per memory, a little stronger
 * for the relevant ones); land is where the sum passes LAND, a territory's land where its own field outweighs
 * every other's; its relief, contour lines of its own field.
 */
function buildTerrain(terr: { id: string; index: number; x: number; y: number; ids: string[] }[], pos: Map<string, [number, number]>, relevance: Map<string, number>, b: AtlasInfo["bounds"], detail: Detail): Pick<AtlasInfo, "territories" | "shore" | "shallows"> {
  const W = b.x1 - b.x0, H = b.y1 - b.y0;
  const base = detail === "alta" ? 5 : detail === "media" ? 8 : 12;
  const step = Math.max(base, W / 420, H / 300);
  const cols = Math.max(4, Math.ceil(W / step)), rows = Math.max(4, Math.ceil(H / step));
  const K = terr.length, N = cols * rows;
  const fields = terr.map(() => new Float32Array(N));
  const reach = Math.ceil((SIGMA * 3) / step);
  terr.forEach((t, k) => {
    const f = fields[k];
    for (const id of t.ids) {
      const p = pos.get(id); if (!p) continue;
      const w = 0.85 + 0.5 * (relevance.get(id) || 0);
      const gx = (p[0] - b.x0) / step - 0.5, gy = (p[1] - b.y0) / step - 0.5;
      const ix = Math.round(gx), iy = Math.round(gy);
      for (let y = Math.max(0, iy - reach); y <= Math.min(rows - 1, iy + reach); y += 1) {
        const dy = (y - gy) * step;
        for (let x = Math.max(0, ix - reach); x <= Math.min(cols - 1, ix + reach); x += 1) {
          const dx = (x - gx) * step;
          f[y * cols + x] += w * Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA));
        }
      }
    }
  });
  const sum = new Float32Array(N);
  for (const f of fields) for (let i = 0; i < N; i += 1) sum[i] += f[i];
  const toWorld = (rings: number[][][]): Ring[] => rings.map((ring) => ring.map(([x, y]) => [b.x0 + x * step, b.y0 + y * step] as [number, number]));
  const ringsOf = (values: Float32Array, levels: number[]) => contours().size([cols, rows]).thresholds(levels)(Array.from(values)).map((g) => g.coordinates.flatMap((poly) => toWorld(poly)));
  const [shore, shallows] = [ringsOf(sum, [LAND])[0], ringsOf(sum, [LAND * 0.42])[0]];

  // Each territory: where its field outweighs every other's (a thin gap between neighbours) and there is land.
  const territories: Territory[] = [];
  const own = new Float32Array(N);
  terr.forEach((t, k) => {
    const f = fields[k];
    let peak = 0;
    for (let i = 0; i < N; i += 1) {
      let other = 0;
      for (let j = 0; j < K; j += 1) if (j !== k && fields[j][i] > other) other = fields[j][i];
      own[i] = Math.min(f[i] - other - 0.03, sum[i] - LAND);
      if (f[i] > peak) peak = f[i];
    }
    const land = ringsOf(own, [0])[0];
    const levels: number[] = [];
    for (let v = LAND * 2.4; v < peak * 0.96 && levels.length < 6; v *= 1.6) levels.push(v);
    const relief = levels.length ? ringsOf(f, levels) : [];
    // Its name: the cell of its land farthest from its border (a two-pass chamfer distance).
    const dist = new Float32Array(N);
    for (let i = 0; i < N; i += 1) dist[i] = own[i] > 0 ? 1e9 : 0;
    for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) {
      const i = y * cols + x; if (!dist[i]) continue;
      const up = y ? dist[i - cols] : 0, left = x ? dist[i - 1] : 0;
      dist[i] = Math.min(dist[i], up + 1, left + 1, y && x ? dist[i - cols - 1] + 1.41 : 1.41, y && x < cols - 1 ? dist[i - cols + 1] + 1.41 : 1.41);
    }
    let best = -1, at = -1;
    for (let y = rows - 1; y >= 0; y -= 1) for (let x = cols - 1; x >= 0; x -= 1) {
      const i = y * cols + x; if (!dist[i]) continue;
      const down = y < rows - 1 ? dist[i + cols] : 0, right = x < cols - 1 ? dist[i + 1] : 0;
      dist[i] = Math.min(dist[i], down + 1, right + 1, y < rows - 1 && x < cols - 1 ? dist[i + cols + 1] + 1.41 : 1.41, y < rows - 1 && x ? dist[i + cols - 1] + 1.41 : 1.41);
      if (dist[i] > best) { best = dist[i]; at = i; }
    }
    const label: [number, number] = at >= 0 ? [b.x0 + ((at % cols) + 0.5) * step, b.y0 + (Math.floor(at / cols) + 0.5) * step] : [t.x, t.y];
    territories[t.index] = { id: t.id, index: t.index, land, relief, label, room: Math.max(0, best) * step };
  });
  return { territories, shore, shallows };
}
