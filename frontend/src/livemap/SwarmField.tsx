import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { GPUComputationRenderer, type Variable } from "three/examples/jsm/misc/GPUComputationRenderer.js";
import { MEMORY_REACH, type SwarmPlan } from "./swarm";

/**
 * Memórias / Mapa Vivo — the swarm (scene "enxame"): every cloud is up to a million particles living on the graphics
 * card (GPGPU: position and velocity in float textures, one texel per particle, simulated every frame).
 *   - each particle belongs to a home (swarm.ts): a memory, around which it knots, or a section, whose haze it fills;
 *     it drifts in a curl-noise flow (smoke that never repeats), a spring keeps it near home, and it is reborn there
 *     when its life ends;
 *   - a home's state comes from the scene each frame: its colour (grey; the section's colour while something happens
 *     there; the event's colour on a memory) and its energy (a lit memory's particles run faster and shine);
 *   - real events pull: the memories the Zeladora reads stream their particles into her body, the memories a question
 *     really used stream into the Aurora's probe, a wave (a search, a round, a tap, a node born) pushes them outwards;
 *   - the cursor is a vortex: particles near it swirl around and away, like stirring the smoke by hand.
 * The scene drives it through `drive` (written in its own frame, read here): nothing here invents an event.
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
  /** World size of the whole space (forces scale with it). */
  R: number;
  motion: boolean;
  /** 0..1: how lit the whole field is (dims while the camera waits for the space to fade in). */
  light: number;
};

export function makeDrive(plan: SwarmPlan, R: number): SwarmDrive {
  const n = plan.homeSide * plan.homeSide * 4;
  return {
    home: new Float32Array(n), state: new Float32Array(n), pull: new Float32Array(n),
    keeper: new THREE.Vector4(), probe: new THREE.Vector4(), hand: new THREE.Vector4(), view: new THREE.Vector3(0, 0, -1),
    waves: Array.from({ length: SWARM_WAVES }, () => new THREE.Vector4()), waveAt: new Array(SWARM_WAVES).fill(-99),
    R, motion: true, light: 1,
  };
}

// Simplex noise (Ashima / Ian McEwan, MIT) and its curl: a divergence-free flow, so the smoke swirls without clumping.
const NOISE = /* glsl */ `
vec4 permute(vec4 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0/7.0;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
vec3 snoise3(vec3 x){ return vec3(snoise(x), snoise(vec3(x.y - 19.1, x.z + 33.4, x.x + 47.2)), snoise(vec3(x.z + 74.2, x.x - 124.5, x.y + 99.4))); }
vec3 curl(vec3 p){
  const float e = 0.1;
  vec3 dx = vec3(e, 0.0, 0.0), dy = vec3(0.0, e, 0.0), dz = vec3(0.0, 0.0, e);
  vec3 px0 = snoise3(p - dx), px1 = snoise3(p + dx);
  vec3 py0 = snoise3(p - dy), py1 = snoise3(p + dy);
  vec3 pz0 = snoise3(p - dz), pz1 = snoise3(p + dz);
  float x = py1.z - py0.z - pz1.y + pz0.y;
  float y = pz1.x - pz0.x - px1.z + px0.z;
  float z = px1.y - px0.y - py1.x + py0.x;
  return normalize(vec3(x, y, z) / (2.0 * e) + 1e-5);
}
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 randDir(vec2 s){ float z = hash(s) * 2.0 - 1.0; float a = hash(s + 17.3) * 6.2831853; float r = sqrt(1.0 - z*z); return vec3(r*cos(a), r*sin(a), z); }
`;

const SIM_UNIFORMS = /* glsl */ `
uniform sampler2D tRef; uniform sampler2D tHome; uniform sampler2D tState; uniform sampler2D tPull;
uniform float uTime; uniform float uDt; uniform float uR; uniform float uIntro;
uniform vec4 uKeeper; uniform vec4 uProbe; uniform vec4 uHand; uniform vec3 uView;
uniform vec4 uWaves[${SWARM_WAVES}]; uniform float uWaveAt[${SWARM_WAVES}];
`;

