// The office in pixel art: everything is drawn pixel by pixel on a small canvas (16 px tiles, the room
// 480 x 288) and shown enlarged without smoothing. Our own art (no third-party sprites): a top-down
// 3/4 view with a dark back wall (shelves, windows, a clock with the real time), plank floors, carpets
// by area, partition walls round the meeting room, and chibi people with a dark outline that walk in
// four directions, sit with their backs to us at the computers, type, raise a hand, hold a coffee.
import { COLS, ROWS, PLAN, type Furniture, type Walker, type OfficeActor } from "./officeSim";

export const T = 16;                         // pixels per tile
/** The room in pixels (it grows with the team: officeSim usePlan). */
export const size = () => ({ W: COLS * T, H: ROWS * T });
type Ctx = CanvasRenderingContext2D;
const px = (c: Ctx, x: number, y: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), w, h); };
const OUT = "#17141f";

// ---------------- Palette ----------------
const P = {
  wallCap: "#141a28", wallFace: "#2b3550", wallFace2: "#24304a", wallBase: "#1c2438", trim: "#3a4768",
  plank: "#9a6a43", plank2: "#8d6040", plankLine: "#6f4a30", plankHi: "#ac7a50",
  carpetBlue: "#3f6aa0", carpetBlue2: "#4673ab", carpetPurple: "#6b4f7a", carpetPurple2: "#735683", carpetGreen: "#4d7a5a", carpetGreen2: "#55835f",
  checkA: "#ece6da", checkB: "#c7beaf",
  wood: "#c08a5a", woodHi: "#d8a274", woodDark: "#8a5a36", woodDeep: "#5e3b22",
  bossWood: "#6a3d2a", bossWoodHi: "#84503a", bossWoodDark: "#432417",
  beige: "#d9d2bf", beigeDark: "#a69c84", screen: "#1f2a26", screenOn: "#57d89a", screenOn2: "#2f9e6e", screenBlue: "#5bc0ff",
  metal: "#9aa3b3", metalDark: "#5f6778", red: "#c8463c", sofa: "#a3354f", sofaHi: "#bf4a66", sofaDark: "#7a2539",
  leaf: "#3f9a4c", leafHi: "#63c06c", leafDark: "#2a6b34", pot: "#b5603a", potDark: "#8a4428",
  glass: "#a8d8f0", glassHi: "#e3f4ff", paper: "#f3efe4", stool: "#5aa36a", stoolDark: "#3f7a4c",
};

// ---------------- Floors and walls ----------------
const zoneOf = (x: number, y: number) =>
  x >= 1 && x <= 8 && y >= 1 && y <= 6 ? "meet" : x >= 11 && x <= 17 && y >= 1 && y <= 4 ? "boss" : x >= 21 && x <= 28 && y >= 1 && y <= 6 ? "cafe" : x >= 21 && x <= 28 && y >= PLAN.lounge.y0 && y <= PLAN.lounge.y1 ? "lounge" : "wood";

function floorTile(c: Ctx, tx: number, ty: number) {
  const x = tx * T, y = ty * T; const z = zoneOf(tx, ty);
  if (z === "wood") {
    // Planks 4 px tall, seams staggered.
    for (let r = 0; r < 4; r++) {
      px(c, x, y + r * 4, T, 4, (tx + r + ty) % 3 === 0 ? P.plank2 : P.plank);
      px(c, x, y + r * 4, T, 1, P.plankHi);
      const seam = ((ty * 4 + r) * 7 + tx * 16) % 16; px(c, x + seam, y + r * 4, 1, 4, P.plankLine);
      px(c, x, y + r * 4 + 3, T, 1, P.plankLine);
    }
  } else if (z === "cafe") {
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) px(c, x + i * 8, y + j * 8, 8, 8, (i + j + tx + ty) % 2 ? P.checkB : P.checkA);
  } else {
    const [a, b] = z === "meet" ? [P.carpetBlue, P.carpetBlue2] : z === "boss" ? [P.carpetPurple, P.carpetPurple2] : [P.carpetGreen, P.carpetGreen2];
    px(c, x, y, T, T, a);
    for (let i = 0; i < 16; i += 4) for (let j = (i / 4) % 2 ? 2 : 0; j < 16; j += 4) px(c, x + j, y + i, 1, 1, b);
  }
}

