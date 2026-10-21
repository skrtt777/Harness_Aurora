import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { ACTIVITY_COLOR, CATEGORY_COLOR, type GraphCluster, type GraphNode, type KeeperView, type MemoryGraph, type SectionState } from "./adapter";
import { hash01, type Layout, type Vec3 } from "./layout";

/**
 * The Mapa Vivo's drawing (the data comes ready from adapter.ts and layout.ts). Every layer is one GPU buffer:
 * the memories as points, their dust (a few faint satellites per real memory, so density follows the data),
 * the links as thin curves, the core's spokes to each cluster, the focused cluster's branches, and pulses
 * that run only for real events (a memory recalled into a turn, created, found by a search).
 */
export type Quality = "alta" | "media" | "baixa";
export type MapSettings = { paused: boolean; quality: Quality; labels: boolean; reducedMotion: boolean };
export type Highlight = { kind: "recalled" | "created" | "search" | "read" | "linked" | "flagged" | "joined"; at: number; score?: number; note?: string };
/** A turn of the Aurora as it happens: where it goes and what it reaches (all from real events). */
export type AgentTentacle = { id: string; kind: "scanned" | "recalled" | "created" | "used"; strength: number; order: number };
export type AgentState = { key: string; target: Vec3 | null; tentacles: AgentTentacle[]; ended: boolean } | null;
export type CameraCommand = { target: Vec3; distance: number; key: number } | null;

type SceneProps = {
  graph: MemoryGraph;
  layout: Layout;
  settings: MapSettings;
  selectedId: string | null;
  hoveredId: string | null;
  focusClusterId: string | null;
  expanded: Set<string>;
  highlights: Map<string, Highlight>;
  camera: CameraCommand;
  agent: AgentState;
  keeper: KeeperView | null;
  /** Each section's state in the Zeladora's round: a section still waiting is grey, as in the reference. */
  sections: Map<string, SectionState>;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
  onCluster: (id: string, double: boolean) => void;
  onContextLost: () => void;
};

const DUST_PER_NODE: Record<Quality, number> = { alta: 6, media: 3, baixa: 1 };
// The cloud of each cluster (static: computed once per layout, so it costs nothing per frame).
const NEBULA_PER_CLUSTER: Record<Quality, number> = { alta: 150, media: 70, baixa: 16 };
const CURVE_STEPS = 8;
const ACTIVE_MS = 9000;
const KEEPER_SUFFIX: Partial<Record<Highlight["kind"], string>> = { created: " · nova", read: " · lida", linked: " · ligada", flagged: " · conflito", joined: " · juntou" };
const color = (hex: string) => new THREE.Color(hex);
const ACTIVITY = color(ACTIVITY_COLOR);
const TEAL = color("#3fd6c6");
const MAGENTA = color("#f05a8c");
const WHITE = color("#eef2f6");
const YELLOW = color("#f2d14b");

// Soft round points, sized in world units with perspective; alpha per point.
const pointVertex = /* glsl */ `
  attribute float size; attribute float alpha; attribute vec3 tint;
  uniform float minSize; uniform float pixelRatio;
  varying float vAlpha; varying vec3 vTint;
  void main() {
    vAlpha = alpha; vTint = tint;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Never under minSize pixels: far away, the dust still reads as dust instead of vanishing.
    gl_PointSize = max(minSize * pixelRatio, size * (300.0 / -mv.z) * pixelRatio);
    gl_Position = projectionMatrix * mv;
  }`;
const pointFragment = /* glsl */ `
  varying float vAlpha; varying vec3 vTint;
  void main() {
    vec2 p = gl_PointCoord - 0.5; float d = length(p);
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vTint, vAlpha * core * core);
  }`;
