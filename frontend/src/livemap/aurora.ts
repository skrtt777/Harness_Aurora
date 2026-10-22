import type { Cloud, CloudLayout } from "./clouds";
import type { Vec3 } from "./layout";

/** A stable number in [0, 1) from a string (FNV-1a; the same as layout.ts's, kept here so this file stands alone). */
function hash01(text: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1_000_003) / 1_000_003;
}

/**
 * Memórias / Mapa Vivo — the aurora: the memory drawn as the Aurora's own sky (AuroraField.tsx). Pure and tested.
 *   - each section (a node of the Zeladora) is a curtain of an aurora borealis hanging over a dark lake: a long
 *     folded hem, its veil rising from it and fading;
 *   - each memory is one ray of its curtain, standing on the hem (its place along the hem comes from where its
 *     meaning puts it in the atlas: neighbours in meaning stand side by side); nothing else makes a ray;
 *   - the curtains keep the atlas's left-to-right order, in two rows (behind and in front) so long ones can
 *     overlap without touching, the row bowed towards the viewer at its ends (the sky around you).
 * The result is a CloudLayout (every memory a point, every section a "cloud" with a centre and a radius), so the
 * rest of the map (the Zeladora, the probe, the labels, the camera) works on it unchanged.
 */
export type Curtain = {
  id: string;
  index: number;
  /** Centre of the hem (y: the hem's height). */
  x: number; y: number; z: number;
  /** Along the hem (unit, in xz) and its normal (unit, in xz). */
  dx: number; dz: number; nx: number; nz: number;
  /** Length along the hem, height of the veil. */
  length: number; height: number;
  /** The hem's folds (fixed): number of waves along it and their phase. */
  folds: number; phase: number;
};
export type AuroraInfo = {
  curtains: Curtain[];
  /** Per memory: its curtain and its place along the hem (0..1). */
  place: Map<string, { curtain: number; u: number }>;
  /** The lake's height. */
  ground: number;
  /** The camera's direction for the whole sky (from above the lake: the folds of the curtains show). */
  front: Vec3;
  /** Where each section's name goes (per curtain index): above its veil, near its left end. */
  labelAt: Vec3[];
};
export type AuroraLayout = CloudLayout & { aurora: AuroraInfo };

const GAP = 50;
/** A curtain's length and height from its number of memories (both grow with the square root). */
export const curtainLength = (n: number) => 90 + 62 * Math.sqrt(Math.max(1, n));
export const curtainHeight = (n: number) => 230 + 42 * Math.sqrt(Math.max(1, n));

/** A point of the hem at u (0..1), with its fixed folds (no sway). */
export function hemAt(c: Curtain, u: number): Vec3 {
  const s = (u - 0.5) * c.length;
  const fold = Math.sin(u * c.folds * Math.PI * 2 + c.phase) * c.length * 0.06 + Math.sin(u * 2.3 * Math.PI + c.phase * 1.7) * c.length * 0.04;
  return [c.x + c.dx * s + c.nx * fold, c.y, c.z + c.dz * s + c.nz * fold];
}
/** How far the hem sways at u and time t (along its normal): the same function the veil's shader uses. */
export function swayAt(c: Curtain, u: number, t: number): number {
  return c.length * (0.016 * Math.sin(u * 9 + t * 0.45 + c.phase) + 0.009 * Math.sin(u * 23 - t * 0.7 + c.phase * 2));
}

