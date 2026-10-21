// The Mapa Vivo's shared geometry types and the stable hash used to place things deterministically
// (where each memory sits is decided by tree.ts).

export type Vec3 = [number, number, number];
export type Layout = { nodes: Map<string, Vec3>; clusters: Map<string, { center: Vec3; radius: number }>; core: Vec3 };

/** A stable number in [0, 1) from a string (FNV-1a). */
export function hash01(text: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1_000_003) / 1_000_003;
}
