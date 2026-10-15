import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import { groupKey, hash, memoryHealth, type Memory, type MemoryCluster } from "./data";

/**
 * The memory atlas as an aurora: tens of thousands of fine particles weave
 * one veil of light per topic, all in a single cohesive palette (emerald →
 * cyan → indigo), softened by bloom. Memories are precise points of light
 * inside their veil:
 *
 *   left → right        old → new
 *   higher in the veil  more used
 *   brighter            more used · white twinkle = new (7 days)
 *   barely there        never used
 *   warm tint           gets in the way (fails more than it helps)
 *   wave                used now: a ripple of light runs along the veil
 *
 * Motion lives in one vertex shader; the same formula runs on the CPU for
 * hover and click, so picking follows the moving points.
 */
type Props = {
  memories: Memory[];
  allMemories: Memory[];
  clusters: MemoryCluster[];
  pulses?: Map<string, number>;
  recent?: Set<string>;
  selectedId: string | null;
  motion: boolean;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onCluster: (id: number) => void;
  onGroup: (key: string) => void;
};

// One palette for the whole sky; each veil only shifts slightly along it.
const EMERALD = new THREE.Color("#2fe6a8"), CYAN = new THREE.Color("#22d3ee"), INDIGO = new THREE.Color("#6d6af7"), VIOLET = new THREE.Color("#b07cf7");
const WARM = new THREE.Color("#ff9a8a");
const MAX_BANDS = 6;
const WIDTH = 180, COLS = 240, ROWS = 30, ROW_H = 0.95, BAND_Z = 26;
const NEW_MS = 7 * 24 * 3600 * 1000;

type Band = { key: string; label: string; count: number; hem: THREE.Color; crown: THREE.Color; hemY: number; zBase: number; phase: number; energy: number; clusterId?: number; group?: string };
type Star = { m: Memory; band: number; x: number; row: number; weight: number; isNew: boolean; unused: boolean; failing: boolean };

function layout(all: Memory[], clusters: MemoryCluster[]) {
  const labelOf = new Map(clusters.map((c) => [c.id, c.label]));
  const keyOf = (m: Memory) => (m.cluster !== undefined && m.cluster >= 0 ? `c${m.cluster}` : `g:${groupKey(m)}`);
  const groups = new Map<string, Memory[]>();
  all.forEach((m) => groups.set(keyOf(m), [...(groups.get(keyOf(m)) ?? []), m]));
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const kept = ordered.slice(0, MAX_BANDS - (ordered.length > MAX_BANDS ? 1 : 0));
  const rest = ordered.slice(kept.length).flatMap(([, ms]) => ms);
  const lists: [string, Memory[]][] = rest.length ? [...kept, ["other", rest]] : kept;
  const uses = (m: Memory) => m.stats?.uses ?? 0;
  const topicUses = lists.map(([, ms]) => ms.reduce((s, m) => s + uses(m), 0));
  const maxTopic = Math.max(1, ...topicUses);
  const n = Math.max(1, lists.length);
  const bands: Band[] = lists.map(([key, ms], i) => {
    const clusterId = key.startsWith("c") ? Number(key.slice(1)) : undefined;
    const k = n > 1 ? i / (n - 1) : 0;
    return {
      key,
      label: key === "other" ? "Outros assuntos" : clusterId !== undefined ? labelOf.get(clusterId) ?? `Assunto ${clusterId + 1}` : key.slice(2),
      count: ms.length,
      hem: EMERALD.clone().lerp(CYAN, k * 0.75),
      crown: INDIGO.clone().lerp(VIOLET, k),
      hemY: -6 + (i % 2) * 2.5,
      zBase: -i * BAND_Z,
      phase: i * 1.9 + hash(key) * 2,
      energy: 0.45 + 0.55 * (topicUses[i] / maxTopic),
      clusterId,
      group: key.startsWith("g:") ? key.slice(2) : undefined,
    };
  });
  const bandOf = new Map<string, number>();
  lists.forEach(([, ms], i) => ms.forEach((m) => bandOf.set(m.id, i)));
  const maxUses = Math.max(0, ...all.map(uses));
  const order = all.map((m, i) => ({ id: m.id, t: m.createdAt ? Date.parse(m.createdAt) : NaN, i }));
  order.sort((a, b) => (Number.isFinite(a.t) && Number.isFinite(b.t) ? a.t - b.t : a.i - b.i));
  const ageRank = new Map(order.map((o, k) => [o.id, all.length > 1 ? k / (all.length - 1) : 0.5]));
  const now = Date.now();
  const stars: Star[] = all.map((m) => {
    const weight = maxUses > 0 ? Math.log1p(uses(m)) / Math.log1p(maxUses) : 0;
    const unused = !(uses(m) > 0);
    return {
      m,
      band: bandOf.get(m.id) ?? 0,
      x: -WIDTH / 2 + 10 + (WIDTH - 20) * (ageRank.get(m.id) ?? 0.5) + (hash(`${m.id}:x`) - 0.5) * 1.4,
      row: unused ? 0.6 + hash(`${m.id}:r`) * 1.2 : 2.5 + weight * (ROWS - 7) + (hash(`${m.id}:r`) - 0.5) * 1.6,
      weight,
      isNew: m.createdAt ? now - Date.parse(m.createdAt) < NEW_MS : false,
      unused,
      failing: memoryHealth(m).failing,
    };
  });
  return { bands, stars };
}

