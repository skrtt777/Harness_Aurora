// The Aurora's memory as a space of clouds, one per section (the Zeladora's nodes): each cloud is a volume
// that sits where its memories' meaning puts it in the 3D semantic atlas, its size grows with how many
// memories it holds, and inside it each memory keeps its direction from the cloud's centre in the atlas
// (memories that mean nearly the same thing sit side by side). Around the memories, a dense grain of particles,
// fibres and soft puffs gives each cloud its mass; the grain is decoration, the memories are the bright points.
// Deterministic: the same memories make the same space. Pure (no DOM, no three.js), so it is tested in node.
import type { MemoryGraph } from "./adapter";
import type { MemoryGraphSnapshot } from "../api";
import type { Layout, Vec3 } from "./layout";

// The same hash as layout.ts (kept here so this module stands alone in the tests).
function hash01(text: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1_000_003) / 1_000_003;
}

export type Cloud = { id: string; index: number; x: number; y: number; z: number; r: number; ids: string[] };
export type CloudLayout = Layout & {
  clouds: Cloud[];
  cloudOf: Map<string, number>;
  /** The space's size: every cloud fits within R of the origin. */
  R: number;
  /** Half the space's width and height seen from the front (it is laid out wide, like the screen). */
  halfW: number; halfH: number;
};

/** World units per ∛memory of a cloud's radius (a volume: it grows with the cube root). */
const UNIT = 46;
const GAP = 60;
/** Wider than tall, and not too deep (it is mostly seen from the front, then orbited). */
const STRETCH = [1.6, 1, 0.75];
export const cloudRadius = (count: number) => UNIT * Math.cbrt(Math.max(1, count)) + UNIT * 0.6;

/** The sections' colours: an aurora's (its green first, the biggest section; then cyan, ice, blue, violet, rose…). */
export const CLOUD_COLORS = ["#6cffb8", "#4ce6ff", "#b48cff", "#9ff0ff", "#ff7db8", "#5aa8ff", "#a6ff8c", "#e07dff", "#3fd6c6", "#8f8cff", "#c8f0ff", "#ffa3d9"];
export const cloudColor = (index: number) => CLOUD_COLORS[((index % CLOUD_COLORS.length) + CLOUD_COLORS.length) % CLOUD_COLORS.length];

/** A point on the unit sphere from two numbers in [0, 1). */
const sphere = (u: number, v: number): [number, number, number] => { const z = 2 * u - 1, a = 2 * Math.PI * v, s = Math.sqrt(1 - z * z); return [s * Math.cos(a), s * Math.sin(a), z]; };

