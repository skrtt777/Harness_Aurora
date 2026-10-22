import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { GPUComputationRenderer, type Variable } from "three/examples/jsm/misc/GPUComputationRenderer.js";
import { BlendFunction, Effect, EffectAttribute } from "postprocessing";
import { MEMORY_REACH, type SwarmPlan } from "./swarm";

/**
 * Memórias / Mapa Vivo — the swarm (scene "enxame"): the clouds as up to a million particles of matter, simulated
 * and lit on the graphics card, after Edan Kwan's Particle Love ("The Spirit", "Hyper Mix"):
 *   - simulation (GPGPU, one texel per particle): each particle belongs to a home (swarm.ts: a memory, around which
 *     it knots, or a section, whose body it fills); it rides a 4D curl-noise flow (3 octaves of simplex derivatives,
 *     time as the 4th axis: currents that bend slowly and never repeat), is drawn back home and is reborn there when
 *     its life ends, shrinking to nothing as it dies (no popping);
 *   - matter, not glow: every particle is a small lit sphere (opaque, depth-tested), with a key light, a rim and
 *     soft self-shadowing — a shadow map of the swarm seen from the light, so the clouds shade themselves and cast
 *     their shadow on the floor below the space;
 *   - motion blur: each frame a velocity buffer (where each particle was a frame ago, camera included) smears the
 *     image along the motion (an Effect in the composer);
 *   - real events only: a home's colour and energy come from the scene (section colour, the event's colour, a lit
 *     memory runs faster and glows); what the Zeladora reads pours into her body; what an answer really used flows
 *     into the Aurora's probe; waves push the matter; the cursor is a vortex that stirs it.
 */
export const SWARM_WAVES = 4;
export type SwarmDrive = {
  /** Per home: x, y, z, radius (memories first, then sections; padded to homeSide²). */
  home: Float32Array;
  /** Per home: r, g, b, energy 0..1. */
  state: Float32Array;
  /** Per home: pull to the probe, pull to the Zeladora, 0, 0. */
  pull: Float32Array;
  keeper: THREE.Vector4;
  probe: THREE.Vector4;
  /** The cursor in the space (x, y, z, strength) and the direction the camera looks. */
  hand: THREE.Vector4;
  view: THREE.Vector3;
  waves: THREE.Vector4[];
  waveAt: number[];
  /** World size of the whole space (forces and sizes scale with it). */
  R: number;
  /** Where the floor is (below every cloud). */
  floorY: number;
  motion: boolean;
  /** 0..1: how lit the whole field is (while the space fades in). */
  light: number;
};

export function makeDrive(plan: SwarmPlan, R: number): SwarmDrive {
  const n = plan.homeSide * plan.homeSide * 4;
  return {
    home: new Float32Array(n), state: new Float32Array(n), pull: new Float32Array(n),
    keeper: new THREE.Vector4(), probe: new THREE.Vector4(), hand: new THREE.Vector4(), view: new THREE.Vector3(0, 0, -1),
    waves: Array.from({ length: SWARM_WAVES }, () => new THREE.Vector4()), waveAt: new Array(SWARM_WAVES).fill(-99),
    R, floorY: -R, motion: true, light: 1,
  };
}

/** The light: from above, a little in front and to the right (shadows fall on the floor, below and behind). */
const LIGHT_DIR = new THREE.Vector3(0.35, 1, 0.45).normalize();
const SHADOW_SIZE = 2048;