/** The fixed part of the room (floors, walls, wall decoration), drawn once into a buffer. */
export function drawRoom(c: Ctx) {
  const { W, H } = size();
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) floorTile(c, tx, ty);
  // Back wall: cap, face with panels, baseboard.
  px(c, 0, 0, W, 3, P.wallCap); px(c, 0, 3, W, T - 3, P.wallFace);
  for (let x = 0; x < W; x += 32) px(c, x, 3, 1, T - 5, P.wallFace2);
  px(c, 0, T - 2, W, 2, P.wallBase);
  // Pictures.
  for (const [wx, col] of [[10.2, "#d9a23f"], [20.9, "#4b8fd1"]] as const) { const x = Math.round(wx * T); px(c, x - 1, 4, 12, 9, OUT); px(c, x, 5, 10, 7, "#8a6a40"); px(c, x + 1, 6, 8, 5, col); px(c, x + 2, 9, 3, 2, "#f2e6c8"); }
  // Side and front walls (seen from above: their dark top).
  px(c, 0, 0, 4, H, P.wallCap); px(c, W - 4, 0, 4, H, P.wallCap); px(c, 4, T, 1, H - T, P.wallFace2); px(c, W - 5, T, 1, H - T, P.wallFace2);
  px(c, 0, H - 5, W, 5, P.wallCap);
  // The door (bottom left): an opening with a mat.
  px(c, 2 * T + 4, H - 5, T * 2 - 8, 5, P.plankLine); px(c, 2 * T + 6, H - 10, T * 2 - 12, 5, "#7a3b2e"); px(c, 2 * T + 7, H - 9, T * 2 - 14, 3, "#9b4d3b");
  // Partition walls round the meeting room (where the plan has glass).
  for (const f of PLAN.furniture) if (f.kind === "glass") {
    const x = f.x * T, y = f.y * T;
    if (f.x === 9) { px(c, x + 4, y, 8, T, P.wallCap); px(c, x + 4, y, 1, T, P.trim); }
    else { px(c, x, y + 2, T, 4, P.wallCap); px(c, x, y + 6, T, 9, P.wallFace); px(c, x, y + 13, T, 2, P.wallBase); }
  }
  // Door frame of the meeting room.
  px(c, 5 * T - 1, 7 * T + 2, 2, 13, P.wallCap); px(c, 6 * T - 1, 7 * T + 2, 2, 13, P.wallCap);
}

