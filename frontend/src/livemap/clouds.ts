// The Aurora's memory as a field of clouds, one per section (the Zeladora's nodes): each cloud sits where its
// memories' meaning puts it in the semantic atlas, its size grows with how many memories it holds, and inside
// it each memory keeps its direction from the cloud's centre in the atlas (memories that mean nearly the same
// thing sit side by side). Around the memories, a dense grain of particles and fibres gives each cloud its
// mass; the grain is decoration, the memories are the bright points. Deterministic: the same memories make
// the same field. Pure (no DOM, no three.js), so it is tested in node.
import type { MemoryGraph } from "./adapter";
import type { MemoryGraphSnapshot } from "../api";
import type { Layout, Vec3 } from "./layout";

// The same hash as layout.ts (kept here so this module stands alone in the tests).
function hash01(text: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1_000_003) / 1_000_003;
}

export type Cloud = { id: string; index: number; x: number; y: number; r: number; ids: string[] };
export type CloudLayout = Layout & {
  clouds: Cloud[];
  cloudOf: Map<string, number>;
  /** The field's size: every cloud fits within R of the origin. */
  R: number;
  /** Half the field's width and height (it is laid out wide, like the screen). */
  halfW: number; halfH: number;
};

/** World units per √memory of a cloud's radius. */
const UNIT = 30;
const GAP = 64;
/** The field is laid out this much wider than tall (the map is a wide strip of the screen). */
const ASPECT = 1.9;
export const cloudRadius = (count: number) => UNIT * Math.sqrt(Math.max(1, count)) + UNIT * 0.9;

/** The sections' colours: one each, shown only while a section is active (the rest of the field is grey). */
export const CLOUD_COLORS = ["#8fb8e8", "#e88fa6", "#e8c46f", "#a99af0", "#7fdcc0", "#f0a070", "#9fd27a", "#7fc8f0", "#e89fe0", "#c8c08f", "#f08f8f", "#8fe8e0"];
export const cloudColor = (index: number) => CLOUD_COLORS[((index % CLOUD_COLORS.length) + CLOUD_COLORS.length) % CLOUD_COLORS.length];

