// Where everything sits on the Mapa Vivo: deterministic and stable. The same memory lands in the same place
// every time (positions come from its id and, in the overview, from the semantic atlas), so a new memory
// enters its cluster without the others jumping. Clusters spread on a golden-angle spiral around the Aurora's
// core, the general memory right next to it; a few relaxation steps keep clusters from overlapping.
import type { MemoryGraph } from "./adapter";
import type { MemoryGraphSnapshot } from "../api";

export type Vec3 = [number, number, number];
export type Layout = { nodes: Map<string, Vec3>; clusters: Map<string, { center: Vec3; radius: number }>; core: Vec3 };

/** A stable number in [0, 1) from a string (FNV-1a). */
export function hash01(text: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1_000_003) / 1_000_003;
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
export const clusterRadius = (count: number) => 16 + 5.2 * Math.sqrt(Math.max(1, count));

export function layoutGraph(graph: MemoryGraph, snap: Pick<MemoryGraphSnapshot, "atlas"> | null = null): Layout {
  const clusters = new Map<string, { center: Vec3; radius: number }>();
  const ordered = graph.clusters;
  // The general memory hugs the core; the rest on the spiral, in a stable order (size, then id).
  let ring = 0;
  for (const c of ordered) {
    const radius = clusterRadius(c.nodeIds.length);
    if (c.general) { clusters.set(c.id, { center: [0, 0, 0], radius: radius * 0.9 }); continue; }
    ring += 1;
    const angle = ring * GOLDEN + hash01(c.id) * 0.35;
    const distance = 70 + 44 * Math.sqrt(ring) + radius;
    clusters.set(c.id, { center: [Math.cos(angle) * distance, Math.sin(angle) * distance * 0.72, (hash01(c.id, 7) - 0.5) * 18], radius });
  }
  // Relaxation: overlapping clusters push each other apart (the general one stays at the core).
  const list = [...clusters.entries()];
  for (let step = 0; step < 40; step += 1) {
    for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) {
      const [ia, a] = list[i]; const [ib, b] = list[j];
      const dx = b.center[0] - a.center[0]; const dy = b.center[1] - a.center[1];
      const d = Math.hypot(dx, dy) || 0.01; const min = a.radius + b.radius + 14;
      if (d >= min) continue;
      const push = (min - d) / 2; const ux = dx / d; const uy = dy / d;
      const aFixed = ia === "geral"; const bFixed = ib === "geral";
      if (!aFixed) { a.center[0] -= ux * push * (bFixed ? 2 : 1); a.center[1] -= uy * push * (bFixed ? 2 : 1); }
      if (!bFixed) { b.center[0] += ux * push * (aFixed ? 2 : 1); b.center[1] += uy * push * (aFixed ? 2 : 1); }
    }
  }

  // Nodes: inside their cluster. In the overview, the atlas's semantic position (relative to its cluster's
  // centre) gives the inner structure; otherwise a uniform disk point from the id.
  const atlas = new Map((snap?.atlas?.points || []).map((p) => [p.id, p.position]));
  const centroid = new Map<string, Vec3>();
  if (graph.mode === "geral") {
    for (const c of graph.clusters) {
      const pts = c.nodeIds.map((id) => atlas.get(id)).filter(Boolean) as number[][];
      if (pts.length) centroid.set(c.id, [0, 1, 2].map((a) => pts.reduce((s, p) => s + p[a], 0) / pts.length) as Vec3);
    }
  }
  const nodes = new Map<string, Vec3>();
  for (const c of graph.clusters) {
    const { center, radius } = clusters.get(c.id)!;
    const mid = centroid.get(c.id);
    let spread = 1;
    if (mid) {
      const far = Math.max(1, ...c.nodeIds.map((id) => { const p = atlas.get(id); return p ? Math.hypot(p[0] - mid[0], p[1] - mid[1]) : 0; }));
      spread = (radius * 0.92) / far;
    }
    for (const id of c.nodeIds) {
      const p = mid ? atlas.get(id) : undefined;
      if (p && mid) {
        // A little of the id's own jitter so two near-identical memories do not sit on one pixel.
        // Half the atlas's semantic position, half a uniform disk point: the structure stays, the shape is a cloud.
        const angle = hash01(id, 1) * Math.PI * 2;
        const r = radius * Math.sqrt(hash01(id, 2)) * 0.9;
        nodes.set(id, [
          center[0] + ((p[0] - mid[0]) * spread + Math.cos(angle) * r) / 2,
          center[1] + ((p[1] - mid[1]) * spread + Math.sin(angle) * r * 0.85) / 2,
          center[2] + (p[2] - (mid[2] || 0)) * spread * 0.3,
        ]);
        continue;
      }
      const angle = hash01(id, 1) * Math.PI * 2;
      const r = radius * Math.sqrt(hash01(id, 2)) * 0.95;
      nodes.set(id, [center[0] + Math.cos(angle) * r, center[1] + Math.sin(angle) * r * 0.85, center[2] + (hash01(id, 4) - 0.5) * 6]);
    }
  }
  return { nodes, clusters, core: [0, 0, 0] };
}
