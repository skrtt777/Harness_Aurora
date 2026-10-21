// The living sea's shaders: the deep water with moving caustics, the cells' membranes (metaballs that breathe,
// dent under the hand and bulge with a ripple), the jellyfish's bell seen from above (a moon jelly: scalloped
// margin, radial canals, four horseshoe gonads), the memories as glowing organelles, the strands.
import * as THREE from "three";

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

// ---------------------------------------------------------------- a cell's membrane
export const MEMBRANE_POINTS = 48;
export function membraneMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: WORLD_VERTEX,
    fragmentShader: /* glsl */ `
      varying vec2 vW;
      uniform vec4 uPts[${MEMBRANE_POINTS}]; uniform int uCount;
      uniform vec3 uColor; uniform float uTime, uAlpha, uPulse, uFill, uSeed, uQueued;
      uniform vec3 uHand; uniform vec3 uJelly; uniform vec4 uRipple;
      ${NOISE}
      void main() {
        float f = 0.0;
        for (int i = 0; i < ${MEMBRANE_POINTS}; i++) {
          if (i >= uCount) break;
          vec2 d = vW - uPts[i].xy; float r = uPts[i].z;
          f += exp(-dot(d, d) / (r * r));
        }
        // It breathes, and its edge is never a perfect curve.
        f *= 1.0 + 0.07 * sin(uTime * 0.8 + uSeed * 6.28) + 0.22 * (noise(vW * 0.035 + vec2(uTime * 0.12, uSeed * 9.0)) - 0.5);
        // The hand dents it, the jellyfish pushes through it, a ripple makes it bulge as it passes.
        vec2 h = vW - uHand.xy; f -= uHand.z * 0.55 * exp(-dot(h, h) / 260.0);
        vec2 j = vW - uJelly.xy; f -= 0.35 * exp(-dot(j, j) / max(1.0, uJelly.z * uJelly.z));
        float rr = abs(length(vW - uRipple.xy) - uRipple.z); f += uRipple.w * 0.35 * exp(-rr * rr / 60.0);
        float edge = f - 0.42;
        float rim = exp(-abs(edge) * 30.0);
        float halo = exp(-abs(edge) * 7.0) * 0.30;
        float inside = smoothstep(0.0, 0.35, edge);
        float cyto = fbm(vW * 0.045 + vec2(uTime * 0.025, -uTime * 0.018) + uSeed * 4.0);
        vec3 color = mix(uColor, vec3(0.55, 0.62, 0.70), uQueued * 0.75);
        vec3 col = color * (rim * 1.25 + halo) + color * inside * (0.22 + cyto * 0.45 + uFill * 0.25) + vec3(0.7, 1.0, 0.95) * uPulse * (rim * 0.8 + inside * 0.18);
        float alpha = (rim * 0.85 + halo * 0.55 + inside * (0.05 + cyto * 0.07 + uFill * 0.04) + uPulse * (rim * 0.5 + inside * 0.1)) * uAlpha * (1.0 - uQueued * 0.55);
        if (alpha < 0.003) discard;
        gl_FragColor = vec4(col, alpha);
      }`,
    uniforms: {
      uPts: { value: Array.from({ length: MEMBRANE_POINTS }, () => new THREE.Vector4()) }, uCount: { value: 0 },
      uColor: { value: new THREE.Color() }, uTime: { value: 0 }, uAlpha: { value: 1 }, uPulse: { value: 0 }, uFill: { value: 0 }, uSeed: { value: 0 }, uQueued: { value: 0 },
      uHand: { value: new THREE.Vector3() }, uJelly: { value: new THREE.Vector3() }, uRipple: { value: new THREE.Vector4() },
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
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
