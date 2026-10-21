// The Mapa Vivo's drawing kit: dynamic buffers written every frame without allocation — points (sized in
// pixels, so the canopy reads like a field of stars at any zoom), hairlines, and ribbons (WebGL lines are one
// pixel wide; the glowing path of a memory being reached is a ribbon with a soft edge and a colour gradient).
import * as THREE from "three";

type XY = { x: number; y: number };

/** A dynamic buffer of points or line vertices with position, alpha, tint (and size for points). */
export function dynamicGeometry(count: number, withSize: boolean) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(Math.max(1, count) * 3), 3));
  g.setAttribute("alpha", new THREE.BufferAttribute(new Float32Array(Math.max(1, count)), 1));
  g.setAttribute("tint", new THREE.BufferAttribute(new Float32Array(Math.max(1, count) * 3), 3));
  if (withSize) g.setAttribute("size", new THREE.BufferAttribute(new Float32Array(Math.max(1, count)), 1));
  g.setDrawRange(0, 0);
  return g;
}

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
  dot(x: number, y: number, size: number, alpha: number, c: THREE.Color) {
    if (this.n >= this.pos.count || alpha <= 0.002) return;
    this.pos.setXYZ(this.n, x, y, 0); this.alpha.setX(this.n, alpha); this.tint.setXYZ(this.n, c.r, c.g, c.b);
    this.size?.setX(this.n, size); this.n += 1;
  }
  line(ax: number, ay: number, bx: number, by: number, alpha: number, c: THREE.Color, alphaB = alpha, cb: THREE.Color = c) {
    if (this.n + 2 > this.pos.count || (alpha <= 0.002 && alphaB <= 0.002)) return;
    this.pos.setXYZ(this.n, ax, ay, 0); this.alpha.setX(this.n, alpha); this.tint.setXYZ(this.n, c.r, c.g, c.b); this.n += 1;
    this.pos.setXYZ(this.n, bx, by, 0); this.alpha.setX(this.n, alphaB); this.tint.setXYZ(this.n, cb.r, cb.g, cb.b); this.n += 1;
  }
  end() {
    this.pos.needsUpdate = true; this.alpha.needsUpdate = true; this.tint.needsUpdate = true;
    if (this.size) this.size.needsUpdate = true;
    this.geo.setDrawRange(0, this.n);
  }
}

/** Ribbons: each segment a quad `width` world units wide, soft at its edges (the `side` attribute). */
export function ribbonGeometry(segments: number) {
  const g = new THREE.BufferGeometry();
  const v = Math.max(1, segments) * 6;
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(v * 3), 3));
  g.setAttribute("alpha", new THREE.BufferAttribute(new Float32Array(v), 1));
  g.setAttribute("tint", new THREE.BufferAttribute(new Float32Array(v * 3), 3));
  g.setAttribute("side", new THREE.BufferAttribute(new Float32Array(v), 1));
  g.setDrawRange(0, 0);
  return g;
}
export class RibbonWriter {
  n = 0;
  private pos: THREE.BufferAttribute; private alpha: THREE.BufferAttribute; private tint: THREE.BufferAttribute; private side: THREE.BufferAttribute;
  constructor(private geo: THREE.BufferGeometry) {
    this.pos = geo.getAttribute("position") as THREE.BufferAttribute;
    this.alpha = geo.getAttribute("alpha") as THREE.BufferAttribute;
    this.tint = geo.getAttribute("tint") as THREE.BufferAttribute;
    this.side = geo.getAttribute("side") as THREE.BufferAttribute;
  }
  begin() { this.n = 0; return this; }
  private v(x: number, y: number, a: number, c: THREE.Color, s: number) {
    this.pos.setXYZ(this.n, x, y, 0); this.alpha.setX(this.n, a); this.tint.setXYZ(this.n, c.r, c.g, c.b); this.side.setX(this.n, s); this.n += 1;
  }
  /** One segment a→b, `w` wide (world units), alpha and colour from a to b. */
  seg(a: XY, b: XY, w: number, alphaA: number, alphaB: number, ca: THREE.Color, cb: THREE.Color) {
    if (this.n + 6 > this.pos.count) return;
    const dx = b.x - a.x, dy = b.y - a.y; const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * w * 0.5, ny = (dx / len) * w * 0.5;
    // Stretch a little past both ends so consecutive segments join without a gap.
    const ex = (dx / len) * w * 0.25, ey = (dy / len) * w * 0.25;
    const ax = a.x - ex, ay = a.y - ey, bx = b.x + ex, by = b.y + ey;
    this.v(ax + nx, ay + ny, alphaA, ca, 1); this.v(ax - nx, ay - ny, alphaA, ca, -1); this.v(bx + nx, by + ny, alphaB, cb, 1);
    this.v(bx + nx, by + ny, alphaB, cb, 1); this.v(ax - nx, ay - ny, alphaA, ca, -1); this.v(bx - nx, by - ny, alphaB, cb, -1);
  }
  end() {
    this.pos.needsUpdate = true; this.alpha.needsUpdate = true; this.tint.needsUpdate = true; this.side.needsUpdate = true;
    this.geo.setDrawRange(0, this.n);
  }
}

