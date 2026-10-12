// The room each operation happens in: the scene's fixtures by the kind of place in the data (app/powerbiStory.js
// reads it from the place column). A checkout is drawn in a shop with shelves, a consulting room in a clinic
// corridor with a waiting room, a counter in a hall with a ticket panel, a machine on a factory floor — the
// entities (one drawn object each, where they are) are the same; the world around them is the area's own.
// The warehouse with dock doors stays in app/powerbiScene.js (yardScene), for docks and vehicles.

import { person } from "./powerbiModels.js";

const COS = Math.cos(Math.PI / 6);
const r1 = (v) => String(Math.round(v * 10) / 10);
const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const FONT = "font-family='Segoe UI, sans-serif'";

// Interior colours by night and by day.
export const ROOMS = {
  noite: { floor: "#17263D", tile: "#1C2E48", wall: ["#2B3A55", "#22324D", "#1A263B"], wallText: "#DCE6F5", fixture: ["#3A4D6E", "#2C3E5A", "#22324D"], white: ["#E8EDF5", "#C5CEDD", "#A3AFC3"], metal: ["#6F7F99", "#56657D", "#434F63"], belt: "#0B1322", glass: "#5BA4E6", seat: ["#4A5D80", "#3A4C6B", "#2E3D57"], safety: "#E8B93D", cross: "#E53935", product: ["#E57373", "#FFB74D", "#81C784", "#64B5F6", "#BA68C8"], text: "#C9D3E3", staff: ["#8EA0BC", "#6F8099", "#56657D"] },
  dia: { floor: "#EEF2F8", tile: "#E1E8F2", wall: ["#F4F7FC", "#E2E9F4", "#C9D5E8"], wallText: "#2F6FDB", fixture: ["#FFFFFF", "#E3EAF5", "#C5D1E3"], white: ["#FFFFFF", "#E9EEF6", "#D3DCEA"], metal: ["#B8C3D4", "#9AA7BB", "#7E8CA3"], belt: "#3B4A63", glass: "#9CC7F0", seat: ["#7FA3D9", "#5F86C2", "#4A6DA8"], safety: "#D9A400", cross: "#E53935", product: ["#E57373", "#FFB74D", "#81C784", "#64B5F6", "#BA68C8"], text: "#3B4A63", staff: ["#B7C2D4", "#9AA7BB", "#7E8CA3"] },
};

/**
 * The fixtures of one environment. ctx: { cv, look, LEN, DEPTH, n, w, hasRoad, D, safe, siteName (DAX or null),
 * title }. Returns { floor, backdrop, place(cx, k, free), served(cx, i), line(cx, i), spot(j), queueGround,
 * QUEUE, outdoors, label(cx) [X, Y, Z of the place name], tag(cx) [X, Y, Z of the name tag] }.
 */
