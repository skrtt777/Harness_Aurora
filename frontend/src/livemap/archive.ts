// The Aurora's memory as a living archive (the Mapa Vivo's 3D mode): a small city of bookshelf towers on a
// plaza. Each section (a node of the Zeladora) is a tower, standing where its cloud stands on the 2D field
// (clouds.ts), so neighbouring subjects are neighbouring towers; each memory is a book on its shelves, books that
// mean nearly the same thing side by side (in the order of their direction around the cloud's centre), floor
// after floor around the four faces. The more a section holds, the taller (and a little wider) its tower.
// Deterministic and pure (no DOM, no three.js), so it is tested in node.
import type { CloudLayout } from "./clouds";

/** A book's size (thickness along the shelf, height, depth into the tower), in world units. */
export const BOOK = { w: 0.34, h: 1.15, d: 0.8 };
const SLOT = BOOK.w + 0.07;
export const FLOOR_H = 1.55;
/** World units per unit of the 2D field. */
const SCALE = 0.028;
const GAP = 4.5;

export type Tower = {
  id: string; index: number;
  x: number; z: number;
  /** Half the tower's width (books stand in its outer ring). */
  half: number;
  floors: number; cols: number;
  height: number;
  ids: string[];
};
/** Where a book stands: its tower, its centre, and which way its spine faces (rotation about the vertical). */
export type BookSlot = { id: string; tower: number; x: number; y: number; z: number; rot: number; face: number; floor: number };
export type ArchiveLayout = { towers: Tower[]; books: Map<string, BookSlot>; extent: number };

/** Books per face of a floor for a section of `n` memories: towers taller than wide. */
export const colsFor = (n: number) => Math.max(2, Math.min(8, Math.ceil(Math.sqrt(n / 11))));

export function layoutArchive(clouds: Pick<CloudLayout, "clouds" | "nodes">): ArchiveLayout {
  const towers: Tower[] = clouds.clouds.map((c) => {
    const cols = colsFor(c.ids.length);
    const floors = Math.max(1, Math.ceil(c.ids.length / (cols * 4)));
    const half = (cols * SLOT) / 2 + BOOK.d * 0.55;
    // Books that mean nearly the same thing side by side: in the order of their direction around the centre.
    const ids = [...c.ids].sort((a, b) => {
      const pa = clouds.nodes.get(a), pb = clouds.nodes.get(b);
      const aa = pa ? Math.atan2(pa[1] - c.y, pa[0] - c.x) : 0, ab = pb ? Math.atan2(pb[1] - c.y, pb[0] - c.x) : 0;
      return aa - ab || (a < b ? -1 : 1);
    });
    return { id: c.id, index: c.index, x: c.x * SCALE, z: -c.y * SCALE, half, floors, cols, height: floors * FLOOR_H + 0.5, ids };
  });
  // Towers keep a street between them (pushed apart, the bigger one moves less).
  for (let it = 0; it < 200; it += 1) {
    let moved = 0;
    for (let i = 0; i < towers.length; i += 1) for (let j = i + 1; j < towers.length; j += 1) {
      const a = towers[i], b = towers[j];
      let dx = b.x - a.x, dz = b.z - a.z; let d = Math.hypot(dx, dz);
      if (d < 1e-6) { dx = Math.cos(i + j); dz = Math.sin(i + j); d = 1; }
      const need = (a.half + b.half) * Math.SQRT2 + GAP;
      if (d >= need) continue;
      const push = (need - d) / d, wa = b.half / (a.half + b.half), wb = a.half / (a.half + b.half);
      a.x -= dx * push * wa; a.z -= dz * push * wa; b.x += dx * push * wb; b.z += dz * push * wb;
      moved += need - d;
    }
    if (moved < 0.001 && it > 10) break;
  }
  // Centred on the plaza.
  const n = Math.max(1, towers.length);
  const mx = towers.reduce((s, t) => s + t.x, 0) / n, mz = towers.reduce((s, t) => s + t.z, 0) / n;
  for (const t of towers) { t.x -= mx; t.z -= mz; }

  const books = new Map<string, BookSlot>();
  towers.forEach((t, ti) => {
    const perFloor = t.cols * 4;
    t.ids.forEach((id, k) => {
      const floor = Math.floor(k / perFloor), j = k % perFloor;
      const face = Math.floor(j / t.cols), slot = j % t.cols;
      const along = (slot - (t.cols - 1) / 2) * SLOT;
      const out = t.half - BOOK.d / 2 - 0.02;
      const y = 0.3 + floor * FLOOR_H + 0.06 + BOOK.h / 2;
      // Faces: 0 front (+z), 1 right (+x), 2 back (−z), 3 left (−x); the spine faces outward.
      const [x, z, rot] = face === 0 ? [t.x + along, t.z + out, 0] : face === 1 ? [t.x + out, t.z - along, Math.PI / 2] : face === 2 ? [t.x - along, t.z - out, Math.PI] : [t.x - out, t.z + along, -Math.PI / 2];
      books.set(id, { id, tower: ti, x, y, z, rot, face, floor });
    });
  });
  const extent = Math.max(12, ...towers.map((t) => Math.hypot(t.x, t.z) + t.half * 1.5));
  return { towers, books, extent };
}

/** Where to stand to read a book: in front of its face, a little out on the street. */
export function standingSpot(t: Tower, b: BookSlot, out = 1.6): [number, number] {
  const r = t.half + out;
  return b.face === 0 ? [b.x, t.z + r] : b.face === 1 ? [t.x + r, b.z] : b.face === 2 ? [b.x, t.z - r] : [t.x - r, b.z];
}