export function layoutClouds(graph: MemoryGraph, snap: Pick<MemoryGraphSnapshot, "atlas"> | null = null): CloudLayout {
  const at = new Map<string, number[]>((snap?.atlas?.points || []).map((p) => [p.id, p.position]));
  const sorted = [...graph.clusters].filter((c) => c.nodeIds.length).sort((a, b) => b.nodeIds.length - a.nodeIds.length || (a.id < b.id ? -1 : 1));
  // Where each cloud's memories are in the atlas (its mean); without the atlas, on a spiral by size.
  const mean = (pts: number[][]) => [0, 1, 2].map((k) => pts.reduce((s, p) => s + (p[k] || 0), 0) / pts.length);
  const means = sorted.map((c) => { const pts = c.nodeIds.map((id) => at.get(id)).filter(Boolean) as number[][]; return pts.length ? mean(pts) : null; });
  const known = means.filter(Boolean) as number[][];
  const m0 = known.length ? mean(known) : [0, 0, 0];
  const spread = known.length > 1 ? Math.sqrt(known.reduce((s, p) => s + (p[0] - m0[0]) ** 2 + (p[1] - m0[1]) ** 2 + (p[2] - m0[2]) ** 2, 0) / known.length) || 1 : 1;
  const radii = sorted.map((c) => cloudRadius(c.nodeIds.length));
  const total = Math.cbrt(radii.reduce((s, r) => s + r ** 3, 0)) * 1.6;
  const clouds: Cloud[] = sorted.map((c, i) => {
    const m = means[i];
    const [sx, sy, sz] = sphere(hash01(c.id, 1), hash01(c.id, 2));
    const far = 0.4 + 0.6 * Math.sqrt(i / Math.max(1, sorted.length));
    const p = m ? [0, 1, 2].map((k) => ((m[k] - m0[k]) / spread) * total) : [sx * total * far, sy * total * far, sz * total * far];
    return { id: c.id, index: i, x: p[0] * STRETCH[0], y: p[1] * STRETCH[1], z: p[2] * STRETCH[2], r: radii[i], ids: c.nodeIds };
  });
  // Clouds never overlap: pushed apart (the bigger one moves less), with a weak pull to the middle.
  for (let it = 0; it < 260; it += 1) {
    let moved = 0;
    for (let i = 0; i < clouds.length; i += 1) for (let j = i + 1; j < clouds.length; j += 1) {
      const a = clouds[i], b = clouds[j];
      let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z; let d = Math.hypot(dx, dy, dz);
      if (d < 1e-6) { [dx, dy, dz] = sphere(hash01(a.id + b.id, 3), hash01(a.id + b.id, 4)); d = 1; }
      const need = a.r + b.r + GAP;
      if (d >= need) continue;
      const push = (need - d) / d;
      const wa = b.r / (a.r + b.r), wb = a.r / (a.r + b.r);
      a.x -= dx * push * wa; a.y -= dy * push * wa; a.z -= dz * push * wa;
      b.x += dx * push * wb; b.y += dy * push * wb; b.z += dz * push * wb;
      moved += need - d;
    }
    for (const c of clouds) { c.x *= 0.9985; c.y *= 0.994; c.z *= 0.99; }
    if (moved < 0.01 && it > 20) break;
  }
  // Centred on the origin (by volume).
  const vol = clouds.reduce((s, c) => s + c.r ** 3, 0) || 1;
  const cx = clouds.reduce((s, c) => s + c.x * c.r ** 3, 0) / vol, cy = clouds.reduce((s, c) => s + c.y * c.r ** 3, 0) / vol, cz = clouds.reduce((s, c) => s + c.z * c.r ** 3, 0) / vol;
  for (const c of clouds) { c.x -= cx; c.y -= cy; c.z -= cz; }

  // Inside a cloud: each memory keeps its direction from the cloud's centre in the atlas; its distance comes
  // from its rank (so the volume fills evenly instead of a few outliers at the edge and everyone in the middle).
  const nodes = new Map<string, Vec3>();
  const cloudOf = new Map<string, number>();
  for (const c of clouds) {
    const pts = c.ids.map((id) => at.get(id));
    const have = pts.filter(Boolean) as number[][];
    const o = have.length ? mean(have) : [0, 0, 0];
    const dirs = c.ids.map((id, k) => {
      const p = pts[k];
      const v = p ? [0, 1, 2].map((a) => (p[a] || 0) - o[a]) : [0, 0, 0];
      const d = Math.hypot(v[0], v[1], v[2]);
      const u = d > 1e-9 ? v.map((x) => x / d) : sphere(hash01(id, 5), hash01(id, 6));
      return { id, u, d: d > 1e-9 ? d : hash01(id, 7) * 1e-6 };
    });
    const byDist = [...dirs].sort((p, q) => p.d - q.d || (p.id < q.id ? -1 : 1));
    byDist.forEach((p, rank) => {
      const rr = c.ids.length === 1 ? 0 : c.r * 0.8 * Math.cbrt((rank + 0.5) / c.ids.length);
      const j = sphere(hash01(p.id, 8), hash01(p.id, 9));
      const u = [0, 1, 2].map((k) => p.u[k] + j[k] * 0.12);
      const n = Math.hypot(u[0], u[1], u[2]) || 1;
      nodes.set(p.id, [c.x + (u[0] / n) * rr, c.y + (u[1] / n) * rr, c.z + (u[2] / n) * rr]);
      cloudOf.set(p.id, c.index);
    });
  }
  const clustersBox = new Map<string, { center: Vec3; radius: number }>();
  for (const c of clouds) clustersBox.set(c.id, { center: [c.x, c.y, c.z], radius: c.r });
  const R = Math.max(200, ...clouds.map((c) => Math.hypot(c.x, c.y, c.z) + c.r));
  const halfW = Math.max(150, ...clouds.map((c) => Math.abs(c.x) + c.r));
  const halfH = Math.max(120, ...clouds.map((c) => Math.abs(c.y) + c.r));
  return { nodes, clusters: clustersBox, core: [0, 0, 0], clouds, cloudOf, R, halfW, halfH };
}

/** How far the camera must be (fov 45°) to see the whole space from the front in a view of this aspect. */
export function fitDistance(layout: Pick<CloudLayout, "halfW" | "halfH">, aspect: number): number {
  const t = Math.tan((45 * Math.PI) / 360);
  return Math.max(layout.halfH / t, layout.halfW / (t * Math.max(0.3, aspect))) * 1.05;
}

/**
 * The grain of the space: particles around each memory and through each cloud, fibres between nearby
 * particles of the same cloud, and a few big soft puffs per cloud (its glow). `perMemory` particles per memory
 * (the caller lowers it with many memories). Each particle and fibre end knows its cloud (to take its colour),
 * a seed (for its own small motion) and a size (1 for grain, large for a puff).
 */
