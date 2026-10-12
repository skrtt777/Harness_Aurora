// The life of the miniature: each object has a home (where the data or the scene puts it) and a
// behaviour (walk about, drive around the ring road, spin, float, fly, swim, hop); a finger, a hand or
// an object held nearby pushes it away, objects push each other, and a spring brings each one back to
// its place. Pure (no three.js): plate coordinates in metres (x right, y up, z toward the viewer).

export const RING = { ax: 0.24, az: 0.165 };     // the ring road of "rodar" (an ellipse on the 0.6 x 0.45 plate)
const SPEED = 0.035;                              // m/s, walking and driving in the miniature

export function makeBody({ x = 0, y = 0, z = 0, rot = 0, radius = 0.015, height = 0.03, behavior = "parado", seed = 1, bounds = null, fixed = false }) {
  return { home: { x, y, z, rot }, radius, height, behavior, seed, bounds, fixed, ox: 0, oz: 0, vx: 0, vz: 0, held: false, hop: -1, pose: { x, y, z, rot } };
}

// A smooth wander from a seed: a sum of slow sines, in -1..1.
const wave = (t, s, k) => (Math.sin(t * (0.21 + 0.07 * k) + s * 1.7 + k) + 0.6 * Math.sin(t * (0.53 + 0.05 * k) + s * 3.1 + 2 * k)) / 1.6;

/** Where the behaviour puts the body at time t (seconds), before pushes. */
export function behave(b, t) {
  const h = b.home; const s = b.seed;
  switch (b.behavior) {
    case "passear": case "nadar": {
      const R = b.behavior === "nadar" ? 0.03 : 0.045; const slow = b.behavior === "nadar" ? 0.7 : 1;
      const at = (tt) => ({ x: h.x + R * wave(tt * slow, s, 0), z: h.z + R * wave(tt * slow, s, 1) });
      const p = at(t), q = at(t + 0.25);
      const moving = Math.hypot(q.x - p.x, q.z - p.z) > 1e-4;
      return { x: p.x, y: h.y, z: p.z, rot: moving ? Math.atan2(q.x - p.x, q.z - p.z) : h.rot };
    }
    case "rodar": {
      // Around the ring road, all at the same speed (nobody overtakes), each from where it was put.
      const a0 = Math.atan2(h.z / RING.az, h.x / RING.ax); const w = SPEED / ((RING.ax + RING.az) / 2);
      const a = a0 + w * t;
      const x = RING.ax * Math.cos(a), z = RING.az * Math.sin(a);
      const dx = -RING.ax * Math.sin(a), dz = RING.az * Math.cos(a);
      return { x, y: h.y, z, rot: Math.atan2(dx, dz) };
    }
    case "orbitar": {
      const r = Math.max(0.06, Math.hypot(h.x, h.z)); const a = Math.atan2(h.z, h.x) + (0.5 / (r * 8)) * t;
      return { x: r * Math.cos(a), y: h.y, z: r * Math.sin(a), rot: h.rot + t * 0.8 };
    }
    case "voar": {
      const r = 0.06; const a = s + t * 0.6;
      return { x: h.x + r * Math.cos(a), y: h.y + 0.01 * Math.sin(t * 1.3 + s), z: h.z + r * Math.sin(a), rot: Math.atan2(-Math.sin(a), Math.cos(a)) };
    }
    case "girar": return { x: h.x, y: h.y, z: h.z, rot: h.rot + t * 0.6 };
    case "flutuar": return { x: h.x, y: h.y + 0.008 * Math.sin(t * 1.4 + s), z: h.z, rot: h.rot + 0.15 * Math.sin(t * 0.4 + s) };
    case "pular": return { x: h.x, y: h.y + 0.012 * Math.max(0, Math.sin(t * 4 + s * 2)), z: h.z, rot: h.rot + 0.3 * Math.sin(t * 0.5 + s) };
    case "idle": return { x: h.x, y: h.y, z: h.z, rot: h.rot + 0.12 * Math.sin(t * 0.7 + s) };
    default: return { ...h };
  }
}

