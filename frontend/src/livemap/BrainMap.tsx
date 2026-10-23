import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ACTIVITY_COLOR, edgesOf, reviewOf, type MemoryGraph } from "./adapter";
import { cloudColor } from "./clouds";
import { hash01 } from "./layout";
import type { AtlasLayout } from "./atlas";
import type { Highlight, MapProps } from "./types";

/**
 * Memórias / Mapa Vivo — the memory as a living brain in 3D (WebGL + bloom):
 *   - each memory is a neuron (a glowing point in its section's colour; bigger when more relevant, a white core
 *     when proven); each section (a node of the Zeladora) is a lobe with its own colour haze and its name;
 *   - each real connection is a fibre, with faint signals always running along it; when a memory is touched
 *     (a search, a question that recalls it, the Zeladora reading it) it flares and fires impulses to its
 *     neighbours;
 *   - a question to the Aurora is an orange core whose beams reach every memory it weighed;
 *   - the Zeladora is a pale comet going from memory to memory, its trail behind;
 *   - drag to turn, wheel to come closer, click a memory, double-click to go into its section; idle, it turns
 *     slowly by itself.
 * Where everything sits comes from the atlas (atlas.ts: the meaning of each memory), lifted into depth per
 * section. Nothing is invented: every point is a stored memory, every line a real connection or event.
 */
const KEEPER = "#d6ecff", PROBE = "#ff9d5c", SELECT = "#ff7aa8";
const HL: Record<Highlight["kind"], string> = { recalled: PROBE, created: ACTIVITY_COLOR, search: "#9cc8ff", read: KEEPER, linked: KEEPER, flagged: "#f2d14b", joined: "#ffffff" };
const ACTIVE_MS = 9000;
const POOL = 1400;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

type World = {
  ids: string[]; index: Map<string, number>; pos: Float32Array; cloud: Int32Array;
  centers: THREE.Vector3[]; radii: number[]; scale: number; radius: number;
  /** An atlas point (a camera command's target) in this space. */
  fromAtlas: (x: number, y: number) => THREE.Vector3;
};