/** Where a point is at time t — the same formula as the vertex shader. */
function place(b: Band, x: number, row: number, t: number, out = new THREE.Vector3()) {
  const h = row / ROWS;
  const fold = b.zBase + 10 * Math.sin(x * 0.03 + b.phase) + 4 * Math.sin(x * 0.083 - b.phase + t * 0.12);
  const wave = 1.6 * Math.sin(x * 0.05 + t * 0.45 + b.phase) * h;
  return out.set(x, b.hemY + row * ROW_H + wave, fold + 2.2 * h * Math.sin(x * 0.04 + t * 0.3 + b.phase));
}

const vertex = /* glsl */ `
  attribute vec3 aBase;      // x, row, band
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aKind;     // 0 veil, 1 memory
  attribute float aShown;
  attribute float aTwinkle;  // 1 = new memory
  attribute float aBirth;    // seconds (uNow) a memory arrived while watching; -1 = was already there
  uniform float uTime;
  uniform float uNow;
  uniform float uReveal;     // seconds since the view opened
  uniform float uFocus;      // band in focus, -1 = none
  uniform float uScale;
  uniform float uDim;
  uniform vec4 uBands[8];    // hemY, zBase, phase, energy
  uniform vec4 uRipples[8];  // x, band, start (s), strength
  varying vec3 vColor;
  varying float vAlpha;
  varying float vKind;
  void main() {
    int bi = int(aBase.z + 0.5);
    vec4 B = uBands[bi];
    float x = aBase.x, row = aBase.y, h = row / ${ROWS.toFixed(1)};
    float fold = B.y + 10.0 * sin(x * 0.03 + B.z) + 4.0 * sin(x * 0.083 - B.z + uTime * 0.12);
    float wave = 1.6 * sin(x * 0.05 + uTime * 0.45 + B.z) * h;
    vec3 p = vec3(x, B.x + row * ${ROW_H.toFixed(2)} + wave, fold + 2.2 * h * sin(x * 0.04 + uTime * 0.3 + B.z));
    // Rays: fine vertical streaks drifting along the veil.
    float s1 = 0.5 + 0.5 * sin(x * 0.42 + uTime * 0.35 + B.z * 3.0);
    float s2 = 0.5 + 0.5 * sin(x * 0.13 - uTime * 0.21 + B.z);
    float s3 = 0.5 + 0.5 * sin(x * 0.031 + uTime * 0.08 + B.z * 0.7);
    float rays = pow(s1 * s2, 1.6) * (0.35 + 0.65 * s3);
    float rip = 0.0;
    for (int i = 0; i < 8; i++) {
      vec4 R = uRipples[i];
      if (R.w <= 0.0 || abs(R.y - aBase.z) > 0.5) continue;
      float age = uNow - R.z;
      if (age < 0.0 || age > 5.0) continue;
      float d = abs(abs(x - R.x) - age * 22.0);
      rip += R.w * exp(-d * d / 24.0) * (1.0 - age / 5.0);
    }
    // Time runs left to right: now and then a comet of light travels each hem
    // from the oldest memories to "now", waking the memories it passes.
    float age01 = (x + ${(WIDTH / 2).toFixed(1)}) / ${WIDTH.toFixed(1)};
    float cometX = fract((uNow + B.z * 2.3) / 16.0) * 1.25 - 0.1;
    float comet = exp(-pow((age01 - cometX) * 18.0, 2.0)) * smoothstep(1.15, 0.95, cometX);
    float bright, size;
    if (aKind > 0.5) {
      float tw = aTwinkle * (0.5 + 0.5 * sin(uNow * 2.4 + x));
      bright = 1.0 + rip * 0.8 + tw * 0.6 + comet * 0.7;
      size = aSize * (1.0 + rip * 0.5 + tw * 0.25 + comet * 0.3);
      // Opening: memories light up in the order they were made, oldest first.
      bright *= smoothstep(1.3 + age01 * 2.4, 1.7 + age01 * 2.4, uReveal);
      // A memory that arrives while you watch falls from the sky into its veil.
      if (aBirth >= 0.0) {
        float b = clamp((uNow - aBirth) / 2.4, 0.0, 1.0);
        p.y += (1.0 - b) * (1.0 - b) * 30.0;
        bright *= 0.3 + 0.7 * b;
        size *= 1.0 + (1.0 - b) * 1.5;
      }
    } else {
      // The veil: bright at the hem, fading up into the rays.
      float body = exp(-h * 1.35) * (0.1 + 0.95 * rays) + exp(-h * 18.0) * 0.5;
      bright = body * (0.5 + 0.5 * B.w) * (1.0 - smoothstep(0.85, 1.0, h)) + rip * exp(-h * 1.5) * 0.9 + comet * exp(-h * 7.0) * 0.9;
      size = aSize * (0.8 + rays * 0.5 + rip * 0.6 + comet * 0.4);
      // Opening: the veils grow from the hem up.
      bright *= smoothstep(h * 1.8, h * 1.8 + 0.6, uReveal);
    }
    // One topic in focus (hovering its name): the others step back.
    float focus = (uFocus < -0.5 || abs(uFocus - aBase.z) < 0.5) ? 1.0 : 0.16;
    // The veil fades at its two ends.
    float ends = smoothstep(${(WIDTH / 2).toFixed(1)}, ${(WIDTH / 2 - 18).toFixed(1)}, abs(x));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = size * uScale / max(-mv.z, 0.1);
    gl_Position = projectionMatrix * mv;
    vColor = aColor;
    vKind = aKind;
    vAlpha = bright * aShown * ends * focus * (aKind > 0.5 ? 1.0 : 1.0 - uDim * 0.7);
  }
`;