type Part = { pos: Float32Array; cloud: Float32Array; seed: Float32Array; alpha: Float32Array; size: Float32Array; count: number };
export type Field = { points: Part; fibres: Part };
export function buildField(layout: CloudLayout, perMemory: number): Field {
  const P: number[][] = [[], [], [], [], [], [], []]; // x y z cloud seed alpha size
  let k = 0;
  const rnd = () => hash01(`g${k}`, (k += 1));
  const gauss = () => { const u = Math.max(1e-6, rnd()), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const add = (x: number, y: number, z: number, c: number, a: number, size = 1) => { P[0].push(x); P[1].push(y); P[2].push(z); P[3].push(c); P[4].push(rnd()); P[5].push(a); P[6].push(size); };
  const byCloud: number[][] = layout.clouds.map(() => []);
  for (const c of layout.clouds) {
    const n = c.ids.length * perMemory;
    // Around each memory: a tight knot; through the cloud: an even haze (more of it in bigger clouds).
    for (const id of c.ids) {
      const p = layout.nodes.get(id)!;
      const sigma = c.r * (0.05 + 0.08 * rnd());
      for (let j = 0; j < Math.ceil(perMemory * 0.5); j += 1) { byCloud[c.index].push(P[0].length); add(p[0] + gauss() * sigma, p[1] + gauss() * sigma, p[2] + gauss() * sigma, c.index, 0.25 + 0.5 * rnd()); }
    }
    const haze = Math.floor(n * 0.5);
    for (let j = 0; j < haze; j += 1) {
      const [ux, uy, uz] = sphere(rnd(), rnd()); const rr = c.r * Math.cbrt(rnd()) * (0.95 + 0.12 * gauss());
      byCloud[c.index].push(P[0].length); add(c.x + ux * rr, c.y + uy * rr, c.z + uz * rr, c.index, 0.1 + 0.32 * rnd());
    }
  }
  // Puffs: big soft points through each cloud (its glow and volume); not fibre ends.
  for (const c of layout.clouds) {
    const puffs = 10 + Math.min(30, c.ids.length);
    for (let j = 0; j < puffs; j += 1) { const [ux, uy, uz] = sphere(rnd(), rnd()); const rr = c.r * 0.7 * Math.cbrt(rnd()); add(c.x + ux * rr, c.y + uy * rr, c.z + uz * rr, c.index, 0.035 + 0.03 * rnd(), 26 + rnd() * 30); }
  }
  // Fibres: each particle to the nearest of a few others of its cloud (a tangle, not a net), sometimes two.
  const F: number[][] = [[], [], [], [], [], [], []];
  for (const c of layout.clouds) {
    const list = byCloud[c.index];
    const maxLen = c.r * 0.34;
    for (let q = 0; q < list.length; q += 1) {
      const i = list[q];
      let best = -1, bd = Infinity, second = -1, sd = Infinity;
      for (let t = 0; t < 10; t += 1) {
        const j = list[Math.floor(rnd() * list.length)];
        if (j === i) continue;
        const d = (P[0][j] - P[0][i]) ** 2 + (P[1][j] - P[1][i]) ** 2 + (P[2][j] - P[2][i]) ** 2;
        if (d < bd) { second = best; sd = bd; best = j; bd = d; } else if (d < sd) { second = j; sd = d; }
      }
      for (const [j, d] of [[best, bd], [second, sd]] as [number, number][]) {
        if (j < 0 || Math.sqrt(d) > maxLen || (j === second && rnd() > 0.35)) continue;
        const a = 0.05 + 0.17 * rnd() * (1 - Math.sqrt(d) / maxLen);
        for (const e of [i, j]) { F[0].push(P[0][e]); F[1].push(P[1][e]); F[2].push(P[2][e]); F[3].push(c.index); F[4].push(P[4][e]); F[5].push(a); F[6].push(1); }
      }
    }
  }
  return { points: pack(P), fibres: pack(F) };
}
function pack(P: number[][]): Part {
  const n = P[0].length;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) { pos[i * 3] = P[0][i]; pos[i * 3 + 1] = P[1][i]; pos[i * 3 + 2] = P[2][i]; }
  return { pos, cloud: Float32Array.from(P[3]), seed: Float32Array.from(P[4]), alpha: Float32Array.from(P[5]), size: Float32Array.from(P[6]), count: n };
}

/** How many grain particles per memory for a quality and a number of memories (at most ~50k in all). */
export function grainPerMemory(quality: "alta" | "media" | "baixa", memories: number): number {
  const want = quality === "alta" ? 70 : quality === "media" ? 30 : 6;
  return Math.max(2, Math.min(want, Math.floor(50_000 / Math.max(1, memories))));
}