// 4D simplex noise with analytic derivatives (Stefan Gustavson / Ian McEwan, MIT) and its curl, 3 octaves — the
// flow of "The Spirit".
const CURL = /* glsl */ `
vec4 mod289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
float mod289(float x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x * 34.0) + 1.0) * x); }
float permute(float x){ return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float taylorInvSqrt(float r){ return 1.79284291400159 - 0.85373472095314 * r; }
vec4 grad4(float j, vec4 ip){
  const vec4 ones = vec4(1.0, 1.0, 1.0, -1.0);
  vec4 p, s;
  p.xyz = floor(fract(vec3(j) * ip.xyz) * 7.0) * ip.z - 1.0;
  p.w = 1.5 - dot(abs(p.xyz), ones.xyz);
  s = vec4(lessThan(p, vec4(0.0)));
  p.xyz = p.xyz + (s.xyz * 2.0 - 1.0) * s.www;
  return p;
}
#define F4 0.309016994374947451
vec4 simplexNoiseDerivatives(vec4 v){
  const vec4 C = vec4(0.138196601125011, 0.276393202250021, 0.414589803375032, -0.447213595499958);
  vec4 i = floor(v + dot(v, vec4(F4)));
  vec4 x0 = v - i + dot(i, C.xxxx);
  vec4 i0;
  vec3 isX = step(x0.yzw, x0.xxx);
  vec3 isYZ = step(x0.zww, x0.yyz);
  i0.x = isX.x + isX.y + isX.z;
  i0.yzw = 1.0 - isX;
  i0.y += isYZ.x + isYZ.y;
  i0.zw += 1.0 - isYZ.xy;
  i0.z += isYZ.z;
  i0.w += 1.0 - isYZ.z;
  vec4 i3 = clamp(i0, 0.0, 1.0);
  vec4 i2 = clamp(i0 - 1.0, 0.0, 1.0);
  vec4 i1 = clamp(i0 - 2.0, 0.0, 1.0);
  vec4 x1 = x0 - i1 + C.xxxx;
  vec4 x2 = x0 - i2 + C.yyyy;
  vec4 x3 = x0 - i3 + C.zzzz;
  vec4 x4 = x0 + C.wwww;
  i = mod289(i);
  float j0 = permute(permute(permute(permute(i.w) + i.z) + i.y) + i.x);
  vec4 j1 = permute(permute(permute(permute(i.w + vec4(i1.w, i2.w, i3.w, 1.0)) + i.z + vec4(i1.z, i2.z, i3.z, 1.0)) + i.y + vec4(i1.y, i2.y, i3.y, 1.0)) + i.x + vec4(i1.x, i2.x, i3.x, 1.0));
  vec4 ip = vec4(1.0 / 294.0, 1.0 / 49.0, 1.0 / 7.0, 0.0);
  vec4 p0 = grad4(j0, ip);
  vec4 p1 = grad4(j1.x, ip);
  vec4 p2 = grad4(j1.y, ip);
  vec4 p3 = grad4(j1.z, ip);
  vec4 p4 = grad4(j1.w, ip);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  p4 *= taylorInvSqrt(dot(p4, p4));
  vec3 values0 = vec3(dot(p0, x0), dot(p1, x1), dot(p2, x2));
  vec2 values1 = vec2(dot(p3, x3), dot(p4, x4));
  vec3 m0 = max(0.5 - vec3(dot(x0, x0), dot(x1, x1), dot(x2, x2)), 0.0);
  vec2 m1 = max(0.5 - vec2(dot(x3, x3), dot(x4, x4)), 0.0);
  vec3 temp0 = -6.0 * m0 * m0 * values0;
  vec2 temp1 = -6.0 * m1 * m1 * values1;
  vec3 mmm0 = m0 * m0 * m0;
  vec2 mmm1 = m1 * m1 * m1;
  float dx = temp0[0] * x0.x + temp0[1] * x1.x + temp0[2] * x2.x + temp1[0] * x3.x + temp1[1] * x4.x + mmm0[0] * p0.x + mmm0[1] * p1.x + mmm0[2] * p2.x + mmm1[0] * p3.x + mmm1[1] * p4.x;
  float dy = temp0[0] * x0.y + temp0[1] * x1.y + temp0[2] * x2.y + temp1[0] * x3.y + temp1[1] * x4.y + mmm0[0] * p0.y + mmm0[1] * p1.y + mmm0[2] * p2.y + mmm1[0] * p3.y + mmm1[1] * p4.y;
  float dz = temp0[0] * x0.z + temp0[1] * x1.z + temp0[2] * x2.z + temp1[0] * x3.z + temp1[1] * x4.z + mmm0[0] * p0.z + mmm0[1] * p1.z + mmm0[2] * p2.z + mmm1[0] * p3.z + mmm1[1] * p4.z;
  float dw = temp0[0] * x0.w + temp0[1] * x1.w + temp0[2] * x2.w + temp1[0] * x3.w + temp1[1] * x4.w + mmm0[0] * p0.w + mmm0[1] * p1.w + mmm0[2] * p2.w + mmm1[0] * p3.w + mmm1[1] * p4.w;
  return vec4(dx, dy, dz, dw) * 49.0;
}
vec3 curl(in vec3 p, in float noiseTime, in float persistence){
  vec4 xN = vec4(0.0), yN = vec4(0.0), zN = vec4(0.0);
  for (int i = 0; i < 3; ++i) {
    float twoPowI = pow(2.0, float(i));
    float scale = 0.5 * twoPowI * pow(persistence, float(i));
    xN += simplexNoiseDerivatives(vec4(p * twoPowI, noiseTime)) * scale;
    yN += simplexNoiseDerivatives(vec4((p + vec3(123.4, 129845.6, -1239.1)) * twoPowI, noiseTime)) * scale;
    zN += simplexNoiseDerivatives(vec4((p + vec3(-9519.0, 9051.0, -123.0)) * twoPowI, noiseTime)) * scale;
  }
  return vec3(zN[1] - yN[2], xN[2] - zN[0], yN[0] - xN[1]);
}
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 randDir(vec2 s){ float z = hash(s) * 2.0 - 1.0; float a = hash(s + 17.3) * 6.2831853; float r = sqrt(1.0 - z * z); return vec3(r * cos(a), r * sin(a), z); }
`;

