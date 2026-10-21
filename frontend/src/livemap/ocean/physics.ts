// The living sea's physics, as plain numbers (no drawing), so it can be tested:
//   - the Zeladora is a jellyfish (água-viva): she swims by pulses — the bell contracts, pushes, glides —
//     toward where she works, and turns as she goes;
//   - her tentacles are ropes (Verlet): they trail behind as she swims, sway in the water, and one can reach
//     out to a memory, its tip pulled to it;
//   - the plankton drifts in a slow current, pushed away by the person's hand (the cursor), by the jellyfish
//     and by a ripple when the person taps the water;
//   - memories bend away from the hand and spring back.
export type V2 = { x: number; y: number };

// ---------------------------------------------------------------- the jellyfish's swim
export type Swim = { x: number; y: number; vx: number; vy: number; heading: number; phase: number; contraction: number };
export const newSwim = (x: number, y: number): Swim => ({ x, y, vx: 0, vy: 0, heading: 0, phase: 0, contraction: 0 });

/**
 * One step of the swim toward `target` (null: drift where she is). The bell beats faster when the target is
 * far; each beat's contraction gives a push toward it; the water's drag makes her glide and stop.
 * Returns the bell's contraction now (0 open, 1 closed) for the drawing.
 */
export function stepSwim(s: Swim, target: V2 | null, dt: number): number {
  const dx = target ? target.x - s.x : 0, dy = target ? target.y - s.y : 0;
  const dist = Math.hypot(dx, dy);
  const urgency = target ? Math.min(1, dist / 60) : 0;
  // Far away (another cell), she beats faster and harder: a long trip still takes only a couple of seconds.
  const far = target ? Math.min(1, Math.max(0, (dist - 60) / 300)) : 0;
  const beat = 0.45 + urgency * 1.1 + far * 0.9; // beats per second
  s.phase = (s.phase + dt * beat) % 1;
  // Contraction: quick close (first 30% of the beat), slow reopening.
  const p = s.phase;
  s.contraction = p < 0.3 ? Math.sin((p / 0.3) * Math.PI * 0.5) : Math.cos(((p - 0.3) / 0.7) * Math.PI * 0.5);
  if (target && dist > 0.5) {
    // The push happens while the bell closes; near the target it is gentle, so she settles instead of overshooting.
    const thrust = p < 0.3 ? (26 + urgency * 150 + far * 2200) * Math.min(1, dist / 12) : 0;
    s.vx += (dx / dist) * thrust * dt;
    s.vy += (dy / dist) * thrust * dt;
    const want = Math.atan2(dy, dx);
    let turn = want - s.heading;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    s.heading += turn * Math.min(1, dt * 2.2);
  }
  const drag = Math.exp(-dt * (target && dist < 8 ? 4.5 : target && dist < 40 ? 2.6 : target && dist > 120 ? 1.1 : 1.6));
  s.vx *= drag; s.vy *= drag;
  s.x += s.vx * dt; s.y += s.vy * dt;
  return s.contraction;
}

// ---------------------------------------------------------------- tentacles (Verlet ropes)
export type Rope = { px: Float32Array; py: Float32Array; ox: Float32Array; oy: Float32Array; seg: number };
export function newRope(n: number, x: number, y: number, seg: number): Rope {
  const r: Rope = { px: new Float32Array(n), py: new Float32Array(n), ox: new Float32Array(n), oy: new Float32Array(n), seg };
  for (let i = 0; i < n; i += 1) { r.px[i] = r.ox[i] = x - i * seg; r.py[i] = r.oy[i] = y; }
  return r;
}

/**
 * One step of a rope hanging from (ax, ay). The water pulls it gently along `flow` (behind the swimmer) and
 * sways it; with `reach`, its tip is pulled to that point and the rope may stretch up to `maxStretch` times
 * its length to get there. `pushers` (the hand, a ripple) push its points away.
 */
