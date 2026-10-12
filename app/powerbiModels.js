// The things drawn in the scenes, as small isometric models that point the right way: a truck whose cab
// leads where it goes (backed into a dock, nose first on the road and on its route), a person who faces
// what they wait for (the counter, the bed, the line ahead), a box with its tape. Each takes the canvas of
// the scene (box/poly/at in world coordinates) and colours that may be DAX pieces.

const r1 = (v) => String(Math.round(v * 10) / 10);
const COS = Math.cos(Math.PI / 6);
// The screen direction of each world direction (for a face looking that way, a hair parting…).
const SCREEN = { "+X": [COS, 0.5], "-X": [-COS, -0.5], "+Y": [-COS, 0.5], "-Y": [COS, -0.5] };

/**
 * A truck from (X, Y) along `axis` ("y" or "x"), `len` long and `wide` across, its cab at the `front`
 * end (+1: the far end of the axis, -1: the start). body = [top, left, right] fills (the cargo, in the
 * colour of its state); L = the scene's look (chassis, cab, glass…). Parts are drawn back to front.
 */
export function truck(cv, X, Y, { len = 150, wide = 32, tall = 52, axis = "y", front = 1, body, L }) {
  const along = (a, b) => (axis === "y" ? [X, Y + a, wide, b] : [X + a, Y, b, wide]);
  const box = (a, b, z, h, fills) => { const [x, y, dx, dy] = along(a, b); return cv.box(x, y, z, dx, dy, h, fills); };
  const cabLen = Math.round(len * 0.2); const gap = 4; const cargoLen = len - cabLen - gap;
  const cargoAt = front > 0 ? 0 : cabLen + gap; const cabAt = front > 0 ? cargoLen + gap : 0;
  const parts = [];
  // The shadow and the chassis, then the wheels on the visible side (+X face for "y", +Y face for "x").
  parts.push(box(0, len, 0, 8, [L.chassis, L.chassis, L.chassis]));
  const side = (a, z) => (axis === "y" ? cv.at(X + wide, Y + a, z) : cv.at(X + a, Y + wide, z));
  const wheels = [cargoAt + len * 0.1, cargoAt + cargoLen - len * 0.12, cabAt + cabLen / 2].map((a) => {
    const [wx, wy] = side(a, Math.max(3, tall * 0.13));
    const r = Math.max(2.5, tall * 0.15);
    return `<ellipse cx='${wx}' cy='${wy}' rx='${r1(r)}' ry='${r1(r * 1.13)}' fill='#0B0F16'/><ellipse cx='${wx}' cy='${wy}' rx='${r1(r * 0.4)}' ry='${r1(r * 0.46)}' fill='#5B6B85'/>`;
  });
  const cargo = [box(cargoAt, cargoLen, 8, tall, body)];
  // A stripe along the visible side of the cargo.
  const [s0x, s0y] = side(cargoAt + 6, tall * 0.5); const [s1x, s1y] = side(cargoAt + cargoLen - 6, tall * 0.5);
  cargo.push(`<line x1='${s0x}' y1='${s0y}' x2='${s1x}' y2='${s1y}' stroke='#FFFFFF' stroke-width='2.5' opacity='0.35'/>`);
  const cabTall = Math.round(tall * 0.8);
  const cab = [box(cabAt, cabLen, 8, cabTall, L.cab)];
  // The side window of the cab (visible side), and the windshield when the front faces the viewer.
  const w0 = cabAt + (front > 0 ? cabLen * 0.45 : 3); const w1 = cabAt + (front > 0 ? cabLen - 3 : cabLen * 0.55);
  const win = (a0, a1, z0, z1) => (axis === "y" ? cv.poly([[X + wide, Y + a0, z0], [X + wide, Y + a1, z0], [X + wide, Y + a1, z1], [X + wide, Y + a0, z1]], L.glass) : cv.poly([[X + a0, Y + wide, z0], [X + a1, Y + wide, z0], [X + a1, Y + wide, z1], [X + a0, Y + wide, z1]], L.glass));
  cab.push(win(w0, w1, 8 + cabTall * 0.5, 8 + cabTall * 0.9));
  if (front > 0) {
    const f = cabAt + cabLen; const m = 3;
    cab.push(axis === "y"
      ? cv.poly([[X + m, Y + f, 8 + cabTall * 0.5], [X + wide - m, Y + f, 8 + cabTall * 0.5], [X + wide - m, Y + f, 8 + cabTall * 0.9], [X + m, Y + f, 8 + cabTall * 0.9]], L.glass)
      : cv.poly([[X + f, Y + m, 8 + cabTall * 0.5], [X + f, Y + wide - m, 8 + cabTall * 0.5], [X + f, Y + wide - m, 8 + cabTall * 0.9], [X + f, Y + m, 8 + cabTall * 0.9]], L.glass));
  }
  // Farther first: with the cab at the far end it is nearer to the viewer, drawn last.
  parts.push(...(front > 0 ? [cargo, cab] : [cab, cargo]), wheels);
  return parts;
}