const SIMULATION = /* glsl */ `
uniform sampler2D tRef; uniform sampler2D tHome; uniform sampler2D tState; uniform sampler2D tPull;
uniform float uTime; uniform float uDt; uniform float uR; uniform float uIntro; uniform float uMemories; uniform float uHomeSide;
uniform vec4 uKeeper; uniform vec4 uProbe; uniform vec4 uHand; uniform vec3 uView;
uniform vec4 uWaves[${SWARM_WAVES}]; uniform float uWaveAt[${SWARM_WAVES}];
${CURL}
void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 pos = texture2D(texturePosition, uv);
  vec4 ref = texture2D(tRef, uv);
  vec4 home = texture2D(tHome, ref.xy);
  vec4 st = texture2D(tState, ref.xy);
  vec4 pl = texture2D(tPull, ref.xy);
  float k = uDt * 60.0;                       // per-frame steps at 60 fps
  float e = st.a;
  float hw = max(home.w, 1.0);
  float opening = 1.0 - smoothstep(0.0, 3.2, uIntro);
  vec3 p = pos.xyz;
  // Life 1 → 0 in a few seconds (faster on a lit memory: it visibly pours); nobody dies while the swarm opens.
  float life = pos.w - uDt * (0.22 + 0.3 * ref.z + 0.6 * e) * step(3.2, uIntro);
  float pk = pl.y * uKeeper.w * step(ref.z, 0.25 * pl.y);
  float pp = pl.x * uProbe.w * step(ref.z, 0.32 * pl.x);
  bool arrived = (pk > 0.001 && distance(p, uKeeper.xyz) < uR * 0.03) || (pp > 0.001 && distance(p, uProbe.xyz) < uR * 0.03);
  // A memory is a source (its particles are born at it, breathing, and curl around it as smoke, as from the
  // emitter of The Spirit, but held close: every knot sits on its memory's point and never melts into its
  // neighbours'); a section's particles (only in a view with no memory) are its body, drifting slowly.
  float hi = floor(ref.y * uHomeSide) * uHomeSide + floor(ref.x * uHomeSide);
  float knot = step(hi, uMemories - 0.5);
  bool lost = uIntro > 3.2 && pk + pp < 0.001 && distance(p, home.xyz) > mix(hw * 5.0 + uR * 0.3, hw * 2.2, knot);
  if (life <= 0.0 || arrived || lost) {
    float breathe = 1.0 + sin(uTime * 6.0 + ref.z * 6.28) * 0.25;
    float r = mix(0.1 + 0.55 * ref.w, 0.05 + 0.12 * ref.w * breathe, knot);
    p = home.xyz + randDir(uv + fract(uTime * 0.1373)) * hw * r;
    life = 0.55 + 0.45 * hash(uv * 3.1 + fract(uTime));
  } else {
    // The current: the curl of 4D noise (a knot's at its own size, so it swirls in place).
    float scale = mix(hw * 1.3, hw * 0.9, knot);
    vec3 c = curl(p / scale, uTime * 0.1 + ref.z * 0.04, 0.1 + (1.0 - life) * 0.15);
    c /= (1.0 + length(c) * 0.25);
    float speed = mix(hw * 0.004 + uR * 0.0003, hw * 0.007, knot);
    p += c * speed * (1.0 + 1.4 * e) * k;
    // Home: a soft pull inside its reach, a firm one beyond (the opening flies everything home).
    vec3 d = home.xyz - p; float dl = length(d);
    float reach = hw * mix(0.3 + 0.7 * ref.w, 0.25 + 0.45 * ref.w, knot);
    p += d * (mix(0.004, 0.002, knot) + mix(0.03, 0.07, knot) * smoothstep(reach, reach * 1.7, dl) + 0.05 * opening) * k;
    // Real events pull: into the Zeladora's body, into the Aurora's probe (spiralling around the view axis).
    if (pk > 0.001) { vec3 q = uKeeper.xyz - p; float ql = length(q); vec3 n = q / max(ql, 1e-3); p += (n * min(ql, uR * 0.011) + cross(n, uView) * uR * 0.002) * pk * k; }
    if (pp > 0.001) { vec3 q = uProbe.xyz - p; float ql = length(q); vec3 n = q / max(ql, 1e-3); p += (n * min(ql, uR * 0.013) + cross(n, uView) * uR * 0.003) * pp * k; }
    // The cursor: a vortex around the view axis that also pushes outwards.
    if (uHand.w > 0.001) {
      vec3 h = p - uHand.xyz; float hl = length(h); float hr = uR * 0.2;
      if (hl < hr) { float f = 1.0 - hl / hr; f *= f * uHand.w; vec3 n = h / max(hl, 1e-3); p += (cross(uView, n) * 1.6 + n * 0.8) * uR * 0.012 * f * k; }
    }
    // Waves: a shell growing through the space pushes the matter it crosses.
    for (int i = 0; i < ${SWARM_WAVES}; i++) {
      vec4 w = uWaves[i]; if (w.w <= 0.0) continue;
      float age = uTime - uWaveAt[i]; if (age < 0.0 || age > 2.6) continue;
      vec3 q = p - w.xyz; float ql = length(q);
      float band = uR * 0.08; float dd = abs(ql - age * uR * 0.75);
      if (dd < band) p += (q / max(ql, 1e-3)) * uR * 0.01 * w.w * (1.0 - dd / band) * (1.0 - age / 2.6) * k;
    }
  }
  gl_FragColor = vec4(p, life);
}
`;