// Sparks rising from memories in use: a small pool, moved on the CPU.
const sparkVertex = /* glsl */ `
  attribute float aAlpha;
  uniform float uScale;
  varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = 1.4 * uScale / max(-mv.z, 0.1);
    gl_Position = projectionMatrix * mv;
    vA = aAlpha;
  }
`;
const sparkFragment = /* glsl */ `
  varying float vA;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    float a = exp(-r2 * 5.0) * vA;
    gl_FragColor = vec4(vec3(0.62, 1.0, 0.86) * a, a);
  }
`;
const fragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vKind;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    float a;
    vec3 col;
    if (vKind > 0.5) {
      // A precise point of light: hard core, soft halo.
      float core = smoothstep(0.09, 0.0, r2);
      float halo = exp(-r2 * 7.0) * 0.45;
      a = (core + halo) * vAlpha;
      col = mix(vColor, vec3(1.0), core * 0.7);
    } else {
      a = exp(-r2 * 4.0) * vAlpha * 1.6;
      col = vColor;
    }
    gl_FragColor = vec4(col * a, a);
  }
`;

function Sky({ bands, stars, visible, selectedId, hoverId, focusBand, pulses, recent, motion, time }: {
  bands: Band[]; stars: Star[]; visible: Set<string>; selectedId: string | null; hoverId: string | null; focusBand: number;
  pulses?: Map<string, number>; recent?: Set<string>; motion: boolean; time: React.MutableRefObject<number>;
}) {
  const { size, gl } = useThree();
  const born = useMemo(() => performance.now(), []);
  const byId = useMemo(() => new Map(stars.map((s) => [s.m.id, s])), [stars]);
  // When each memory arrived: -1 for those already there when the view opened.
  const births = useRef<Map<string, number> | null>(null);
  // The veils: every band fully woven with fine points.
  const veil = useMemo(() => {
    const n = bands.length * COLS * ROWS;
    const base = new Float32Array(n * 3), color = new Float32Array(n * 3), sz = new Float32Array(n), zero = new Float32Array(n), shown = new Float32Array(n).fill(1);
    const c = new THREE.Color();
    let k = 0;
    bands.forEach((band, bi) => {
      for (let col = 0; col < COLS; col++) for (let row = 0; row < ROWS; row++) {
        const jx = (hash(`${bi}:${col}:${row}`) - 0.5) * 0.5;
        base.set([-WIDTH / 2 + (col + jx) * (WIDTH / COLS), row + (hash(`${col}:${row}:${bi}`) - 0.5) * 0.4, bi], k * 3);
        c.copy(band.hem).lerp(band.crown, Math.pow(row / ROWS, 0.75));
        color.set([c.r, c.g, c.b], k * 3);
        sz[k] = 1.15;
        k++;
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("aBase", new THREE.BufferAttribute(base, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(color, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(sz, 1));
    g.setAttribute("aKind", new THREE.BufferAttribute(zero, 1));
    g.setAttribute("aShown", new THREE.BufferAttribute(shown, 1));
    g.setAttribute("aTwinkle", new THREE.BufferAttribute(zero.slice(), 1));
    g.setAttribute("aBirth", new THREE.BufferAttribute(new Float32Array(n).fill(-1), 1));
    return g;
  }, [bands]);
  const mem = useMemo(() => {
    const n = stars.length;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("aBase", new THREE.BufferAttribute(new Float32Array(stars.flatMap((s) => [s.x, s.row, s.band])), 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute("aKind", new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
    g.setAttribute("aShown", new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute("aTwinkle", new THREE.BufferAttribute(new Float32Array(stars.map((s) => (s.isNew ? 1 : 0))), 1));
    const nowS = (performance.now() - born) / 1000;
    if (!births.current) births.current = new Map(stars.map((s) => [s.m.id, -1]));
    stars.forEach((s) => { if (!births.current!.has(s.m.id)) births.current!.set(s.m.id, nowS); });
    g.setAttribute("aBirth", new THREE.BufferAttribute(new Float32Array(stars.map((s) => births.current!.get(s.m.id) ?? -1)), 1));
    return g;
  }, [stars, born]);
  useEffect(() => () => { veil.dispose(); mem.dispose(); }, [veil, mem]);
  useEffect(() => {
    const col = mem.getAttribute("aColor") as THREE.BufferAttribute;
    const sz = mem.getAttribute("aSize") as THREE.BufferAttribute;
    const sh = mem.getAttribute("aShown") as THREE.BufferAttribute;
    const c = new THREE.Color(), white = new THREE.Color("#ffffff");
    stars.forEach((s, i) => {
      const band = bands[s.band];
      c.copy(band.hem).lerp(band.crown, s.row / ROWS).lerp(white, s.isNew ? 0.8 : 0.2 + s.weight * 0.3);
      if (s.failing) c.lerp(WARM, 0.75);
      const isSel = s.m.id === selectedId, isHover = s.m.id === hoverId;
      if (isSel || isHover) c.lerp(white, 0.6);
      col.setXYZ(i, c.r, c.g, c.b);
      sz.setX(i, (s.unused ? 1.1 : 1.6 + s.weight * 1.6) * (isSel ? 2.1 : isHover ? 1.6 : 1));
      const base = s.unused ? 0.25 : 0.45 + s.weight * 0.4;
      sh.setX(i, !visible.has(s.m.id) ? 0.06 : (selectedId && !isSel ? 0.3 : 1) * (isSel || isHover ? 1.4 : base));
    });
    col.needsUpdate = sz.needsUpdate = sh.needsUpdate = true;
  }, [mem, stars, bands, selectedId, hoverId, visible]);

  // One material for the life of the view (usage refreshes must not restart the motion).
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 }, uNow: { value: 0 }, uReveal: { value: 0 }, uFocus: { value: -1 }, uScale: { value: 300 }, uDim: { value: 0 },
      uBands: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
      uRipples: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
    },
  }), []);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    (material.uniforms.uBands.value as THREE.Vector4[]).forEach((v, i) => { const b = bands[i]; if (b) v.set(b.hemY, b.zBase, b.phase, b.energy); else v.set(0, 0, 0, 0); });
  }, [material, bands]);

  // Sparks: rise from memories in use, along the rays of their veil.
  const SPARKS = 320;
  const sparkGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(SPARKS), 1));
    return g;
  }, []);
  const sparkMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: sparkVertex, fragmentShader: sparkFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uScale: { value: 300 } },
  }), []);
  useEffect(() => () => { sparkGeo.dispose(); sparkMat.dispose(); }, [sparkGeo, sparkMat]);
  const sparks = useRef(Array.from({ length: SPARKS }, () => ({ s: null as Star | null, t0: 0, life: 0, dx: 0, rise: 0 })));
  const at = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    const u = material.uniforms;
    if (motion) u.uTime.value += delta;
    time.current = u.uTime.value;
    const nowS = (performance.now() - born) / 1000;
    u.uNow.value = nowS;
    u.uReveal.value = nowS;
    u.uFocus.value = focusBand;
    u.uScale.value = size.height * gl.getPixelRatio() * 0.9;
    sparkMat.uniforms.uScale.value = u.uScale.value;
    u.uDim.value += ((selectedId ? 1 : 0) - u.uDim.value) * Math.min(1, delta * 3);
    // Spawn: strong for memories used now, a trickle for the last answer's.
    const pool = sparks.current;
    const spawn = (s: Star, rate: number) => {
      if (Math.random() > rate * delta) return;
      const free = pool.find((p) => !p.s || nowS - p.t0 > p.life);
      if (free) Object.assign(free, { s, t0: nowS, life: 1.6 + Math.random() * 1.4, dx: (Math.random() - 0.5) * 2.5, rise: 9 + Math.random() * 12 });
    };
    pulses?.forEach((pulseAt, id) => { const s = byId.get(id); if (s && visible.has(id) && performance.now() - pulseAt < 6000) spawn(s, 26); });
    recent?.forEach((id) => { const s = byId.get(id); if (s && visible.has(id)) spawn(s, 2.5); });
    const pos = sparkGeo.getAttribute("position") as THREE.BufferAttribute;
    const alpha = sparkGeo.getAttribute("aAlpha") as THREE.BufferAttribute;
    pool.forEach((p, i) => {
      const k = p.s ? (nowS - p.t0) / p.life : 1;
      if (!p.s || k >= 1) { alpha.setX(i, 0); return; }
      place(bands[p.s.band], p.s.x + p.dx * k, p.s.row, u.uTime.value, at);
      pos.setXYZ(i, at.x, at.y + p.rise * k * (1 - k * 0.3), at.z);
      alpha.setX(i, Math.sin(Math.PI * k) * 0.9);
    });
    pos.needsUpdate = alpha.needsUpdate = true;
    const ripples: [Star, number, number][] = [];
    [...(pulses ?? [])].filter(([, at]) => performance.now() - at < 5000).slice(-8).forEach(([id, at]) => {
      const s = byId.get(id);
      if (s) ripples.push([s, (at - born) / 1000, 1]);
    });
    // Memories of the last answer: a soft wave that comes back every 7 s.
    recent?.forEach((id) => {
      const s = byId.get(id);
      if (!s || ripples.length >= 8) return;
      ripples.push([s, u.uNow.value - ((u.uNow.value + hash(id) * 7) % 7), 0.4]);
    });
    (u.uRipples.value as THREE.Vector4[]).forEach((v, i) => {
      const r = ripples[i];
      if (r) v.set(r[0].x, r[0].band, r[1], r[2]); else v.set(0, 0, 0, 0);
    });
  });
  return (
    <>
      <points geometry={veil} material={material} frustumCulled={false} />
      <points geometry={mem} material={material} frustumCulled={false} renderOrder={1} />
      <points geometry={sparkGeo} material={sparkMat} frustumCulled={false} renderOrder={2} />
    </>
  );
}

/** Hover/click on the moving points: the CPU twin of the shader picks the nearest on screen. */
function Picker({ bands, stars, visible, time, onHover, onSelect, onFocus }: {
  bands: Band[]; stars: Star[]; visible: Set<string>; time: React.MutableRefObject<number>;
  onHover: (id: string | null, at?: THREE.Vector3) => void; onSelect: (id: string) => void; onFocus: (id: string) => void;
}) {
  const { camera, gl } = useThree();
  const handlers = useRef({ onHover, onSelect, onFocus });
  handlers.current = { onHover, onSelect, onFocus };
  useEffect(() => {
    const el = gl.domElement;
    const p = new THREE.Vector3();
    const nearest = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      let best: { s: Star; at: THREE.Vector3 } | null = null, bestD = 14 * 14;
      for (const s of stars) {
        if (!visible.has(s.m.id)) continue;
        place(bands[s.band], s.x, s.row, time.current, p);
        const at = p.clone();
        p.project(camera);
        if (p.z > 1) continue;
        const d = ((p.x * 0.5 + 0.5) * r.width - mx) ** 2 + ((0.5 - p.y * 0.5) * r.height - my) ** 2;
        if (d < bestD) { bestD = d; best = { s, at }; }
      }
      return best;
    };
    let down = { x: 0, y: 0 };
    const move = (e: PointerEvent) => { const b = nearest(e); el.style.cursor = b ? "pointer" : "grab"; handlers.current.onHover(b?.s.m.id ?? null, b?.at); };
    const pdown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const click = (e: MouseEvent) => { if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return; const b = nearest(e); if (b) handlers.current.onSelect(b.s.m.id); };
    const dbl = (e: MouseEvent) => { const b = nearest(e); if (b) handlers.current.onFocus(b.s.m.id); };
    const leave = () => handlers.current.onHover(null);
    el.addEventListener("pointermove", move); el.addEventListener("pointerdown", pdown); el.addEventListener("click", click); el.addEventListener("dblclick", dbl); el.addEventListener("pointerleave", leave);
    return () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerdown", pdown); el.removeEventListener("click", click); el.removeEventListener("dblclick", dbl); el.removeEventListener("pointerleave", leave); };
  }, [bands, stars, visible, camera, gl, time]);
  return null;
}

/** The camera breathes: a very slow sway while nobody is touching it. */
function Drift({ enabled }: { enabled: boolean }) {
  const { camera } = useThree();
  const base = useRef<THREE.Vector3 | null>(null);
  const idle = useRef(true);
  useEffect(() => {
    const stop = () => { idle.current = false; };
    window.addEventListener("pointerdown", stop);
    return () => window.removeEventListener("pointerdown", stop);
  }, []);
  useFrame(({ clock }) => {
    if (!enabled || !idle.current) return;
    if (!base.current) base.current = camera.position.clone();
    const t = clock.elapsedTime;
    camera.position.set(base.current.x + Math.sin(t * 0.07) * 9, base.current.y + Math.sin(t * 0.05) * 1.5, base.current.z);
  });
  return null;
}

export default function MemoryParticles({ memories, allMemories, clusters, pulses, recent, selectedId, motion, onSelect, onFocus, onCluster, onGroup }: Props) {
  const { bands, stars } = useMemo(() => layout(allMemories, clusters), [allMemories, clusters]);
  const visible = useMemo(() => new Set(memories.map((m) => m.id)), [memories]);
  const [hover, setHover] = useState<{ id: string; at: THREE.Vector3 } | null>(null);
  const [focusBand, setFocusBand] = useState(-1);
  const time = useRef(0);
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const live = motion && !reduced;
  const hovered = hover ? allMemories.find((m) => m.id === hover.id) : undefined;
  const depth = Math.max(1, bands.length - 1) * BAND_Z;
  const helping = stars.filter((s) => (s.m.stats?.helped ?? 0) > 0).length;
  const fresh = stars.filter((s) => s.isNew).length;
  const nowMs = performance.now();
  const usedNow = new Set([...(recent ?? []), ...[...(pulses ?? [])].filter(([, at]) => nowMs - at < 60000).map(([id]) => id)]).size;
  return (
    <div className="memory-aurora">
      <Canvas
        dpr={[1, 1.75]}
        camera={{ position: [0, 4, 92 + depth * 0.1], fov: 42, near: 0.5, far: 2000 }}
        gl={{ antialias: false, powerPreference: "high-performance" }}
        frameloop={live ? "always" : "demand"}
      >
        <color attach="background" args={["#020308"]} />
        <fog attach="fog" args={["#020308", 150 + depth * 0.4, 330 + depth]} />
        <Sky bands={bands} stars={stars} visible={visible} selectedId={selectedId} hoverId={hover?.id ?? null} focusBand={focusBand} pulses={pulses} recent={recent} motion={live} time={time} />
        <Picker bands={bands} stars={stars} visible={visible} time={time}
          onHover={(id, at) => setHover(id && at ? { id, at } : null)} onSelect={onSelect} onFocus={onFocus} />
        {hovered && hover && (
          <Html position={hover.at} zIndexRange={[30, 0]} style={{ pointerEvents: "none" }}>
            <div className="star-tooltip aurora-tip3d">
              <strong>{hovered.title}</strong>
              {hovered.stats && <small>{hovered.stats.uses}× usada · ajudou {hovered.stats.helped} · falhou {hovered.stats.failed}</small>}
            </div>
          </Html>
        )}
        <OrbitControls makeDefault target={[0, 7, -depth * 0.42]} enableDamping dampingFactor={0.06} rotateSpeed={0.5} minDistance={40} maxDistance={380} maxPolarAngle={Math.PI * 0.6} />
        <Drift enabled={live} />
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur intensity={1.05} luminanceThreshold={0.08} luminanceSmoothing={0.35} radius={0.75} />
        </EffectComposer>
      </Canvas>
      <header className="aurora-title">
        <span>Aurora da memória</span>
        <strong>{bands.length} assuntos · {allMemories.length.toLocaleString("pt-BR")} memórias</strong>
      </header>
      {/* Topics: one quiet line each, with how much the topic is used. Hover lights its veil. */}
      <nav className="aurora-topics" aria-label="Assuntos da aurora" onMouseLeave={() => setFocusBand(-1)}>
        {bands.map((b, i) => (
          <button key={b.key} onMouseEnter={() => setFocusBand(i)} onFocus={() => setFocusBand(i)} onBlur={() => setFocusBand(-1)}
            className={focusBand === i ? "on" : ""}
            onClick={() => (b.clusterId !== undefined ? onCluster(b.clusterId) : b.group ? onGroup(b.group) : undefined)}>
            <i style={{ background: `#${b.hem.getHexString()}`, width: `${10 + b.energy * 22}px` }} />
            <span>{b.label}</span>
            <small>{b.count}</small>
          </button>
        ))}
      </nav>
      <div className="aurora-legend" aria-label="Como ler a aurora">
        <span><b>↑</b> mais alto, mais usada</span>
        <span><b className="sw-new">·</b> cintila, nova</span>
        <span><b className="sw-beam">∿</b> onda e faíscas, em uso</span>
        <span><b className="sw-unused">·</b> tênue, nunca usada</span>
        <span><b className="sw-bad">·</b> tom quente, atrapalha</span>
      </div>
      <div className="aurora-stats" aria-label="Memória em números">
        <div><b>{allMemories.length.toLocaleString("pt-BR")}</b><small>memórias</small></div>
        <div><b>{helping.toLocaleString("pt-BR")}</b><small>ajudam</small></div>
        <div><b>{fresh.toLocaleString("pt-BR")}</b><small>novas</small></div>
        <div><b className={usedNow ? "live" : ""}>{usedNow}</b><small>em uso</small></div>
      </div>
      <span className="aurora-axis left">antigas</span>
      <span className="aurora-axis right">recentes</span>
    </div>
  );
}