// ---------------- Furniture ----------------
function box(c: Ctx, x: number, y: number, w: number, h: number, top: string, hi: string, front: string, frontH: number) {
  px(c, x - 1, y - 1, w + 2, h + 2, OUT);
  px(c, x, y, w, h - frontH, top); px(c, x, y, w, 1, hi); px(c, x, y + h - frontH, w, frontH, front);
}
function monitor(c: Ctx, x: number, y: number, on: boolean, t: number, seed: number) {
  // A small beige computer with its screen (green text scrolling while someone works).
  px(c, x - 1, y - 1, 16, 13, OUT); px(c, x, y, 14, 11, P.beige); px(c, x, y + 9, 14, 2, P.beigeDark);
  px(c, x + 2, y + 2, 10, 6, on ? P.screen : "#151a1c");
  if (on) for (let i = 0; i < 3; i++) { const len = 2 + Math.floor((Math.sin(t * 4 + i * 1.9 + seed) + 1) * 3.5); px(c, x + 3, y + 3 + i * 2, len, 1, i === 1 ? P.screenOn2 : P.screenOn); }
  else px(c, x + 3, y + 3, 2, 1, "#2a3337");
  px(c, x + 5, y + 11, 4, 2, P.beigeDark);
}
function chair(c: Ctx, x: number, y: number) { px(c, x + 3, y + 7, 10, 5, OUT); px(c, x + 4, y + 8, 8, 3, P.stool); px(c, x + 4, y + 8, 8, 1, "#7cc48a"); px(c, x + 5, y + 11, 1, 3, OUT); px(c, x + 10, y + 11, 1, 3, OUT); }
function plant(c: Ctx, x: number, y: number) {
  px(c, x + 4, y + 9, 8, 7, OUT); px(c, x + 5, y + 10, 6, 5, P.pot); px(c, x + 5, y + 10, 6, 1, "#d27a4e"); px(c, x + 5, y + 14, 6, 1, P.potDark);
  for (const [dx, dy, w, h, col] of [[7, -6, 2, 16, P.leafDark], [3, -2, 3, 11, P.leaf], [10, -3, 3, 12, P.leaf], [5, -8, 2, 10, P.leafHi], [9, -9, 2, 10, P.leafHi], [1, 2, 3, 6, P.leafDark], [12, 1, 3, 7, P.leafDark]] as const) px(c, x + dx, y + dy, w, h, col);
}
export function drawFurniture(c: Ctx, f: Furniture, working: Set<number>, t: number) {
  const x = f.x * T, y = f.y * T, w = f.w * T;
  switch (f.kind) {
    case "desk": {
      box(c, x + 1, y + 3, w - 2, 12, P.wood, P.woodHi, P.woodDark, 4);
      px(c, x + 2, y + 15, 2, 2, OUT); px(c, x + w - 4, y + 15, 2, 2, OUT);
      monitor(c, x + 9, y - 6, working.has(f.desk!), t, f.desk!);
      px(c, x + 6, y + 8, 12, 2, P.metal); px(c, x + 6, y + 8, 12, 1, "#c5ccd8"); px(c, x + 21, y + 8, 2, 2, P.metal);
      px(c, x + 25, y + 5, 3, 3, P.paper); px(c, x + 25, y + 5, 3, 1, "#6b3e1f");
      break;
    }
    case "table": {
      box(c, x + 2, y + 2, w - 4, 2 * T - 4, P.wood, P.woodHi, P.woodDark, 5);
      px(c, x + 10, y + 8, 8, 6, P.paper); px(c, x + 11, y + 9, 5, 1, "#9aa3b3"); px(c, x + 11, y + 11, 4, 1, "#9aa3b3");
      px(c, x + 36, y + 10, 12, 7, P.metalDark); px(c, x + 37, y + 11, 10, 4, P.screenBlue);
      px(c, x + 26, y + 18, 3, 3, P.paper);
      break;
    }
    case "bossdesk": {
      box(c, x, y + 2, w, 14, P.bossWood, P.bossWoodHi, P.bossWoodDark, 5);
      monitor(c, x + 17, y - 8, true, t, 99);
      px(c, x + 4, y + 6, 8, 3, "#d4af37"); px(c, x + 5, y + 7, 6, 1, OUT);
      px(c, x + 36, y + 5, 5, 4, P.paper); px(c, x + 37, y + 6, 3, 1, P.red);
      break;
    }
    case "counter": {
      box(c, x, y - 2, w, 16, "#b9a78f", "#d2c2aa", "#8b7760", 9);
      for (let i = 0; i < f.w; i++) { px(c, x + i * T + 2, y + 7, 12, 6, "#7a6650"); px(c, x + i * T + 7, y + 9, 2, 1, "#c9b68f"); }
      for (let i = 0; i < 4; i++) { px(c, x + 6 + i * 16, y + 1, 4, 4, OUT); px(c, x + 7 + i * 16, y + 2, 2, 2, P.paper); }
      break;
    }
    case "machine": {
      px(c, x + 1, y - 8, 14, 23, OUT); px(c, x + 2, y - 7, 12, 21, "#3b404c"); px(c, x + 2, y - 7, 12, 2, "#555c6b");
      px(c, x + 4, y - 3, 8, 5, "#1a1d24"); px(c, x + 5, y - 2, 2, 1, P.red); px(c, x + 9, y - 2, 2, 1, P.screenOn);
      px(c, x + 5, y + 5, 6, 6, "#20232b"); px(c, x + 6, y + 8, 4, 3, P.paper);
      // Steam.
      for (let i = 0; i < 3; i++) { const p = (t * 0.7 + i / 3) % 1; px(c, x + 7 + Math.round(Math.sin(t * 3 + i) * 1.5), y + 4 - Math.round(p * 10), 1, 1, `rgba(255,255,255,${(1 - p).toFixed(2)})`); }
      break;
    }
    case "roundtable": px(c, x + 1, y + 3, 14, 10, OUT); px(c, x + 2, y + 4, 12, 7, P.wood); px(c, x + 2, y + 4, 12, 1, P.woodHi); px(c, x + 2, y + 10, 12, 1, P.woodDark); px(c, x + 7, y + 13, 2, 3, OUT); px(c, x + 5, y + 5, 3, 3, P.paper); px(c, x + 5, y + 5, 3, 1, "#6b3e1f"); break;
    case "sofa": {
      px(c, x - 1, y - 1, w + 2, 17, OUT);
      px(c, x, y, w, 7, P.sofaDark); px(c, x, y, w, 2, P.sofa);
      px(c, x, y + 7, w, 6, P.sofa); px(c, x, y + 7, w, 1, P.sofaHi);
      for (let i = 1; i < f.w; i++) px(c, x + i * T, y + 7, 1, 6, P.sofaDark);
      px(c, x, y + 2, 4, 13, P.sofaHi); px(c, x + w - 4, y + 2, 4, 13, P.sofaHi); px(c, x, y + 13, w, 2, P.sofaDark);
      break;
    }
    case "plant": plant(c, x, y); break;
    case "shelf": {
      px(c, x - 1, y - 13, w + 2, 30, OUT); px(c, x, y - 12, w, 28, P.woodDeep);
      const books = ["#c8463c", "#3f7fd1", "#e2b33c", "#4fa35e", "#9b59b6", "#e07b39"];
      for (let s = 0; s < 3; s++) {
        px(c, x + 1, y - 11 + s * 9, w - 2, 8, "#3a2416");
        for (let b = 0; b < 9; b++) { const hgt = 5 + ((b * 7 + s * 3) % 3); px(c, x + 2 + b * 3, y - 11 + s * 9 + (8 - hgt), 2, hgt, books[(b + s * 2) % books.length]); }
        px(c, x, y - 3 + s * 9, w, 1, P.woodDark);
      }
      break;
    }
    case "whiteboard": {
      px(c, x - 1, y - 14, w + 2, 15, OUT); px(c, x, y - 13, w, 13, "#f4f6f8"); px(c, x, y - 1, w, 1, P.metal);
      const pts = [[4, 8], [12, 4], [20, 7], [28, 2], [38, 5]];
      for (let i = 0; i < pts.length - 1; i++) { const [a, b] = [pts[i], pts[i + 1]]; for (let s = 0; s <= 8; s++) px(c, x + a[0] + ((b[0] - a[0]) * s) / 8, y - 13 + a[1] + ((b[1] - a[1]) * s) / 8 + 2, 1, 1, "#3f7fd1"); }
      px(c, x + 30, y - 6, 12, 1, P.red); px(c, x + 30, y - 4, 8, 1, "#4fa35e");
      break;
    }
    case "server": {
      px(c, x + 1, y - 10, 14, 26, OUT); px(c, x + 2, y - 9, 12, 24, "#2b303b"); px(c, x + 2, y - 9, 12, 1, "#454c5c");
      for (let r = 0; r < 5; r++) {
        px(c, x + 3, y - 7 + r * 4, 10, 3, "#1b1f27");
        for (let l = 0; l < 3; l++) { const on = Math.sin(t * (3 + l + r) + r * 2.1 + l) > 0.1; px(c, x + 4 + l * 2, y - 6 + r * 4, 1, 1, on ? (l === 2 ? "#e9b23c" : "#57d89a") : "#30363f"); }
        px(c, x + 10, y - 6 + r * 4, 2, 1, "#5f6778");
      }
      break;
    }
    case "glass": break;            // drawn as walls with the room
  }
}
/** The sky through the windows at this hour: day, sunset, night with stars. */
function sky(now: Date) {
  const h = now.getHours() + now.getMinutes() / 60;
  if (h >= 7 && h < 17) return { glass: P.glass, hi: P.glassHi, night: false };
  if (h >= 17 && h < 19) return { glass: "#f2a65a", hi: "#ffd9a0", night: false };
  if (h >= 5.5 && h < 7) return { glass: "#e9b3c8", hi: "#fbe3ec", night: false };
  return { glass: "#1b2448", hi: "#f6f1c7", night: true };
}
export function drawWindows(c: Ctx, now: Date) {
  const k = sky(now);
  for (const wx of [5.4, 8.6, 18.6, 19.8]) {
    const x = Math.round(wx * T); px(c, x - 1, 3, 14, 11, OUT); px(c, x, 4, 12, 9, k.glass);
    if (k.night) { px(c, x + 2, 5, 1, 1, k.hi); px(c, x + 9, 7, 1, 1, k.hi); px(c, x + 3, 10, 1, 1, "#9aa3c7"); }
    else { px(c, x + 1, 5, 2, 2, k.hi); px(c, x + 8, 9, 1, 2, k.hi); }
    px(c, x + 5, 4, 2, 9, P.trim); px(c, x, 8, 12, 1, P.trim);
  }
}
/** Evening and night: the room dims and the screens of who works glow. */
export function drawLight(c: Ctx, now: Date, glows: Array<{ x: number; y: number }>) {
  const { W, H } = size();
  const h = now.getHours() + now.getMinutes() / 60;
  const dark = h >= 20 || h < 5.5 ? 0.42 : h >= 18.5 ? 0.22 : h < 7 ? 0.18 : 0;
  if (!dark) return;
  c.fillStyle = `rgba(14,18,46,${dark})`; c.fillRect(0, 0, W, H);
  c.save(); c.globalCompositeOperation = "lighter";
  // A soft halo round each lit screen (three rings, fainter outwards), on the desk and the face before it.
  for (const g of glows) {
    const cx = g.x + 7, cy = g.y + 5;
    for (const [rx, ry, al] of [[11, 9, 0.07], [8, 6, 0.09], [5, 4, 0.12]] as const) { c.fillStyle = `rgba(90,210,150,${al})`; c.fillRect(cx - rx, cy - ry + 2, rx * 2, ry * 2); c.fillRect(cx - rx + 2, cy - ry, rx * 2 - 4, ry * 2 + 4); }
  }
  c.restore();
}
/** The wall clock, with the real time. */
export function drawClock(c: Ctx, now: Date) {
  const cx = 14.5 * T, cy = 8; px(c, cx - 6, cy - 6, 13, 13, OUT); px(c, cx - 5, cy - 5, 11, 11, "#f4f1e8"); px(c, cx - 5, cy - 5, 11, 1, P.red);
  const hand = (len: number, a: number, col: string) => { for (let i = 0; i <= len; i++) px(c, cx + Math.round(Math.sin(a) * i), cy - Math.round(Math.cos(a) * i), 1, 1, col); };
  hand(3, ((now.getHours() % 12) + now.getMinutes() / 60) * Math.PI / 6, OUT); hand(4, now.getMinutes() * Math.PI / 30, "#555");
}
/** An empty chair where nobody sits (desks and the meeting table). */
export function drawEmptySeat(c: Ctx, x: number, y: number) { chair(c, x * T, y * T - 6); }