const lineVertex = /* glsl */ `
  attribute float alpha; attribute vec3 tint; varying float vAlpha; varying vec3 vTint;
  void main() { vAlpha = alpha; vTint = tint; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const lineFragment = /* glsl */ `
  varying float vAlpha; varying vec3 vTint;
  void main() { gl_FragColor = vec4(vTint, vAlpha); }`;

const pointMaterial = (minSize: number) => new THREE.ShaderMaterial({ vertexShader: pointVertex, fragmentShader: pointFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { minSize: { value: minSize }, pixelRatio: { value: Math.min(2, window.devicePixelRatio || 1) } } });
const lineMaterial = () => new THREE.ShaderMaterial({ vertexShader: lineVertex, fragmentShader: lineFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });

/** A point on the gentle curve between a and b (bent sideways by `bend`), t in [0, 1]. */
function curvePoint(a: Vec3, b: Vec3, t: number, bend: number, out: THREE.Vector3) {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, mz = (a[2] + b[2]) / 2;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const cx = mx - dy * bend, cy = my + dx * bend, cz = mz;
  const u = 1 - t;
  return out.set(u * u * a[0] + 2 * u * t * cx + t * t * b[0], u * u * a[1] + 2 * u * t * cy + t * t * b[1], u * u * a[2] + 2 * u * t * cz + t * t * b[2]);
}

function Scene(props: SceneProps) {
  const { graph, layout, settings, selectedId, hoveredId, focusClusterId, expanded, highlights, camera, onHover, onSelect, onCluster } = props;
  const nodes = graph.nodes;
  const index = useMemo(() => new Map(nodes.map((n, i) => [n.id, i])), [nodes]);
  const clusterOf = useMemo(() => new Map(graph.clusters.map((c) => [c.id, c])), [graph.clusters]);
  const motion = !settings.paused && !settings.reducedMotion;

  // Current positions ease toward the layout's targets (a new memory grows in at its cluster's edge).
  const current = useRef(new Map<string, THREE.Vector3>());
  const born = useRef(new Map<string, number>());
  const firstLoad = useRef(true);
  useEffect(() => {
    const now = performance.now();
    const ordered = [...nodes].sort((a, b) => a.createdAt - b.createdAt);
    ordered.forEach((n, i) => {
      if (current.current.has(n.id)) return;
      const target = layout.nodes.get(n.id)!;
      const cluster = layout.clusters.get(n.clusterId);
      const from = cluster ? cluster.center : target;
      current.current.set(n.id, new THREE.Vector3(...(settings.reducedMotion ? target : from)));
      // The first load arrives in waves; later ones as they happen.
      born.current.set(n.id, firstLoad.current ? now + Math.min(2600, (i / Math.max(1, ordered.length)) * 2600) : now);
    });
    for (const id of [...current.current.keys()]) if (!index.has(id)) { current.current.delete(id); born.current.delete(id); }
    firstLoad.current = false;
  }, [nodes, layout, index, settings.reducedMotion]);

  // ---------- Buffers ----------
  const dustCount = nodes.length * DUST_PER_NODE[settings.quality];
  const nebulaCount = 0;
  // Each cluster's nebula: denser at the centre, thin filaments outward, tinted by its category.
  const nebulaGeo = useMemo(() => {
    const pos: number[] = []; const size: number[] = []; const alpha: number[] = []; const tint: number[] = [];
    const c3 = new THREE.Color(); const grey3 = new THREE.Color("#8a93a3");
    for (const c of graph.clusters) {
      const box = layout.clusters.get(c.id); if (!box) continue;
      const count = Math.round(Math.sqrt(c.nodeIds.length) * NEBULA_PER_CLUSTER[settings.quality]);
      c3.set(CATEGORY_COLOR[c.category]).lerp(grey3, 0.5);
      for (let j = 0; j < count; j += 1) {
        const a = hash01(c.id, 101 + j) * Math.PI * 2;
        const r = box.radius * 1.2 * Math.pow(hash01(c.id, 301 + j), 0.8);
        // Filaments: a third of the points follow a few spiral arms.
        const arm = j % 3 === 0 ? Math.floor(hash01(c.id, 901 + j) * 5) : -1;
        const ang = arm >= 0 ? (arm / 5) * Math.PI * 2 + r * 0.03 + (hash01(c.id, 903 + j) - 0.5) * 0.25 : a;
        pos.push(box.center[0] + Math.cos(ang) * r, box.center[1] + Math.sin(ang) * r * 0.85, box.center[2] + (hash01(c.id, 501 + j) - 0.5) * 10);
        size.push(0.25 + hash01(c.id, 701 + j) * 0.45);
        alpha.push(0.1 + (1 - r / (box.radius * 1.2)) * 0.22);
        tint.push(c3.r, c3.g, c3.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("size", new THREE.Float32BufferAttribute(size, 1));
    g.setAttribute("alpha", new THREE.Float32BufferAttribute(alpha, 1)); g.setAttribute("tint", new THREE.Float32BufferAttribute(tint, 3));
    return g;
  }, [graph.clusters, layout, settings.quality]);
  // Links between clusters, aggregated: one long arc per related pair, stronger for more links (static too).
  const bridgeGeo = useMemo(() => {
    const pos: number[] = []; const alpha: number[] = []; const tint: number[] = [];
    const c3 = new THREE.Color(); const STEPS = 28;
    for (const b of graph.bridges.slice(0, 80)) {
      const A = layout.clusters.get(b.a); const B = layout.clusters.get(b.b); if (!A || !B) continue;
      const strength = Math.min(0.3, 0.04 + Math.sqrt(b.count) * 0.025);
      c3.set(CATEGORY_COLOR[(graph.clusters.find((c) => c.id === b.a)?.category) || "geral"]).lerp(new THREE.Color("#d7dde6"), 0.5);
      const bend = 0.22 * (hash01(b.a + b.b) > 0.5 ? 1 : -1);
      const p = new THREE.Vector3(); const q = new THREE.Vector3();
      for (let s = 0; s < STEPS; s += 1) {
        curvePoint(A.center, B.center, s / STEPS, bend, p); curvePoint(A.center, B.center, (s + 1) / STEPS, bend, q);
        const fade = Math.sin(((s + 0.5) / STEPS) * Math.PI);
        pos.push(p.x, p.y, p.z, q.x, q.y, q.z); alpha.push(strength * fade, strength * fade); tint.push(c3.r, c3.g, c3.b, c3.r, c3.g, c3.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("alpha", new THREE.Float32BufferAttribute(alpha, 1)); g.setAttribute("tint", new THREE.Float32BufferAttribute(tint, 3));
    return g;
  }, [graph.bridges, graph.clusters, layout]);
  useEffect(() => () => { nebulaGeo.dispose(); bridgeGeo.dispose(); }, [nebulaGeo, bridgeGeo]);
  const nodeGeo = useMemo(() => { const g = new THREE.BufferGeometry(); const n = nodes.length; g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute("size", new THREE.BufferAttribute(new Float32Array(n), 1)); g.setAttribute("alpha", new THREE.BufferAttribute(new Float32Array(n), 1)); g.setAttribute("tint", new THREE.BufferAttribute(new Float32Array(n * 3), 3)); return g; }, [nodes.length]);
  const dustGeo = useMemo(() => { const g = new THREE.BufferGeometry(); const n = dustCount + nebulaCount; g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute("size", new THREE.BufferAttribute(new Float32Array(n), 1)); g.setAttribute("alpha", new THREE.BufferAttribute(new Float32Array(n), 1)); g.setAttribute("tint", new THREE.BufferAttribute(new Float32Array(n * 3), 3)); return g; }, [dustCount, nebulaCount]);
  const edgeVerts = graph.edges.length * CURVE_STEPS * 2;
  const edgeGeo = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(edgeVerts * 3), 3)); g.setAttribute("alpha", new THREE.BufferAttribute(new Float32Array(edgeVerts), 1)); g.setAttribute("tint", new THREE.BufferAttribute(new Float32Array(edgeVerts * 3), 3)); return g; }, [edgeVerts]);
  // Spokes core → each cluster, and branches of expanded/focused clusters → their members (dotted: every other segment).
  // With nothing in focus, the core reaches its most proven general memories (the reference's tentacles).
  const branchIds = useMemo(() => {
    const relevance = new Map(nodes.map((n) => [n.id, n.relevance]));
    return graph.clusters
      .filter((c) => c.id === focusClusterId || expanded.has(c.id) || (!focusClusterId && c.general))
      .flatMap((c) => [...c.nodeIds].sort((a, b) => (relevance.get(b) || 0) - (relevance.get(a) || 0)).slice(0, c.general && c.id !== focusClusterId ? 28 : 80).map((id) => ({ c, id })));
  }, [graph.clusters, focusClusterId, expanded, nodes]);
  const spokeVerts = (graph.clusters.length + branchIds.length) * 12 * 2;
  const spokeGeo = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(spokeVerts * 3), 3)); g.setAttribute("alpha", new THREE.BufferAttribute(new Float32Array(spokeVerts), 1)); g.setAttribute("tint", new THREE.BufferAttribute(new Float32Array(spokeVerts * 3), 3)); return g; }, [spokeVerts]);
  const PULSES = 240;
  const pulseGeo = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(PULSES * 3), 3)); g.setAttribute("size", new THREE.BufferAttribute(new Float32Array(PULSES), 1)); g.setAttribute("alpha", new THREE.BufferAttribute(new Float32Array(PULSES), 1)); g.setAttribute("tint", new THREE.BufferAttribute(new Float32Array(PULSES * 3), 3)); return g; }, []);
  const materials = useMemo(() => ({ nodes: pointMaterial(2.4), dust: pointMaterial(1.1), edges: lineMaterial(), spokes: lineMaterial(), pulses: pointMaterial(4) }), []);
  useEffect(() => () => { Object.values(materials).forEach((m) => m.dispose()); }, [materials]);
  useEffect(() => () => { [nodeGeo, dustGeo, edgeGeo, spokeGeo, pulseGeo].forEach((g) => g.dispose()); }, [nodeGeo, dustGeo, edgeGeo, spokeGeo, pulseGeo]);

  // Neighbours of the hovered/selected memory, for the highlight of its links.
  const focusIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of [hoveredId, selectedId]) {
      if (!id) continue;
      ids.add(id);
      for (const e of graph.edges) { if (e.from === id) ids.add(e.to); if (e.to === id) ids.add(e.from); }
    }
    return ids;
  }, [graph.edges, hoveredId, selectedId]);

  const tmp = useMemo(() => new THREE.Vector3(), []);
  const segA = useMemo(() => new THREE.Vector3(), []);
  const segB = useMemo(() => new THREE.Vector3(), []);
  const tmpColor = useMemo(() => new THREE.Color(), []);
  const grey = useMemo(() => new THREE.Color("#c9d1d9"), []);
  const nebulaGrey = useMemo(() => new THREE.Color("#8a93a3"), []);
  const has = (id: string) => index.has(id);
  const pos = (id: string): Vec3 => { const v = current.current.get(id); return v ? [v.x, v.y, v.z] : layout.nodes.get(id) || [0, 0, 0]; };

  useFrame(({ clock }, delta) => {
    const now = performance.now();
    const t = clock.getElapsedTime();
    const ease = settings.reducedMotion ? 1 : 1 - Math.pow(0.0025, delta);
    // ---- nodes ----
    const np = nodeGeo.getAttribute("position") as THREE.BufferAttribute;
    const ns = nodeGeo.getAttribute("size") as THREE.BufferAttribute;
    const na = nodeGeo.getAttribute("alpha") as THREE.BufferAttribute;
    const nt = nodeGeo.getAttribute("tint") as THREE.BufferAttribute;
    const dim = selectedId || hoveredId ? 0.35 : 1;
    nodes.forEach((n, i) => {
      const v = current.current.get(n.id); const target = layout.nodes.get(n.id);
      if (!v || !target) return;
      const grow = Math.max(0, Math.min(1, (now - (born.current.get(n.id) || 0)) / 900));
      if (grow > 0) v.lerp(tmp.set(target[0], target[1], target[2]), ease);
      // Idle drift: barely perceptible, never a re-position.
      const drift = motion ? Math.sin(t * 0.25 + hash01(n.id) * 6.28) * 0.18 : 0;
      np.setXYZ(i, v.x + drift, v.y + drift * 0.6, v.z);
      const hl = highlights.get(n.id);
      const active = hl && now - hl.at < ACTIVE_MS ? 1 - (now - hl.at) / ACTIVE_MS : 0;
      const isFocus = focusIds.has(n.id);
      const base = 1.5 + n.relevance * 2.6 + (n.id === selectedId ? 4 : n.id === hoveredId ? 2.5 : 0) + active * 3;
      ns.setX(i, base * grow);
      // A cluster in focus keeps its colour; the others go grey and quiet (the reference's sections).
      const queued = props.sections.get(n.clusterId)?.state === "na fila" && !active && !isFocus;
      const away = (focusClusterId && n.clusterId !== focusClusterId && !isFocus && !active) || queued ? 1 : 0;
      na.setX(i, Math.min(1, (0.55 + n.relevance * 0.35 + active) * (isFocus || active ? 1 : dim) * (away ? 0.45 : 1)));
      // Points are lights: near white, tinted by their category.
      tmpColor.set(CATEGORY_COLOR[n.category]).lerp(WHITE, away ? 0.75 : 0.32).lerp(hl?.kind === "read" || hl?.kind === "linked" ? TEAL : hl?.kind === "flagged" ? YELLOW : ACTIVITY, active * 0.85);
      if (n.id === selectedId) tmpColor.lerp(MAGENTA, 0.5);
      nt.setXYZ(i, tmpColor.r, tmpColor.g, tmpColor.b);
    });
    np.needsUpdate = ns.needsUpdate = na.needsUpdate = nt.needsUpdate = true;

    // ---- dust: satellites of each memory + the faint nebula of each cluster ----
    const dp = dustGeo.getAttribute("position") as THREE.BufferAttribute;
    const ds = dustGeo.getAttribute("size") as THREE.BufferAttribute;
    const da = dustGeo.getAttribute("alpha") as THREE.BufferAttribute;
    const dt = dustGeo.getAttribute("tint") as THREE.BufferAttribute;
    const per = DUST_PER_NODE[settings.quality];
    let k = 0;
    nodes.forEach((n) => {
      const [x, y, z] = pos(n.id);
      for (let j = 0; j < per; j += 1, k += 1) {
        const a = hash01(n.id, 11 + j) * Math.PI * 2; const r = 0.8 + hash01(n.id, 31 + j) * 4.2;
        const wob = motion ? Math.sin(t * 0.4 + j + hash01(n.id, j)) * 0.25 : 0;
        dp.setXYZ(k, x + Math.cos(a) * (r + wob), y + Math.sin(a) * (r + wob), z + (hash01(n.id, 51 + j) - 0.5) * 3);
        ds.setX(k, 0.35 + hash01(n.id, 71 + j) * 0.5); da.setX(k, 0.22 * dim + 0.08);
        tmpColor.set(CATEGORY_COLOR[n.category]).lerp(grey, 0.55);
        dt.setXYZ(k, tmpColor.r, tmpColor.g, tmpColor.b);
      }
    });
    dp.needsUpdate = ds.needsUpdate = da.needsUpdate = dt.needsUpdate = true;
    dustGeo.setDrawRange(0, k);

    // ---- edges: thin curves, stronger for explicit relations and the focused memory's links ----
    const ep = edgeGeo.getAttribute("position") as THREE.BufferAttribute;
    const ea = edgeGeo.getAttribute("alpha") as THREE.BufferAttribute;
    const et = edgeGeo.getAttribute("tint") as THREE.BufferAttribute;
    let v = 0;
    for (const e of graph.edges) {
      const lit = focusIds.has(e.from) && focusIds.has(e.to) && (e.from === selectedId || e.to === selectedId || e.from === hoveredId || e.to === hoveredId);
      // A link between two clusters is drawn on its own only for the memory in focus (otherwise it is in the arcs).
      if (e.cross && !lit) continue;
      const a = pos(e.from); const b = pos(e.to);
      // Thin and faint inside a cloud (many overlap, additively); strong only for the memory in focus.
      const alpha = lit ? 0.75 : (e.kind === "relacao" ? 0.16 : 0.025 + (e.weight - 0.5) * 0.1) * dim;
      const from = index.get(e.from); const fromNode = from !== undefined ? nodes[from] : null;
      tmpColor.set(fromNode ? CATEGORY_COLOR[fromNode.category] : "#8a93a3");
      if (e.kind === "relacao") tmpColor.lerp(TEAL, 0.4);
      const bend = 0.18 * (hash01(e.id) - 0.5);
      // Two reused vectors (no allocation per segment: thousands of curves are redrawn each frame).
      let prev = curvePoint(a, b, 0, bend, segA);
      let next = segB;
      for (let s = 1; s <= CURVE_STEPS; s += 1) {
        curvePoint(a, b, s / CURVE_STEPS, bend, next);
        ep.setXYZ(v, prev.x, prev.y, prev.z); ea.setX(v, Math.min(0.9, alpha)); et.setXYZ(v, tmpColor.r, tmpColor.g, tmpColor.b); v += 1;
        ep.setXYZ(v, next.x, next.y, next.z); ea.setX(v, Math.min(0.9, alpha)); et.setXYZ(v, tmpColor.r, tmpColor.g, tmpColor.b); v += 1;
        [prev, next] = [next, prev];
      }
    }
    ep.needsUpdate = ea.needsUpdate = et.needsUpdate = true;
    edgeGeo.setDrawRange(0, v);

    // ---- spokes (core → cluster) and branches (focused cluster → members), dotted ----
    const sp = spokeGeo.getAttribute("position") as THREE.BufferAttribute;
    const sa = spokeGeo.getAttribute("alpha") as THREE.BufferAttribute;
    const st = spokeGeo.getAttribute("tint") as THREE.BufferAttribute;
    let w = 0;
    const dotted = (a: Vec3, b: Vec3, alpha: number, tint: THREE.Color, bend: number) => {
      for (let s = 0; s < 12; s += 2) {
        const p0 = curvePoint(a, b, s / 12, bend, tmp); sp.setXYZ(w, p0.x, p0.y, p0.z); sa.setX(w, alpha); st.setXYZ(w, tint.r, tint.g, tint.b); w += 1;
        const p1 = curvePoint(a, b, (s + 1) / 12, bend, tmp); sp.setXYZ(w, p1.x, p1.y, p1.z); sa.setX(w, alpha); st.setXYZ(w, tint.r, tint.g, tint.b); w += 1;
      }
    };
    for (const c of graph.clusters) {
      if (c.general) continue;
      const box = layout.clusters.get(c.id); if (!box) continue;
      const lit = c.id === focusClusterId;
      dotted(layout.core, box.center, lit ? 0.5 : 0.07, tmpColor.set(CATEGORY_COLOR[c.category]), 0.08 * (hash01(c.id) - 0.5));
    }
    for (const { c, id } of branchIds) {
      const box = layout.clusters.get(c.id); if (!box) continue;
      dotted(box.center, pos(id), 0.55, tmpColor.set("#e6edf3"), 0.1 * (hash01(id) - 0.5));
    }
    sp.needsUpdate = sa.needsUpdate = st.needsUpdate = true;
    spokeGeo.setDrawRange(0, w);

    // ---- pulses: only real events (recalled / created / search), core → cluster → memory ----
    const pp = pulseGeo.getAttribute("position") as THREE.BufferAttribute;
    const ps = pulseGeo.getAttribute("size") as THREE.BufferAttribute;
    const pa = pulseGeo.getAttribute("alpha") as THREE.BufferAttribute;
    const pt = pulseGeo.getAttribute("tint") as THREE.BufferAttribute;
    let q = 0;
    for (const [id, hl] of highlights) {
      if (q >= PULSES) break;
      const age = now - hl.at; if (age > 2600 || (hl.kind !== "recalled" && hl.kind !== "created")) continue;
      const n = index.get(id); if (n === undefined) continue;
      const box = layout.clusters.get(nodes[n].clusterId); if (!box) continue;
      const travel = settings.reducedMotion ? 1 : Math.min(1, age / 1800);
      const leg = travel < 0.5 ? curvePoint(layout.core, box.center, travel * 2, 0.05, tmp) : curvePoint(box.center, pos(id), (travel - 0.5) * 2, 0.08, tmp);
      pp.setXYZ(q, leg.x, leg.y, leg.z); ps.setX(q, 3.2); pa.setX(q, 1 - age / 2600);
      tmpColor.set(hl.kind === "created" ? ACTIVITY_COLOR : "#7ff3e6"); pt.setXYZ(q, tmpColor.r, tmpColor.g, tmpColor.b); q += 1;
    }
    pp.needsUpdate = ps.needsUpdate = pa.needsUpdate = pt.needsUpdate = true;
    pulseGeo.setDrawRange(0, q);
  });

  // Picking a memory: the raycaster's threshold covers its point.
  const pick = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.index !== undefined ? nodes[e.index]?.id ?? null : null);

  return (
    <>
      <points geometry={nebulaGeo} material={materials.dust} frustumCulled={false} />
      <points geometry={dustGeo} material={materials.dust} frustumCulled={false} />
      <lineSegments geometry={bridgeGeo} material={materials.spokes} frustumCulled={false} />
      <lineSegments geometry={edgeGeo} material={materials.edges} frustumCulled={false} />
      <lineSegments geometry={spokeGeo} material={materials.spokes} frustumCulled={false} />
      <points
        geometry={nodeGeo} material={materials.nodes} frustumCulled={false}
        onPointerMove={(e) => { e.stopPropagation(); onHover(pick(e)); }}
        onPointerOut={() => onHover(null)}
        onClick={(e) => { e.stopPropagation(); onSelect(pick(e)); }}
      />
      <points geometry={pulseGeo} material={materials.pulses} frustumCulled={false} />
      <Core motion={motion} />
      {graph.clusters.map((c) => <ClusterHub key={c.id} cluster={c} center={layout.clusters.get(c.id)?.center || [0, 0, 0]} focused={c.id === focusClusterId} motion={motion} onCluster={onCluster} />)}
      {settings.labels && <Labels {...props} index={index} clusterOf={clusterOf} pos={pos} />}
      <CameraRig command={camera} reduced={settings.reducedMotion} />
      <Creature keeper={props.keeper} core={layout.core} pos={pos} has={has} reduced={settings.reducedMotion} />
      <AccessPath agent={props.agent} core={layout.core} pos={pos} has={has} reduced={settings.reducedMotion} />
    </>
  );
}


/**
 * A Zeladora (app/memoryKeeper.js): a spider on the web of memories. She is not part of how the Aurora thinks —
 * she looks after the memory. She walks the web to the memory she is reading; 16 short legs carry her, 22
 * dotted tentacles reach the last memories she read (several at once, as she organizes them); a thread runs
 * between two memories she has just linked; a yellow mark stays on what she flagged for the person. Every
 * target is an id from a real event; with the Zeladora off she is not drawn.
 */
const LEGS = 16;
const TENTACLES = 22;
const LEG_STEPS = 4;
const BODY_X = 8.5, BODY_Y = 10.6;
const FLAG_COLOR = color("#f2d14b");
const VAGUE_COLOR = color("#f05a8c");
function Creature({ keeper, core, pos, has, reduced }: { keeper: KeeperView | null; core: Vec3; pos: (id: string) => Vec3; has: (id: string) => boolean; reduced: boolean }) {
  const group = useRef<THREE.Group>(null);
  const place = useRef(new THREE.Vector3(core[0] + 26, core[1] - 30, core[2] + 4));
  const MAX_LINE = LEGS * LEG_STEPS * 2 + TENTACLES * 16 * 2 + 12 * 24 * 2;
  const MAX_DOT = TENTACLES + LEGS + 200;
  const lines = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_LINE * 3), 3)); g.setAttribute("alpha", new THREE.BufferAttribute(new Float32Array(MAX_LINE), 1)); g.setAttribute("tint", new THREE.BufferAttribute(new Float32Array(MAX_LINE * 3), 3)); return g; }, [MAX_LINE]);
  const dots = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_DOT * 3), 3)); g.setAttribute("size", new THREE.BufferAttribute(new Float32Array(MAX_DOT), 1)); g.setAttribute("alpha", new THREE.BufferAttribute(new Float32Array(MAX_DOT), 1)); g.setAttribute("tint", new THREE.BufferAttribute(new Float32Array(MAX_DOT * 3), 3)); return g; }, [MAX_DOT]);
  // The body's grid (the reference's mesh): chords across the ellipse.
  const grid = useMemo(() => {
    const p: number[] = [];
    for (let k = -3; k <= 3; k += 1) {
      const y = (BODY_Y * k) / 4, hx = BODY_X * Math.sqrt(1 - (y / BODY_Y) ** 2);
      p.push(-hx, y, 0.05, hx, y, 0.05);
      const x = (BODY_X * k) / 4, hy = BODY_Y * Math.sqrt(1 - (x / BODY_X) ** 2);
      p.push(x, -hy, 0.05, x, hy, 0.05);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3)); return g;
  }, []);
  const lineMat = useMemo(() => lineMaterial(), []);
  const dotMat = useMemo(() => pointMaterial(2.2), []);
  useEffect(() => () => { lines.dispose(); dots.dispose(); grid.dispose(); lineMat.dispose(); dotMat.dispose(); }, [lines, dots, grid, lineMat, dotMat]);
  const v = useMemo(() => new THREE.Vector3(), []);
  const w = useMemo(() => new THREE.Vector3(), []);
  const c3 = useMemo(() => new THREE.Color(), []);

  useFrame(({ clock }, delta) => {
    const t = reduced ? 0 : clock.getElapsedTime();
    const g = group.current;
    const visible = Boolean(keeper?.enabled);
    if (g) g.visible = visible;
    if (!visible) { lines.setDrawRange(0, 0); dots.setDrawRange(0, 0); return; }
    // She walks the web to the memory she is reading; resting, she waits beside the core.
    const reading = keeper?.current && has(keeper.current) ? keeper.current : null;
    const target: Vec3 | null = reading ? pos(reading) : null;
    const resting = !target;
    const goal = target ? v.set(target[0] + 9, target[1] - 11, target[2] + 6) : v.set(core[0] + 26, core[1] - 30, core[2] + 4);
    const step = 1 - Math.pow(0.12, delta);
    place.current.lerp(goal, reduced ? 1 : step);
    const moving = place.current.distanceTo(goal) > 2;
    if (g) { g.position.copy(place.current); const s = 1 + Math.sin(t * 2.2) * 0.035; g.scale.set(s, s, 1); }
    const from: Vec3 = [place.current.x, place.current.y, place.current.z];

    const lp = lines.getAttribute("position") as THREE.BufferAttribute;
    const la = lines.getAttribute("alpha") as THREE.BufferAttribute;
    const lt = lines.getAttribute("tint") as THREE.BufferAttribute;
    const dp = dots.getAttribute("position") as THREE.BufferAttribute;
    const ds = dots.getAttribute("size") as THREE.BufferAttribute;
    const da = dots.getAttribute("alpha") as THREE.BufferAttribute;
    const dt = dots.getAttribute("tint") as THREE.BufferAttribute;
    let k = 0, d = 0;
    const seg = (a: THREE.Vector3, alpha: number) => { if (k >= MAX_LINE) return; lp.setXYZ(k, a.x, a.y, a.z); la.setX(k, alpha); lt.setXYZ(k, c3.r, c3.g, c3.b); k += 1; };
    const dot = (p: Vec3, size: number, alpha: number) => { if (d >= MAX_DOT) return; dp.setXYZ(d, p[0], p[1], p[2]); ds.setX(d, size); da.setX(d, alpha); dt.setXYZ(d, c3.r, c3.g, c3.b); d += 1; };

    // ---- 16 legs: short, around the body; they step faster while she walks ----
    c3.set("#3fd6c6");
    for (let i = 0; i < LEGS; i += 1) {
      const ang = (i / LEGS) * Math.PI * 2 + 0.1;
      const base: Vec3 = [from[0] + Math.cos(ang) * BODY_X, from[1] + Math.sin(ang) * BODY_Y, from[2]];
      const gait = Math.sin(t * (moving ? 9 : 1.6) + i * (i % 2 ? Math.PI : 0) + i * 0.4);
      const len = (resting ? 4 : 6) + gait * (moving ? 2.2 : 0.8);
      const end: Vec3 = [base[0] + Math.cos(ang + gait * 0.15) * len, base[1] + Math.sin(ang + gait * 0.15) * len * 1.1, base[2]];
      for (let s = 0; s < LEG_STEPS; s += 1) { seg(curvePoint(base, end, s / LEG_STEPS, 0.2, w), 0.75); seg(curvePoint(base, end, (s + 1) / LEG_STEPS, 0.2, w), 0.75); }
      dot(end, 0.9, 0.7);
    }

    // ---- 22 tentacles: dotted, to the memories she just read (newest brightest) ----
    const trail = resting ? [] : (keeper?.trail || []).filter(has).slice(0, TENTACLES);
    trail.forEach((id, i) => {
      const p = pos(id);
      if (Math.hypot(p[0] - from[0], p[1] - from[1]) > 160) return;
      const flagged = keeper?.flags.some((f) => f.id === id || f.otherId === id);
      const vague = keeper?.kinds[id] === "vaga";
      c3.set(vague ? "#f05a8c" : flagged ? "#f2d14b" : "#eef2f6");
      const alpha = 0.85 - i * 0.03;
      const ang = Math.atan2(p[1] - from[1], p[0] - from[0]);
      const base: Vec3 = [from[0] + Math.cos(ang) * BODY_X * 0.9, from[1] + Math.sin(ang) * BODY_Y * 0.9, from[2]];
      const bend = 0.12 * Math.sin(t * 1.1 + hash01(id) * 6);
      for (let s = 0; s < 16; s += 2) { seg(curvePoint(base, p, s / 16, bend, w), alpha); seg(curvePoint(base, p, (s + 1) / 16, bend, w), alpha); }
      dot(p, i === 0 ? 2.6 : 1.6, 0.95);
    });

    // ---- links she just made: a thread between the two memories, fading in 8 s ----
    for (const link of (keeper?.links || []).slice(-12)) {
      const age = Date.now() - link.at; if (age > 8000 || !has(link.from) || !has(link.to)) continue;
      const a = pos(link.from), b = pos(link.to);
      const grow = reduced ? 1 : Math.min(1, age / 900);
      const alpha = 0.9 * (1 - age / 8000);
      c3.set("#7ff3e6");
      for (let s = 0; s < 24; s += 1) { if (s / 24 > grow) break; seg(curvePoint(a, b, s / 24, 0.22, w), alpha); seg(curvePoint(a, b, Math.min((s + 1) / 24, grow), 0.22, w), alpha); }
    }

    // ---- flags: a mark on each memory she flagged (yellow: values disagree; pink: vague) ----
    for (const f of (keeper?.flags || []).slice(0, 90)) {
      c3.copy(f.otherId ? FLAG_COLOR : VAGUE_COLOR);
      for (const id of [f.id, f.otherId]) if (id && has(id)) { const p = pos(id); dot([p[0] + 1.4, p[1] + 1.4, p[2] + 0.5], 2.4 + Math.sin(t * 3 + hash01(id) * 6) * 0.4, 0.95); }
    }

    lp.needsUpdate = la.needsUpdate = lt.needsUpdate = true; lines.setDrawRange(0, k);
    dp.needsUpdate = ds.needsUpdate = da.needsUpdate = dt.needsUpdate = true; dots.setDrawRange(0, d);
  });

  const what = keeper?.phase === "descansando" ? "descansando" : keeper?.areaLabel ? `lendo · ${keeper.areaLabel}` : keeper?.phase || "";
  return (
    <>
      <lineSegments geometry={lines} material={lineMat} frustumCulled={false} />
      <points geometry={dots} material={dotMat} frustumCulled={false} />
      <group ref={group} visible={false}>
        <mesh scale={[1, BODY_Y / BODY_X, 1]}><circleGeometry args={[BODY_X, 48]} /><meshBasicMaterial color="#06201f" transparent opacity={0.78} depthWrite={false} /></mesh>
        <lineSegments geometry={grid}><lineBasicMaterial color="#3fd6c6" transparent opacity={0.4} depthWrite={false} /></lineSegments>
        <mesh scale={[1, BODY_Y / BODY_X, 1]}><ringGeometry args={[BODY_X - 0.7, BODY_X, 72]} /><meshBasicMaterial color="#3fd6c6" transparent opacity={0.95} side={THREE.DoubleSide} depthWrite={false} /></mesh>
        <mesh rotation={[0, 0, Math.PI / 4]} position={[0, 0, 0.2]}><planeGeometry args={[3, 3]} /><meshBasicMaterial color="#f05a8c" depthWrite={false} /></mesh>
        <Html position={[BODY_X + 2.5, -BODY_Y - 1.5, 0]} zIndexRange={[25, 20]} style={{ pointerEvents: "none" }}>
          <div className="lm-creature-label">zeladora · {what}</div>
        </Html>
      </group>
    </>
  );
}

/**
 * How the Aurora reaches her memories in a chat turn (this is the brain working, not the Zeladora): a path
 * from memory A to memory B — the memories recalled into the turn, in the order the search ranked them — drawn
 * hop by hop with a bright head; with one memory, from the core to it. The candidates the search weighed show
 * as faint points. All from the turn's real events; it fades out when the turn ends.
 */
const PATH_COLOR = color("#f6d9a6");
function AccessPath({ agent, core, pos, has, reduced }: { agent: AgentState; core: Vec3; pos: (id: string) => Vec3; has: (id: string) => boolean; reduced: boolean }) {
  const born = useRef(0);
  const endedAt = useRef<number | null>(null);
  const MAX = 12 * 28 * 2;
  const lines = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX * 3), 3)); g.setAttribute("alpha", new THREE.BufferAttribute(new Float32Array(MAX), 1)); g.setAttribute("tint", new THREE.BufferAttribute(new Float32Array(MAX * 3), 3)); return g; }, [MAX]);
  const dots = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(40 * 3), 3)); g.setAttribute("size", new THREE.BufferAttribute(new Float32Array(40), 1)); g.setAttribute("alpha", new THREE.BufferAttribute(new Float32Array(40), 1)); g.setAttribute("tint", new THREE.BufferAttribute(new Float32Array(40 * 3), 3)); return g; }, []);
  const lineMat = useMemo(() => lineMaterial(), []);
  const dotMat = useMemo(() => pointMaterial(2), []);
  useEffect(() => () => { lines.dispose(); dots.dispose(); lineMat.dispose(); dotMat.dispose(); }, [lines, dots, lineMat, dotMat]);
  useEffect(() => { born.current = performance.now(); endedAt.current = null; }, [agent?.key]);
  useEffect(() => { if (agent?.ended && endedAt.current === null) endedAt.current = performance.now(); }, [agent?.ended]);
  const w = useMemo(() => new THREE.Vector3(), []);
  const c3 = useMemo(() => new THREE.Color(), []);
  useFrame(() => {
    const now = performance.now();
    const fade = endedAt.current !== null ? Math.max(0, 1 - (now - endedAt.current) / 3000) : 1;
    if (!agent || fade <= 0) { lines.setDrawRange(0, 0); dots.setDrawRange(0, 0); return; }
    const lp = lines.getAttribute("position") as THREE.BufferAttribute;
    const la = lines.getAttribute("alpha") as THREE.BufferAttribute;
    const lt = lines.getAttribute("tint") as THREE.BufferAttribute;
    const dp = dots.getAttribute("position") as THREE.BufferAttribute;
    const ds = dots.getAttribute("size") as THREE.BufferAttribute;
    const da = dots.getAttribute("alpha") as THREE.BufferAttribute;
    const dt = dots.getAttribute("tint") as THREE.BufferAttribute;
    let k = 0, d = 0;
    const dot = (p: Vec3, size: number, alpha: number) => { if (d >= 40) return; dp.setXYZ(d, p[0], p[1], p[2]); ds.setX(d, size); da.setX(d, alpha); dt.setXYZ(d, c3.r, c3.g, c3.b); d += 1; };
    // The candidates the search weighed: faint points.
    c3.set("#9fb3c8");
    for (const tent of agent.tentacles) if (tent.kind === "scanned" && has(tent.id)) dot(pos(tent.id), 1.4, (0.25 + tent.strength * 0.4) * fade);
    // The path: the memories used, in order; one memory alone is reached from the core.
    const stops = agent.tentacles.filter((x) => (x.kind === "recalled" || x.kind === "used" || x.kind === "created") && has(x.id)).sort((a, b) => a.order - b.order).map((x) => pos(x.id)).slice(0, 12);
    const points: Vec3[] = stops.length === 1 ? [core, stops[0]] : stops;
    const HOP = reduced ? 1 : 700;
    let head: THREE.Vector3 | null = null;
    c3.copy(PATH_COLOR);
    for (let i = 0; i + 1 < points.length; i += 1) {
      const grow = reduced ? 1 : Math.max(0, Math.min(1, (now - born.current - i * HOP) / HOP));
      if (grow <= 0) break;
      const a = points[i], b = points[i + 1];
      for (let s = 0; s < 28; s += 1) {
        if (s / 28 > grow || k + 2 > MAX) break;
        const p0 = curvePoint(a, b, s / 28, 0.28, w); lp.setXYZ(k, p0.x, p0.y, p0.z); la.setX(k, 0.85 * fade); lt.setXYZ(k, c3.r, c3.g, c3.b); k += 1;
        const p1 = curvePoint(a, b, Math.min((s + 1) / 28, grow), 0.28, w); lp.setXYZ(k, p1.x, p1.y, p1.z); la.setX(k, 0.85 * fade); lt.setXYZ(k, c3.r, c3.g, c3.b); k += 1;
        head = p1.clone();
      }
      dot(a, 2.6, fade);
      if (grow >= 1) dot(b, 2.6, fade);
    }
    if (head && fade === 1) { c3.set("#ffffff"); dot([head.x, head.y, head.z], 3.4, 1); }
    lp.needsUpdate = la.needsUpdate = lt.needsUpdate = true; lines.setDrawRange(0, k);
    dp.needsUpdate = ds.needsUpdate = da.needsUpdate = dt.needsUpdate = true; dots.setDrawRange(0, d);
  });
  return (
    <>
      <lineSegments geometry={lines} material={lineMat} frustumCulled={false} />
      <points geometry={dots} material={dotMat} frustumCulled={false} />
    </>
  );
}

/** The Aurora's core: identity and global context (not a memory) — a turquoise crown, a magenta centre. */
function Core({ motion }: { motion: boolean }) {
  const ring = useRef<THREE.Group>(null);
  useFrame(({ clock }) => { if (ring.current && motion) { const s = 1 + Math.sin(clock.getElapsedTime() * 1.1) * 0.035; ring.current.scale.set(s, s * 0.78, s); ring.current.rotation.z += 0.0012; } });
  const spikes = useMemo(() => {
    const pts: number[] = [];
    for (let i = 0; i < 28; i += 1) { const a = (i / 28) * Math.PI * 2; const r0 = 6.4; const r1 = 8.8 + hash01(String(i)) * 4.5; pts.push(Math.cos(a) * r0, Math.sin(a) * r0 * 0.78, 0, Math.cos(a) * r1, Math.sin(a) * r1 * 0.78, 0); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3)); return g;
  }, []);
  return (
    <group scale={1.7} renderOrder={10}>
      <group ref={ring} scale={[1, 0.78, 1]}>
        <mesh><ringGeometry args={[5.6, 6.3, 64]} /><meshBasicMaterial color="#3fd6c6" transparent opacity={0.75} side={THREE.DoubleSide} /></mesh>
        <mesh><circleGeometry args={[5.6, 48]} /><meshBasicMaterial color="#0b3b38" transparent opacity={0.55} /></mesh>
        <mesh><sphereGeometry args={[5.5, 18, 12]} /><meshBasicMaterial color="#3fd6c6" wireframe transparent opacity={0.12} /></mesh>
      </group>
      <lineSegments geometry={spikes}><lineBasicMaterial color="#3fd6c6" transparent opacity={0.45} /></lineSegments>
      <mesh><boxGeometry args={[1.9, 1.9, 0.4]} /><meshBasicMaterial color="#f05a8c" /></mesh>
    </group>
  );
}

/** A cluster's hub: a small magenta centre; focused, it gets the crown like the core. Click expands, double click focuses. */
function ClusterHub({ cluster, center, focused, motion, onCluster }: { cluster: GraphCluster; center: Vec3; focused: boolean; motion: boolean; onCluster: (id: string, double: boolean) => void }) {
  const ref = useRef<THREE.Group>(null);
  const target = useMemo(() => new THREE.Vector3(...center), [center]);
  useFrame((_, delta) => { if (ref.current) ref.current.position.lerp(target, motion ? 1 - Math.pow(0.004, delta) : 1); });
  if (cluster.general) return null;
  return (
    <group ref={ref} position={center} onClick={(e) => { e.stopPropagation(); onCluster(cluster.id, false); }} onDoubleClick={(e) => { e.stopPropagation(); onCluster(cluster.id, true); }}>
      <mesh><boxGeometry args={[focused ? 1.6 : 0.9, focused ? 1.6 : 0.9, 0.3]} /><meshBasicMaterial color="#f05a8c" transparent opacity={focused ? 1 : 0.7} /></mesh>
      {focused && <mesh scale={[1, 0.78, 1]}><ringGeometry args={[4.2, 4.7, 48]} /><meshBasicMaterial color={CATEGORY_COLOR[cluster.category]} transparent opacity={0.7} side={THREE.DoubleSide} /></mesh>}
      <mesh visible={false}><circleGeometry args={[6, 12]} /><meshBasicMaterial /></mesh>
    </group>
  );
}

type LabelProps = SceneProps & { index: Map<string, number>; clusterOf: Map<string, GraphCluster>; pos: (id: string) => Vec3 };
/** Few labels: every cluster's name; a memory's only when hovered, selected, active, found, or in the focused cluster. */
function Labels({ graph, layout, selectedId, hoveredId, focusClusterId, highlights, index, pos, sections }: LabelProps) {
  const camera = useThree((s) => s.camera);
  const near = camera.position.length() < 260;
  const show = new Set<string>();
  for (const id of [hoveredId, selectedId]) if (id) show.add(id);
  const now = performance.now();
  // The Zeladora's reading: only her newest few, briefly (the reference labels the words under her tentacles);
  // a link is shown by its thread, not by labels on both ends.
  const reads = [...highlights].filter(([, h]) => (h.kind === "read" || (h.kind === "flagged" && h.note)) && now - h.at < 4000).sort((a, b) => b[1].at - a[1].at).slice(0, 8);
  for (const [id] of reads) show.add(id);
  for (const [id, h] of highlights) if (h.kind !== "read" && h.kind !== "linked" && !(h.kind === "flagged" && h.note) && (now - h.at < ACTIVE_MS || h.kind === "search")) show.add(id);
  // The cluster in focus names a few of its memories at the tips of its branches: one per angular slice around
  // the hub (the most proven in each), none near the centre — so the labels spread out instead of piling up.
  if (focusClusterId) {
    const box = layout.clusters.get(focusClusterId);
    const members = graph.clusters.find((c) => c.id === focusClusterId)?.nodeIds || [];
    const slices = near ? 14 : 9;
    const best = new Map<number, string>();
    for (const id of members) {
      const p = layout.nodes.get(id); if (!p || !box) continue;
      const dx = p[0] - box.center[0], dy = p[1] - box.center[1];
      if (Math.hypot(dx, dy) < box.radius * 0.45) continue;
      const slice = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2)) * slices) % slices;
      const current = best.get(slice);
      if (!current || (graph.nodes[index.get(id)!]?.relevance || 0) > (graph.nodes[index.get(current)!]?.relevance || 0)) best.set(slice, id);
    }
    for (const id of best.values()) show.add(id);
  }
  const ids = [...show].filter((id) => index.has(id)).slice(0, 30);
  return (
    <>
      {graph.clusters.map((c) => {
        const box = layout.clusters.get(c.id); if (!box) return null;
        return (
          <Html key={c.id} position={[box.center[0] + box.radius * 0.55, box.center[1] + box.radius * 0.95, box.center[2]]} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
            <div className={`lm-cluster-label ${c.id === focusClusterId ? "on" : ""} ${sections.get(c.id)?.state === "lendo" ? "reading" : sections.get(c.id)?.state === "na fila" ? "queued" : ""}`} style={{ color: c.id === focusClusterId || sections.get(c.id)?.state === "lendo" ? CATEGORY_COLOR[c.category] : undefined }}>
              <b>{c.label}</b><span>{sections.get(c.id) ? `${sections.get(c.id)!.read}/${sections.get(c.id)!.total} memórias · ${sections.get(c.id)!.state === "feito" ? "feito" : sections.get(c.id)!.state}` : `${c.nodeIds.length} ${c.nodeIds.length === 1 ? "memória" : "memórias"} · ${c.sublabel}`}</span>
            </div>
          </Html>
        );
      })}
      {ids.map((id) => {
        const n: GraphNode = graph.nodes[index.get(id)!];
        const h = highlights.get(id);
        const [x, y, z] = pos(id);
        // Left of its cluster's centre the label grows to the left, right of it to the right (outward).
        const box = layout.clusters.get(n.clusterId);
        const left = box ? x < box.center[0] : false;
        const text = focusClusterId === n.clusterId && id !== selectedId && id !== hoveredId ? (n.label.length > 22 ? `${n.label.slice(0, 21)}…` : n.label) : n.label;
        return (
          <Html key={`n:${id}`} position={[x + (left ? -1.6 : 1.6), y + 1.2, z]} zIndexRange={[20, 10]} style={{ pointerEvents: "none" }}>
            <div className={`lm-node-label ${left ? "left" : ""} ${id === selectedId ? "sel" : ""} ${h && now - h.at < ACTIVE_MS ? h.kind : ""} ${h?.note === "▶ vaga" ? "vague" : ""}`}>{text}{h?.kind === "recalled" && now - h.at < ACTIVE_MS ? ` · consultada${h.score != null ? ` · ${h.score.toFixed(2).replace(".", ",")}` : ""}` : h && now - h.at < ACTIVE_MS ? (h.note ? ` · ${h.note}` : KEEPER_SUFFIX[h.kind] || "") : ""}</div>
          </Html>
        );
      })}
    </>
  );
}

/** Moves the camera smoothly to a target (a cluster, a memory, the whole map) when the view asks. */
function CameraRig({ command, reduced }: { command: CameraCommand; reduced: boolean }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: OrbitControlsImpl | null };
  const goal = useRef<{ target: THREE.Vector3; position: THREE.Vector3 } | null>(null);
  useEffect(() => {
    if (!command) return;
    const target = new THREE.Vector3(...command.target);
    goal.current = { target, position: new THREE.Vector3(target.x, target.y - command.distance * 0.08, target.z + command.distance) };
  }, [command]);
  useFrame((_, delta) => {
    if (!goal.current || !controls) return;
    const k = reduced ? 1 : 1 - Math.pow(0.02, delta);
    controls.target.lerp(goal.current.target, k);
    camera.position.lerp(goal.current.position, k);
    controls.update();
    if (camera.position.distanceTo(goal.current.position) < 0.5) goal.current = null;
  });
  return null;
}

export default function LiveMapScene(props: SceneProps) {
  const high = props.settings.quality === "alta";
  return (
    <Canvas
      className="lm-canvas"
      dpr={high ? [1, 2] : 1}
      gl={{ antialias: high, powerPreference: "high-performance", alpha: false }}
      camera={{ position: [0, -30, 420], fov: 45, near: 0.5, far: 4000 }}
      raycaster={{ params: { Points: { threshold: 1.6 }, Mesh: {}, Line: { threshold: 0.5 }, LOD: {}, Sprite: {} } }}
      onCreated={({ gl }) => {
        gl.setClearColor("#07090d");
        gl.domElement.addEventListener("webglcontextlost", (e) => { e.preventDefault(); props.onContextLost(); }, { once: true });
      }}
      onPointerMissed={() => props.onSelect(null)}
    >
      <Scene {...props} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} enableRotate={false} screenSpacePanning minDistance={25} maxDistance={1400} zoomSpeed={0.9} panSpeed={0.9}
        mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }} touches={{ ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN }} />
      {high && (
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur intensity={0.55} luminanceThreshold={0.18} luminanceSmoothing={0.4} radius={0.6} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