export function layoutClouds(graph: MemoryGraph, snap: Pick<MemoryGraphSnapshot, "atlas"> | null = null): CloudLayout {
  const at = new Map<string, number[]>((snap?.atlas?.points || []).map((p) => [p.id, p.position]));
  const sorted = [...graph.clusters].filter((c) => c.nodeIds.length).sort((a, b) => b.nodeIds.length - a.nodeIds.length || (a.id < b.id ? -1 : 1));
  // Where each cloud's memories are in the atlas (its mean); without the atlas, around a ring by size.
  const means = sorted.map((c) => {
    const pts = c.nodeIds.map((id) => at.get(id)).filter(Boolean) as number[][];
    if (!pts.length) return null;
    return [pts.reduce((s, p) => s + (p[0] || 0), 0) / pts.length, pts.reduce((s, p) => s + (p[1] || 0), 0) / pts.length];
  });
  const known = means.filter(Boolean) as number[][];
  const mx = known.length ? known.reduce((s, p) => s + p[0], 0) / known.length : 0;
  const my = known.length ? known.reduce((s, p) => s + p[1], 0) / known.length : 0;
  const spread = known.length > 1 ? Math.sqrt(known.reduce((s, p) => s + (p[0] - mx) ** 2 + (p[1] - my) ** 2, 0) / known.length) || 1 : 1;
  const radii = sorted.map((c) => cloudRadius(c.nodeIds.length));
  const total = Math.sqrt(radii.reduce((s, r) => s + r * r, 0));
  const clouds: Cloud[] = sorted.map((c, i) => {
    const m = means[i];
    const a = i * 2.39996 + hash01(c.id) * 0.3;
    const x = (m ? ((m[0] - mx) / spread) * total * 0.9 : Math.cos(a) * total * (0.4 + 0.6 * Math.sqrt(i / Math.max(1, sorted.length)))) * ASPECT;
    const y = m ? ((m[1] - my) / spread) * total * 0.9 : Math.sin(a) * total * (0.4 + 0.6 * Math.sqrt(i / Math.max(1, sorted.length)));
    return { id: c.id, index: i, x, y, r: radii[i], ids: c.nodeIds };
  });
  // Clouds never overlap: pushed apart (the bigger one moves less), with a weak pull to the middle.
  for (let it = 0; it < 220; it += 1) {
    let moved = 0;
    for (let i = 0; i < clouds.length; i += 1) for (let j = i + 1; j < clouds.length; j += 1) {
      const a = clouds[i], b = clouds[j];
      let dx = b.x - a.x, dy = b.y - a.y; let d = Math.hypot(dx, dy);
      if (d < 1e-6) { dx = Math.cos(i + j); dy = Math.sin(i + j); d = 1; }
      const need = a.r + b.r + GAP;
      if (d >= need) continue;
      const push = (need - d) / d;
      const wa = b.r / (a.r + b.r), wb = a.r / (a.r + b.r);
      a.x -= dx * push * wa; a.y -= dy * push * wa; b.x += dx * push * wb; b.y += dy * push * wb;
      moved += need - d;
    }
    for (const c of clouds) { c.x *= 0.9985; c.y *= 0.993; }
    if (moved < 0.01 && it > 20) break;
  }
  // Centred on the origin (by area).
  const area = clouds.reduce((s, c) => s + c.r * c.r, 0) || 1;
  const cx = clouds.reduce((s, c) => s + c.x * c.r * c.r, 0) / area, cy = clouds.reduce((s, c) => s + c.y * c.r * c.r, 0) / area;
  for (const c of clouds) { c.x -= cx; c.y -= cy; }

  // Inside a cloud: each memory keeps its direction from the cloud's centre in the atlas; its distance comes
  // from its rank (so the cloud fills evenly instead of a few outliers at the edge and everyone in the middle).
  const nodes = new Map<string, Vec3>();
  const cloudOf = new Map<string, number>();
  for (const c of clouds) {
    const pts = c.ids.map((id) => at.get(id));
    const have = pts.filter(Boolean) as number[][];
    const ox = have.length ? have.reduce((s, p) => s + (p[0] || 0), 0) / have.length : 0;
    const oy = have.length ? have.reduce((s, p) => s + (p[1] || 0), 0) / have.length : 0;
    const polar = c.ids.map((id, k) => {
      const p = pts[k];
      const dx = p ? (p[0] || 0) - ox : 0, dy = p ? (p[1] || 0) - oy : 0;
      const d = Math.hypot(dx, dy);
      return { id, a: d > 1e-9 ? Math.atan2(dy, dx) : hash01(id, 5) * Math.PI * 2, d: d > 1e-9 ? d : hash01(id, 6) * 1e-6 };
    });
    const byDist = [...polar].sort((p, q) => p.d - q.d || (p.id < q.id ? -1 : 1));
    byDist.forEach((p, rank) => {
      const rr = c.ids.length === 1 ? 0 : c.r * 0.8 * Math.sqrt((rank + 0.5) / c.ids.length);
      const a = p.a + (hash01(p.id, 7) - 0.5) * 0.25;
      nodes.set(p.id, [c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr, 0]);
      cloudOf.set(p.id, c.index);
    });
  }
  const clustersBox = new Map<string, { center: Vec3; radius: number }>();
  for (const c of clouds) clustersBox.set(c.id, { center: [c.x, c.y, 0], radius: c.r });
  const R = Math.max(200, ...clouds.map((c) => Math.hypot(c.x, c.y) + c.r));
  const halfW = Math.max(150, ...clouds.map((c) => Math.abs(c.x) + c.r));
  const halfH = Math.max(120, ...clouds.map((c) => Math.abs(c.y) + c.r));
  return { nodes, clusters: clustersBox, core: [0, 0, 0], clouds, cloudOf, R, halfW, halfH };
}

/** How far the camera must be (fov 45°) to see the whole field in a view of this aspect (width / height). */
export function fitDistance(layout: Pick<CloudLayout, "halfW" | "halfH">, aspect: number): number {
  const t = Math.tan((45 * Math.PI) / 360);
  return Math.max(layout.halfH / t, layout.halfW / (t * Math.max(0.3, aspect))) * 1.05;
}

