// The Aurora's memory as one living tree, seen like a search tree: the root (the Aurora) at the bottom, one
// branch per section fanning out from it, and the section's memories as the leaves of a wide canopy at the
// top. The shape is the data:
//   - inside a section the memories are laid side by side along their main semantic axis, and the section
//     splits where the meaning changes most (each split cut at the biggest semantic gap near its middle), so
//     memories that mean nearly the same thing share a fork high in the canopy and different ones part near
//     the section's base;
//   - the newer a memory, the higher it sits in the canopy;
//   - each section's width in the canopy is proportional to how many memories it holds.
// Deterministic: the same memories grow the same tree. Pure (no DOM, no three.js), so it is tested in node.
import type { MemoryGraph } from "./adapter";
import type { MemoryGraphSnapshot } from "../api";
import type { Layout, Vec3 } from "./layout";

// The same hash as layout.ts (kept here so this module stands alone in the tests).
function hash01(text: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1_000_003) / 1_000_003;
}

export type MemoryTree = {
  count: number;
  x: Float32Array; y: Float32Array;
  parent: Int32Array;
  /** Distance from the root in units of R (the canopy is ~0.75..1.5). */
  r: Float32Array;
  /** Angle from the vertical (radians, negative to the left). */
  angle: Float32Array;
  /** Hops from the root. */
  level: Uint16Array;
  /** Memories under the node (1 for a leaf). */
  carried: Uint32Array;
  /** Index of the node's section in `sections` (-1 for the root). */
  section: Int32Array;
  /** The memory a leaf is (null for forks). */
  memoryAt: (string | null)[];
  leafOf: Map<string, number>;
  /** The sections left to right: base node, angular range of its leaves, where its name goes. */
  sections: { id: string; node: number; from: number; to: number; labelX: number; labelY: number }[];
  /** Size of the tree in world units (the canopy spans about ±1.12 R, its top is at ~R). */
  R: number;
  /** The widest angle and the farthest distance (in R) of any node: how far a wave from the root must go. */
  span: number; reach: number;
};
export type TreeLayout = Layout & { tree: MemoryTree };

export const treeRadius = (memories: number) => 170 + 30 * Math.sqrt(Math.max(1, memories));
/** Half the canopy's width, in R. */
export const HALF_WIDTH = 1.12;
const SECTION_Y = 0.06;
const CANOPY_Y = 0.5;

type Vec = number[];
const sub = (a: Vec, b: Vec) => a.map((v, i) => v - (b[i] || 0));
const dot = (a: Vec, b: Vec) => a.reduce((s, v, i) => s + v * (b[i] || 0), 0);
const dist = (a: Vec, b: Vec) => Math.sqrt(a.reduce((s, v, i) => s + (v - (b[i] || 0)) ** 2, 0));

/** The memories of a section in an order where neighbours mean similar things (their main semantic axis). */
function semanticOrder(ids: string[], at: Map<string, Vec>, createdAt: Map<string, number>): string[] {
  const pts = ids.map((id) => at.get(id));
  if (ids.length < 3 || pts.some((p) => !p)) return [...ids].sort((a, b) => (createdAt.get(a) || 0) - (createdAt.get(b) || 0) || (a < b ? -1 : 1));
  const dim = pts[0]!.length;
  const mean = new Array(dim).fill(0);
  for (const p of pts) for (let k = 0; k < dim; k += 1) mean[k] += p![k] / pts.length;
  const centred = pts.map((p) => sub(p!, mean));
  // Main axis by power iteration on the covariance (a fixed start: deterministic).
  let v = Array.from({ length: dim }, (_, k) => 1 / (k + 1));
  for (let it = 0; it < 40; it += 1) {
    const next = new Array(dim).fill(0);
    for (const c of centred) { const s = dot(c, v); for (let k = 0; k < dim; k += 1) next[k] += c[k] * s; }
    const len = Math.sqrt(dot(next, next)) || 1;
    v = next.map((x) => x / len);
  }
  const proj = new Map(ids.map((id, i) => [id, dot(centred[i], v)]));
  return [...ids].sort((a, b) => proj.get(a)! - proj.get(b)! || (a < b ? -1 : 1));
}

