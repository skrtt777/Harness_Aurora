// A section of the memory as a coral colony (seen from above): it grows from its base toward every memory of
// the section — space colonization, the algorithm that grows trees and corals — and each memory is a polyp at
// the tip of its own branch. The shape is the data: branches split where memories part ways, and thicken where
// many memories hang from them (pipe model). Deterministic: the same memories grow the same coral.
//
// `reefDisplace` is how a point of the reef moves in the water — the current's sway, the person's hand and the
// jellyfish pushing it aside, a ripple passing — the same formula the coral's shader uses (shaders.ts), so the
// polyps drawn as points stay exactly on the tips of their branches.
// The same hash as layout.ts (kept here so this module stands alone in the tests).
function hash01(text: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1_000_003) / 1_000_003;
}

export type CoralInput = { id: string; x: number; y: number };
export type Coral = {
  x: Float32Array; y: Float32Array; parent: Int32Array;
  /** Path length from the base, 0..1 (1 = the farthest tip). */
  depth: Float32Array;
  /** Branch width at the node (pipe model: grows with the memories it carries). */
  width: Float32Array;
  /** Each node's own phase in the current (0..1). */
  phase: Float32Array;
  /** Memory id → its tip node. */
  tips: Map<string, number>;
  count: number;
};

export function growCoral(base: { x: number; y: number }, memories: CoralInput[], opts: { seed?: string } = {}): Coral {
  const seed = opts.seed || "coral";
  const reach = Math.max(10, ...memories.map((m) => Math.hypot(m.x - base.x, m.y - base.y)));
  const step = Math.max(2.4, reach / 15);
  const influence = step * 6;
  const kill = step * 1.3;
  const xs: number[] = [base.x], ys: number[] = [base.y], parent: number[] = [-1];
  // Spatial hash of the nodes (cell = influence) so each attractor looks at its neighbourhood only.
  const cell = influence;
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
  const addNode = (x: number, y: number, p: number) => { xs.push(x); ys.push(y); parent.push(p); const k = key(x, y); (grid.get(k) || grid.set(k, []).get(k)!).push(xs.length - 1); return xs.length - 1; };
  grid.set(key(base.x, base.y), [0]);
  const nearest = (x: number, y: number, radius: number) => {
    let best = -1, bd = radius * radius;
    // A wide search looks at every node (the grid is for the small neighbourhoods of the growth).
    if (!Number.isFinite(radius) || radius > cell * 6) {
      for (let n = 0; n < xs.length; n += 1) { const d = (xs[n] - x) ** 2 + (ys[n] - y) ** 2; if (d < bd) { bd = d; best = n; } }
      return best;
    }
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), span = Math.ceil(radius / cell);
    for (let i = cx - span; i <= cx + span; i += 1) for (let j = cy - span; j <= cy + span; j += 1) {
      for (const n of grid.get(`${i}:${j}`) || []) { const d = (xs[n] - x) ** 2 + (ys[n] - y) ** 2; if (d < bd) { bd = d; best = n; } }
    }
    return best;
  };
  const alive = memories.map((m) => ({ ...m, owner: -1 }));
  for (let iter = 0; iter < 160 && alive.some((a) => a.owner < 0); iter += 1) {
    // Each attractor pulls its closest node (within reach of influence).
    const pull = new Map<number, { dx: number; dy: number; n: number }>();
    for (const a of alive) {
      if (a.owner >= 0) continue;
      const n = nearest(a.x, a.y, influence);
      if (n < 0) continue;
      const d = Math.hypot(a.x - xs[n], a.y - ys[n]) || 1;
      const acc = pull.get(n) || { dx: 0, dy: 0, n: 0 };
      acc.dx += (a.x - xs[n]) / d; acc.dy += (a.y - ys[n]) / d; acc.n += 1;
      pull.set(n, acc);
    }
    if (!pull.size) {
      // Nothing within reach: the colony stretches toward the nearest waiting memory.
      let best: { a: (typeof alive)[number]; n: number; d: number } | null = null;
      for (const a of alive) { if (a.owner >= 0) continue; const n = nearest(a.x, a.y, reach * 4); if (n < 0) continue; const d = Math.hypot(a.x - xs[n], a.y - ys[n]); if (!best || d < best.d) best = { a, n, d }; }
      if (!best) break;
      pull.set(best.n, { dx: (best.a.x - xs[best.n]) / (best.d || 1), dy: (best.a.y - ys[best.n]) / (best.d || 1), n: 1 });
    }
    for (const [n, acc] of pull) {
      let dx = acc.dx / acc.n, dy = acc.dy / acc.n;
      // A little life in each branch: a slight bend that depends on where it is (deterministic).
      const wob = (hash01(`${seed}:${n}`) - 0.5) * 0.5;
      const c = Math.cos(wob), s = Math.sin(wob);
      [dx, dy] = [dx * c - dy * s, dx * s + dy * c];
      const len = Math.hypot(dx, dy) || 1;
      addNode(xs[n] + (dx / len) * step, ys[n] + (dy / len) * step, n);
    }
    // Memories reached are owned by the node that reached them.
    for (const a of alive) {
      if (a.owner >= 0) continue;
      const n = nearest(a.x, a.y, kill);
      if (n >= 0) a.owner = n;
    }
  }
  // Every memory ends on its own tip, exactly where it is.
  const tips = new Map<string, number>();
  for (const a of alive) {
    const owner = a.owner >= 0 ? a.owner : nearest(a.x, a.y, Infinity);
    tips.set(a.id, addNode(a.x, a.y, owner < 0 ? 0 : owner));
  }
  const count = xs.length;
  // Pipe model: a branch is as thick as the memories it carries; path length from the base.
  const carried = new Float32Array(count);
  for (const t of tips.values()) carried[t] += 1;
  for (let i = count - 1; i > 0; i -= 1) if (parent[i] >= 0) carried[parent[i]] += carried[i];
  const dist = new Float32Array(count);
  for (let i = 1; i < count; i += 1) dist[i] = dist[parent[i]] + Math.hypot(xs[i] - xs[parent[i]], ys[i] - ys[parent[i]]);
  const maxDist = Math.max(1, ...dist);
  const coral: Coral = { x: Float32Array.from(xs), y: Float32Array.from(ys), parent: Int32Array.from(parent), depth: new Float32Array(count), width: new Float32Array(count), phase: new Float32Array(count), tips, count };
  for (let i = 0; i < count; i += 1) {
    coral.depth[i] = dist[i] / maxDist;
    coral.width[i] = Math.min(step * 1.5, 1.1 + Math.sqrt(carried[i]) * 0.95);
    coral.phase[i] = hash01(`${seed}:p${i}`);
  }
  for (const [id, t] of tips) coral.phase[t] = hash01(id);
  return coral;
}