const VELOCITY = /* glsl */ `
${SIM_UNIFORMS}
${NOISE}
void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 pos = texture2D(texturePosition, uv);
  vec3 v = texture2D(textureVelocity, uv).xyz;
  vec4 ref = texture2D(tRef, uv);
  vec4 home = texture2D(tHome, ref.xy);
  vec4 st = texture2D(tState, ref.xy);
  vec4 pl = texture2D(tPull, ref.xy);
  vec3 p = pos.xyz;
  float e = st.a;
  float S = uR;                                   // forces scale with the space
  // The flow: curl noise, finer and faster around a lit memory.
  // (scaled to the home: a memory's knot curls tight, a section's haze rolls slowly)
  float hw = max(home.w, 1.0);
  vec3 flow = curl(p * (1.1 / hw) + vec3(0.0, uTime * 0.06, 0.0));
  vec3 acc = flow * (hw * 1.1 + S * 0.02) * (1.0 + 1.6 * e);
  // A spring outside the particle's own distance from home.
  vec3 toHome = home.xyz - p; float d = length(toHome);
  float reach = home.w * (0.2 + 0.8 * ref.w);
  acc += (toHome / max(d, 1e-3)) * max(0.0, d - reach) * 0.7;
  // Pulled by real events: into the Zeladora's body, into the Aurora's probe (an arc: flow keeps it alive).
  float pk = pl.y * uKeeper.w, pp = pl.x * uProbe.w;
  if (pk > 0.001 && ref.z < 0.22 * pl.y) { vec3 q = uKeeper.xyz - p; acc += normalize(q) * S * 0.9 * pk + cross(normalize(q), uView) * S * 0.12 * pk; }
  if (pp > 0.001 && ref.z < 0.3 * pl.x) { vec3 q = uProbe.xyz - p; acc += normalize(q) * S * 1.1 * pp + cross(normalize(q), uView) * S * 0.18 * pp; }
  // The cursor: a vortex around the view axis, pushing outwards.
  if (uHand.w > 0.001) {
    vec3 h = p - uHand.xyz; float hl = length(h); float hr = S * 0.22;
    if (hl < hr) { float k = (1.0 - hl / hr); k *= k * uHand.w; vec3 n = h / max(hl, 1e-3); acc += (cross(uView, n) * 2.2 + n * 1.4) * S * k * 3.0; }
  }
  // Waves: a shell growing through the space pushes what it crosses.
  for (int i = 0; i < ${SWARM_WAVES}; i++) {
    vec4 w = uWaves[i]; if (w.w <= 0.0) continue;
    float age = uTime - uWaveAt[i]; if (age < 0.0 || age > 2.6) continue;
    vec3 q = p - w.xyz; float ql = length(q);
    float band = S * 0.08; float dd = abs(ql - age * S * 0.75);
    if (dd < band) acc += (q / max(ql, 1e-3)) * S * 6.0 * w.w * (1.0 - dd / band) * (1.0 - age / 2.6);
  }
  v = v * exp(-uDt * 2.2) + acc * uDt;
  float vmax = S * (0.45 + 0.6 * max(pk, pp)) * (uIntro < 3.2 ? 1.8 : 1.0);
  float vl = length(v); if (vl > vmax) v *= vmax / vl;
  gl_FragColor = vec4(v, 1.0);
}
`;

const POSITION = /* glsl */ `
${SIM_UNIFORMS}
${NOISE}
void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 pos = texture2D(texturePosition, uv);
  vec3 v = texture2D(textureVelocity, uv).xyz;
  vec4 ref = texture2D(tRef, uv);
  vec4 home = texture2D(tHome, ref.xy);
  vec4 st = texture2D(tState, ref.xy);
  vec4 pl = texture2D(tPull, ref.xy);
  vec3 p = pos.xyz + v * uDt;
  // Life runs 1 → 0; lit memories live faster (more particles reborn at them: they visibly pour).
  // (while the swarm opens, nobody dies: every particle flies from the centre to its home first)
  float life = pos.w - uDt * (0.12 + 0.25 * ref.z + 0.5 * st.a) * step(3.2, uIntro);
  // A pulled particle that arrived is reborn at home (a stream that keeps flowing).
  bool arrived = (pl.y * uKeeper.w > 0.001 && ref.z < 0.22 * pl.y && distance(p, uKeeper.xyz) < uR * 0.035) || (pl.x * uProbe.w > 0.001 && ref.z < 0.3 * pl.x && distance(p, uProbe.xyz) < uR * 0.035);
  // Far astray (a home moved away, a wave threw it): reborn too.
  bool lost = uIntro > 3.2 && distance(p, home.xyz) > home.w * 3.5 + uR * 0.25;
  if (life <= 0.0 || arrived || lost) {
    vec3 dir = randDir(uv + fract(uTime * 0.137));
    p = home.xyz + dir * home.w * (0.15 + 0.85 * ref.w);
    life = 0.6 + 0.4 * hash(uv * 3.1 + uTime);
  }
  gl_FragColor = vec4(p, life);
}
`;

