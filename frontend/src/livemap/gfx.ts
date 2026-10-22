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
 * clamped), with a hot core and a soft halo. A negative size draws a small hollow square instead (a memory
 * still in review, like the reference's square marks).
 */
export const pointMaterial = () => new THREE.ShaderMaterial({
  vertexShader: /* glsl */ `
    attribute float size; attribute float alpha; attribute vec3 tint;
    uniform float uRef; uniform float pixelRatio;
    varying float vAlpha; varying vec3 vTint; varying float vSquare;
    void main() {
      vAlpha = alpha; vTint = tint; vSquare = size < 0.0 ? 1.0 : 0.0;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float zoom = clamp(uRef / -mv.z, 0.7, 3.2);
      gl_PointSize = max(1.5, abs(size) * zoom) * pixelRatio;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    varying float vAlpha; varying vec3 vTint; varying float vSquare;
    void main() {
      vec2 p = gl_PointCoord - 0.5;
      if (vSquare > 0.5) {
        float m = max(abs(p.x), abs(p.y));
        float ring = smoothstep(0.5, 0.42, m) * smoothstep(0.22, 0.3, m);
        if (ring < 0.01) discard;
        gl_FragColor = vec4(vTint, vAlpha * ring);
        return;
      }
      float d = length(p);
      if (d > 0.5) discard;
      float core = smoothstep(0.2, 0.0, d);
      float halo = exp(-d * d * 16.0);
      gl_FragColor = vec4(vTint * (0.7 + core * 0.7), vAlpha * (core * 0.85 + halo * 0.5));
    }`,
  uniforms: { uRef: { value: 800 }, pixelRatio: { value: Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1) } },
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});

/** How many clouds the field's shaders know by colour (more clouds share colours). */
export const FIELD_CLOUDS = 48;
export const FIELD_WAVES = 4;
/**
 * The field's grain (clouds.ts buildField): static buffers on the GPU, animated only through uniforms — each
 * cloud's colour, heat (0 grey, 1 in its colour) and light, the cursor's lens, a few expanding waves, a slow
 * drift of every grain. So tens of thousands of particles and fibres cost nothing per frame on the CPU.
 */
const FIELD_VERTEX = (points: boolean) => /* glsl */ `
  attribute float cloud; attribute float seed; attribute float alpha;
  uniform vec3 uColor[${FIELD_CLOUDS}]; uniform float uHeat[${FIELD_CLOUDS}]; uniform float uLight[${FIELD_CLOUDS}];
  uniform float uTime; uniform float uMotion; uniform float uDrift; uniform vec3 uHand; uniform float uLensR;
  uniform vec4 uWaves[${FIELD_WAVES}]; uniform float uWaveSpeed; uniform float uWaveBand; uniform float uRef; uniform float pixelRatio;
  varying float vAlpha; varying vec3 vTint;
  void main() {
    int ci = int(cloud + 0.5);
    float heat = uHeat[ci]; float light = uLight[ci];
    vec3 p = position;
    if (uMotion > 0.5) {
      p.x += sin(uTime * (0.25 + seed * 0.6) + seed * 40.0) * uDrift;
      p.y += cos(uTime * (0.2 + seed * 0.5) + seed * 17.0) * uDrift;
    }
    float dh = distance(p.xy, uHand.xy);
    float lens = uHand.z * pow(max(0.0, 1.0 - dh / uLensR), 2.0);
    float wv = 0.0;
    for (int i = 0; i < ${FIELD_WAVES}; i++) {
      vec4 w = uWaves[i];
      if (w.w > 0.0) {
        float age = uTime - w.z;
        float d = abs(distance(p.xy, w.xy) - age * uWaveSpeed);
        wv = max(wv, w.w * max(0.0, 1.0 - d / uWaveBand) * max(0.0, 1.0 - age / 2.6));
      }
    }
    float twinkle = uMotion > 0.5 ? 0.72 + 0.28 * sin(uTime * (0.5 + seed * 2.0) + seed * 60.0) : 0.86;
    vec3 grey = vec3(0.56, 0.6, 0.67);
    vTint = mix(mix(grey, uColor[ci], heat), vec3(1.0), clamp(wv * 0.55 + lens * 0.35, 0.0, 1.0));
    vAlpha = alpha * light * (0.6 + 0.85 * heat) * twinkle + lens * 0.45 + wv * 0.7;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    ${points ? "float zoom = clamp(uRef / -mv.z, 0.7, 2.6); gl_PointSize = (1.25 + heat * 0.55 + wv * 1.6 + lens * 0.8) * zoom * pixelRatio;" : ""}
    gl_Position = projectionMatrix * mv;
  }`;
export const fieldMaterial = (points: boolean) => new THREE.ShaderMaterial({
  vertexShader: FIELD_VERTEX(points),
  fragmentShader: points
    ? /* glsl */ `varying float vAlpha; varying vec3 vTint; void main() { vec2 p = gl_PointCoord - 0.5; float d = length(p); if (d > 0.5) discard; gl_FragColor = vec4(vTint, vAlpha * smoothstep(0.5, 0.1, d)); }`
    : /* glsl */ `varying float vAlpha; varying vec3 vTint; void main() { gl_FragColor = vec4(vTint, vAlpha); }`,
  uniforms: {
    uColor: { value: Array.from({ length: FIELD_CLOUDS }, () => new THREE.Color("#9aa4b4")) },
    uHeat: { value: new Array(FIELD_CLOUDS).fill(0) },
    uLight: { value: new Array(FIELD_CLOUDS).fill(1) },
    uTime: { value: 0 }, uMotion: { value: 1 }, uDrift: { value: 1.2 }, uHand: { value: new THREE.Vector3() }, uLensR: { value: 60 },
    uWaves: { value: Array.from({ length: FIELD_WAVES }, () => new THREE.Vector4(0, 0, 0, 0)) }, uWaveSpeed: { value: 400 }, uWaveBand: { value: 40 },
    uRef: { value: 800 }, pixelRatio: { value: Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1) },
  },
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});

/** A static geometry for the field's grain (points or fibre vertices). */
export function fieldGeometry(part: { pos: Float32Array; cloud: Float32Array; seed: Float32Array; alpha: Float32Array; count: number }) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(part.count ? part.pos : new Float32Array(3), 3));
  g.setAttribute("cloud", new THREE.BufferAttribute(part.count ? part.cloud : new Float32Array(1), 1));
  g.setAttribute("seed", new THREE.BufferAttribute(part.count ? part.seed : new Float32Array(1), 1));
  g.setAttribute("alpha", new THREE.BufferAttribute(part.count ? part.alpha : new Float32Array(1), 1));
  g.setDrawRange(0, part.count);
  return g;
}

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
