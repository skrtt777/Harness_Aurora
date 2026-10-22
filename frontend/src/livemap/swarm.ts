import type { CloudLayout } from "./clouds";

/**
 * Memórias / Mapa Vivo — the swarm: the clouds drawn as up to a million particles simulated on the graphics card
 * (SwarmField.tsx). This file is the plan, pure and testable: which "home" every particle belongs to.
 *   - a home is a memory (a bright knot of particles around it) or a whole section (its haze, filling the cloud);
 *   - every memory gets its share, never zero; the sections share the rest by their volume;
 *   - the plan is written into a texture (one texel per particle): which home, a seed, how far from home it lives.
 * Homes are numbered memories first (in `ids` order), then the sections (in layout order).
 */
export type SwarmQuality = "alta" | "media" | "baixa";
/** Side of the particle textures: 1024² ≈ 1 M particles, 512² ≈ 262 k, 256² ≈ 65 k. */
export const swarmSide = (q: SwarmQuality) => (q === "alta" ? 1024 : q === "media" ? 512 : 256);
/** The share of particles that make the sections' haze (the rest knot around the memories). */
export const HAZE_SHARE = 0.42;
/** How far a memory's particles live from it (world units, before the per-particle factor). */
export const MEMORY_REACH = 30;

export type SwarmPlan = {
  side: number;
  count: number;
  /** Side of the homes texture (memories + sections). */
  homeSide: number;
  homes: number;
  memories: number;
  /** Per particle: home u, home v, seed 0..1, distance factor 0..1 (a texture's RGBA). */
  ref: Float32Array;
  /** Particles per home (for tests and the legend). */
  perHome: Uint32Array;
};

const fract = (x: number) => x - Math.floor(x);
/** A cheap deterministic random in 0..1 for particle i and channel k. */
const rnd = (i: number, k: number) => fract(Math.sin(i * 12.9898 + k * 78.233 + 0.5) * 43758.5453);

export function homeUV(index: number, homeSide: number): [number, number] {
  return [((index % homeSide) + 0.5) / homeSide, (Math.floor(index / homeSide) + 0.5) / homeSide];
}

export function planSwarm(layout: Pick<CloudLayout, "clouds" | "nodes">, ids: string[], side: number): SwarmPlan {
  const count = side * side;
  const memories = ids.length, sections = layout.clouds.length;
  const homes = memories + sections;
  const homeSide = Math.max(1, Math.ceil(Math.sqrt(homes)));
  const ref = new Float32Array(count * 4);
  const perHome = new Uint32Array(homes);
  // The haze: each section by its volume; the knots: the same for every memory.
  const haze = sections ? Math.round(count * (memories ? HAZE_SHARE : 1)) : 0;
  const knots = count - haze;
  const vol = layout.clouds.map((c) => c.r ** 3);
  const volSum = vol.reduce((s, v) => s + v, 0) || 1;
  // Cumulative section boundaries over the haze particles.
  const bounds: number[] = [];
  let acc = 0;
  for (const v of vol) { acc += v / volSum; bounds.push(Math.round(acc * haze)); }
  let section = 0;
  for (let i = 0; i < count; i += 1) {
    let home: number, dist: number;
    if (i < knots && memories) {
      home = i % memories;
      // Most of a knot sits close to its memory; a few wander farther out.
      dist = Math.pow(rnd(i, 1), 1.6);
    } else {
      const h = i - knots;
      while (section < bounds.length - 1 && h >= bounds[section]) section += 1;
      home = memories + section;
      // Fill the sphere evenly (cube root of a uniform random).
      dist = Math.cbrt(rnd(i, 1));
    }
    const [u, v] = homeUV(home, homeSide);
    ref[i * 4] = u; ref[i * 4 + 1] = v; ref[i * 4 + 2] = rnd(i, 2); ref[i * 4 + 3] = dist;
    perHome[home] += 1;
  }
  return { side, count, homeSide, homes, memories, ref, perHome };
}