export function roomKit(env, ctx) {
  const { cv, LEN, DEPTH, n, w, D, safe, siteName, title } = ctx;
  const R = ROOMS[ctx.look] || ROOMS.noite;
  const floor = [];
  const backdrop = [];
  // The room: a floor, a back wall and a side wall (a cut-away, so everything inside is seen).
  // The room ends before the road (when the data has a way out).
  const right = (ctx.hasRoad ? 690 : 910) + (LEN - 640);
  floor.push(cv.poly([[-110, -50, 0], [right, -50, 0], [right, 810, 0], [-110, 810, 0]], R.floor));
  for (let g = -30; g <= right - 10; g += 80) floor.push(`<polyline points='${cv.pts([[g, -50, 0], [g, 810, 0]])}' stroke='${R.tile}' stroke-width='1.5' fill='none'/>`);
  for (let g = 30; g <= 800; g += 80) floor.push(`<polyline points='${cv.pts([[-110, g, 0], [right, g, 0]])}' stroke='${R.tile}' stroke-width='1.5' fill='none'/>`);
  backdrop.push(cv.box(-110, -64, 0, right + 110, 14, 120, R.wall));
  backdrop.push(cv.box(-124, -64, 0, 14, 874, 120, R.wall));
  // The unit's name painted on the back wall.
  const [sx, sy] = cv.at(-60, -50, 70);
  const sign = [`<text transform='matrix(${r1(COS)},0.5,0,1,${sx},${sy})' fill='${R.wallText}' ${FONT} font-size='38' font-weight='800' letter-spacing='3'>`, siteName ? D(safe(`UPPER(LEFT(${siteName}, 22))`)) : xml(String(title).toUpperCase().slice(0, 22)), "</text>"];
  const wallText = (X, Z, text, size = 22, fill = R.wallText) => { const [x, y] = cv.at(X, -50, Z); return `<text transform='matrix(${r1(COS)},0.5,0,1,${x},${y})' fill='${fill}' ${FONT} font-size='${size}' font-weight='700'>${xml(text)}</text>`; };
  const chair = (X, Y) => [cv.box(X - 13, Y - 6, 0, 26, 24, 16, R.seat), cv.box(X - 13, Y + 16, 16, 26, 6, 22, R.seat)];
  const seated = { pessoa: true };
  // The waiting area of people: rows of chairs (spots match the chairs).
  const chairsSpot = (j) => [40 + (j % 10) * 46, 570 + Math.floor(j / 10) * 78];
  const chairs = (count) => Array.from({ length: count }, (_, j) => chair(...chairsSpot(j)));
  const kit = { floor, backdrop, outdoors: false, QUEUE: 20 };

  if (env === "loja") {
    backdrop.push(sign);
    // Shelves (gondolas) with goods along the back; the checkouts in a row in front of them.
    for (const [Y, k0] of [[20, 0], [92, 2]]) {
      for (let X = 0; X < LEN; X += 210) {
        backdrop.push(cv.box(X, Y, 0, 180, 34, 64, R.fixture));
        for (let s = 0; s < 3; s += 1) backdrop.push(cv.poly([[X + 4, Y + 34, 10 + s * 18], [X + 176, Y + 34, 10 + s * 18], [X + 176, Y + 34, 22 + s * 18], [X + 4, Y + 34, 22 + s * 18]], R.product[(k0 + s + X / 210) % R.product.length]));
      }
    }
    // The entrance (glass doors) where the line starts.
    backdrop.push(cv.poly([[300, 760, 0], [460, 760, 0], [460, 806, 0], [300, 806, 0]], R.fixture[1]));
    { const [ex, ey] = cv.at(330, 790, 0); backdrop.push(`<text transform='matrix(${r1(COS)},0.5,${r1(-COS)},0.5,${ex},${ey})' fill='${R.wallText}' ${FONT} font-size='22' font-weight='800' letter-spacing='4'>ENTRADA</text>`); }
    const cw = Math.min(w * 0.42, 30);
    Object.assign(kit, {
      place: (cx, k, free) => [
        cv.box(cx - cw - 4, DEPTH - 10, 0, cw, 96, 30, R.fixture),
        cv.poly([[cx - cw, DEPTH - 6, 30], [cx - 8, DEPTH - 6, 30], [cx - 8, DEPTH + 82, 30], [cx - cw, DEPTH + 82, 30]], R.belt),
        cv.box(cx - 6, DEPTH - 10, 0, 3, 3, 76, R.metal),
        // The till's number light: green when free.
        cv.box(cx - 12, DEPTH - 16, 76, 14, 14, 12, [free, free, free]),
      ],
      served: (cx, i) => [cx + 12, DEPTH + 30 + i * 26],
      line: (cx, i) => [cx + 12, DEPTH + 112 + i * 34],
      spot: chairsSpot,
      queueGround: [cv.poly([[10, 540, 0], [500, 540, 0], [500, 800, 0], [10, 800, 0]], "none", ` stroke='${R.safety}' stroke-width='2' stroke-dasharray='10 8' opacity='0.6'`)],
      facing: "-X",
      label: (cx) => [cx - cw - 4, DEPTH - 10, 100],
      tag: (cx) => [cx + 12, DEPTH + 30, 96],
    });
  } else if (env === "clinica") {
    backdrop.push(sign);
    // A red cross on the wall; the rooms in a row (partitions, a bed, a door whose floor mark is green when free).
    backdrop.push(cv.box(LEN - 120, -50, 70, 36, 4, 12, [R.cross, R.cross, R.cross]), cv.box(LEN - 108, -50, 58, 12, 4, 36, [R.cross, R.cross, R.cross]));
    backdrop.push(wallText(LEN - 60, 90, "PRONTO ATENDIMENTO", 20));
    Object.assign(kit, {
      place: (cx, k, free) => [
        cv.poly([[cx - w / 2 + 6, 0, 0], [cx + w / 2 - 2, 0, 0], [cx + w / 2 - 2, DEPTH, 0], [cx - w / 2 + 6, DEPTH, 0]], R.tile),
        cv.box(cx - w / 2 + 2, -50, 0, 5, DEPTH + 50, 34, R.wall),
        cv.box(cx - 16, 30, 0, 32, 78, 20, R.white),
        cv.box(cx - 14, 32, 20, 28, 18, 6, R.fixture),
        cv.box(cx - w / 2 + 6, DEPTH - 5, 0, Math.max(4, w * 0.22), 5, 34, R.wall),
        cv.box(cx + w / 2 - 2 - Math.max(4, w * 0.22), DEPTH - 5, 0, Math.max(4, w * 0.22), 5, 34, R.wall),
        cv.poly([[cx - w * 0.22, DEPTH - 4, 0], [cx + w * 0.22, DEPTH - 4, 0], [cx + w * 0.22, DEPTH + 10, 0], [cx - w * 0.22, DEPTH + 10, 0]], free),
      ],
      served: (cx, i) => [cx + 26 - i * Math.min(14, w / 4), 70 + i * 34],
      line: (cx, i) => [cx, DEPTH + 52 + i * 36],
      spot: chairsSpot,
      queueGround: [...chairs(20), cv.box(530, 560, 0, 90, 40, 36, R.fixture), (() => { const [x, y] = cv.at(530, 600, 46); return `<text x='${x}' y='${y}' fill='${R.text}' ${FONT} font-size='15' font-weight='700'>Recepção</text>`; })()],
      facing: "-X",
      label: (cx) => [cx - 12, DEPTH + 14, 2],
      tag: (cx) => [cx + 26, 70, 92],
      flatLabel: true,
      seated,
    });
  } else if (env === "salao") {
    backdrop.push(sign);
    // The ticket panel on the wall calls the last one served.
    const [px, py] = cv.at(-110, 330, 112);
    backdrop.push(cv.box(-110, 300, 64, 6, 220, 56, ["#0B1322", "#0B1322", "#0B1322"]));
    backdrop.push(`<text transform='matrix(${r1(COS)},-0.5,0,1,${r1(Number(px) + 4)},${r1(Number(py) + 4)})' fill='#3DDC97' ${FONT} font-size='24' font-weight='800'>`, D(`"SENHA " & ${safe("LEFT(MAXX(NaDoca, [@nome]), 10)")}`), "</text>");
    Object.assign(kit, {
      place: (cx, k, free) => [
        cv.box(cx - w / 2 + 4, DEPTH - 30, 0, w - 8, 26, 36, R.fixture),
        cv.box(cx - w / 2 + 2, DEPTH - 60, 36, 4, 56, 40, [R.glass, R.glass, R.glass], " opacity='0.35'"),
        cv.box(cx - 8, DEPTH - 26, 36, 16, 6, 14, R.metal),
        // The clerk behind the counter, and the counter's light: green when free.
        person(cv, cx, DEPTH - 56, { shirt: R.staff, facing: "+Y" }).parts,
        cv.box(cx - 6, DEPTH - 30, 76, 12, 12, 10, [free, free, free]),
      ],
      served: (cx, i) => [cx + (i - 1) * Math.min(16, w / 3), DEPTH + 26],
      line: (cx, i) => [cx, DEPTH + 74 + i * 36],
      spot: chairsSpot,
      queueGround: chairs(20),
      facing: "-Y",
      label: (cx) => [cx - w / 2 + 4, DEPTH - 30, 100],
      tag: (cx) => [cx, DEPTH + 26, 92],
      seated,
    });
  } else {
    // fabrica: machines with a status light, a conveyor in front, a pallet area marked in yellow.
    backdrop.push(sign);
    floor.push(`<polyline points='${cv.pts([[0, DEPTH + 60, 0], [LEN, DEPTH + 60, 0]])}' stroke='${R.safety}' stroke-width='4' stroke-dasharray='18 10' fill='none'/>`);
    backdrop.push(cv.box(0, DEPTH + 4, 0, LEN, 24, 16, [R.belt, R.metal[1], R.metal[2]]));
    const mw = Math.min(w * 0.7, 64);
    Object.assign(kit, {
      QUEUE: 15,
      place: (cx, k, free) => [
        cv.box(cx - mw / 2, DEPTH - 96, 0, mw, 80, 66, R.metal),
        cv.box(cx - mw / 2 + 6, DEPTH - 18, 20, mw - 12, 4, 30, [R.belt, R.belt, R.belt]),
        cv.box(cx - 6, DEPTH - 62, 66, 12, 12, 14, [free, free, free]),
      ],
      served: (cx, i) => [cx + (i - 1) * Math.min(18, w / 3), DEPTH + 2],
      line: (cx, i) => [cx, DEPTH + 84 + i * 42],
      spot: (j) => [40 + (j % 5) * 70, 560 + Math.floor(j / 5) * 70],
      queueGround: [cv.poly([[10, 520, 0], [380, 520, 0], [380, 780, 0], [10, 780, 0]], "none", ` stroke='${R.safety}' stroke-width='3' stroke-dasharray='12 8'`)],
      label: (cx) => [cx - mw / 2, DEPTH - 16, 92],
      tag: (cx) => [cx, DEPTH + 2, 80],
    });
  }
  return kit;
}

/** A colour and its two darker faces, for a box. */
export function faces(hex) {
  const n = parseInt(hex.slice(1), 16);
  const dark = (f) => `#${[16, 8, 0].map((s) => Math.round(((n >> s) & 255) * f).toString(16).padStart(2, "0")).join("")}`;
  return [hex, dark(0.82), dark(0.68)];
}
