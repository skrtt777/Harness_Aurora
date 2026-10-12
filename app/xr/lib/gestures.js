// Gestures and motion of the person, from tracked hands and head (WebXR poses as plain [x, y, z]).
// Pure: no three.js, no WebXR objects; the headset loop feeds numbers and reads decisions.
// The same thresholds as the Quest app had (AuroraMRPawn.h), now in metres.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a) => Math.hypot(a[0], a[1], a[2]);
export const distance = (a, b) => length(sub(a, b));
const unit = (a) => { const l = length(a) || 1; return scale(a, 1 / l); };

/** Pinch with hysteresis: closes under 2.2 cm, opens over 3.5 cm; only after the fingers were apart. */
export class Pinch {
  constructor() { this.down = false; this.armed = false; }
  update(tracked, thumbTip, indexTip) {
    if (!tracked || !thumbTip || !indexTip) { this.down = false; this.armed = false; return false; }
    const d = distance(thumbTip, indexTip);
    if (d >= 0.035) this.armed = true;
    this.down = this.armed && (this.down ? d < 0.035 : d < 0.022);
    return this.down;
  }
}

/** An open hand: the four finger tips far from the wrist (not a fist, not a pinch). */
export function openHand(joints) {
  const w = joints?.wrist; if (!w) return false;
  const tips = ["index-finger-tip", "middle-finger-tip", "ring-finger-tip", "pinky-finger-tip"].map((k) => joints[k]);
  if (tips.some((t) => !t)) return false;
  return tips.every((t) => distance(t, w) > 0.12) && distance(joints["thumb-tip"] || w, joints["index-finger-tip"]) > 0.05;
}

/** The palm's normal (out of the palm), from the wrist and the index and pinky knuckles. */
export function palmNormal(joints, handedness = "right") {
  const w = joints?.wrist; const i = joints?.["index-finger-metacarpal"]; const p = joints?.["pinky-finger-metacarpal"];
  if (!w || !i || !p) return null;
  const n = unit(cross(sub(i, w), sub(p, w)));
  return handedness === "left" ? scale(n, -1) : n;
}

/** Fires once after an open palm turned to the face is held 0.8 s; losing tracking never fires. */
export class Summon {
  constructor(hold = 0.8) { this.hold = hold; this.t = 0; this.release = 0; this.latched = false; }
  update(tracked, palmToFace, dt) {
    dt = Math.min(Math.max(dt, 0), 0.05);
    if (!tracked) { this.t = 0; this.release = 0; return false; }
    if (!palmToFace) { this.t = 0; this.release += dt; if (this.release >= 0.25) this.latched = false; return false; }
    this.release = 0;
    if (this.latched) return false;
    this.t += dt;
    if (this.t >= this.hold) { this.latched = true; return true; }
    return false;
  }
  get progress() { return Math.min(1, this.t / this.hold); }
}

/** Whether a palm faces the head: its normal points to the eyes (within ~50 degrees). */
export function palmFacesHead(joints, handedness, head) {
  const n = palmNormal(joints, handedness); const w = joints?.wrist;
  if (!n || !w || !head) return false;
  return dot(n, unit(sub(head, w))) > 0.64;
}

/**
 * Two hands holding an object: from where both grabbed (a0, b0) to where they are (a, b), the change of
 * scale (the hands apart), of turn around the vertical (yaw, radians) and of place (the midpoint).
 */
export function twoHand(a0, b0, a, b) {
  const d0 = distance(a0, b0) || 1e-6; const d = distance(a, b);
  const yaw0 = Math.atan2(b0[0] - a0[0], b0[2] - a0[2]); const yaw1 = Math.atan2(b[0] - a[0], b[2] - a[2]);
  let yaw = yaw1 - yaw0;
  while (yaw > Math.PI) yaw -= 2 * Math.PI; while (yaw < -Math.PI) yaw += 2 * Math.PI;
  const mid0 = scale(add(a0, b0), 0.5); const mid = scale(add(a, b), 0.5);
  return { scale: d / d0, yaw, move: sub(mid, mid0), pivot: mid0 };
}

/**
 * Head motion: speed over the last second, to tell standing (reading) from walking.
 * Walking (over 0.45 m/s for 0.6 s) brings the panel along; it stays still while you stand.
 */
export class HeadMotion {
  constructor() { this.samples = []; this.walking = false; this.fast = 0; this.slow = 0; }
  update(pos, t, dt) {
    this.samples.push({ pos, t });
    while (this.samples.length > 2 && t - this.samples[0].t > 1) this.samples.shift();
    const first = this.samples[0];
    const span = t - first.t;
    const flat = [pos[0] - first.pos[0], 0, pos[2] - first.pos[2]];
    this.speed = span > 0.2 ? length(flat) / span : 0;
    if (this.speed > 0.45) { this.fast += dt; this.slow = 0; } else { this.slow += dt; this.fast = 0; }
    if (!this.walking && this.fast > 0.6) this.walking = true;
    if (this.walking && this.slow > 1.2) this.walking = false;
    return this.walking;
  }
}

/**
 * Where a panel should be: it stays put while the person looks around a little, and comes back in front
 * when they turned away (over 40 degrees), walked off (over 1.6 m) or are walking. The target only;
 * the caller eases toward it.
 */
export function lazyFollow({ panel, head, forward, distance: dist = 0.9, height = -0.1, walking = false, maxAngle = 40, maxDistance = 1.6 }) {
  const f = unit([forward[0], 0, forward[2]]);
  const target = [head[0] + f[0] * dist, head[1] + height, head[2] + f[2] * dist];
  if (!panel) return { move: true, target };
  const to = [panel[0] - head[0], 0, panel[2] - head[2]];
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(unit(to), f)))) * 180 / Math.PI;
  const far = length(to) > maxDistance || length(to) < 0.35;
  return { move: walking || far || angle > maxAngle, target, angle };
}

/** Eases a value toward a target with a time constant (frame-rate independent). */
export function ease(current, target, dt, tau = 0.25) {
  const k = 1 - Math.exp(-dt / tau);
  return current.map((c, i) => c + (target[i] - c) * k);
}