// Drawing: each particle a soft dot (and, at high quality, a streak along its velocity: motion blur).
const DRAW_VERTEX = /* glsl */ `
uniform sampler2D tPos; uniform sampler2D tVel; uniform sampler2D tRef; uniform sampler2D tState;
uniform float uSize; uniform float uR; uniform float uStreak; uniform float uLight; uniform float uAlpha; uniform vec4 uKeeper; uniform vec4 uProbe;
attribute vec2 sim; attribute float tail;
varying vec3 vColor; varying float vAlpha;
void main(){
  vec4 pos = texture2D(tPos, sim);
  vec3 vel = texture2D(tVel, sim).xyz;
  vec4 ref = texture2D(tRef, sim);
  vec4 st = texture2D(tState, ref.xy);
  float speed = length(vel) / uR;
  vec3 p = pos.xyz - vel * uStreak * tail;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  // Colour: the home's, brighter with speed (a running particle is a hot one), a cool rim when idle.
  vec3 c = st.rgb;
  c = mix(c, vec3(1.0), clamp(speed * 0.8 + st.a * 0.2, 0.0, 0.45));
  vColor = c;
  float life = pos.w;
  float fade = smoothstep(0.0, 0.18, life) * smoothstep(1.0, 0.85, life);
  // Poured into her body or the probe: it vanishes as it arrives (no blinding pile at the attractor).
  fade *= mix(1.0, smoothstep(uR * 0.02, uR * 0.1, distance(pos.xyz, uKeeper.xyz)), step(0.001, uKeeper.w));
  fade *= mix(1.0, smoothstep(uR * 0.02, uR * 0.1, distance(pos.xyz, uProbe.xyz)), step(0.001, uProbe.w));
  vAlpha = uAlpha * fade * (0.6 + 0.7 * st.a + min(speed * 1.5, 0.9)) * uLight * (1.0 - tail);
  gl_PointSize = clamp(uSize * (1.0 + ref.z * 0.8 + st.a * 1.2) * (uR * 2.0 / max(1.0, -mv.z)), 1.0, 7.0);
}
`;
const DRAW_FRAGMENT = /* glsl */ `
varying vec3 vColor; varying float vAlpha; uniform float uPoints;
void main(){
  float a = vAlpha;
  if (uPoints > 0.5) { vec2 q = gl_PointCoord - 0.5; float d = dot(q, q) * 4.0; if (d > 1.0) discard; a *= exp(-d * 3.0); }
  gl_FragColor = vec4(vColor * a, a);
}
`;

function drawMaterial(points: boolean) {
  return new THREE.ShaderMaterial({
    vertexShader: DRAW_VERTEX, fragmentShader: DRAW_FRAGMENT, transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    uniforms: { tPos: { value: null }, tVel: { value: null }, tRef: { value: null }, tState: { value: null }, uSize: { value: 1.4 }, uR: { value: 1 }, uStreak: { value: 0.12 }, uLight: { value: 1 }, uAlpha: { value: 0.2 }, uKeeper: { value: new THREE.Vector4() }, uProbe: { value: new THREE.Vector4() }, uPoints: { value: points ? 1 : 0 } },
  });
}