export function layoutAurora(base: CloudLayout): AuroraLayout {
  // The atlas's order, left to right (the base layout put meaning-neighbours near each other).
  const order = [...base.clouds].sort((a, b) => a.x - b.x || (a.id < b.id ? -1 : 1));
  const rows = order.length > 3 ? 2 : 1;
  const sized = order.map((c) => ({ c, L: curtainLength(c.ids.length), H: curtainHeight(c.ids.length) }));
  // Into rows, alternating; each row laid end to end (with a gap), the front row shifted by half a curtain.
  const rowItems: (typeof sized)[] = Array.from({ length: rows }, () => []);
  sized.forEach((s, i) => rowItems[i % rows].push(s));
  const xs = new Map<string, number>();
  let widest = 0;
  rowItems.forEach((items, r) => {
    const total = items.reduce((s, it) => s + it.L, 0) + GAP * Math.max(0, items.length - 1);
    let x = -total / 2 + (r === 1 ? items[0]?.L * 0.25 || 0 : 0);
    for (const it of items) { xs.set(it.c.id, x + it.L / 2); x += it.L + GAP; }
    widest = Math.max(widest, total);
  });
  const W = Math.max(200, widest / 2);
  const tallest = Math.max(...sized.map((s) => s.H), 200);
  const ground = -tallest * 0.5;
  const curtains: Curtain[] = [];
  const clouds: Cloud[] = [];
  const nodes = new Map<string, Vec3>();
  const cloudOf = new Map<string, number>();
  const place = new Map<string, { curtain: number; u: number }>();
  const clusters = new Map<string, { center: Vec3; radius: number }>();
  // Keep the base layout's indices (they give each section its colour everywhere in the app).
  for (const s of sized) {
    const c = s.c;
    const r = rows === 2 ? order.indexOf(c) % 2 : 0;
    const x = xs.get(c.id)!;
    const t = x / W;
    // The row bows towards the viewer at its ends; behind (r 0) and in front (r 1).
    const z = (r === 0 ? -170 : 130) + t * t * W * 0.2;
    // Along the row, a little turned (and following the bow).
    const angle = (hash01(c.id, 11) - 0.5) * 0.45 - Math.atan(2 * t * 0.2);
    const dx = Math.cos(angle), dz = Math.sin(angle);
    const y = ground + 14 + hash01(c.id, 12) * 22 + (r === 0 ? 16 : 0);
    const curtain: Curtain = { id: c.id, index: c.index, x, y, z, dx, dz, nx: -dz, nz: dx, length: s.L, height: s.H, folds: 1 + Math.round(hash01(c.id, 13) * 2), phase: hash01(c.id, 14) * Math.PI * 2 };
    curtains[c.index] = curtain;
    // Its memories along the hem in the atlas order (their base positions along the curtain's direction).
    const members = [...c.ids].sort((a, b) => {
      const pa = base.nodes.get(a), pb = base.nodes.get(b);
      return (pa ? pa[0] * dx + pa[2] * dz : 0) - (pb ? pb[0] * dx + pb[2] * dz : 0) || (a < b ? -1 : 1);
    });
    members.forEach((id, k) => {
      const u = 0.08 + 0.84 * (members.length === 1 ? 0.5 : (k + 0.5 + (hash01(id, 15) - 0.5) * 0.5) / members.length);
      const p = hemAt(curtain, u);
      nodes.set(id, [p[0], p[1] + curtain.height * (0.03 + 0.05 * hash01(id, 16)), p[2]]);
      cloudOf.set(id, c.index);
      place.set(id, { curtain: c.index, u });
    });
    const centre: Vec3 = [x, y + s.H * 0.45, z];
    const radius = Math.max(s.L, s.H) * 0.5;
    // (r places its name: just above the veil's top, at its left.)
    clouds[c.index] = { id: c.id, index: c.index, x: centre[0], y: centre[1], z: centre[2], r: s.H * 0.62, ids: c.ids };
    clusters.set(c.id, { center: centre, radius });
  }
  // Centred: the middle between the lake and the tallest top at y 0.
  const top = Math.max(...curtains.filter(Boolean).map((c) => c.y + c.height), 0);
  const mid = (ground + top) / 2;
  const shift = (p: Vec3): Vec3 => [p[0], p[1] - mid, p[2]];
  for (const c of curtains) if (c) c.y -= mid;
  for (const c of clouds) if (c) c.y -= mid;
  for (const [id, p] of nodes) nodes.set(id, shift(p));
  for (const [id, b] of clusters) clusters.set(id, { center: shift(b.center), radius: b.radius });
  const halfW = W * 1.12 + 40, halfH = (top - ground) / 2 + 20;
  const R = Math.max(halfW, halfH, ...curtains.filter(Boolean).map((c) => Math.hypot(c.x, c.z) + c.length / 2));
  return {
    nodes, clusters, core: [0, 0, 0], clouds, cloudOf, R, halfW, halfH,
    aurora: { curtains, place, ground: ground - mid, front: [0, 0.42, 1], labelAt: curtains.map((c) => { if (!c) return [0, 0, 0] as Vec3; const p = hemAt(c, 0.1); return [p[0], c.y + c.height * 0.78, p[2]] as Vec3; }) },
  };
}