/** Lifts the atlas into depth: each section at its own height (a dome of lobes), its memories around it. */
function buildWorld(L: AtlasLayout): World {
  const ids = [...L.nodes.keys()];
  let span = 1;
  for (const p of L.nodes.values()) span = Math.max(span, Math.abs(p[0]), Math.abs(p[1]));
  const scale = 110 / span, R = 120;
  const cz = L.clouds.map((c) => {
    const X = c.x * scale, Y = c.y * scale;
    const dome = Math.sqrt(Math.max(0, R * R - X * X - Y * Y));
    return (hash01(c.id, 7) > 0.5 ? 1 : -1) * dome * (0.25 + 0.4 * hash01(c.id, 9));
  });
  const centers = L.clouds.map((c, i) => new THREE.Vector3(c.x * scale, -c.y * scale, cz[i]));
  const radii = L.clouds.map((c) => Math.max(8, c.r * scale));
  const pos = new Float32Array(ids.length * 3), cloud = new Int32Array(ids.length);
  const index = new Map<string, number>();
  ids.forEach((id, i) => {
    const p = L.nodes.get(id)!, ci = L.cloudOf.get(id) ?? 0;
    index.set(id, i); cloud[i] = ci;
    // A gaussian depth inside its lobe (Box–Muller from two stable hashes).
    const g = Math.sqrt(-2 * Math.log(1e-6 + hash01(id, 3))) * Math.cos(2 * Math.PI * hash01(id, 5));
    pos[i * 3] = p[0] * scale; pos[i * 3 + 1] = -p[1] * scale; pos[i * 3 + 2] = (cz[ci] ?? 0) + g * radii[ci] * 0.38;
  });
  let radius = 40;
  for (let i = 0; i < ids.length; i += 1) radius = Math.max(radius, Math.hypot(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
  const fromAtlas = (x: number, y: number) => {
    let best = -1, bd = Infinity;
    L.clouds.forEach((c, i) => { const d = Math.hypot(c.x - x, c.y - y) / c.r; if (d < bd) { bd = d; best = i; } });
    return new THREE.Vector3(x * scale, -y * scale, best >= 0 && bd < 1.3 ? cz[best] : 0);
  };
  return { ids, index, pos, cloud, centers, radii, scale, radius, fromAtlas };
}

// ---------- shaders ----------
const NODE_VS = /* glsl */ `
  attribute float aSize; attribute vec3 aColor; attribute float aGlow; attribute float aPhase; attribute float aDim; attribute float aCore;
  uniform float uTime; uniform float uPx; uniform float uMotion; uniform float uFar;
  varying vec3 vColor; varying float vGlow; varying float vDim; varying float vCore;
  void main() {
    vec3 p = position + vec3(sin(uTime * 0.6 + aPhase), cos(uTime * 0.5 + aPhase * 1.3), sin(uTime * 0.4 + aPhase * 0.7)) * 0.6 * uMotion;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float tw = 1.0 + 0.18 * sin(uTime * 2.2 + aPhase * 6.0) * uMotion;
    gl_PointSize = clamp(aSize * (1.0 + aGlow * 1.8) * tw * uPx / -mv.z, 1.5, 180.0);
    vColor = aColor; vGlow = aGlow; vCore = aCore;
    vDim = aDim * clamp(1.5 - (-mv.z) / uFar, 0.3, 1.0);
  }`;
const NODE_FS = /* glsl */ `
  varying vec3 vColor; varying float vGlow; varying float vDim; varying float vCore;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float core = smoothstep(0.32, 0.0, d);
    float halo = pow(1.0 - d, 2.6) * 0.6;
    vec3 c = vColor * (halo + core * 0.9) + vec3(1.0) * core * (0.25 + 0.5 * vCore + vGlow * 1.2);
    gl_FragColor = vec4(c * vDim, 1.0);
  }`;
/** Signals along fibres: looping (ambient) or once (an impulse fired at uTime = aT0, lasting aDur). */
const FLOW_VS = (loop: boolean) => /* glsl */ `
  attribute vec3 aB; attribute vec3 aColor; attribute float aT0; attribute float aDur; attribute float aSize;
  uniform float uTime; uniform float uPx; uniform float uFar;
  varying vec3 vColor; varying float vA;
  void main() {
    float t = ${loop ? "fract(uTime / aDur + aT0)" : "(uTime - aT0) / aDur"};
    if (t < 0.0 || t > 1.0 || aSize <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
    float e = ${loop ? "t" : "t * t * (3.0 - 2.0 * t)"};
    vec3 d = aB - position;
    vec3 side = normalize(cross(d, vec3(0.31, 0.22, 0.93)) + 1e-5);
    vec3 p = mix(position, aB, e) + side * sin(3.14159 * e) * length(d) * ${loop ? "0.0" : "0.1"};
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float f = sin(3.14159 * t);
    gl_PointSize = clamp(aSize * (0.5 + 0.5 * f) * uPx / -mv.z, 1.0, 60.0);
    vColor = aColor; vA = f * clamp(1.5 - (-mv.z) / uFar, 0.3, 1.0);
  }`;
const FLOW_FS = /* glsl */ `
  varying vec3 vColor; varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float a = pow(1.0 - d, 2.0);
    gl_FragColor = vec4((vColor * a + vec3(1.0) * smoothstep(0.4, 0.0, d) * 0.6) * vA, 1.0);
  }`;

function glowTexture(): THREE.Texture {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d")!, grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.18, "rgba(255,255,255,0.55)"); grd.addColorStop(0.5, "rgba(255,255,255,0.12)"); grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } as const;

type Fly = { p0: THREE.Vector3; t0v: THREE.Vector3; p1: THREE.Vector3; t1v: THREE.Vector3; at: number; ms: number };
type Engine = {
  setWorld: (L: AtlasLayout, graph: MemoryGraph) => void;
  dispose: () => void;
};

export default function BrainMap(props: MapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const live = useRef(props); live.current = props;
  const engine = useRef<Engine | null>(null);

  useEffect(() => {
    const host = hostRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x020308, 1);
    renderer.domElement.className = "lm-brain-canvas";
    host.appendChild(renderer.domElement);
    const labels = document.createElement("div"); labels.className = "lm-brain-labels"; host.appendChild(labels);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 1, 5000);
    camera.position.set(0, 40, 330);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.07; controls.rotateSpeed = 0.6; controls.zoomSpeed = 0.9;
    controls.minDistance = 8; controls.maxDistance = 1400; controls.autoRotateSpeed = 0.35;
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(800, 500), 1.25, 0.65, 0.04);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    const tex = glowTexture();
    const t0 = performance.now();
    const uniforms = { uTime: { value: 0 }, uPx: { value: 600 }, uMotion: { value: 1 }, uFar: { value: 600 } };

    // ---------- the far dust: a slow starfield behind everything ----------
    {
      const n = 2600, p = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), ph = new Float32Array(n), dim = new Float32Array(n), z = new Float32Array(n);
      for (let i = 0; i < n; i += 1) {
        const u = hash01(`d${i}`, 1) * 2 - 1, th = hash01(`d${i}`, 2) * Math.PI * 2, r = 420 + hash01(`d${i}`, 4) * 900;
        const s = Math.sqrt(1 - u * u);
        p[i * 3] = r * s * Math.cos(th); p[i * 3 + 1] = r * u; p[i * 3 + 2] = r * s * Math.sin(th);
        const c = new THREE.Color().setHSL(0.55 + hash01(`d${i}`, 6) * 0.2, 0.6, 0.7);
        col.set([c.r, c.g, c.b], i * 3); size[i] = 2 + hash01(`d${i}`, 8) * 4; ph[i] = hash01(`d${i}`, 10) * 6.28; dim[i] = 0.25 + hash01(`d${i}`, 12) * 0.35;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(p, 3)); g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
      g.setAttribute("aSize", new THREE.BufferAttribute(size, 1)); g.setAttribute("aPhase", new THREE.BufferAttribute(ph, 1));
      g.setAttribute("aGlow", new THREE.BufferAttribute(z, 1)); g.setAttribute("aCore", new THREE.BufferAttribute(z, 1)); g.setAttribute("aDim", new THREE.BufferAttribute(dim, 1));
      const m = new THREE.ShaderMaterial({ vertexShader: NODE_VS, fragmentShader: NODE_FS, uniforms: { ...uniforms, uFar: { value: 1e5 } }, ...additive });
      m.uniforms.uTime = uniforms.uTime; m.uniforms.uPx = uniforms.uPx; m.uniforms.uMotion = uniforms.uMotion;
      const dust = new THREE.Points(g, m); dust.name = "dust"; scene.add(dust);
    }

    // ---------- the pool of impulses (fired by events) ----------
    const pool = {
      a: new Float32Array(POOL * 3), b: new Float32Array(POOL * 3), col: new Float32Array(POOL * 3),
      t0: new Float32Array(POOL), dur: new Float32Array(POOL), size: new Float32Array(POOL), next: 0,
    };
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(pool.a, 3)); pg.setAttribute("aB", new THREE.BufferAttribute(pool.b, 3));
    pg.setAttribute("aColor", new THREE.BufferAttribute(pool.col, 3)); pg.setAttribute("aT0", new THREE.BufferAttribute(pool.t0, 1));
    pg.setAttribute("aDur", new THREE.BufferAttribute(pool.dur, 1)); pg.setAttribute("aSize", new THREE.BufferAttribute(pool.size, 1));
    pg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const pulses = new THREE.Points(pg, new THREE.ShaderMaterial({ vertexShader: FLOW_VS(false), fragmentShader: FLOW_FS, uniforms, ...additive }));
    pulses.frustumCulled = false; scene.add(pulses);
    let poolDirty = false;
    const fire = (from: THREE.Vector3 | ArrayLike<number>, to: THREE.Vector3 | ArrayLike<number>, hex: string, delay = 0, dur = 1.1, size = 5, trail = 4) => {
      const c = new THREE.Color(hex), now = uniforms.uTime.value;
      const A = from instanceof THREE.Vector3 ? [from.x, from.y, from.z] : from, B = to instanceof THREE.Vector3 ? [to.x, to.y, to.z] : to;
      for (let k = 0; k < trail; k += 1) {
        const i = pool.next; pool.next = (pool.next + 1) % POOL;
        pool.a.set([A[0], A[1], A[2]], i * 3); pool.b.set([B[0], B[1], B[2]], i * 3);
        const f = 1 - k / trail; pool.col.set([c.r * f, c.g * f, c.b * f], i * 3);
        pool.t0[i] = now + delay + k * 0.035; pool.dur[i] = dur; pool.size[i] = size * (1 - k * 0.16);
      }
      poolDirty = true;
    };

    // ---------- the agent's core and beams; the Zeladora's comet and trail ----------
    const coreSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: PROBE, ...additive }));
    coreSprite.visible = false; scene.add(coreSprite);
    const beamG = new THREE.BufferGeometry();
    const beams = new THREE.LineSegments(beamG, new THREE.LineBasicMaterial({ vertexColors: true, ...additive }));
    beams.frustumCulled = false; scene.add(beams);
    const comet = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: KEEPER, ...additive }));
    comet.visible = false; scene.add(comet);
    const TRAIL = 70;
    const trailPos = new Float32Array(TRAIL * 3), trailCol = new Float32Array(TRAIL * 3);
    const trailG = new THREE.BufferGeometry();
    trailG.setAttribute("position", new THREE.BufferAttribute(trailPos, 3)); trailG.setAttribute("color", new THREE.BufferAttribute(trailCol, 3));
    const trail = new THREE.Line(trailG, new THREE.LineBasicMaterial({ vertexColors: true, ...additive }));
    trail.frustumCulled = false; scene.add(trail);
    const selRing = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: SELECT, ...additive, opacity: 0.9 }));
    selRing.visible = false; scene.add(selRing);

    // ---------- the world (rebuilt when the memories change) ----------
    let W: World | null = null;
    let graph: MemoryGraph | null = null;
    let nodes: THREE.Points | null = null, fibres: THREE.LineSegments | null = null, flow: THREE.Points | null = null;
    const hazes: THREE.Sprite[] = [];
    let edgeList: { a: number; b: number; kind: string; w: number }[] = [];
    let clusterEls: HTMLDivElement[] = [];
    const nodeEls: HTMLDivElement[] = [];
    let fitDist = 330;

    const clear = () => {
      for (const o of [nodes, fibres, flow]) if (o) { scene.remove(o); o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
      for (const h of hazes) { scene.remove(h); h.material.dispose(); }
      hazes.length = 0; nodes = fibres = flow = null;
      for (const el of clusterEls) el.remove(); clusterEls = [];
    };

    const setWorld = (L: AtlasLayout, g: MemoryGraph) => {
      const first = !W;
      clear(); W = buildWorld(L); graph = g;
      const n = W.ids.length, byId = new Map(g.nodes.map((x) => [x.id, x]));
      const col = new Float32Array(n * 3), size = new Float32Array(n), ph = new Float32Array(n), glow = new Float32Array(n), dim = new Float32Array(n).fill(1), core = new Float32Array(n);
      W.ids.forEach((id, i) => {
        const node = byId.get(id), c = new THREE.Color(cloudColor(W!.cloud[i]));
        col.set([c.r, c.g, c.b], i * 3);
        const rel = node?.relevance ?? 0.3;
        size[i] = 3.4 + 5 * rel; ph[i] = hash01(id, 11) * 6.28;
        core[i] = node && reviewOf(node.memory) === "comprovada" ? 1 : 0;
      });
      const ng = new THREE.BufferGeometry();
      ng.setAttribute("position", new THREE.BufferAttribute(W.pos, 3)); ng.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
      ng.setAttribute("aSize", new THREE.BufferAttribute(size, 1)); ng.setAttribute("aPhase", new THREE.BufferAttribute(ph, 1));
      ng.setAttribute("aGlow", new THREE.BufferAttribute(glow, 1)); ng.setAttribute("aDim", new THREE.BufferAttribute(dim, 1)); ng.setAttribute("aCore", new THREE.BufferAttribute(core, 1));
      nodes = new THREE.Points(ng, new THREE.ShaderMaterial({ vertexShader: NODE_VS, fragmentShader: NODE_FS, uniforms, ...additive }));
      nodes.frustumCulled = false; scene.add(nodes);

      // Fibres: the real connections (relations brighter than semantic neighbours).
      edgeList = [];
      for (const e of g.edges) { const a = W.index.get(e.from), b = W.index.get(e.to); if (a !== undefined && b !== undefined) edgeList.push({ a, b, kind: e.kind, w: e.weight }); }
      const fp = new Float32Array(edgeList.length * 6), fc = new Float32Array(edgeList.length * 6);
      edgeList.forEach((e, i) => { fp.set(W!.pos.subarray(e.a * 3, e.a * 3 + 3), i * 6); fp.set(W!.pos.subarray(e.b * 3, e.b * 3 + 3), i * 6 + 3); });
      const fg = new THREE.BufferGeometry();
      fg.setAttribute("position", new THREE.BufferAttribute(fp, 3)); fg.setAttribute("color", new THREE.BufferAttribute(fc, 3));
      fibres = new THREE.LineSegments(fg, new THREE.LineBasicMaterial({ vertexColors: true, ...additive }));
      fibres.frustumCulled = false; scene.add(fibres);

      // Ambient signals: a few always running along each fibre.
      const per = edgeList.length > 2500 ? 1 : 2, m = Math.min(6000, edgeList.length * per);
      const qa = new Float32Array(m * 3), qb = new Float32Array(m * 3), qc = new Float32Array(m * 3), qt = new Float32Array(m), qd = new Float32Array(m), qs = new Float32Array(m);
      for (let k = 0; k < m; k += 1) {
        const e = edgeList[k % edgeList.length], fwd = hash01(`f${k}`, 1) > 0.5;
        const [x, y] = fwd ? [e.a, e.b] : [e.b, e.a];
        qa.set(W.pos.subarray(x * 3, x * 3 + 3), k * 3); qb.set(W.pos.subarray(y * 3, y * 3 + 3), k * 3);
        const c = new THREE.Color(cloudColor(W.cloud[x]));
        qc.set([c.r, c.g, c.b], k * 3); qt[k] = hash01(`f${k}`, 2); qd[k] = 2.5 + hash01(`f${k}`, 3) * 4; qs[k] = e.kind === "relacao" ? 2.6 : 1.8;
      }
      const qg = new THREE.BufferGeometry();
      qg.setAttribute("position", new THREE.BufferAttribute(qa, 3)); qg.setAttribute("aB", new THREE.BufferAttribute(qb, 3));
      qg.setAttribute("aColor", new THREE.BufferAttribute(qc, 3)); qg.setAttribute("aT0", new THREE.BufferAttribute(qt, 1));
      qg.setAttribute("aDur", new THREE.BufferAttribute(qd, 1)); qg.setAttribute("aSize", new THREE.BufferAttribute(qs, 1));
      flow = new THREE.Points(qg, new THREE.ShaderMaterial({ vertexShader: FLOW_VS(true), fragmentShader: FLOW_FS, uniforms, ...additive }));
      flow.frustumCulled = false; scene.add(flow);

      // Each lobe's haze and its name.
      L.clouds.forEach((c, i) => {
        const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: cloudColor(i), ...additive, opacity: 0.075 }));
        h.position.copy(W!.centers[i]); h.scale.setScalar(W!.radii[i] * 3.4); scene.add(h); hazes.push(h);
        const cl = g.clusters.find((x) => x.id === c.id);
        const el = document.createElement("div"); el.className = "lm-brain-cl";
        el.style.setProperty("--c", cloudColor(i));
        el.innerHTML = `<b></b><span></span>`;
        (el.firstChild as HTMLElement).textContent = (cl?.label || c.id).toUpperCase();
        (el.lastChild as HTMLElement).textContent = `${c.ids.length} memórias`;
        labels.appendChild(el); clusterEls.push(el);
      });
      fitDist = (W.radius / Math.tan((25 * Math.PI) / 180)) * 0.72;
      uniforms.uFar.value = fitDist * 1.3;
      if (first) { camera.position.set(0, W.radius * 0.35, fitDist * 1.6); controls.target.set(0, 0, 0); flyTo(new THREE.Vector3(), fitDist, 2600, new THREE.Vector3(0.25, 0.22, 1)); }
      paintFibres();
    };

    // ---------- camera flights ----------
    let fly: Fly | null = null;
    const flyTo = (target: THREE.Vector3, dist: number, ms = 1500, dir?: THREE.Vector3) => {
      const d = (dir ? dir.clone() : camera.position.clone().sub(controls.target)).normalize();
      fly = { p0: camera.position.clone(), t0v: controls.target.clone(), p1: target.clone().add(d.multiplyScalar(dist)), t1v: target.clone(), at: performance.now(), ms };
    };

    // ---------- what is lit: fibres of the selected / hovered memory, the focused section ----------
    let paintKey = "";
    const dimOf = (ci: number, id: string) => {
      const P = live.current;
      let d = 1;
      if (P.focusClusterId && W && graph) { const fi = graph.clusters.findIndex((c) => c.id === P.focusClusterId); if (fi >= 0 && fi !== ci) d = 0.28; }
      if (P.readSet && !P.readSet.has(id)) d *= 0.45;
      return d;
    };
    function paintFibres() {
      if (!W || !fibres || !nodes || !graph) return;
      const P = live.current;
      const lit = P.selectedId ?? P.hoveredId;
      const fc = fibres.geometry.getAttribute("color") as THREE.BufferAttribute, arr = fc.array as Float32Array;
      const li = lit ? W.index.get(lit) : undefined;
      edgeList.forEach((e, i) => {
        const on = li !== undefined && (e.a === li || e.b === li);
        const base = (e.kind === "relacao" ? 0.16 : 0.07) * Math.min(dimOf(W!.cloud[e.a], W!.ids[e.a]), dimOf(W!.cloud[e.b], W!.ids[e.b]));
        const ca = new THREE.Color(cloudColor(W!.cloud[e.a])), cb = new THREE.Color(cloudColor(W!.cloud[e.b]));
        const k = on ? 0.95 : base;
        arr.set([ca.r * k, ca.g * k, ca.b * k], i * 6); arr.set([cb.r * k, cb.g * k, cb.b * k], i * 6 + 3);
      });
      fc.needsUpdate = true;
      const da = nodes.geometry.getAttribute("aDim") as THREE.BufferAttribute, dd = da.array as Float32Array;
      W.ids.forEach((id, i) => { dd[i] = dimOf(W!.cloud[i], id); });
      da.needsUpdate = true;
      if (flow) (flow.material as THREE.ShaderMaterial).opacity = 1;
    }

    // ---------- interaction ----------
    let lastUser = -1e9, hover: string | null = null, mouse: [number, number] | null = null, down: [number, number] | null = null;
    controls.addEventListener("start", () => { lastUser = performance.now(); fly = null; live.current.onUserMove(); });
    const v3 = new THREE.Vector3();
    const pick = (mx: number, my: number): string | null => {
      if (!W) return null;
      const r = renderer.domElement.getBoundingClientRect();
      let best: string | null = null, bd = 18 * 18;
      for (let i = 0; i < W.ids.length; i += 1) {
        v3.set(W.pos[i * 3], W.pos[i * 3 + 1], W.pos[i * 3 + 2]).project(camera);
        if (v3.z > 1) continue;
        const x = (v3.x * 0.5 + 0.5) * r.width, y = (-v3.y * 0.5 + 0.5) * r.height;
        const d = (x - mx) ** 2 + (y - my) ** 2;
        if (d < bd) { bd = d; best = W.ids[i]; }
      }
      return best;
    };
    const local = (e: PointerEvent | MouseEvent): [number, number] => { const r = renderer.domElement.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const onMove = (e: PointerEvent) => { mouse = local(e); };
    const onLeave = () => { mouse = null; if (hover) { hover = null; live.current.onHover(null); } };
    const onDown = (e: PointerEvent) => { down = local(e); };
    const onUp = (e: PointerEvent) => {
      const p = local(e);
      if (!down || Math.hypot(p[0] - down[0], p[1] - down[1]) > 5) { down = null; return; }
      down = null;
      const id = pick(p[0], p[1]);
      live.current.onSelect(id);
    };
    const onDbl = (e: MouseEvent) => {
      const p = local(e), id = pick(p[0], p[1]);
      const node = id ? graph?.nodes.find((x) => x.id === id) : null;
      if (node) live.current.onCluster(node.clusterId, true);
    };
    const el = renderer.domElement;
    el.addEventListener("pointermove", onMove); el.addEventListener("pointerleave", onLeave);
    el.addEventListener("pointerdown", onDown); el.addEventListener("pointerup", onUp); el.addEventListener("dblclick", onDbl);

    // ---------- size ----------
    let Wpx = 800, Hpx = 500;
    const resize = () => {
      const r = host.getBoundingClientRect();
      Wpx = Math.max(10, r.width); Hpx = Math.max(10, r.height);
      renderer.setSize(Wpx, Hpx, false); composer.setSize(Wpx, Hpx); bloom.setSize(Wpx, Hpx);
      camera.aspect = Wpx / Hpx; camera.updateProjectionMatrix();
      uniforms.uPx.value = (Hpx * renderer.getPixelRatio()) / (2 * Math.tan((camera.fov * Math.PI) / 360));
    };
    const ro = new ResizeObserver(resize); ro.observe(host); resize();

    // ---------- the frame ----------
    let raf = 0, lastFrame = performance.now();
    let seenHL = new Map<string, number>(), seenKeeper: string | null = null, seenLinks = 0, agentKey = "", agentPulse = 0, agentEndAt = 0;
    const cometPos = new THREE.Vector3(); let cometOn = false;
    const trailBuf: THREE.Vector3[] = [];
    let lastCam = 0;
    const posOf = (id: string) => { const i = W?.index.get(id); return i === undefined ? null : new THREE.Vector3(W!.pos[i * 3], W!.pos[i * 3 + 1], W!.pos[i * 3 + 2]); };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const P = live.current, now = performance.now(), clock = Date.now();
      const dt = Math.min(0.05, (now - lastFrame) / 1000); lastFrame = now;
      const motion = !P.settings.paused && !P.settings.reducedMotion;
      if (motion) uniforms.uTime.value += dt;
      uniforms.uMotion.value = motion ? 1 : 0;
      if (!W || !nodes) { composer.render(); return; }

      // A camera command from the panel (fit, a section, a memory, where a question is going).
      if (P.camera && P.camera.key !== lastCam) {
        lastCam = P.camera.key;
        if (P.camera.front) {
          // The whole brain, shifted off the panels that cover part of the view (the command's offset, along the screen).
          const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
          flyTo(right.multiplyScalar(P.camera.target[0] * W.scale * 0.8).add(up.multiplyScalar(-P.camera.target[1] * W.scale * 0.8)), fitDist, 1600);
        }
        else flyTo(W.fromAtlas(P.camera.target[0], P.camera.target[1]), clamp(P.camera.distance * W.scale * 0.6, 22, fitDist * 0.8), 1500);
      }
      if (fly) {
        const u = clamp((now - fly.at) / fly.ms, 0, 1), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
        camera.position.lerpVectors(fly.p0, fly.p1, e); controls.target.lerpVectors(fly.t0v, fly.t1v, e);
        if (u >= 1) fly = null;
      }
      controls.autoRotate = motion && !fly && now - lastUser > 8000 && !P.selectedId;
      controls.update();

      // Hover (only when the mouse moved over the canvas).
      if (mouse) { const id = pick(mouse[0], mouse[1]); if (id !== hover) { hover = id; P.onHover(id); el.style.cursor = id ? "pointer" : "grab"; } }

      // Lit fibres when the selection, hover or focus changed.
      const key = `${P.selectedId}|${P.hoveredId}|${P.focusClusterId}|${P.readSet?.size ?? -1}`;
      if (key !== paintKey) { paintKey = key; paintFibres(); }

      // Glow of every memory: selected, hovered, the Zeladora's, the ones an event touched.
      const ga = nodes.geometry.getAttribute("aGlow") as THREE.BufferAttribute, gl = ga.array as Float32Array;
      gl.fill(0);
      for (const [id, h] of P.highlights) {
        const i = W.index.get(id); if (i === undefined) continue;
        const age = clock - h.at;
        gl[i] = Math.max(gl[i], h.kind === "search" ? 0.8 : clamp(1 - age / ACTIVE_MS, 0, 1) * 1.2);
        // A new touch: the neuron fires impulses to its neighbours.
        if (seenHL.get(id) !== h.at && age < 4000) {
          const from = posOf(id)!, col = HL[h.kind] || "#ffffff";
          let k = 0;
          for (const e of edgesOf(graph!, id)) { const other = e.from === id ? e.to : e.from, to = posOf(other); if (to && k < 10) { fire(from, to, col, 0.05 * k, 1.0 + 0.3 * hash01(other, 1), 5, 4); k += 1; } }
        }
      }
      seenHL = new Map([...P.highlights].map(([id, h]) => [id, h.at]));
      const sel = P.selectedId ? W.index.get(P.selectedId) : undefined, hov = P.hoveredId ? W.index.get(P.hoveredId) : undefined;
      if (hov !== undefined) gl[hov] = Math.max(gl[hov], 0.7);
      if (sel !== undefined) gl[sel] = Math.max(gl[sel], 1.1);
      const kc = P.keeper?.current ? W.index.get(P.keeper.current) : undefined;
      if (kc !== undefined) gl[kc] = Math.max(gl[kc], 1);
      ga.needsUpdate = true;
      if (sel !== undefined) {
        selRing.visible = true; selRing.position.set(W.pos[sel * 3], W.pos[sel * 3 + 1], W.pos[sel * 3 + 2]);
        selRing.scale.setScalar(7 + Math.sin(uniforms.uTime.value * 3) * 1.2);
      } else selRing.visible = false;

      // The Zeladora: a comet gliding to the memory she reads, firing into it and onwards along her links.
      const k = P.keeper;
      const kp = k?.current ? posOf(k.current) : null;
      if (k?.enabled && k.running && kp) {
        if (!cometOn) { cometPos.copy(kp).add(new THREE.Vector3(0, 30, 0)); cometOn = true; }
        cometPos.lerp(kp, 1 - Math.pow(0.02, dt));
        comet.visible = true; comet.position.copy(cometPos); comet.scale.setScalar(11 + Math.sin(now / 160) * 1.5);
        if (k.current !== seenKeeper) {
          if (seenKeeper) { const a = posOf(seenKeeper); if (a) fire(a, kp, KEEPER, 0, 0.9, 6, 6); }
          seenKeeper = k.current;
        }
        const links = k.links.filter((l) => clock - l.at < 6000);
        if (k.links.length !== seenLinks) {
          for (const l of k.links.slice(-3)) { const a = posOf(l.from), b = posOf(l.to); if (a && b && clock - l.at < 3000) fire(a, b, KEEPER, 0, 1.3, 5, 5); }
          seenLinks = k.links.length;
        }
        void links;
      } else { comet.visible = false; cometOn = false; seenKeeper = null; }
      if (cometOn) { trailBuf.unshift(cometPos.clone()); if (trailBuf.length > TRAIL) trailBuf.length = TRAIL; } else if (trailBuf.length) trailBuf.pop();
      const kcol = new THREE.Color(KEEPER);
      for (let i = 0; i < TRAIL; i += 1) {
        const p = trailBuf[Math.min(i, trailBuf.length - 1)] || cometPos, f = i < trailBuf.length ? Math.pow(1 - i / TRAIL, 2) * 0.8 : 0;
        trailPos.set([p.x, p.y, p.z], i * 3); trailCol.set([kcol.r * f, kcol.g * f, kcol.b * f], i * 3);
      }
      trailG.attributes.position.needsUpdate = true; trailG.attributes.color.needsUpdate = true;

      // A question: an orange core above what it weighs, beams to each memory, impulses down the strong ones.
      const ag = P.agent;
      if (ag && ag.tentacles.length) {
        if (ag.key !== agentKey) { agentKey = ag.key; agentPulse = 0; agentEndAt = 0; }
        if (ag.ended && !agentEndAt) agentEndAt = now;
        const fade = agentEndAt ? clamp(1 - (now - agentEndAt) / 5000, 0, 1) : 1;
        const pts = ag.tentacles.map((t) => posOf(t.id)).filter(Boolean) as THREE.Vector3[];
        const c = pts.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, pts.length));
        const up = camera.up.clone().multiplyScalar(28);
        c.add(up);
        coreSprite.visible = fade > 0; coreSprite.position.copy(c); coreSprite.scale.setScalar((16 + Math.sin(now / 140) * 3) * (0.4 + 0.6 * fade));
        (coreSprite.material as THREE.SpriteMaterial).opacity = fade;
        const bp = new Float32Array(ag.tentacles.length * 6), bc = new Float32Array(ag.tentacles.length * 6);
        const pc = new THREE.Color(PROBE);
        ag.tentacles.forEach((t, i) => {
          const p = posOf(t.id); if (!p) return;
          const s = (t.kind === "used" ? 0.9 : t.kind === "recalled" ? 0.6 : 0.18) * fade;
          bp.set([c.x, c.y, c.z, p.x, p.y, p.z], i * 6); bc.set([pc.r * s * 1.4, pc.g * s * 1.4, pc.b * s * 1.4, pc.r * s * 0.5, pc.g * s * 0.5, pc.b * s * 0.5], i * 6);
        });
        beamG.setAttribute("position", new THREE.BufferAttribute(bp, 3)); beamG.setAttribute("color", new THREE.BufferAttribute(bc, 3));
        beams.visible = fade > 0;
        if (motion && fade > 0.5 && now - agentPulse > 420) {
          agentPulse = now;
          for (const t of ag.tentacles) if (t.kind !== "scanned" || hash01(t.id + now, 1) < 0.15) { const p = posOf(t.id); if (p) fire(c, p, PROBE, hash01(t.id, 2) * 0.3, 0.8, t.kind === "used" ? 7 : 4, 4); }
        }
      } else { coreSprite.visible = false; beams.visible = false; agentKey = ""; }

      if (poolDirty) { for (const n of ["position", "aB", "aColor", "aT0", "aDur", "aSize"]) pg.attributes[n].needsUpdate = true; poolDirty = false; }

      for (const h of hazes) (h.material as THREE.SpriteMaterial).opacity = 0.075;
      if (P.focusClusterId && graph) { const fi = graph.clusters.findIndex((c) => c.id === P.focusClusterId); hazes.forEach((h, i) => { (h.material as THREE.SpriteMaterial).opacity = i === fi ? 0.13 : 0.035; }); }
      const dust = scene.getObjectByName("dust"); if (dust && motion) dust.rotation.y += dt * 0.008;

      composer.render();
      placeLabels(P, clock);
    };

    // ---------- names: each lobe's, and the memories that matter now ----------
    const placeLabels = (P: MapProps, clock: number) => {
      if (!W || !graph) return;
      const show = P.settings.labels;
      const camDist = camera.position.distanceTo(controls.target);
      // Nearest lobes first; a name that would cover one already placed waits (bigger lobes win ties).
      const fi = P.focusClusterId ? graph.clusters.findIndex((x) => x.id === P.focusClusterId) : -1;
      const order = W.centers.map((c, i) => ({ i, d: c.distanceTo(camera.position) - (i === fi ? 1e4 : 0) - W!.radii[i] })).sort((a, b) => a.d - b.d);
      const boxes: [number, number, number, number][] = [];
      for (const { i } of order) {
        const el = clusterEls[i], c = W.centers[i]; if (!el) continue;
        v3.copy(c).add(new THREE.Vector3(0, W.radii[i] * 0.55, 0)).project(camera);
        if (!show || v3.z > 1) { el.style.opacity = "0"; continue; }
        const x = (v3.x * 0.5 + 0.5) * Wpx, y = (-v3.y * 0.5 + 0.5) * Hpx;
        const depth = c.distanceTo(camera.position) / Math.max(1, camDist);
        const sc = clamp(1.25 - depth * 0.3, 0.75, 1.15);
        const w = ((el.firstChild as HTMLElement).textContent!.length * 8.6 + 8) * sc, h = 30 * sc;
        const bx: [number, number, number, number] = [x - w / 2, y - h, w, h];
        if (boxes.some((b) => bx[0] < b[0] + b[2] && b[0] < bx[0] + bx[2] && bx[1] < b[1] + b[3] && b[1] < bx[1] + bx[3])) { el.style.opacity = "0"; continue; }
        boxes.push(bx);
        const a = clamp(1.6 - depth * 0.8, 0.3, 1) * (fi >= 0 && fi !== i ? 0.4 : 1);
        el.style.opacity = String(a); el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${sc.toFixed(3)})`;
      }
      // Memory names: selected, hovered, the Zeladora's, the hottest touched ones (at most 10).
      const want: { id: string; col: string }[] = [];
      const push = (id: string | null | undefined, col: string) => { if (id && W!.index.has(id) && !want.some((w) => w.id === id)) want.push({ id, col }); };
      push(P.selectedId, SELECT); push(P.hoveredId, "#ffffff"); push(P.keeper?.current, KEEPER);
      [...P.highlights].filter(([, h]) => h.kind === "search" || clock - h.at < ACTIVE_MS).sort((a, b) => b[1].at - a[1].at).slice(0, 8).forEach(([id, h]) => push(id, HL[h.kind]));
      while (nodeEls.length < want.length) { const e = document.createElement("div"); e.className = "lm-brain-node"; labels.appendChild(e); nodeEls.push(e); }
      nodeEls.forEach((e, i) => {
        const w = want[i];
        if (!w || !show) { e.style.opacity = "0"; return; }
        const j = W!.index.get(w.id)!;
        v3.set(W!.pos[j * 3], W!.pos[j * 3 + 1], W!.pos[j * 3 + 2]).project(camera);
        if (v3.z > 1) { e.style.opacity = "0"; return; }
        const label = graph!.nodes.find((x) => x.id === w.id)?.label || "";
        if (e.textContent !== label) e.textContent = label.length > 48 ? `${label.slice(0, 46)}…` : label;
        e.style.setProperty("--c", w.col); e.style.opacity = "1";
        e.style.transform = `translate(${((v3.x * 0.5 + 0.5) * Wpx + 12).toFixed(1)}px, ${((-v3.y * 0.5 + 0.5) * Hpx - 8).toFixed(1)}px)`;
      });
    };

    raf = requestAnimationFrame(frame);
    engine.current = {
      setWorld,
      dispose: () => {
        cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); clear();
        el.removeEventListener("pointermove", onMove); el.removeEventListener("pointerleave", onLeave);
        el.removeEventListener("pointerdown", onDown); el.removeEventListener("pointerup", onUp); el.removeEventListener("dblclick", onDbl);
        pg.dispose(); beamG.dispose(); trailG.dispose(); tex.dispose(); composer.dispose(); renderer.dispose();
        host.innerHTML = "";
      },
    };
    const { layout: L0, graph: G0 } = live.current;
    setWorld(L0, G0);
    return () => { engine.current?.dispose(); engine.current = null; };
  }, []);

  // New memories / new layout: the world is rebuilt (the camera stays where it is).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    engine.current?.setWorld(props.layout, props.graph);
  }, [props.layout, props.graph]);

  return <div ref={hostRef} className="lm-brain" aria-label="Cérebro das memórias: cada ponto é uma memória, cada fio uma ligação real" />;
}