// ---------------- People ----------------
export type Look = { skin: string; skinDark: string; hair: string; hairHi: string; style: number; shirt: string; shirtDark: string; pants: string; shoes: string };
const SKINS = [["#f6d1b0", "#dca988"], ["#e5b48c", "#c4906a"], ["#c48a5f", "#9d6a45"], ["#8d5a3b", "#6b4229"], ["#f1c9a5", "#d1a27f"]];
const HAIRS = [["#3b2a1e", "#5a4130"], ["#6e4325", "#8f5c35"], ["#c98a3d", "#e2a95a"], ["#1d1b22", "#3a3644"], ["#d9d4cc", "#f2eee8"], ["#a13d2d", "#c9583f"], ["#e6c35c", "#f5dd86"]];
const ROLE: Record<OfficeActor["kind"], [string, string]> = { aurora: ["#8b55e8", "#6a3cc0"], agente: ["#25a691", "#1a7d6d"], copia: ["#7fd8cb", "#5bb3a6"], subagente: ["#c4a3ff", "#9b7ae0"], professor: ["#f0efe9", "#c9c6bd"], chefe: ["#2e3d6e", "#1f2a4f"] };
const hash = (s: string) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
export function lookOf(a: OfficeActor): Look {
  const h = hash(a.id); const [skin, skinDark] = SKINS[h % SKINS.length]; const [hair, hairHi] = HAIRS[(h >>> 4) % HAIRS.length];
  const [shirt, shirtDark] = ROLE[a.kind];
  return { skin, skinDark, hair, hairHi, style: (h >>> 9) % 4, shirt, shirtDark, pants: a.kind === "chefe" ? "#1f2a4f" : ["#34405e", "#3b3b44", "#5a4636"][(h >>> 12) % 3], shoes: "#2a1d16" };
}