/**
 * The grain of the field: particles around each memory and through each cloud, and fibres between nearby
 * particles of the same cloud. `perMemory` particles per memory (the caller lowers it with many memories).
 * Each particle and fibre end knows its cloud (to take its colour) and a seed (for its own small motion).
 */
export type Field = {
  points: { pos: Float32Array; cloud: Float32Array; seed: Float32Array; alpha: Float32Array; count: number };
  fibres: { pos: Float32Array; cloud: Float32Array; seed: Float32Array; alpha: Float32Array; count: number };
};
export function buildField(layout: CloudLayout, perMemory: number): Field {
  const px: number[] = [], py: number[] = [], pc: number[] = [], ps: number[] = [], pa: number[] = [];
  let k = 0;
  const rnd = () => hash01(`g${k}`, (k += 1));
  const gauss = () => { const u = Math.max(1e-6, rnd()), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const byCloud: number[][] = layout.clouds.map(() => []);
  for (const c of layout.clouds) {
    const n = c.ids.length * perMemory;
    // Around each memory: a tight knot; through the cloud: an even haze (more of it in bigger clouds).
    for (const id of c.ids) {
      const p = layout.nodes.get(id)!;
      const sigma = c.r * (0.06 + 0.1 * rnd());
      for (let j = 0; j < Math.ceil(perMemory * 0.55); j += 1) {
        byCloud[c.index].push(px.length);
        px.push(p[0] + gauss() * sigma); py.push(p[1] + gauss() * sigma); pc.push(c.index); ps.push(rnd()); pa.push(0.25 + 0.5 * rnd());
      }
    }
    const haze = Math.floor(n * 0.45);
    for (let j = 0; j < haze; j += 1) {
      const a = rnd() * Math.PI * 2, rr = c.r * Math.sqrt(rnd()) * (0.95 + 0.15 * gauss());
      byCloud[c.index].push(px.length);
      px.push(c.x + Math.cos(a) * rr); py.push(c.y + Math.sin(a) * rr); pc.push(c.index); ps.push(rnd()); pa.push(0.12 + 0.35 * rnd());
    }
  }
  // Fibres: each particle to the nearest of a few others of its cloud (a tangle, not a net), sometimes two.
  const fx: number[] = [], fy: number[] = [], fc: number[] = [], fs: number[] = [], fa: number[] = [];
  for (const c of layout.clouds) {
    const list = byCloud[c.index];
    const maxLen = c.r * 0.32;
    for (let q = 0; q < list.length; q += 1) {
      const i = list[q];
      let best = -1, bd = Infinity, second = -1, sd = Infinity;
      for (let t = 0; t < 10; t += 1) {
        const j = list[Math.floor(rnd() * list.length)];
        if (j === i) continue;
        const d = (px[j] - px[i]) ** 2 + (py[j] - py[i]) ** 2;
        if (d < bd) { second = best; sd = bd; best = j; bd = d; } else if (d < sd) { second = j; sd = d; }
      }
      for (const [j, d] of [[best, bd], [second, sd]] as [number, number][]) {
        if (j < 0 || Math.sqrt(d) > maxLen || (j === second && rnd() > 0.35)) continue;
        const a = 0.05 + 0.18 * rnd() * (1 - Math.sqrt(d) / maxLen);
        fx.push(px[i], px[j]); fy.push(py[i], py[j]); fc.push(c.index, c.index); fs.push(ps[i], ps[j]); fa.push(a, a);
      }
    }
  }
  const pack = (x: number[], y: number[], c: number[], s: number[], a: number[]) => {
    const pos = new Float32Array(x.length * 3);
    for (let i = 0; i < x.length; i += 1) { pos[i * 3] = x[i]; pos[i * 3 + 1] = y[i]; }
    return { pos, cloud: Float32Array.from(c), seed: Float32Array.from(s), alpha: Float32Array.from(a), count: x.length };
  };
  return { points: pack(px, py, pc, ps, pa), fibres: pack(fx, fy, fc, fs, fa) };
}

/** How many grain particles per memory for a quality and a number of memories (at most ~45k in all). */
export function grainPerMemory(quality: "alta" | "media" | "baixa", memories: number): number {
  const want = quality === "alta" ? 60 : quality === "media" ? 26 : 6;
  return Math.max(2, Math.min(want, Math.floor(45_000 / Math.max(1, memories))));
}