function floatTexture(data: Float32Array, side: number) {
  const t = new THREE.DataTexture(data, side, side, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

export default function SwarmField({ plan, drive, streaks }: { plan: SwarmPlan; drive: SwarmDrive; streaks: boolean }) {
  const gl = useThree((s) => s.gl);
  const sim = useMemo(() => {
    const side = plan.side;
    const gpu = new GPUComputationRenderer(side, side, gl);
    const pos0 = gpu.createTexture(), vel0 = gpu.createTexture();
    const P = pos0.image.data as Float32Array;
    // The opening: every particle starts in a small sphere at the centre of the space and flies to its home (a
    // big bang of the memory). Without motion they start at home. Lives out of step, so no pulse later.
    for (let i = 0; i < plan.count; i += 1) {
      const zz = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - zz * zz);
      let cx = 0, cy = 0, cz = 0, d = Math.cbrt(Math.random()) * drive.R * 0.06;
      if (!drive.motion) {
        const u = plan.ref[i * 4], v = plan.ref[i * 4 + 1];
        const hi = Math.min(plan.homes - 1, Math.floor(v * plan.homeSide) * plan.homeSide + Math.floor(u * plan.homeSide));
        cx = drive.home[hi * 4]; cy = drive.home[hi * 4 + 1]; cz = drive.home[hi * 4 + 2];
        d = (drive.home[hi * 4 + 3] || MEMORY_REACH) * (0.15 + 0.85 * plan.ref[i * 4 + 3]);
      }
      P[i * 4] = cx + s * Math.cos(a) * d; P[i * 4 + 1] = cy + s * Math.sin(a) * d; P[i * 4 + 2] = cz + zz * d; P[i * 4 + 3] = 0.3 + 0.7 * Math.random();
    }
    const posVar: Variable = gpu.addVariable("texturePosition", POSITION, pos0);
    const velVar: Variable = gpu.addVariable("textureVelocity", VELOCITY, vel0);
    gpu.setVariableDependencies(posVar, [posVar, velVar]);
    gpu.setVariableDependencies(velVar, [posVar, velVar]);
    const tRef = floatTexture(plan.ref, side);
    const tHome = floatTexture(drive.home, plan.homeSide), tState = floatTexture(drive.state, plan.homeSide), tPull = floatTexture(drive.pull, plan.homeSide);
    const shared = {
      tRef: { value: tRef }, tHome: { value: tHome }, tState: { value: tState }, tPull: { value: tPull },
      uTime: { value: 0 }, uDt: { value: 0.016 }, uR: { value: drive.R }, uIntro: { value: 0 },
      uKeeper: { value: drive.keeper }, uProbe: { value: drive.probe }, uHand: { value: drive.hand }, uView: { value: drive.view },
      uWaves: { value: drive.waves }, uWaveAt: { value: drive.waveAt },
    };
    Object.assign(posVar.material.uniforms, shared);
    Object.assign(velVar.material.uniforms, shared);
    const error = gpu.init();
    if (error) console.warn("[enxame]", error);
    // The particles to draw: a dot each, and a streak (two ends) each.
    const n = plan.count;
    const simUV = new Float32Array(n * 2);
    for (let i = 0; i < n; i += 1) { simUV[i * 2] = ((i % side) + 0.5) / side; simUV[i * 2 + 1] = (Math.floor(i / side) + 0.5) / side; }
    const dots = new THREE.BufferGeometry();
    dots.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    dots.setAttribute("sim", new THREE.BufferAttribute(simUV, 2));
    dots.setAttribute("tail", new THREE.BufferAttribute(new Float32Array(n), 1));
    const lines = new THREE.BufferGeometry();
    const lUV = new Float32Array(n * 4), lTail = new Float32Array(n * 2);
    for (let i = 0; i < n; i += 1) { lUV[i * 4] = lUV[i * 4 + 2] = simUV[i * 2]; lUV[i * 4 + 1] = lUV[i * 4 + 3] = simUV[i * 2 + 1]; lTail[i * 2 + 1] = 1; }
    lines.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 6), 3));
    lines.setAttribute("sim", new THREE.BufferAttribute(lUV, 2));
    lines.setAttribute("tail", new THREE.BufferAttribute(lTail, 1));
    const dotMat = drawMaterial(true), lineMat = drawMaterial(false);
    for (const m of [dotMat, lineMat]) { m.uniforms.tRef.value = tRef; m.uniforms.tState.value = tState; m.uniforms.uR.value = drive.R; m.uniforms.uKeeper.value = drive.keeper; m.uniforms.uProbe.value = drive.probe; }
    // Fewer, brighter particles at low quality; a million faint ones at high.
    const alpha = side >= 1024 ? 0.036 : side >= 512 ? 0.09 : 0.22;
    dotMat.uniforms.uAlpha.value = alpha; lineMat.uniforms.uAlpha.value = alpha * 0.9;
    dotMat.uniforms.uSize.value = side >= 1024 ? 1.1 : side >= 512 ? 1.5 : 2.1;
    return { born: -1, gpu, posVar, velVar, tRef, tHome, tState, tPull, uniforms: [posVar.material.uniforms, velVar.material.uniforms], dots, lines, dotMat, lineMat, error };
  }, [plan, gl]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    sim.gpu.dispose(); sim.tRef.dispose(); sim.tHome.dispose(); sim.tState.dispose(); sim.tPull.dispose();
    sim.dots.dispose(); sim.lines.dispose(); sim.dotMat.dispose(); sim.lineMat.dispose();
  }, [sim]);

  useFrame((state, delta) => {
    if (sim.error) return;
    sim.tHome.needsUpdate = true; sim.tState.needsUpdate = true; sim.tPull.needsUpdate = true;
    if (drive.motion) {
      const dt = Math.min(delta, 1 / 30);
      if (sim.born < 0) sim.born = state.clock.elapsedTime;
      for (const u of sim.uniforms) { u.uTime.value = state.clock.elapsedTime; u.uDt.value = dt; u.uR.value = drive.R; u.uIntro.value = state.clock.elapsedTime - sim.born; }
      sim.gpu.compute();
    }
    const pos = sim.gpu.getCurrentRenderTarget(sim.posVar).texture, vel = sim.gpu.getCurrentRenderTarget(sim.velVar).texture;
    for (const m of [sim.dotMat, sim.lineMat]) { m.uniforms.tPos.value = pos; m.uniforms.tVel.value = vel; m.uniforms.uLight.value = drive.light; m.uniforms.uR.value = drive.R; }
  });

  if (sim.error) return null;
  return (
    <>
      {streaks && <lineSegments geometry={sim.lines} material={sim.lineMat} frustumCulled={false} />}
      <points geometry={sim.dots} material={sim.dotMat} frustumCulled={false} />
    </>
  );
}