// ---------------------------------------------------------------- drawing: lit spheres with self-shadowing
const SPHERE_VERTEX = /* glsl */ `
uniform sampler2D tPos; uniform sampler2D tRef; uniform sampler2D tState;
uniform float uSize; uniform float uScale; uniform mat4 uLightMatrix;
attribute vec2 sim;
varying vec3 vColor; varying float vEnergy; varying vec4 vShadow; varying float vLife;
void main(){
  vec4 pos = texture2D(tPos, sim);
  vec4 ref = texture2D(tRef, sim);
  vec4 st = texture2D(tState, ref.xy);
  vec4 mv = modelViewMatrix * vec4(pos.xyz, 1.0);
  gl_Position = projectionMatrix * mv;
  vLife = pos.w;
  // Two tones per home, as in The Spirit: the young particle bright, the old one deeper.
  vColor = mix(st.rgb * 0.62, min(vec3(1.0), st.rgb * 1.35 + 0.08), smoothstep(0.0, 0.8, pos.w));
  vEnergy = st.a;
  vShadow = uLightMatrix * vec4(pos.xyz, 1.0);
  float size = uSize * (0.55 + 0.9 * ref.z) * (1.0 + st.a * 0.6) * smoothstep(0.0, 0.2, pos.w);
  gl_PointSize = clamp(size * uScale / max(1.0, -mv.z), 0.0, 24.0);
}
`;
const SPHERE_FRAGMENT = /* glsl */ `
uniform sampler2D tShadow; uniform vec3 uLightView; uniform float uLight; uniform float uShadowTexel;
varying vec3 vColor; varying float vEnergy; varying vec4 vShadow; varying float vLife;
float shadowAt(vec4 sc){
  vec3 s = sc.xyz / sc.w * 0.5 + 0.5;
  if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) return 1.0;
  float lit = 0.0;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) {
    float d = texture2DLodEXT(tShadow, s.xy + vec2(float(x), float(y)) * uShadowTexel, 0.0).r;
    lit += step(s.z - 0.0025, d);
  }
  return lit / 9.0;
}
void main(){
  vec2 q = gl_PointCoord * 2.0 - 1.0; q.y = -q.y;
  float r2 = dot(q, q); if (r2 > 1.0) discard;
  vec3 n = vec3(q, sqrt(1.0 - r2));
  float sh = shadowAt(vShadow);
  float diff = max(dot(n, uLightView), 0.0);
  float wrap = max(dot(n, uLightView) * 0.5 + 0.5, 0.0);
  float spec = pow(max(dot(reflect(-uLightView, n), vec3(0.0, 0.0, 1.0)), 0.0), 24.0);
  float rim = pow(1.0 - n.z, 2.5);
  // Deep shadows (the matter shades itself, as in The Spirit), a little sky from above, a cool rim.
  float sky = 0.5 + 0.5 * n.y;
  vec3 c = vColor * (0.07 + 0.1 * sky + 0.12 * wrap * sh + 1.05 * diff * sh);
  c += vec3(1.0) * spec * 0.4 * sh + vColor * rim * 0.18;
  // A lit memory glows (above the bloom threshold).
  c += vColor * vEnergy * 1.1;
  gl_FragColor = vec4(c * uLight, 1.0);
}
`;
// Seen from the light: the depth of the nearest particle in every texel.
const DEPTH_VERTEX = /* glsl */ `
uniform sampler2D tPos; uniform sampler2D tRef; uniform float uSize; uniform float uPx;
attribute vec2 sim;
void main(){
  vec4 pos = texture2D(tPos, sim);
  vec4 ref = texture2D(tRef, sim);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos.xyz, 1.0);
  gl_PointSize = max(1.0, uSize * (0.55 + 0.9 * ref.z) * uPx * smoothstep(0.0, 0.2, pos.w));
}
`;
const DEPTH_FRAGMENT = /* glsl */ `
void main(){ vec2 q = gl_PointCoord * 2.0 - 1.0; if (dot(q, q) > 1.0) discard; gl_FragColor = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0); }
`;
// Where each particle moved on screen since the last frame (for the motion blur).
const MOTION_VERTEX = /* glsl */ `
uniform sampler2D tPos; uniform sampler2D tPrev; uniform sampler2D tRef; uniform float uSize; uniform float uScale;
uniform mat4 uPrevViewProjection;
attribute vec2 sim;
varying vec2 vMotion;
void main(){
  vec4 pos = texture2D(tPos, sim);
  vec4 prev = texture2D(tPrev, sim);
  vec4 ref = texture2D(tRef, sim);
  vec4 mv = modelViewMatrix * vec4(pos.xyz, 1.0);
  vec4 now = projectionMatrix * mv;
  vec4 was = uPrevViewProjection * vec4(prev.xyz, 1.0);
  // A particle reborn this frame did not travel there.
  vMotion = (now.xy / now.w - was.xy / was.w) * 0.5 * step(pos.w, prev.w);
  gl_Position = now;
  gl_PointSize = clamp(uSize * (0.55 + 0.9 * ref.z) * uScale / max(1.0, -mv.z) * smoothstep(0.0, 0.2, pos.w), 0.0, 24.0);
}
`;
const MOTION_FRAGMENT = /* glsl */ `
varying vec2 vMotion;
void main(){ vec2 q = gl_PointCoord * 2.0 - 1.0; if (dot(q, q) > 1.0) discard; gl_FragColor = vec4(vMotion, 0.0, 1.0); }
`;
// The floor: dark, catching the swarm's shadow, fading out at its edge.
const FLOOR_VERTEX = /* glsl */ `
uniform mat4 uLightMatrix; varying vec4 vShadow; varying vec2 vXZ;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vShadow = uLightMatrix * w; vXZ = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }
`;
const FLOOR_FRAGMENT = /* glsl */ `
uniform sampler2D tShadow; uniform float uShadowTexel; uniform float uExtent; uniform vec3 uColor; uniform float uLight;
varying vec4 vShadow; varying vec2 vXZ;
void main(){
  vec3 s = vShadow.xyz / vShadow.w * 0.5 + 0.5;
  float lit = 1.0;
  if (s.x > 0.0 && s.x < 1.0 && s.y > 0.0 && s.y < 1.0) {
    lit = 0.0;
    for (int x = -2; x <= 2; x++) for (int y = -2; y <= 2; y++) lit += step(s.z - 0.004, texture2DLodEXT(tShadow, s.xy + vec2(float(x), float(y)) * uShadowTexel * 2.0, 0.0).r);
    lit /= 25.0;
  }
  float edge = 1.0 - smoothstep(0.35, 1.0, length(vXZ) / uExtent);
  vec3 c = uColor * (0.35 + 0.65 * lit);
  gl_FragColor = vec4(c * uLight, edge * 0.9);
}
`;