/**
 * One step: behaviours, pushes from the pushers ({x, y, z, r}: fingertips, hands, a held object), the
 * bodies pushing each other, the spring back home, the plate's edge. Sets each body's pose.
 */
export function stepBodies(bodies, { t, dt, pushers = [] }) {
  const k = 70, c = 2 * Math.sqrt(k) * 0.75;
  const live = bodies.filter((b) => !b.held);
  for (const b of live) {
    const base = behave(b, t);
    // Spring back toward the behaviour's place (critically damped enough not to wobble long).
    if (!b.fixed) {
      b.vx += (-k * b.ox - c * b.vx) * dt; b.vz += (-k * b.oz - c * b.vz) * dt;
      b.ox += b.vx * dt; b.oz += b.vz * dt;
    }
    b.base = base;
    b.pose = { x: base.x + b.ox, y: base.y, z: base.z + b.oz, rot: base.rot };
  }
  // Pushes: whatever is closer than the two radii moves out of the way (only near its height).
  for (const p of pushers) {
    for (const b of live) {
      if (b.fixed) continue;
      if (p.y != null && (p.y < b.pose.y - 0.01 || p.y > b.pose.y + b.height + 0.02)) continue;
      const dx = b.pose.x - p.x, dz = b.pose.z - p.z; const d = Math.hypot(dx, dz); const min = p.r + b.radius;
      if (d >= min) continue;
      const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0; const push = min - d;
      b.ox += nx * push; b.oz += nz * push; b.vx += nx * push * 8; b.vz += nz * push * 8;
      b.pose.x += nx * push; b.pose.z += nz * push;
    }
  }
  // The bodies on the ground push each other apart (those in the air pass over).
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = live[i], b = live[j];
    if (a.fixed || b.fixed || Math.abs(a.pose.y - b.pose.y) > Math.min(a.height, b.height)) continue;
    // Two that stand close by design (trucks in line) may always be as close as their places are, so
    // the springs can bring both home; only a push closer than that makes them collide.
    const dx = b.pose.x - a.pose.x, dz = b.pose.z - a.pose.z; const d = Math.hypot(dx, dz);
    const min = Math.min((a.radius + b.radius) * 0.85, Math.hypot(b.base.x - a.base.x, b.base.z - a.base.z));
    if (d >= min || (Math.hypot(a.ox, a.oz) < 0.002 && Math.hypot(b.ox, b.oz) < 0.002)) continue;
    const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0; const half = (min - d) / 2;
    a.ox -= nx * half; a.oz -= nz * half; b.ox += nx * half; b.oz += nz * half;
    a.pose.x -= nx * half; a.pose.z -= nz * half; b.pose.x += nx * half; b.pose.z += nz * half;
  }
  // The plate's edge: nothing falls off.
  for (const b of live) {
    if (!b.bounds) continue;
    const mx = b.bounds.w / 2 - b.radius, mz = b.bounds.d / 2 - b.radius;
    const cx = Math.max(-mx, Math.min(mx, b.pose.x)), cz = Math.max(-mz, Math.min(mz, b.pose.z));
    if (cx !== b.pose.x) { b.ox += cx - b.pose.x; b.vx = 0; b.pose.x = cx; }
    if (cz !== b.pose.z) { b.oz += cz - b.pose.z; b.vz = 0; b.pose.z = cz; }
  }
  // A hop (a tap on the PC or the phone): a short jump in place.
  for (const b of live) if (b.hop >= 0) { const u = (t - b.hop) / 0.55; if (u > 1) b.hop = -1; else { b.pose.y += 0.03 * Math.sin(Math.PI * u); b.pose.rot += 2 * Math.PI * u; } }
  return bodies;
}

/** The return home of a released object: 0..1 to an eased arc (position mix, extra height). */
export function returnArc(u) {
  const x = Math.max(0, Math.min(1, u));
  const e = x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
  return { mix: e, lift: Math.sin(Math.PI * x) };
}