type Rect = [number, number, number, number, string];
/**
 * A person, the feet at (fx, fy) on the small canvas: pose "stand" | "walk" | "sit" (back to us, at a
 * desk) | "sitFront" (facing us: sofa, far side of the table); facing for stand/walk.
 */
export function drawPerson(c: Ctx, fx: number, fy: number, a: OfficeActor, look: Look, pose: "stand" | "walk" | "sit" | "sitFront", facing: "up" | "down" | "left" | "right", frame: number, t: number, carry: "paper" | "cup" | null = null) {
  const L = look; const x0 = Math.round(fx) - 8, y0 = Math.round(fy) - 24;
  const seed = hash(a.id);
  const blink = Math.floor(t * 1000 + seed) % 3900 < 120;                 // a blink every few seconds
  const breathe = pose !== "walk" && Math.floor(t * 0.9 + (seed % 10) / 10) % 2 === 1 ? 1 : 0;
  const flip = facing === "left"; const side = facing === "left" || facing === "right";
  const back = pose === "sit" || (pose !== "sitFront" && facing === "up");
  const sitting = pose === "sit" || pose === "sitFront"; const dy = sitting ? 3 : 0;
  const step = pose === "walk" ? (frame % 4 === 1 ? 1 : frame % 4 === 3 ? -1 : 0) : 0;
  const parts: Rect[] = []; const details: Rect[] = [];
  const P_ = (x: number, y: number, w: number, h: number, col: string, list = parts) => list.push([x, y, w, h, col]);
  // Head (big, chibi) and hair.
  const hy = 1 + dy + breathe;
  if (side) {
    P_(3, hy, 11, 11, L.hair); P_(7, hy + 4, 7, 6, L.skin); P_(7, hy + 10, 6, 1, L.skinDark);
    P_(12, hy + 6 + (blink ? 1 : 0), 1, blink ? 1 : 2, OUT, details); P_(6, hy + 5, 2, 2, L.skin, details);              // eye; ear
    P_(4, hy + 1, 8, 1, L.hairHi, details);
  } else if (back) {
    P_(2, hy, 12, 11, L.hair); P_(6, hy + 10, 4, 1, L.skinDark);
    P_(4, hy + 1, 7, 1, L.hairHi, details); P_(3, hy + 3, 1, 4, L.hairHi, details);
  } else {
    P_(2, hy, 12, 11, L.hair); P_(3, hy + 4, 10, 6, L.skin); P_(4, hy + 10, 8, 1, L.skinDark);
    if (blink) { P_(5, hy + 7, 1, 1, OUT, details); P_(10, hy + 7, 1, 1, OUT, details); }
    else { P_(5, hy + 6, 1, 2, OUT, details); P_(10, hy + 6, 1, 2, OUT, details); }
    P_(4, hy + 8, 1, 1, "#e89a8a", details); P_(11, hy + 8, 1, 1, "#e89a8a", details);
    P_(3, hy + 4, 4, 1, L.hair, details); P_(4, hy + 1, 8, 1, L.hairHi, details);           // fringe, shine
    if (a.kind === "professor") { P_(4, hy + 5, 3, 1, OUT, details); P_(9, hy + 5, 3, 1, OUT, details); P_(7, hy + 5, 2, 1, OUT, details); }
  }
  if (L.style === 1) { P_(1, hy + 3, 1, 9, L.hair); P_(14, hy + 3, 1, 9, L.hair); }                    // long
  if (L.style === 2) P_(6, hy - 2, 4, 3, L.hair);                                                     // bun
  if (L.style === 3) { P_(3, hy - 1, 3, 2, L.hair); P_(7, hy - 2, 3, 3, L.hair); P_(11, hy - 1, 2, 2, L.hair); } // spiky
  // Body, arms, hands.
  const by = 12 + dy;
  P_(4, by, 8, 6, L.shirt); P_(4, by + 5, 8, 1, L.shirtDark);
  const raise = a.state === "aguardando" && !side;
  const typing = pose === "sit" && ["trabalhando", "refazendo", "conferindo", "pensando", "cobrado"].includes(a.state);
  const k = typing ? (Math.floor(t * 10 + (hash(a.id) % 3)) % 2) : 0;
  if (side) { P_(6 + step, by + 1, 3, 5, L.shirtDark); P_(6 + step, by + 5, 3, 1, L.skin); }
  else {
    P_(2, by + 1 - (typing ? k : 0), 2, 5, L.shirt); P_(2, by + 5 - (typing ? k : 0), 2, 1, L.skin);
    if (raise) { P_(12, by - 7, 2, 7, L.shirt); P_(12, by - 8, 2, 2, L.skin); }
    else { P_(12, by + 1 - (typing ? 1 - k : 0), 2, 5, L.shirt); P_(12, by + 5 - (typing ? 1 - k : 0), 2, 1, L.skin); }
  }
  // Role marks: the boss's collar and tie, the teacher's coat and badge, Aurora's star.
  if (!back && !side) {
    if (a.kind === "chefe") { P_(6, by, 4, 1, "#f2f2f2", details); P_(7, by + 1, 2, 4, P.red, details); }
    if (a.kind === "professor") { P_(7, by, 2, 5, a.teacher === "claude" ? "#d97757" : "#2b2f38", details); P_(4, by + 2, 2, 2, a.teacher === "claude" ? "#d97757" : "#5b6170", details); }
    if (a.kind === "aurora") P_(9, by + 2, 2, 2, "#e6d4ff", details);
    if (a.kind === "agente") P_(5, by + 2, 2, 1, "#e6fff9", details);
    if (a.kind === "subagente") { P_(5, by + 2, 2, 2, "#8b55e8", details); P_(9, by + 2, 2, 2, "#fff6c9", details); }
  }
  // Legs and shoes (sitting at a desk: on the stool; sitting facing us: knees forward).
  if (pose === "sit") { P_(3, by + 6, 10, 3, P.stool); P_(3, by + 6, 10, 1, "#7cc48a"); P_(4, by + 9, 1, 2, OUT); P_(11, by + 9, 1, 2, OUT); }
  else if (pose === "sitFront") { P_(4, by + 6, 8, 2, L.pants); P_(4, by + 8, 3, 1, L.shoes); P_(9, by + 8, 3, 1, L.shoes); }
  else if (side) { P_(6 - step, 18, 2, 4 - Math.abs(step), L.pants); P_(8 + step, 18, 2, 4, L.pants); P_(6 - step, 22 - Math.abs(step), 3, 1, L.shoes); P_(8 + step, 22, 3, 1, L.shoes); }
  else { P_(5, 18, 2, 3 - (step > 0 ? 1 : 0), L.pants); P_(9, 18, 2, 3 - (step < 0 ? 1 : 0), L.pants); P_(4, 21 - (step > 0 ? 1 : 0), 3, 2, L.shoes); P_(9, 21 - (step < 0 ? 1 : 0), 3, 2, L.shoes); }
  // In hand: a coffee, or the paper of a delivery.
  const holds = carry ?? (a.state === "cafe" ? "cup" : null);
  if (holds === "cup" && !back) { P_(side ? 9 + step : 13, by + 2, 3, 4, "#f2f2f2", details); P_(side ? 9 + step : 13, by + 2, 3, 1, "#6b3e1f", details); }
  if (holds === "paper") { P_(side ? 9 + step : 12, by + 1, 4, 5, P.paper, details); P_(side ? 10 + step : 13, by + 2, 2, 1, "#9aa3b3", details); P_(side ? 10 + step : 13, by + 4, 2, 1, "#9aa3b3", details); }

  c.save();
  if (a.kind === "copia") c.globalAlpha = 0.7;
  if (flip) { c.translate(x0 * 2 + 16, 0); c.scale(-1, 1); }
  // Shadow, the outline (each part one pixel larger, in dark), then the colours, then the details.
  if (!sitting) { c.fillStyle = "rgba(0,0,0,0.22)"; c.fillRect(x0 + 3, y0 + 22, 10, 2); c.fillRect(x0 + 4, y0 + 24, 8, 1); }
  for (const [x, y, w, h] of parts) px(c, x0 + x - 1, y0 + y - 1, w + 2, h + 2, OUT);
  for (const [x, y, w, h, col] of parts) px(c, x0 + x, y0 + y, w, h, col);
  for (const [x, y, w, h, col] of details) px(c, x0 + x, y0 + y, w, h, col);
  c.restore();
}

