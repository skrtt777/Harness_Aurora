// The shape every drawing of the memory shares (atlas.ts makes it): each memory a point, each section a "cloud"
// (its centre, its radius and its memories), and the sections' colours. Pure (no DOM).
import type { Layout } from "./layout";

export type Cloud = { id: string; index: number; x: number; y: number; z: number; r: number; ids: string[] };
export type CloudLayout = Layout & {
  clouds: Cloud[];
  cloudOf: Map<string, number>;
  /** The space's size: every cloud fits within R of the origin. */
  R: number;
  /** Half the space's width and height seen from the front. */
  halfW: number; halfH: number;
};

/** The sections' colours: an aurora's (its green first, the biggest section; then cyan, ice, blue, violet, rose…). */
export const CLOUD_COLORS = ["#6cffb8", "#4ce6ff", "#b48cff", "#9ff0ff", "#ff7db8", "#5aa8ff", "#a6ff8c", "#e07dff", "#3fd6c6", "#8f8cff", "#c8f0ff", "#ffa3d9"];
export const cloudColor = (index: number) => CLOUD_COLORS[((index % CLOUD_COLORS.length) + CLOUD_COLORS.length) % CLOUD_COLORS.length];

/**
 * How far the camera is from the map to see all of it in a view of this aspect. The map is flat, but camera
 * commands keep this measure (a 45° view: what is seen is 2·distance·tan(22.5°) tall).
 */
export function fitDistance(layout: Pick<CloudLayout, "halfW" | "halfH">, aspect: number): number {
  const t = Math.tan((45 * Math.PI) / 360);
  return Math.max(layout.halfH / t, layout.halfW / (t * Math.max(0.3, aspect))) * 1.05;
}
/** What a camera distance shows: the visible height in world units. */
export const viewHeight = (distance: number) => 2 * distance * Math.tan((45 * Math.PI) / 360);