export function stepRope(r: Rope, ax: number, ay: number, dt: number, opts: { flow: V2; sway: number; t: number; reach?: V2 | null; maxStretch?: number; pushers?: Pusher[] }) {
  const n = r.px.length;
  const damp = 0.9;
  for (let i = 1; i < n; i += 1) {
    const vx = (r.px[i] - r.ox[i]) * damp, vy = (r.py[i] - r.oy[i]) * damp;
    r.ox[i] = r.px[i]; r.oy[i] = r.py[i];
    const along = i / n;
    const swayX = Math.sin(opts.t * 2.1 + i * 0.6 + opts.sway) * 0.9 * along;
    const swayY = Math.cos(opts.t * 1.7 + i * 0.5 + opts.sway) * 0.9 * along;
    let fx = opts.flow.x + swayX, fy = opts.flow.y + swayY;
    for (const p of opts.pushers || []) {
      const dx = r.px[i] - p.x, dy = r.py[i] - p.y; const d = Math.hypot(dx, dy);
      if (d < p.r && d > 0.01) { const k = (1 - d / p.r) * p.s * 40; fx += (dx / d) * k; fy += (dy / d) * k; }
    }
    r.px[i] += vx + fx * dt * dt * 60;
    r.py[i] += vy + fy * dt * dt * 60;
  }
  // Reaching: the tip goes to the memory (the rope stretches, within limits).
  let seg = r.seg;
  if (opts.reach) {
    const total = Math.hypot(opts.reach.x - ax, opts.reach.y - ay);
    seg = Math.min(r.seg * (opts.maxStretch ?? 3), Math.max(r.seg, (total / (n - 1)) * 1.02));
    const tip = n - 1;
    r.px[tip] += (opts.reach.x - r.px[tip]) * 0.35;
    r.py[tip] += (opts.reach.y - r.py[tip]) * 0.35;
  }
  r.px[0] = r.ox[0] = ax; r.py[0] = r.oy[0] = ay;
  // Constraints: each segment keeps its length (a few passes; the root never moves).
  for (let pass = 0; pass < 6; pass += 1) {
    for (let i = 1; i < n; i += 1) {
      const dx = r.px[i] - r.px[i - 1], dy = r.py[i] - r.py[i - 1];
      const d = Math.hypot(dx, dy) || 0.0001;
      const diff = (d - seg) / d;
      if (i === 1) { r.px[i] -= dx * diff; r.py[i] -= dy * diff; }
      else { r.px[i] -= dx * diff * 0.5; r.py[i] -= dy * diff * 0.5; r.px[i - 1] += dx * diff * 0.5; r.py[i - 1] += dy * diff * 0.5; }
    }
    r.px[0] = ax; r.py[0] = ay;
  }
  return seg;
}

// ---------------------------------------------------------------- the water: plankton, hand, ripples
export type Pusher = { x: number; y: number; r: number; s: number };
export type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

/** The slow current at a point: a few rotating eddies (smooth, never still). */
export function current(x: number, y: number, t: number): V2 {
  const a = Math.sin(y * 0.011 + t * 0.07) + Math.sin((x + y) * 0.006 - t * 0.05);
  const b = Math.cos(x * 0.012 - t * 0.06) + Math.cos((x - y) * 0.007 + t * 0.04);
  return { x: a * 2.2, y: b * 2.2 };
}

/** Moves the plankton one step: the current, the pushers (hand, jellyfish, ripples), wrapping at the edges. */
export function stepPlankton(px: Float32Array, py: Float32Array, vx: Float32Array, vy: Float32Array, dt: number, t: number, bounds: Bounds, pushers: Pusher[]) {
  const w = bounds.maxX - bounds.minX, h = bounds.maxY - bounds.minY;
  for (let i = 0; i < px.length; i += 1) {
    const c = current(px[i], py[i], t);
    let ax = (c.x - vx[i]) * 1.5, ay = (c.y - vy[i]) * 1.5;
    for (const p of pushers) {
      const dx = px[i] - p.x, dy = py[i] - p.y; const d2 = dx * dx + dy * dy;
      if (d2 < p.r * p.r && d2 > 0.0001) { const d = Math.sqrt(d2); const k = (1 - d / p.r) * p.s * 90; ax += (dx / d) * k; ay += (dy / d) * k; }
    }
    vx[i] += ax * dt; vy[i] += ay * dt;
    px[i] += vx[i] * dt; py[i] += vy[i] * dt;
    if (px[i] < bounds.minX) px[i] += w; else if (px[i] > bounds.maxX) px[i] -= w;
    if (py[i] < bounds.minY) py[i] += h; else if (py[i] > bounds.maxY) py[i] -= h;
  }
}

/** A ripple from a tap on the water: an expanding ring that pushes what it passes, for ~2 s. */
export type Ripple = { x: number; y: number; at: number };
export function rippleRing(r: Ripple, now: number): Pusher | null {
  const age = (now - r.at) / 1000;
  if (age < 0 || age > 2) return null;
  return { x: r.x, y: r.y, r: 10 + age * 90, s: (1 - age / 2) * 0.9 };
}

/**
 * Memories bend away from the hand and spring back (an offset per memory, with velocity). `ox/oy` and
 * `vx/vy` are per memory; `base` gives each memory's resting position.
 */
export function stepBend(ox: Float32Array, oy: Float32Array, vx: Float32Array, vy: Float32Array, base: (i: number) => V2, dt: number, pushers: Pusher[]) {
  for (let i = 0; i < ox.length; i += 1) {
    let fx = -ox[i] * 22 - vx[i] * 6.5, fy = -oy[i] * 22 - vy[i] * 6.5;
    if (pushers.length) {
      const b = base(i); const x = b.x + ox[i], y = b.y + oy[i];
      for (const p of pushers) {
        const dx = x - p.x, dy = y - p.y; const d2 = dx * dx + dy * dy;
        if (d2 < p.r * p.r && d2 > 0.0001) { const d = Math.sqrt(d2); const k = (1 - d / p.r) * p.s * 260; fx += (dx / d) * k; fy += (dy / d) * k; }
      }
    }
    vx[i] += fx * dt; vy[i] += fy * dt;
    ox[i] += vx[i] * dt; oy[i] += vy[i] * dt;
  }
}