/**
 * Points sized in pixels at the "fit" distance, growing a little as the camera comes closer (uRef / depth,
 * clamped), with a hot core and a soft halo.
 */
export const pointMaterial = () => new THREE.ShaderMaterial({
  vertexShader: /* glsl */ `
    attribute float size; attribute float alpha; attribute vec3 tint;
    uniform float uRef; uniform float pixelRatio;
    varying float vAlpha; varying vec3 vTint;
    void main() {
      vAlpha = alpha; vTint = tint;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float zoom = clamp(uRef / -mv.z, 0.7, 3.2);
      gl_PointSize = max(1.5, size * zoom) * pixelRatio;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    varying float vAlpha; varying vec3 vTint;
    void main() {
      vec2 p = gl_PointCoord - 0.5; float d = length(p);
      if (d > 0.5) discard;
      float core = smoothstep(0.2, 0.0, d);
      float halo = exp(-d * d * 16.0);
      gl_FragColor = vec4(vTint * (0.7 + core * 0.7), vAlpha * (core * 0.85 + halo * 0.5));
    }`,
  uniforms: { uRef: { value: 800 }, pixelRatio: { value: Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1) } },
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});

export const lineMaterial = () => new THREE.ShaderMaterial({
  vertexShader: /* glsl */ `attribute float alpha; attribute vec3 tint; varying float vAlpha; varying vec3 vTint;
    void main() { vAlpha = alpha; vTint = tint; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `varying float vAlpha; varying vec3 vTint; void main() { gl_FragColor = vec4(vTint, vAlpha); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});

export const ribbonMaterial = () => new THREE.ShaderMaterial({
  vertexShader: /* glsl */ `attribute float alpha; attribute vec3 tint; attribute float side; varying float vAlpha; varying vec3 vTint; varying float vSide;
    void main() { vAlpha = alpha; vTint = tint; vSide = side; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `varying float vAlpha; varying vec3 vTint; varying float vSide;
    void main() { float e = 1.0 - vSide * vSide; gl_FragColor = vec4(vTint * (0.8 + e * 0.5), vAlpha * smoothstep(0.0, 0.7, e)); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});

/** A colour along a gradient of stops ([position 0..1, colour]). */
export function gradient(stops: [number, THREE.Color][], t: number, out: THREE.Color) {
  if (t <= stops[0][0]) return out.copy(stops[0][1]);
  for (let i = 1; i < stops.length; i += 1) {
    if (t <= stops[i][0]) { const [p0, c0] = stops[i - 1]; const [p1, c1] = stops[i]; return out.copy(c0).lerp(c1, (t - p0) / (p1 - p0 || 1)); }
  }
  return out.copy(stops[stops.length - 1][1]);
}