// ---------------------------------------------------------------- the motion blur (an Effect for the composer)
const BLUR_FRAGMENT = /* glsl */ `
uniform sampler2D tMotion; uniform float uStrength;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
  // The motion here, or the strongest of its neighbours (so the smear runs past a particle's edge).
  vec2 m = texture2D(tMotion, uv).xy;
  vec2 o = texelSize * 3.0;
  vec2 m1 = texture2D(tMotion, uv + vec2(o.x, 0.0)).xy, m2 = texture2D(tMotion, uv - vec2(o.x, 0.0)).xy;
  vec2 m3 = texture2D(tMotion, uv + vec2(0.0, o.y)).xy, m4 = texture2D(tMotion, uv - vec2(0.0, o.y)).xy;
  if (dot(m1, m1) > dot(m, m)) m = m1; if (dot(m2, m2) > dot(m, m)) m = m2; if (dot(m3, m3) > dot(m, m)) m = m3; if (dot(m4, m4) > dot(m, m)) m = m4;
  m *= uStrength;
  float px = length(m / texelSize);
  m *= min(1.0, 48.0 / max(px, 1e-3)) * step(0.75, px);
  vec4 acc = inputColor;
  for (int i = 1; i <= 10; i++) acc += texture2DLodEXT(inputBuffer, uv - m * (float(i) / 10.0), 0.0);
  outputColor = acc / 11.0;
}
`;
export class SwarmBlurEffect extends Effect {
  constructor() {
    super("SwarmBlur", BLUR_FRAGMENT, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([["tMotion", new THREE.Uniform(null)], ["uStrength", new THREE.Uniform(0)]]),
    });
  }
}
let blur: SwarmBlurEffect | null = null;
/** The one motion blur of the swarm (the composer shows it; the swarm feeds it each frame). */
export function swarmBlur() { return (blur ||= new SwarmBlurEffect()); }

