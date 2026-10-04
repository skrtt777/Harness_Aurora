import * as THREE from "three";
import { clusterColor, groupColor, groupKey, hash, type Memory, type MemoryCluster } from "./data";

/**
 * Tidy constellation: every topic becomes a compact group (members keep their
 * meaning-based arrangement relative to each other, scaled to a size that
 * grows with the topic), the groups are packed side by side without
 * overlapping, and inside each group the lines draw its shape — the shortest
 * tree joining its stars — instead of a tangle of "similar" links.
 */
export type ConstellationGroup = {
  key: string;
  label: string;
  clusterId?: number;
  center: THREE.Vector3;
  radius: number;
  color: string;
  count: number;
};
export type ConstellationLayout = {
  positions: Map<string, [number, number, number]>;
  groups: ConstellationGroup[];
  edges: [string, string][];
};

const GAP = 7;

export function constellationLayout(memories: Memory[], clusters: MemoryCluster[]): ConstellationLayout {
  const keyOf = (m: Memory) => (m.cluster !== undefined ? `c${m.cluster}` : `g:${groupKey(m)}`);
  const members = new Map<string, Memory[]>();
  memories.forEach((m) => members.set(keyOf(m), [...(members.get(keyOf(m)) || []), m]));

  const groups = [...members].map(([key, list]) => {
    // Meaning map (x, y, z) laid on a galaxy disc: its two main axes become the floor (x, z).
    const disc = (p: [number, number, number]) => new THREE.Vector3(p[0], p[2] * 0.45, p[1]);
    const original = list.reduce((s, m) => s.add(disc(m.position)), new THREE.Vector3()).divideScalar(list.length);
    const offsets = list.map((m) => disc(m.position).sub(original));
    const rms = Math.sqrt(offsets.reduce((s, o) => s + o.lengthSq(), 0) / list.length);
    const radius = 2.5 + Math.sqrt(list.length) * 1.7;
    // Scale the group to its target size; a group with a single point stays a point.
    const scale = rms > 1e-3 ? (radius * 0.62) / rms : 0;
    const clusterId = key.startsWith("c") ? Number(key.slice(1)) : undefined;
    return {
      key,
      list,
      // Scaled to the target size; the few outliers are pulled back inside the ring.
      offsets: offsets.map((o) => {
        o.multiplyScalar(scale);
        const len = o.length(), max = radius * 0.9;
        return len > max ? o.multiplyScalar((max + (len - max) * 0.15) / len) : o;
      }),
      center: new THREE.Vector3(original.x, 0, original.z),
      radius,
      clusterId,
      label: clusterId !== undefined ? clusters.find((c) => c.id === clusterId)?.label || "sem assunto" : key.slice(2),
      color: clusterId !== undefined ? clusterColor(clusterId, "#8a93a0") : groupColor(key.slice(2)),
    };
  });

  // Pack the groups: a gentle pull to the middle, pushed apart until none overlap.
  for (const g of groups) if (g.center.lengthSq() < 1e-6) g.center.set(hash(g.key) - 0.5, 0, hash(g.key + "z") - 0.5);
  for (let step = 0; step < 220; step += 1) {
    for (const g of groups) g.center.multiplyScalar(0.97);
    for (let i = 0; i < groups.length; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        const a = groups[i], b = groups[j];
        const delta = b.center.clone().sub(a.center);
        let dist = delta.length();
        if (dist < 1e-4) { delta.set(hash(a.key + b.key) - 0.5, 0, hash(b.key + a.key) - 0.5); dist = delta.length(); }
        const min = a.radius + b.radius + GAP;
        if (dist >= min) continue;
        const push = delta.multiplyScalar(((min - dist) / dist) * 0.5);
        // Bigger groups move less.
        const wa = b.list.length / (a.list.length + b.list.length);
        a.center.addScaledVector(push, -2 * wa);
        b.center.addScaledVector(push, 2 * (1 - wa));
      }
    }
  }

  const positions = new Map<string, [number, number, number]>();
  const edges: [string, string][] = [];
  for (const g of groups) {
    const points = g.list.map((m, i) => {
      const p = g.center.clone().add(g.offsets[i]);
      positions.set(m.id, [p.x, p.y, p.z]);
      return p;
    });
    // Prim's minimum spanning tree: the constellation's shape.
    const inTree = new Array(points.length).fill(false);
    const best = new Array(points.length).fill(Infinity);
    const parent = new Array(points.length).fill(-1);
    if (points.length) best[0] = 0;
    for (let n = 0; n < points.length; n += 1) {
      let u = -1;
      for (let i = 0; i < points.length; i += 1) if (!inTree[i] && (u < 0 || best[i] < best[u])) u = i;
      inTree[u] = true;
      if (parent[u] >= 0) edges.push([g.list[parent[u]].id, g.list[u].id]);
      for (let v = 0; v < points.length; v += 1) {
        const d = points[u].distanceToSquared(points[v]);
        if (!inTree[v] && d < best[v]) { best[v] = d; parent[v] = u; }
      }
    }
  }
  return {
    positions,
    edges,
    groups: groups.map((g) => ({ key: g.key, label: g.label, clusterId: g.clusterId, center: g.center, radius: g.radius, color: g.color, count: g.list.length })),
  };
}