// ---------------------------------------------------------------- how the reef moves in the water
export const REEF = { sway: 2.4, handR: 34, handPush: 9, rippleWidth: 80, ripplePush: 6 };
export type ReefForces = { t: number; hand: { x: number; y: number; s: number }; jelly: { x: number; y: number; r: number }; ripple: { x: number; y: number; r: number; s: number } | null };

/** The offset of a point of the reef (at x, y, with its depth and phase) right now. Mirrors the shader. */
export function reefDisplace(x: number, y: number, depth: number, phase: number, f: ReefForces): [number, number] {
  const d2 = depth * depth;
  let dx = Math.sin(f.t * 0.8 + phase * 6.2831) * d2 * REEF.sway;
  let dy = Math.cos(f.t * 0.7 + phase * 6.2831) * d2 * REEF.sway;
  const push = (px: number, py: number, s: number, r: number) => {
    const hx = x - px, hy = y - py; const d = Math.hypot(hx, hy);
    if (d > 0.01 && d < r) { const k = s * (1 - d / r) ** 2 * REEF.handPush * d2; dx += (hx / d) * k; dy += (hy / d) * k; }
  };
  push(f.hand.x, f.hand.y, f.hand.s, REEF.handR);
  if (f.jelly.r > 0) push(f.jelly.x, f.jelly.y, 0.8, f.jelly.r * 2.2);
  if (f.ripple && f.ripple.s > 0) {
    const rx = x - f.ripple.x, ry = y - f.ripple.y; const rd = Math.hypot(rx, ry) || 0.0001;
    const ring = Math.abs(rd - f.ripple.r);
    const k = f.ripple.s * Math.exp(-(ring * ring) / REEF.rippleWidth) * REEF.ripplePush * depth;
    dx += (rx / rd) * k; dy += (ry / rd) * k;
  }
  return [dx, dy];
}
