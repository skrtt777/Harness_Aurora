// The living sea's shaders: the deep water with moving caustics, the coral colonies (ribbons that sway, bend
// under the hand and ripple), the jellyfish's bell seen from above (a moon jelly: scalloped
// margin, radial canals, four horseshoe gonads), the memories as glowing organelles, the strands.
import * as THREE from "three";
import { REEF } from "./coral";

// The reef's constants as GLSL floats (the same numbers as coral.ts/reefDisplace).
const f = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);
const REEF_GLSL = { sway: f(REEF.sway), handR: f(REEF.handR), handPush: f(REEF.handPush), rippleWidth: f(REEF.rippleWidth), ripplePush: f(REEF.ripplePush) };

const NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
`;

const WORLD_VERTEX = /* glsl */ `
  varying vec2 vW; varying vec2 vUv;
  void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xy; gl_Position = projectionMatrix * viewMatrix * w; }`;

// ---------------------------------------------------------------- the deep water
export function seaMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: WORLD_VERTEX,
    fragmentShader: /* glsl */ `
      varying vec2 vW; uniform float uTime; uniform vec3 uHand;
      ${NOISE}
      void main() {
        vec2 p = vW * 0.0035;
        float c1 = fbm(p + vec2(uTime * 0.008, -uTime * 0.005));
        float k = fbm(p * 3.2 + c1 * 2.2 + vec2(uTime * 0.018, uTime * 0.011));
        float caustic = pow(1.0 - abs(k * 2.0 - 1.0), 7.0);
        float hand = uHand.z * exp(-dot(vW - uHand.xy, vW - uHand.xy) / 2200.0);
        vec3 deep = vec3(0.004, 0.014, 0.026);
        vec3 mid = vec3(0.010, 0.038, 0.056);
        float shaft = smoothstep(0.55, 1.0, fbm(vec2(vW.x * 0.0012 + uTime * 0.004, 0.5)));
        vec3 col = mix(deep, mid, smoothstep(0.3, 0.9, c1)) + vec3(0.03, 0.10, 0.12) * caustic * 0.16 + vec3(0.02, 0.06, 0.07) * shaft * 0.25 + vec3(0.05, 0.16, 0.18) * hand * 0.18;
        gl_FragColor = vec4(col, 1.0);
      }`,
    uniforms: { uTime: { value: 0 }, uHand: { value: new THREE.Vector3() } },
    depthWrite: false,
  });
}

// ---------------------------------------------------------------- the jellyfish's bell (from above)
export function bellMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: WORLD_VERTEX,
    fragmentShader: /* glsl */ `
      varying vec2 vUv; uniform float uTime, uGlow, uContract, uFlash; uniform vec3 uTint;
      void main() {
        vec2 p = vUv * 2.0 - 1.0; float r = length(p); float a = atan(p.y, p.x);
        float margin = 0.97 - 0.035 * (0.5 + 0.5 * cos(a * 16.0)) - uContract * 0.02 * (0.5 + 0.5 * cos(a * 8.0 + uTime));
        if (r > margin) discard;
        float rimBand = smoothstep(margin - 0.16, margin, r);
        float body = 0.07 + 0.22 * r * r;
        float canals = pow(abs(cos(a * 8.0)), 70.0) * smoothstep(0.22, 0.9, r) * 0.45 + pow(abs(cos(a * 8.0 + 0.19635)), 90.0) * smoothstep(0.55, 0.92, r) * 0.25;
        float ring = exp(-pow((r - (margin - 0.07)) * 38.0, 2.0)) * 0.7;
        float g = 0.0;
        for (int k = 0; k < 4; k++) {
          float ang = 0.785398 + float(k) * 1.570796;
          vec2 c = vec2(cos(ang), sin(ang)) * 0.33;
          vec2 q = p - c; float d = length(q);
          float open = smoothstep(-0.35, 0.55, dot(q / max(d, 0.0001), -normalize(c)));
          g += exp(-pow((d - 0.15) * 20.0, 2.0)) * open;
        }
        float glow = 0.85 + 0.15 * sin(uTime * 2.3);
        vec3 col = uTint * (body + rimBand * 0.95 + canals + ring) + vec3(0.96, 0.36, 0.56) * g * glow + vec3(1.0) * uFlash * (0.25 + rimBand * 0.5);
        float alpha = clamp(body * 0.95 + rimBand * 0.65 + canals + ring + g * 0.95 + uFlash * 0.3, 0.0, 1.0) * uGlow;
        gl_FragColor = vec4(col, alpha);
      }`,
    uniforms: { uTime: { value: 0 }, uGlow: { value: 1 }, uContract: { value: 0 }, uFlash: { value: 0 }, uTint: { value: new THREE.Color("#8fe8ff") } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

// ---------------------------------------------------------------- organelles (points) and strands (lines)
const POINT_VERTEX = /* glsl */ `
  attribute float size; attribute float alpha; attribute vec3 tint;
  uniform float minSize; uniform float pixelRatio;
  varying float vAlpha; varying vec3 vTint;
  void main() {
    vAlpha = alpha; vTint = tint;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(minSize * pixelRatio, size * (300.0 / -mv.z) * pixelRatio);
    gl_Position = projectionMatrix * mv;
  }`;
const POINT_FRAGMENT = /* glsl */ `
  varying float vAlpha; varying vec3 vTint;
  void main() {
    vec2 p = gl_PointCoord - 0.5; float d = length(p);
    if (d > 0.5) discard;
    float core = smoothstep(0.22, 0.0, d);
    float halo = exp(-d * d * 14.0);
    gl_FragColor = vec4(vTint * (0.6 + core * 0.8), vAlpha * (core * 0.9 + halo * 0.55));
  }`;
export const pointMaterial = (minSize: number) => new THREE.ShaderMaterial({ vertexShader: POINT_VERTEX, fragmentShader: POINT_FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { minSize: { value: minSize }, pixelRatio: { value: Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1) } } });
export const lineMaterial = () => new THREE.ShaderMaterial({
  vertexShader: /* glsl */ `attribute float alpha; attribute vec3 tint; varying float vAlpha; varying vec3 vTint;
    void main() { vAlpha = alpha; vTint = tint; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `varying float vAlpha; varying vec3 vTint; void main() { gl_FragColor = vec4(vTint, vAlpha); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});

/** A dynamic buffer of points or line vertices with position, alpha, tint (and size for points). */
export function dynamicGeometry(count: number, withSize: boolean) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute("alpha", new THREE.BufferAttribute(new Float32Array(count), 1));
  g.setAttribute("tint", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  if (withSize) g.setAttribute("size", new THREE.BufferAttribute(new Float32Array(count), 1));
  return g;
}

// ---------------------------------------------------------------- a coral colony (one section)
/**
 * The branches of a coral as ribbons (WebGL lines are one pixel wide): each segment a quad as wide as the
 * memories it carries. The vertex shader moves the reef in the water with the same formula as
 * coral.ts/reefDisplace (sway, hand, jellyfish, ripple), so the polyps (drawn as points) stay on the tips.
 * uBleach turns the colony pale (a section the Zeladora has not tended yet); its colour comes back as she does.
 */
export function coralGeometry(coral: { x: Float32Array; y: Float32Array; parent: Int32Array; depth: Float32Array; width: Float32Array; phase: Float32Array; count: number; tips: Map<string, number> }) {
  const segs = coral.count - 1;
  const pos = new Float32Array(segs * 4 * 3), dir = new Float32Array(segs * 4 * 2), side = new Float32Array(segs * 4), width = new Float32Array(segs * 4), depth = new Float32Array(segs * 4), phase = new Float32Array(segs * 4), tip = new Float32Array(segs * 4);
  const index: number[] = [];
  const isTip = new Uint8Array(coral.count);
  for (const t of coral.tips.values()) isTip[t] = 1;
  let v = 0;
  for (let i = 1; i < coral.count; i += 1) {
    const p = coral.parent[i]; if (p < 0) continue;
    let dx = coral.x[i] - coral.x[p], dy = coral.y[i] - coral.y[p]; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    const ends = [p, p, i, i]; const sides = [-1, 1, -1, 1];
    for (let k = 0; k < 4; k += 1) {
      const n = ends[k];
      pos.set([coral.x[n], coral.y[n], -1], (v + k) * 3); dir.set([dx, dy], (v + k) * 2);
      side[v + k] = sides[k]; width[v + k] = coral.width[n] * (isTip[n] ? 0.6 : 1); depth[v + k] = coral.depth[n]; phase[v + k] = coral.phase[n]; tip[v + k] = isTip[n];
    }
    index.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
    v += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aDir", new THREE.BufferAttribute(dir, 2));
  g.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
  g.setAttribute("aWidth", new THREE.BufferAttribute(width, 1));
  g.setAttribute("aDepth", new THREE.BufferAttribute(depth, 1));
  g.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
  g.setAttribute("aTip", new THREE.BufferAttribute(tip, 1));
  g.setIndex(index);
  return g;
}
export function coralMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute vec2 aDir; attribute float aSide; attribute float aWidth; attribute float aDepth; attribute float aPhase; attribute float aTip;
      uniform float uTime; uniform vec3 uHand; uniform vec3 uJelly; uniform vec4 uRipple; uniform float uGrow;
      varying float vSide; varying float vDepth; varying float vTip;
      vec2 push(vec2 p, vec2 at, float s, float r, float d2) {
        vec2 h = p - at; float d = length(h);
        if (d > 0.01 && d < r) { float k = s * pow(1.0 - d / r, 2.0) * ${REEF_GLSL.handPush} * d2; return h / d * k; }
        return vec2(0.0);
      }
      void main() {
        vec2 p = position.xy;
        float d2 = aDepth * aDepth;
        vec2 disp = vec2(sin(uTime * 0.8 + aPhase * 6.2831), cos(uTime * 0.7 + aPhase * 6.2831)) * d2 * ${REEF_GLSL.sway};
        disp += push(p, uHand.xy, uHand.z, ${REEF_GLSL.handR}, d2);
        if (uJelly.z > 0.0) disp += push(p, uJelly.xy, 0.8, uJelly.z * 2.2, d2);
        if (uRipple.w > 0.0) { vec2 rv = p - uRipple.xy; float rd = max(length(rv), 0.0001); float ring = abs(rd - uRipple.z);
          disp += rv / rd * uRipple.w * exp(-ring * ring / ${REEF_GLSL.rippleWidth}) * ${REEF_GLSL.ripplePush} * aDepth; }
        // A new branch grows out from the base (uGrow 0 → 1 when the colony appears).
        float shown = clamp((uGrow - aDepth * 0.85) * 6.0, 0.0, 1.0);
        vec2 n = vec2(-aDir.y, aDir.x);
        p += disp + n * aSide * aWidth * 0.5 * shown;
        vSide = aSide; vDepth = aDepth; vTip = aTip * shown;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, position.z, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vSide; varying float vDepth; varying float vTip;
      uniform vec3 uColor; uniform float uBleach, uAlpha, uPulse, uTime;
      void main() {
        float edge = 1.0 - abs(vSide);
        float soft = smoothstep(0.0, 0.7, edge);
        float core = smoothstep(0.6, 1.0, edge);
        vec3 living = mix(uColor * 0.28, uColor * 1.05 + 0.12, smoothstep(0.0, 1.0, vDepth));
        vec3 bleached = vec3(0.80, 0.84, 0.88) * (0.30 + 0.35 * vDepth);
        vec3 col = mix(living, bleached, uBleach) + vec3(0.6, 1.0, 0.95) * uPulse * (0.3 + vDepth);
        float alpha = soft * (0.42 + 0.45 * vDepth + core * 0.3 + vTip * 0.25) * uAlpha;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(col, alpha);
      }`,
    uniforms: { uTime: { value: 0 }, uHand: { value: new THREE.Vector3() }, uJelly: { value: new THREE.Vector3() }, uRipple: { value: new THREE.Vector4() }, uGrow: { value: 1 },
      uColor: { value: new THREE.Color() }, uBleach: { value: 0 }, uAlpha: { value: 1 }, uPulse: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}