// ---------------- Bubbles ----------------
export type Sign = "dots" | "think" | "hand" | "talk" | "cup" | "zz" | "alert" | "check" | "clip" | "book" | "term" | "paper";
export function signOf(state: string, kind: OfficeActor["kind"]): Sign | null {
  if (kind === "chefe") return state === "cobrando" ? "clip" : state === "conferindo" ? "check" : state === "reuniao" ? "talk" : null;
  return ({ trabalhando: "dots", refazendo: "dots", conferindo: "check", pensando: "think", chegando: "think", aguardando: "hand", revisao: "talk", reuniao: "talk", cafe: "cup", descanso: "zz", cobrado: "alert" } as Record<string, Sign>)[state] || null;
}
/** A small speech bubble with a pixel sign, its tail at (x, y). */
export function drawBubble(c: Ctx, x: number, y: number, s: Sign, t: number) {
  const bx = Math.round(x) - 7, by = Math.round(y) - 12;
  px(c, bx, by, 15, 10, OUT); px(c, bx + 1, by + 1, 13, 8, "#ffffff"); px(c, bx + 6, by + 10, 3, 1, OUT); px(c, bx + 7, by + 9, 1, 2, "#ffffff"); px(c, bx + 7, by + 11, 1, 1, OUT);
  const ix = bx + 4, iy = by + 2; const ink = "#1d2230";
  switch (s) {
    case "dots": for (let i = 0; i < 3; i++) px(c, ix + i * 3, iy + 3, 2, 2, Math.floor(t * 4) % 3 === i ? ink : "#9aa0ad"); break;
    case "think": px(c, ix + 2, iy, 3, 1, ink); px(c, ix + 5, iy + 1, 1, 2, ink); px(c, ix + 3, iy + 3, 2, 1, ink); px(c, ix + 3, iy + 5, 2, 1, ink); break;
    case "hand": px(c, ix + 1, iy + 2, 5, 4, "#e5b48c"); for (let i = 0; i < 4; i++) px(c, ix + 1 + i * 1.4, iy, 1, 3, "#e5b48c"); px(c, ix + 1, iy + 5, 5, 1, "#c4906a"); break;
    case "talk": px(c, ix, iy + 1, 7, 1, ink); px(c, ix, iy + 3, 5, 1, ink); px(c, ix, iy + 5, 6, 1, ink); break;
    case "cup": px(c, ix + 1, iy + 1, 4, 5, "#6b3e1f"); px(c, ix + 5, iy + 2, 1, 2, "#6b3e1f"); px(c, ix + 2, iy + 1, 2, 1, "#c98a5a"); break;
    case "zz": px(c, ix, iy + 2, 3, 1, ink); px(c, ix + 1, iy + 3, 1, 1, ink); px(c, ix, iy + 4, 3, 1, ink); px(c, ix + 4, iy, 2, 1, ink); px(c, ix + 4, iy + 1, 1, 1, ink); px(c, ix + 4, iy + 2, 2, 1, ink); break;
    case "alert": px(c, ix + 3, iy, 2, 4, "#d6334f"); px(c, ix + 3, iy + 5, 2, 1, "#d6334f"); break;
    case "check": px(c, ix, iy + 3, 1, 1, "#2f9e6e"); px(c, ix + 1, iy + 4, 1, 1, "#2f9e6e"); px(c, ix + 2, iy + 5, 1, 1, "#2f9e6e"); px(c, ix + 3, iy + 4, 1, 1, "#2f9e6e"); px(c, ix + 4, iy + 3, 1, 1, "#2f9e6e"); px(c, ix + 5, iy + 2, 1, 1, "#2f9e6e"); px(c, ix + 6, iy + 1, 1, 1, "#2f9e6e"); break;
    case "book": px(c, ix, iy + 1, 7, 5, "#3f7fd1"); px(c, ix + 3, iy + 1, 1, 5, "#1d3f73"); px(c, ix + 1, iy + 2, 1, 1, "#ffffff"); px(c, ix + 5, iy + 2, 1, 1, "#ffffff"); break;
    case "term": px(c, ix, iy, 7, 6, "#1b1f27"); px(c, ix + 1, iy + 1, 1, 1, "#57d89a"); px(c, ix + 2, iy + 2, 1, 1, "#57d89a"); px(c, ix + 1, iy + 3, 1, 1, "#57d89a"); if (Math.floor(t * 2) % 2) px(c, ix + 3, iy + 4, 3, 1, "#57d89a"); break;
    case "paper": px(c, ix + 1, iy, 5, 6, P.paper); px(c, ix + 2, iy + 1, 3, 1, "#9aa3b3"); px(c, ix + 2, iy + 3, 3, 1, "#9aa3b3"); break;
    case "clip": px(c, ix + 1, iy, 5, 6, "#c08a5a"); px(c, ix + 2, iy + 1, 3, 4, "#ffffff"); px(c, ix + 3, iy - 1, 1, 1, OUT); px(c, ix + 2, iy + 2, 3, 1, "#9aa0ad"); break;
  }
}

/** Which desks have someone working at them (their screens are on). */
export function workingDesks(walkers: Walker[]): Set<number> {
  const s = new Set<number>();
  for (const w of walkers) if (w.seat && w.spot?.kind === "desk" && w.spot.desk != null && ["trabalhando", "pensando", "refazendo", "conferindo", "aguardando", "cobrado", "chegando"].includes(w.actor.state)) s.add(w.spot.desk);
  return s;
}
