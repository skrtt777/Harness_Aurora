import test from "node:test";
import assert from "node:assert/strict";

const phys = await import("../.test-build/livemap/ocean/physics.js");

test("the jellyfish swims by pulses to where she works, settles there, and faces the way she goes", () => {
  const s = phys.newSwim(0, 0);
  let beats = 0, last = 0;
  for (let t = 0; t < 6; t += 1 / 60) {
    const c = phys.stepSwim(s, { x: 120, y: 40 }, 1 / 60);
    if (c > 0.9 && last <= 0.9) beats += 1;
    last = c;
  }
  assert.ok(Math.hypot(s.x - 120, s.y - 40) < 6, `arrived (${s.x.toFixed(1)}, ${s.y.toFixed(1)})`);
  assert.ok(beats >= 3, `she swam by beats (${beats})`);
  assert.ok(Math.abs(s.heading - Math.atan2(40, 120)) < 0.6, "facing where she went");
  for (let t = 0; t < 3; t += 1 / 60) phys.stepSwim(s, { x: 120, y: 40 }, 1 / 60);
  assert.ok(Math.hypot(s.vx, s.vy) < 4, "settled, not orbiting");
  // Another cell, far away: there in a few seconds, and settled.
  let arrivedAt = null;
  for (let t = 0; t < 8; t += 1 / 60) { phys.stepSwim(s, { x: 520, y: -260 }, 1 / 60); if (arrivedAt === null && Math.hypot(s.x - 520, s.y + 260) < 15) arrivedAt = t; }
  assert.ok(arrivedAt !== null && arrivedAt < 4, `a far trip took ${arrivedAt}`);
  assert.ok(Math.hypot(s.x - 520, s.y + 260) < 8 && Math.hypot(s.vx, s.vy) < 6, "and she stays there");
});

test("a tentacle keeps its length, trails in the current, and its tip reaches a memory", () => {
  const r = phys.newRope(12, 0, 0, 2.5);
  for (let k = 0; k < 120; k += 1) phys.stepRope(r, 0, 0, 1 / 60, { flow: { x: -3, y: 0 }, sway: 0, t: k / 60 });
  for (let i = 1; i < 12; i += 1) assert.ok(Math.abs(Math.hypot(r.px[i] - r.px[i - 1], r.py[i] - r.py[i - 1]) - 2.5) < 0.3, "segments keep their length");
  assert.ok(r.px[11] < -15, "it trails behind (with the flow)");
  for (let k = 0; k < 120; k += 1) phys.stepRope(r, 0, 0, 1 / 60, { flow: { x: -3, y: 0 }, sway: 0, t: k / 60, reach: { x: 40, y: 20 }, maxStretch: 3 });
  assert.ok(Math.hypot(r.px[11] - 40, r.py[11] - 20) < 4, `tip at the memory (${r.px[11].toFixed(1)}, ${r.py[11].toFixed(1)})`);
  assert.equal(r.px[0], 0); assert.equal(r.py[0], 0);
});

test("the water: plankton drifts, the hand pushes it away, it never leaves the sea; memories spring back", () => {
  const n = 400, px = new Float32Array(n), py = new Float32Array(n), vx = new Float32Array(n), vy = new Float32Array(n);
  for (let i = 0; i < n; i += 1) { px[i] = (i % 20) * 10 - 100; py[i] = Math.floor(i / 20) * 10 - 100; }
  const bounds = { minX: -100, maxX: 100, minY: -100, maxY: 100 };
  for (let k = 0; k < 120; k += 1) phys.stepPlankton(px, py, vx, vy, 1 / 60, k / 60, bounds, [{ x: 0, y: 0, r: 30, s: 1 }]);
  let inside = 0;
  for (let i = 0; i < n; i += 1) { assert.ok(px[i] >= -100 && px[i] <= 100 && py[i] >= -100 && py[i] <= 100); if (Math.hypot(px[i], py[i]) < 10) inside += 1; }
  assert.ok(inside <= 2, `the hand clears the water around it (${inside} left)`);

  const ox = new Float32Array(1), oy = new Float32Array(1), bvx = new Float32Array(1), bvy = new Float32Array(1);
  for (let k = 0; k < 30; k += 1) phys.stepBend(ox, oy, bvx, bvy, () => ({ x: 5, y: 0 }), 1 / 60, [{ x: 0, y: 0, r: 20, s: 1 }]);
  assert.ok(ox[0] > 0.5, "bent away from the hand");
  for (let k = 0; k < 240; k += 1) phys.stepBend(ox, oy, bvx, bvy, () => ({ x: 5, y: 0 }), 1 / 60, []);
  assert.ok(Math.abs(ox[0]) < 0.05 && Math.abs(oy[0]) < 0.05, "and back in place");

  const ring = phys.rippleRing({ x: 0, y: 0, at: 1000 }, 2000);
  assert.ok(ring && ring.r > 80 && ring.s > 0);
  assert.equal(phys.rippleRing({ x: 0, y: 0, at: 1000 }, 3500), null);
});
