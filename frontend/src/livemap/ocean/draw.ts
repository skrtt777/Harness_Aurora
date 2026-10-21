// Writing into the dynamic buffers each frame (no allocation): points and line segments with alpha and tint.
import * as THREE from "three";
import type { Vec3 } from "../layout";

type XYZ = Vec3 | THREE.Vector3 | { x: number; y: number; z?: number };
const X = (p: XYZ) => (Array.isArray(p) ? p[0] : p.x);
const Y = (p: XYZ) => (Array.isArray(p) ? p[1] : p.y);
const Z = (p: XYZ) => (Array.isArray(p) ? p[2] : (p as { z?: number }).z ?? 0);

export class Writer {
  n = 0;
  private pos: THREE.BufferAttribute; private alpha: THREE.BufferAttribute; private tint: THREE.BufferAttribute; private size: THREE.BufferAttribute | null;
  constructor(private geo: THREE.BufferGeometry) {
    this.pos = geo.getAttribute("position") as THREE.BufferAttribute;
    this.alpha = geo.getAttribute("alpha") as THREE.BufferAttribute;
    this.tint = geo.getAttribute("tint") as THREE.BufferAttribute;
    this.size = (geo.getAttribute("size") as THREE.BufferAttribute) || null;
  }
  get full() { return this.n >= this.pos.count; }
  begin() { this.n = 0; return this; }
  /** One point (needs a geometry with size). */
  dot(p: XYZ, size: number, alpha: number, c: THREE.Color) {
    if (this.n >= this.pos.count) return;
    this.pos.setXYZ(this.n, X(p), Y(p), Z(p)); this.alpha.setX(this.n, alpha); this.tint.setXYZ(this.n, c.r, c.g, c.b);
    this.size?.setX(this.n, size); this.n += 1;
  }
  /** One segment (a line geometry). */
  line(a: XYZ, b: XYZ, alpha: number, c: THREE.Color, alphaB = alpha) {
    if (this.n + 2 > this.pos.count) return;
    this.pos.setXYZ(this.n, X(a), Y(a), Z(a)); this.alpha.setX(this.n, alpha); this.tint.setXYZ(this.n, c.r, c.g, c.b); this.n += 1;
    this.pos.setXYZ(this.n, X(b), Y(b), Z(b)); this.alpha.setX(this.n, alphaB); this.tint.setXYZ(this.n, c.r, c.g, c.b); this.n += 1;
  }
  end() {
    this.pos.needsUpdate = true; this.alpha.needsUpdate = true; this.tint.needsUpdate = true;
    if (this.size) this.size.needsUpdate = true;
    this.geo.setDrawRange(0, this.n);
  }
}

/** A point on the gentle curve between a and b (bent sideways by `bend`), t in [0, 1]. */
export function curvePoint(a: Vec3, b: Vec3, t: number, bend: number, out: THREE.Vector3) {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, mz = (a[2] + b[2]) / 2;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const cx = mx - dy * bend, cy = my + dx * bend, cz = mz;
  const u = 1 - t;
  return out.set(u * u * a[0] + 2 * u * t * cx + t * t * b[0], u * u * a[1] + 2 * u * t * cy + t * t * b[1], u * u * a[2] + 2 * u * t * cz + t * t * b[2]);
}