/**
 * A person standing (or seated) at (X, Y), facing `facing` ("+X", "-X", "+Y", "-Y"): legs, a body in
 * `shirt` fills (their state or their risk), arms, a head with hair on the back and the face to the front.
 */
export function person(cv, X, Y, { shirt, facing = "-Y", seat = false, skin = "#C99A73", hair = "#2B1E16", trousers = ["#3B4A63", "#2C3A52", "#22304A"] }) {
  const parts = [];
  const across = facing.endsWith("X") ? "y" : "x";
  const [fx, fy] = { "+X": [1, 0], "-X": [-1, 0], "+Y": [0, 1], "-Y": [0, -1] }[facing];
  if (seat) { X -= fx * 6; Y -= fy * 6; }
  // Legs: two posts side by side across the facing direction; seated, thighs forward on the seat and
  // shins down at its front edge.
  const leg = (o) => {
    if (!seat) return across === "x" ? cv.box(X - 8 + o, Y - 4, 0, 6, 8, 20, trousers) : cv.box(X - 4, Y - 8 + o, 0, 8, 6, 20, trousers);
    const ax = across === "x" ? X - 8 + o : X; const ay = across === "x" ? Y : Y - 8 + o;
    const thigh = across === "x" ? cv.box(ax, Math.min(Y, Y + fy * 16), 12, 6, 16, 6, trousers) : cv.box(Math.min(X, X + fx * 16), ay, 12, 16, 6, 6, trousers);
    const shin = across === "x" ? cv.box(ax, Y + fy * 16 - (fy > 0 ? 0 : 6), 0, 6, 6, 14, trousers) : cv.box(X + fx * 16 - (fx > 0 ? 0 : 6), ay, 0, 6, 6, 14, trousers);
    return fy < 0 || fx < 0 ? [shin, thigh] : [thigh, shin];
  };
  parts.push(leg(0), leg(10));
  const legTop = seat ? 18 : 20;
  // The body: wider across than deep.
  const [bw, bd] = across === "x" ? [20, 11] : [11, 20];
  parts.push(cv.box(X - bw / 2, Y - bd / 2, legTop, bw, bd, 24, shirt));
  // Arms at the sides.
  const arm = (o) => (across === "x" ? cv.box(X - bw / 2 - 5 + o * (bw + 5), Y - 3, legTop + 4, 5, 6, 19, shirt) : cv.box(X - 3, Y - bd / 2 - 5 + o * (bd + 5), legTop + 4, 6, 5, 19, shirt));
  parts.push(arm(0), arm(1));
  // The head: hair behind, the face toward where they look (seen from the back, mostly hair).
  const [hx, hy] = cv.at(X, Y, legTop + 24 + 12);
  const [dx, dy] = SCREEN[facing];
  const away = facing === "-X" || facing === "-Y";
  const face = `<ellipse cx='${r1(Number(hx) + dx * 2.5)}' cy='${r1(Number(hy) + dy * 2.5)}' rx='10' ry='11' fill='${skin}'/>`;
  const back = `<ellipse cx='${r1(Number(hx) - dx * 2.5)}' cy='${r1(Number(hy) - dy * 2.5 - 2)}' rx='10.5' ry='10.5' fill='${hair}'/>`;
  parts.push(away ? [face, back] : [back, face]);
  // Eyes when the face is toward the viewer.
  if (!away) parts.push(`<circle cx='${r1(Number(hx) + dx * 6 - 3)}' cy='${r1(Number(hy) + dy * 4)}' r='1.3' fill='#1B2A4A'/><circle cx='${r1(Number(hx) + dx * 6 + 3)}' cy='${r1(Number(hy) + dy * 4)}' r='1.3' fill='#1B2A4A'/>`);
  return { parts, head: [hx, hy] };
}

/** A box (an order, a load) on a pallet, with its tape across the top. */
export function parcel(cv, X, Y, { body }) {
  return [
    cv.box(X - 18, Y - 18, 0, 36, 36, 6, ["#D9B27C", "#C99A5B", "#A87E45"]),
    cv.box(X - 15, Y - 15, 6, 30, 30, 28, body),
    `<polyline points='${cv.pts([[X - 15, Y, 34], [X + 15, Y, 34], [X + 15, Y, 24]])}' stroke='#F4E3C1' stroke-width='3' fill='none' opacity='0.8'/>`,
  ];
}