function floatTexture(data: Float32Array, side: number) {
  const t = new THREE.DataTexture(data, side, side, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}
const pointsOf = (n: number, side: number) => {
  const g = new THREE.BufferGeometry();
  const simUV = new Float32Array(n * 2);
  for (let i = 0; i < n; i += 1) { simUV[i * 2] = ((i % side) + 0.5) / side; simUV[i * 2 + 1] = (Math.floor(i / side) + 0.5) / side; }
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute("sim", new THREE.BufferAttribute(simUV, 2));
  return g;
};

export default function SwarmField({ plan, drive }: { plan: SwarmPlan; drive: SwarmDrive }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const sim = useMemo(() => {
    const side = plan.side;
    const gpu = new GPUComputationRenderer(side, side, gl);
    const pos0 = gpu.createTexture();
    const P = pos0.image.data as Float32Array;
    // The opening: every particle starts in a small sphere at the centre of the space and flies to its home (the big
    // bang of the memory). Without motion they start at home. Lives out of step, so no pulse later.
    for (let i = 0; i < plan.count; i += 1) {
      const zz = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - zz * zz);
      let cx = 0, cy = 0, cz = 0, d = Math.cbrt(Math.random()) * drive.R * 0.05;
      if (!drive.motion) {
        const u = plan.ref[i * 4], v = plan.ref[i * 4 + 1];
        const hi = Math.min(plan.homes - 1, Math.floor(v * plan.homeSide) * plan.homeSide + Math.floor(u * plan.homeSide));
        cx = drive.home[hi * 4]; cy = drive.home[hi * 4 + 1]; cz = drive.home[hi * 4 + 2];
        d = (drive.home[hi * 4 + 3] || MEMORY_REACH) * (0.15 + 0.85 * plan.ref[i * 4 + 3]);
      }
      P[i * 4] = cx + s * Math.cos(a) * d; P[i * 4 + 1] = cy + s * Math.sin(a) * d; P[i * 4 + 2] = cz + zz * d; P[i * 4 + 3] = 0.3 + 0.7 * Math.random();
    }
    const posVar: Variable = gpu.addVariable("texturePosition", SIMULATION, pos0);
    gpu.setVariableDependencies(posVar, [posVar]);
    const tRef = floatTexture(plan.ref, side);
    const tHome = floatTexture(drive.home, plan.homeSide), tState = floatTexture(drive.state, plan.homeSide), tPull = floatTexture(drive.pull, plan.homeSide);
    Object.assign(posVar.material.uniforms, {
      tRef: { value: tRef }, tHome: { value: tHome }, tState: { value: tState }, tPull: { value: tPull },
      uTime: { value: 0 }, uDt: { value: 0.016 }, uR: { value: drive.R }, uIntro: { value: drive.motion ? 0 : 10 },
      uMemories: { value: plan.memories }, uHomeSide: { value: plan.homeSide },
      uKeeper: { value: drive.keeper }, uProbe: { value: drive.probe }, uHand: { value: drive.hand }, uView: { value: drive.view },
      uWaves: { value: drive.waves }, uWaveAt: { value: drive.waveAt },
    });
    const error = gpu.init();
    if (error) console.warn("[enxame]", error);

    // The light's view (orthographic, over the whole space) and its depth map.
    const lightCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    const shadowRT = new THREE.WebGLRenderTarget(SHADOW_SIZE, SHADOW_SIZE, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
    const motionRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
    const lightMatrix = new THREE.Matrix4();
    // Particle size: about the same mass at every quality (fewer particles, bigger ones).
    const unit = drive.R * 0.0021 * Math.sqrt(1024 / side);

    const n = plan.count;
    const geo = pointsOf(n, side);
    const sphere = new THREE.ShaderMaterial({
      vertexShader: SPHERE_VERTEX, fragmentShader: SPHERE_FRAGMENT,
      uniforms: {
        tPos: { value: null }, tRef: { value: tRef }, tState: { value: tState }, tShadow: { value: shadowRT.texture },
        uSize: { value: unit }, uScale: { value: 1 }, uLightMatrix: { value: lightMatrix }, uLightView: { value: new THREE.Vector3() },
        uLight: { value: 1 }, uShadowTexel: { value: 1 / SHADOW_SIZE },
      },
    });
    const depth = new THREE.ShaderMaterial({ vertexShader: DEPTH_VERTEX, fragmentShader: DEPTH_FRAGMENT, uniforms: { tPos: { value: null }, tRef: { value: tRef }, uSize: { value: unit }, uPx: { value: 1 } } });
    const motion = new THREE.ShaderMaterial({ vertexShader: MOTION_VERTEX, fragmentShader: MOTION_FRAGMENT, uniforms: { tPos: { value: null }, tPrev: { value: null }, tRef: { value: tRef }, uSize: { value: unit }, uScale: { value: 1 }, uPrevViewProjection: { value: new THREE.Matrix4() } } });
    const swarmMesh = new THREE.Points(geo, sphere); swarmMesh.frustumCulled = false;
    const depthScene = new THREE.Scene(); const depthMesh = new THREE.Points(geo, depth); depthMesh.frustumCulled = false; depthScene.add(depthMesh);
    const motionScene = new THREE.Scene(); const motionMesh = new THREE.Points(geo, motion); motionMesh.frustumCulled = false; motionScene.add(motionMesh);
    const floorMat = new THREE.ShaderMaterial({
      vertexShader: FLOOR_VERTEX, fragmentShader: FLOOR_FRAGMENT, transparent: true, depthWrite: false,
      uniforms: { tShadow: { value: shadowRT.texture }, uShadowTexel: { value: 1 / SHADOW_SIZE }, uLightMatrix: { value: lightMatrix }, uExtent: { value: drive.R * 2.2 }, uColor: { value: new THREE.Color("#2c3038") }, uLight: { value: 1 } },
    });
    const floorGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    return { born: -1, gpu, posVar, tRef, tHome, tState, tPull, lightCam, shadowRT, motionRT, lightMatrix, geo, sphere, depth, motion, swarmMesh, depthScene, motionScene, floorMat, floorGeo, prevVP: new THREE.Matrix4(), hasPrev: false, error };
  }, [plan, gl]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    sim.gpu.dispose(); sim.tRef.dispose(); sim.tHome.dispose(); sim.tState.dispose(); sim.tPull.dispose();
    sim.shadowRT.dispose(); sim.motionRT.dispose(); sim.geo.dispose(); sim.sphere.dispose(); sim.depth.dispose(); sim.motion.dispose();
    sim.floorMat.dispose(); sim.floorGeo.dispose();
    const b = swarmBlur(); b.uniforms.get("uStrength")!.value = 0; b.uniforms.get("tMotion")!.value = null;
  }, [sim]);

  useFrame((state, delta) => {
    if (sim.error) return;
    sim.tHome.needsUpdate = true; sim.tState.needsUpdate = true; sim.tPull.needsUpdate = true;
    const R = drive.R;
    if (drive.motion) {
      const dt = Math.min(delta, 1 / 30);
      if (sim.born < 0) sim.born = state.clock.elapsedTime;
      const u = sim.posVar.material.uniforms;
      u.uTime.value = state.clock.elapsedTime; u.uDt.value = dt; u.uR.value = R; u.uIntro.value = state.clock.elapsedTime - sim.born;
      sim.gpu.compute();
    }
    const pos = sim.gpu.getCurrentRenderTarget(sim.posVar).texture;
    const prev = sim.gpu.getAlternateRenderTarget(sim.posVar).texture;

    // The light: an orthographic view over the whole space, from LIGHT_DIR.
    const lc = sim.lightCam;
    const ext = R * 1.25;
    lc.left = -ext; lc.right = ext; lc.top = ext; lc.bottom = -ext; lc.near = R * 0.2; lc.far = R * 5;
    lc.position.copy(LIGHT_DIR).multiplyScalar(R * 2.5); lc.lookAt(0, 0, 0); lc.updateProjectionMatrix(); lc.updateMatrixWorld();
    sim.lightMatrix.multiplyMatrices(lc.projectionMatrix, lc.matrixWorldInverse);
    sim.depth.uniforms.tPos.value = pos; sim.depth.uniforms.uPx.value = SHADOW_SIZE / (2 * ext);
    const old = gl.getRenderTarget();
    const oldClear = gl.getClearColor(new THREE.Color()).getHex(), oldAlpha = gl.getClearAlpha();
    gl.setRenderTarget(sim.shadowRT); gl.setClearColor(0xffffff, 1); gl.clear(); gl.render(sim.depthScene, lc);

    // The camera: sizes on screen and the light in its space.
    const cam = camera;
    const scale = (state.gl.getPixelRatio() * size.height) / (2 * Math.tan((cam.fov * Math.PI) / 360));
    sim.sphere.uniforms.tPos.value = pos; sim.sphere.uniforms.uScale.value = scale; sim.sphere.uniforms.uLight.value = drive.light;
    (sim.sphere.uniforms.uLightView.value as THREE.Vector3).copy(LIGHT_DIR).transformDirection(cam.matrixWorldInverse);

    // The velocity buffer, then the blur reads it.
    const buf = gl.getDrawingBufferSize(new THREE.Vector2());
    if (sim.motionRT.width !== buf.x || sim.motionRT.height !== buf.y) sim.motionRT.setSize(buf.x, buf.y);
    sim.motion.uniforms.tPos.value = pos; sim.motion.uniforms.tPrev.value = prev; sim.motion.uniforms.uScale.value = scale;
    (sim.motion.uniforms.uPrevViewProjection.value as THREE.Matrix4).copy(sim.hasPrev ? sim.prevVP : new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    gl.setRenderTarget(sim.motionRT); gl.setClearColor(0x000000, 0); gl.clear(); gl.render(sim.motionScene, cam);
    gl.setRenderTarget(old); gl.setClearColor(oldClear, oldAlpha);
    sim.prevVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); sim.hasPrev = true;
    const b = swarmBlur();
    b.uniforms.get("tMotion")!.value = sim.motionRT.texture;
    b.uniforms.get("uStrength")!.value = drive.motion ? 1.6 : 0;

    sim.floorMat.uniforms.uLight.value = drive.light; sim.floorMat.uniforms.uExtent.value = R * 2.2;
  });

  if (sim.error) return null;
  return (
    <>
      <primitive object={sim.swarmMesh} />
      <mesh geometry={sim.floorGeo} material={sim.floorMat} position={[0, drive.floorY, 0]} scale={[drive.R * 4.4, 1, drive.R * 4.4]} renderOrder={-1} />
    </>
  );
}