export function layoutTree(graph: MemoryGraph, snap: Pick<MemoryGraphSnapshot, "atlas"> | null = null): TreeLayout {
  const N = graph.nodes.length;
  const R = treeRadius(N);
  const at = new Map<string, Vec>((snap?.atlas?.points || []).map((p) => [p.id, p.position]));
  const createdAt = new Map(graph.nodes.map((n) => [n.id, n.createdAt]));
  // Recency rank: the newest memories at the top of the canopy.
  const byAge = [...graph.nodes].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  const recency = new Map(byAge.map((n, i) => [n.id, N > 1 ? i / (N - 1) : 1]));

  // The sections side by side: the biggest in the middle, the others alternating to its sides (stable order).
  const sorted = [...graph.clusters].filter((c) => c.nodeIds.length).sort((a, b) => b.nodeIds.length - a.nodeIds.length || (a.id < b.id ? -1 : 1));
  const fan: typeof sorted = [];
  sorted.forEach((c, i) => { if (i % 2) fan.unshift(c); else fan.push(c); });

  // Nodes as growing arrays (parents always before their children); node 0 is the root.
  const P: number[] = [-1], X: number[] = [0], Y: number[] = [0], SEC: number[] = [-1], MEM: (string | null)[] = [null];
  const add = (parent: number, x: number, y: number, section: number, memory: string | null) => { P.push(parent); X.push(x); Y.push(y); SEC.push(section); MEM.push(memory); return P.length - 1; };

  const gap = 2; // empty leaf slots between two sections
  const slots = Math.max(1, N + gap * (fan.length - 1));
  const slotW = slots > 1 ? (2 * HALF_WIDTH * R) / (slots - 1) : 0;
  let cursor = slots > 1 ? -HALF_WIDTH * R : 0;
  const sections: MemoryTree["sections"] = [];
  // A tall canopy, like a field of stars: newer memories higher, each with its own small offset.
  const leafY = (id: string) => R * (CANOPY_Y + 0.5 * (0.6 * recency.get(id)! + 0.4 * hash01(id, 9)));

  fan.forEach((cluster, si) => {
    const order = semanticOrder(cluster.nodeIds, at, createdAt);
    const xs = order.map((id, i) => cursor + (i + (hash01(id, 11) - 0.5) * 0.8) * slotW);
    const ys = order.map((id) => leafY(id));
    cursor += (order.length + gap) * slotW;
    const mid = (xs[0] + xs[xs.length - 1]) / 2;
    // The section's base sits just above the root, so its first branches fan out from the root itself.
    const base = add(0, mid * 0.08, R * (SECTION_Y + hash01(cluster.id, 3) * 0.02), si, null);
    // Where the meaning changes between two neighbours (no atlas: every gap the same).
    const gapAt = order.map((id, i) => (i === 0 ? 0 : at.get(id) && at.get(order[i - 1]) ? dist(at.get(id)!, at.get(order[i - 1])!) : 1));
    // Split [lo, hi) into parts at the biggest gaps near the even cuts; a fork per part, higher at each level.
    const grow = (lo: number, hi: number, parent: number, level: number) => {
      const n = hi - lo;
      if (n === 1) { add(parent, xs[lo], ys[lo], si, order[lo]); return; }
      const parts = n > 8 ? 3 : 2;
      const cuts: number[] = [];
      for (let k = 1; k < parts; k += 1) {
        const ideal = lo + (n * k) / parts;
        const window = n <= 6 ? n : Math.max(1, Math.round(n * 0.18));
        let best = -1, bestGap = -1;
        for (let i = Math.max(lo + 1, Math.ceil(ideal - window), (cuts[cuts.length - 1] ?? lo) + 1); i <= Math.min(hi - 1, Math.floor(ideal + window)); i += 1) {
          const g = gapAt[i] - Math.abs(i - ideal) * 1e-6; // ties: the most even cut
          if (g > bestGap) { bestGap = g; best = i; }
        }
        if (best > 0) cuts.push(best);
      }
      const bounds = [lo, ...cuts, hi];
      for (let k = 0; k + 1 < bounds.length; k += 1) {
        const a = bounds[k], b = bounds[k + 1];
        if (b - a === 1) { add(parent, xs[a], ys[a], si, order[a]); continue; }
        // Each fork climbs halfway from its parent toward the middle height of its memories, so the deeper
        // the fork the higher it sits; a memory may hang a little below its fork (the canopy is a field).
        let sy = 0; for (let i = a; i < b; i += 1) sy += ys[i];
        const y = Math.max(Y[parent] + R * 0.03, Y[parent] + (sy / (b - a) - Y[parent]) * (level === 0 ? 0.42 : 0.5) + (hash01(order[a], level) - 0.5) * R * 0.04);
        let sx = 0; for (let i = a; i < b; i += 1) sx += xs[i];
        const spread = xs[b - 1] - xs[a];
        const fork = add(parent, sx / (b - a) + (hash01(order[b - 1], level) - 0.5) * spread * 0.35, y, si, null);
        grow(a, b, fork, level + 1);
      }
    };
    grow(0, order.length, base, 0);
    sections.push({ id: cluster.id, node: base, from: 0, to: 0, labelX: mid, labelY: Math.max(...ys) + R * 0.07 });
  });

  const count = P.length;
  const tree: MemoryTree = {
    count, R, span: 0, reach: 0,
    x: Float32Array.from(X), y: Float32Array.from(Y), parent: Int32Array.from(P), r: new Float32Array(count), angle: new Float32Array(count),
    level: new Uint16Array(count), carried: new Uint32Array(count), section: Int32Array.from(SEC), memoryAt: MEM, leafOf: new Map(), sections,
  };
  for (let i = 0; i < count; i += 1) {
    tree.r[i] = Math.hypot(X[i], Y[i]) / R;
    tree.angle[i] = Math.atan2(X[i], Y[i]);
    tree.span = Math.max(tree.span, Math.abs(tree.angle[i]));
    tree.reach = Math.max(tree.reach, tree.r[i]);
    if (i > 0) tree.level[i] = tree.level[P[i]] + 1;
    if (MEM[i]) { tree.leafOf.set(MEM[i]!, i); tree.carried[i] = 1; }
  }
  for (let i = count - 1; i > 0; i -= 1) tree.carried[P[i]] += tree.carried[i];
  for (const s of sections) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < count; i += 1) if (SEC[i] === sections.indexOf(s) && MEM[i]) { lo = Math.min(lo, tree.angle[i]); hi = Math.max(hi, tree.angle[i]); }
    s.from = lo; s.to = hi;
  }

  // The Layout the rest of the map uses (camera, merges): leaves where they are; a section's box around them.
  const nodes = new Map<string, Vec3>();
  for (const [id, i] of tree.leafOf) nodes.set(id, [tree.x[i], tree.y[i], 0]);
  const clusters = new Map<string, { center: Vec3; radius: number }>();
  for (const s of sections) {
    const ids = graph.clusters.find((c) => c.id === s.id)!.nodeIds;
    const pts = ids.map((id) => nodes.get(id)!).filter(Boolean);
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const radius = Math.max(12, ...pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy)));
    clusters.set(s.id, { center: [cx, cy, 0], radius });
  }
  return { nodes, clusters, core: [0, 0, 0], tree };
}

/** The nodes from the root up to `node` (root first). */
export function pathTo(tree: MemoryTree, node: number): number[] {
  const out: number[] = [];
  for (let n = node; n >= 0; n = tree.parent[n]) out.push(n);
  return out.reverse();
}

/** The way from one node to another along the branches: down to their common fork, then up (a → b). */
export function pathBetween(tree: MemoryTree, a: number, b: number): number[] {
  const up = pathTo(tree, a), down = pathTo(tree, b);
  let k = 0;
  while (k < up.length && k < down.length && up[k] === down[k]) k += 1;
  return [...up.slice(k - 1).reverse(), ...down.slice(k)];
}

/** The fork where two memories meet (the lower it is, the less alike they are). */
export function commonFork(tree: MemoryTree, a: number, b: number): number {
  const up = pathTo(tree, a), down = pathTo(tree, b);
  let k = 0;
  while (k < up.length && k < down.length && up[k] === down[k]) k += 1;
  return up[k - 1];
}
