import { useCallback, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { ACTIVITY_COLOR, CATEGORY_COLOR, type GraphCluster, type GraphNode, type KeeperView, type MemoryGraph, type SectionState } from "./adapter";
import { hash01, type Layout, type Vec3 } from "./layout";
import { curvePoint, Writer } from "./ocean/draw";
import { newRope, newSwim, rippleRing, stepBend, stepPlankton, stepRope, stepSwim, type Pusher, type Ripple, type Rope } from "./ocean/physics";
import { bellMaterial, dynamicGeometry, lineMaterial, MEMBRANE_POINTS, membraneMaterial, pointMaterial, seaMaterial } from "./ocean/shaders";

/**
 * Memórias / Mapa Vivo — the living sea. The Aurora's memory as a bioluminescent ecosystem:
 *   - each section (one thought) is a living CELL: a membrane that breathes, dents under the person's hand and
 *     bulges when a ripple passes; it glows brighter as the Zeladora reads it;
 *   - each memory is an ORGANELLE drifting inside its cell; the links are SYNAPSES, and a touched memory sends
 *     impulses along them to its neighbours (two hops);
 *   - the Zeladora is a JELLYFISH (água-viva — living water): she swims by pulses of her bell to the memory she
 *     reads, her tentacles trailing; one reaches each memory she reads and its light flows back to her;
 *   - a question to the Aurora is an ELECTRIC IMPULSE that jumps from memory to memory across the cells;
 *   - the person's cursor is a current in the water (plankton parts, memories bend, membranes dent); a tap on
 *     the water sends a ripple.
 * Nothing is invented: every light, impulse and movement of a memory comes from a real memory or a real event.
 */
export type Quality = "alta" | "media" | "baixa";
/** autoFocus: the camera goes by itself to what is happening (the Zeladora, a question's memories). */
export type MapSettings = { paused: boolean; quality: Quality; labels: boolean; reducedMotion: boolean; autoFocus: boolean };
export type Highlight = { kind: "recalled" | "created" | "search" | "read" | "linked" | "flagged" | "joined"; at: number; score?: number; note?: string };
/** A turn of the Aurora as it happens: where it goes and what it reaches (all from real events). */
export type AgentTentacle = { id: string; kind: "scanned" | "recalled" | "created" | "used"; strength: number; order: number };
export type AgentState = { key: string; target: Vec3 | null; tentacles: AgentTentacle[]; ended: boolean } | null;
export type CameraCommand = { target: Vec3; distance: number; key: number } | null;
export type Merge = { from: Vec3[]; to: Vec3; at: number };

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
  /** Each section's state in the Zeladora's round. */
  sections: Map<string, SectionState>;
  /** The memories the Zeladora has read in this round (unread ones stay dim while she works); null: all lit. */
  readSet: Set<string> | null;
  /** Memories she is pulling into one (compaction / join), with where they were. */
  merges: Merge[];
  /** The person moved the map: automatic camera moves stop for a while. */
  onUserMove: () => void;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
  onCluster: (id: string, double: boolean) => void;
  onContextLost: () => void;
};

const color = (hex: string) => new THREE.Color(hex);
const ACTIVE_MS = 9000;
const WEB_DECAY_MS = 900;
const SIGNAL_MS = 650;
const TOUCH_STRENGTH: Partial<Record<string, number>> = { read: 1, linked: 1, recalled: 1, created: 0.9, joined: 1, flagged: 0.8, search: 0.45 };
const KEEPER_SUFFIX: Partial<Record<Highlight["kind"], string>> = { created: " · nova", read: " · lida", linked: " · ligada", flagged: " · conflito", joined: " · juntou" };
const PLANKTON: Record<Quality, number> = { alta: 2600, media: 1200, baixa: 300 };
const CURVE_STEPS = 8;
const WHITE = color("#eef2f6");
const GLOW = color("#9ff8ee");
const TEAL = color("#3fd6c6");
const YELLOW = color("#f2d14b");
const ACTIVITY = color(ACTIVITY_COLOR);
const MAGENTA = color("#f05a8c");
const GREY = color("#7b8794");

/** What every part of the sea shares: the hand, the ripples, where the jellyfish is, the clock. */
type World = { hand: { x: number; y: number; s: number }; ripples: Ripple[]; jelly: { x: number; y: number; r: number }; t: number; motion: boolean };
const pushersOf = (w: World, now: number, withJelly = true): Pusher[] => {
  const out: Pusher[] = [];
  if (w.hand.s > 0.02) out.push({ x: w.hand.x, y: w.hand.y, r: 26, s: w.hand.s });
  if (withJelly && w.jelly.r > 0) out.push({ x: w.jelly.x, y: w.jelly.y, r: w.jelly.r * 1.6, s: 0.45 });
  for (const r of w.ripples) { const ring = rippleRing(r, now); if (ring) out.push(ring); }
  return out;
};

function Scene(props: SceneProps) {
  const { graph, layout, settings, selectedId, hoveredId, focusClusterId, highlights, camera, onHover, onSelect, onCluster } = props;
  const nodes = graph.nodes;
  const index = useMemo(() => new Map(nodes.map((n, i) => [n.id, i])), [nodes]);
  const clusterOf = useMemo(() => new Map(graph.clusters.map((c) => [c.id, c])), [graph.clusters]);
  const motion = !settings.paused && !settings.reducedMotion;
  const world = useRef<World>({ hand: { x: 0, y: 0, s: 0 }, ripples: [], jelly: { x: 0, y: 0, r: 0 }, t: 0, motion });
  world.current.motion = motion;

  // ---------- where each memory is: eased to its place, drifting inside its cell, bent by the hand ----------
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
      born.current.set(n.id, firstLoad.current ? now + Math.min(2600, (i / Math.max(1, ordered.length)) * 2600) : now);
    });
    for (const id of [...current.current.keys()]) if (!index.has(id)) { current.current.delete(id); born.current.delete(id); }
    firstLoad.current = false;
  }, [nodes, layout, index, settings.reducedMotion]);
  const bend = useMemo(() => ({ ox: new Float32Array(nodes.length), oy: new Float32Array(nodes.length), vx: new Float32Array(nodes.length), vy: new Float32Array(nodes.length) }), [nodes.length]);
  const pos = (id: string): Vec3 => {
    const v = current.current.get(id); const i = index.get(id);
    if (!v) return layout.nodes.get(id) || [0, 0, 0];
    const t = world.current.t;
    // Organelles drift a little inside their cell, each at its own pace.
    const dx = motion ? Math.sin(t * 0.31 + hash01(id) * 6.28) * 1.5 : 0;
    const dy = motion ? Math.cos(t * 0.27 + hash01(id, 5) * 6.28) * 1.5 : 0;
    return [v.x + dx + (i !== undefined ? bend.ox[i] : 0), v.y + dy + (i !== undefined ? bend.oy[i] : 0), v.z];
  };
  const has = (id: string) => index.has(id);
  const hubOf = (id: string): Vec3 => layout.clusters.get(nodes[index.get(id) ?? -1]?.clusterId)?.center || layout.core;
  const focusIds = useMemo(() => {
    const ids = new Set<string>();
    const anchor = selectedId || hoveredId;
    if (anchor) { ids.add(anchor); for (const e of graph.edges) { if (e.from === anchor) ids.add(e.to); if (e.to === anchor) ids.add(e.from); } }
    return ids;
  }, [selectedId, hoveredId, graph.edges]);

  // ---------- the living web: touches, impulses along the synapses (two hops) ----------
  const touches = useRef(new Map<string, { at: number; s: number; hop: number; spread: boolean }>());
  const touch = useCallback((id: string, strength: number, hop = 0, at = performance.now()) => {
    const cur = touches.current.get(id);
    const curAmp = cur ? cur.s * Math.exp(-(at - cur.at) / WEB_DECAY_MS) : 0;
    if (strength > curAmp) touches.current.set(id, { at, s: strength, hop, spread: false });
  }, []);
  const amp = (id: string, now: number) => { const t = touches.current.get(id); if (!t) return 0; const age = now - t.at; return age < 0 ? 0 : t.s * Math.exp(-age / WEB_DECAY_MS); };
  const neighbours = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of graph.edges) { (m.get(e.from) || m.set(e.from, []).get(e.from)!).push(e.to); (m.get(e.to) || m.set(e.to, []).get(e.to)!).push(e.from); }
    return m;
  }, [graph.edges]);
  const lastTouch = useRef(0);
  useEffect(() => {
    let newest = lastTouch.current;
    for (const [id, h] of highlights) {
      if (h.at <= lastTouch.current) continue;
      touch(id, TOUCH_STRENGTH[h.kind] ?? 0.6, 0, h.at);
      newest = Math.max(newest, h.at);
    }
    lastTouch.current = newest;
  }, [highlights, touch]);

  // ---------- buffers ----------
  const nodeGeo = useMemo(() => dynamicGeometry(Math.max(1, nodes.length), true), [nodes.length]);
  const edgeGeo = useMemo(() => dynamicGeometry(Math.max(1, graph.edges.length) * CURVE_STEPS * 2, false), [graph.edges.length]);
  const sparkGeo = useMemo(() => dynamicGeometry(900, true), []);
  const bridgeGeo = useMemo(() => dynamicGeometry(Math.max(1, Math.min(80, graph.bridges.length)) * 24 * 2, false), [graph.bridges.length]);
  const materials = useMemo(() => ({ nodes: pointMaterial(2.2), edges: lineMaterial(), bridges: lineMaterial(), sparks: pointMaterial(3) }), []);
  useEffect(() => () => { Object.values(materials).forEach((m) => m.dispose()); }, [materials]);
  useEffect(() => () => { [nodeGeo, edgeGeo, sparkGeo, bridgeGeo].forEach((g) => g.dispose()); }, [nodeGeo, edgeGeo, sparkGeo, bridgeGeo]);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const segA = useMemo(() => new THREE.Vector3(), []);
  const segB = useMemo(() => new THREE.Vector3(), []);
  const c3 = useMemo(() => new THREE.Color(), []);
  const lastPluck = useRef(0);

  useFrame(({ clock }, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const now = performance.now();
    const t = clock.getElapsedTime();
    const w = world.current;
    w.t = t;
    w.hand.s *= Math.exp(-dt * 1.4); // the hand's current fades when it stops moving
    w.ripples = w.ripples.filter((r) => now - r.at < 2200);
    const ease = settings.reducedMotion ? 1 : 1 - Math.pow(0.0025, dt);

    // ---- the person's own memory keeps sending impulses; impulses hop to the neighbours ----
    if (now - lastPluck.current > 1500) {
      lastPluck.current = now;
      if (selectedId) touch(selectedId, 0.85);
      if (hoveredId && hoveredId !== selectedId) touch(hoveredId, 0.6);
    }
    for (const [id, tch] of touches.current) {
      const age = now - tch.at;
      if (age > WEB_DECAY_MS * 4) { touches.current.delete(id); continue; }
      if (!tch.spread && age >= SIGNAL_MS) {
        tch.spread = true;
        if (tch.hop < 2) for (const other of (neighbours.get(id) || []).slice(0, 8)) touch(other, tch.s * 0.55, tch.hop + 1, tch.at + SIGNAL_MS);
      }
    }

    // ---- memories bend away from the hand, the jellyfish and the ripples, then spring back ----
    if (motion) stepBend(bend.ox, bend.oy, bend.vx, bend.vy, (i) => { const v = current.current.get(nodes[i]?.id); return v ? { x: v.x, y: v.y } : { x: 0, y: 0 }; }, dt, pushersOf(w, now));

    // ---- organelles ----
    const dim = selectedId || hoveredId ? 0.4 : 1;
    const np = nodeGeo.getAttribute("position") as THREE.BufferAttribute;
    const ns = nodeGeo.getAttribute("size") as THREE.BufferAttribute;
    const na = nodeGeo.getAttribute("alpha") as THREE.BufferAttribute;
    const nt = nodeGeo.getAttribute("tint") as THREE.BufferAttribute;
    nodes.forEach((n, i) => {
      const v = current.current.get(n.id); const target = layout.nodes.get(n.id);
      if (!v || !target) return;
      const grow = Math.max(0, Math.min(1, (now - (born.current.get(n.id) || 0)) / 900));
      if (grow > 0) v.lerp(tmp.set(target[0], target[1], target[2]), ease);
      const [x, y, z] = pos(n.id);
      np.setXYZ(i, x, y, z);
      const hl = highlights.get(n.id);
      const active = hl && now - hl.at < ACTIVE_MS ? 1 - (now - hl.at) / ACTIVE_MS : 0;
      const shake = amp(n.id, now);
      const isFocus = focusIds.has(n.id);
      const unread = Boolean(props.readSet && !props.readSet.has(n.id)) && !active && !isFocus;
      const away = (focusClusterId && n.clusterId !== focusClusterId && !isFocus && !active) || unread;
      // A living light: each organelle breathes at its own pace.
      const breath = motion ? 1 + Math.sin(t * (0.9 + hash01(n.id, 7) * 0.8) + hash01(n.id) * 6.28) * 0.12 : 1;
      const base = (1.7 + n.relevance * 2.6 + (n.id === selectedId ? 4 : n.id === hoveredId ? 2.5 : 0) + active * 3 + shake * 2.2) * breath;
      ns.setX(i, base * grow);
      na.setX(i, Math.min(1, (0.6 + n.relevance * 0.35 + active + shake * 0.6) * (isFocus || active ? 1 : dim) * (away ? 0.32 : 1)));
      c3.set(CATEGORY_COLOR[n.category]).lerp(WHITE, away ? 0.2 : 0.4);
      if (away) c3.lerp(GREY, 0.6);
      c3.lerp(hl?.kind === "read" || hl?.kind === "linked" ? TEAL : hl?.kind === "flagged" ? YELLOW : ACTIVITY, active * 0.85).lerp(GLOW, Math.min(1, shake));
      if (n.id === selectedId) c3.lerp(MAGENTA, 0.5);
      nt.setXYZ(i, c3.r, c3.g, c3.b);
    });
    np.needsUpdate = ns.needsUpdate = na.needsUpdate = nt.needsUpdate = true;
    nodeGeo.setDrawRange(0, nodes.length);

    // ---- synapses: faint filaments that sway; a touched one vibrates and glows ----
    const ew = new Writer(edgeGeo).begin();
    for (const e of graph.edges) {
      const lit = focusIds.has(e.from) && focusIds.has(e.to) && (e.from === selectedId || e.to === selectedId || e.from === hoveredId || e.to === hoveredId);
      const shake = motion ? Math.max(amp(e.from, now), amp(e.to, now)) : 0;
      if (e.cross && !lit && shake < 0.08) continue;
      const a = pos(e.from); const b = pos(e.to);
      const alpha = Math.min(0.95, (lit ? 0.7 : (e.kind === "relacao" ? 0.14 : 0.022 + (e.weight - 0.5) * 0.09) * dim) + shake * 0.8);
      const fromNode = nodes[index.get(e.from) ?? -1];
      c3.set(fromNode ? CATEGORY_COLOR[fromNode.category] : "#8a93a3").lerp(TEAL, e.kind === "relacao" ? 0.45 : 0.2);
      if (shake > 0) c3.lerp(GLOW, Math.min(1, shake * 1.2));
      const curve = 0.18 * (hash01(e.id) - 0.5) + (motion ? Math.sin(t * 0.7 + hash01(e.id, 3) * 6.28) * 0.03 : 0);
      const dx = b[0] - a[0], dy = b[1] - a[1]; const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const wave = (u: number, out: THREE.Vector3) => { if (shake > 0.01) { const o = shake * Math.min(5, len * 0.08) * Math.sin(Math.PI * u) * Math.sin(t * 24 - u * 9 + hash01(e.id) * 6); out.x += nx * o; out.y += ny * o; } return out; };
      let prev = wave(0, curvePoint(a, b, 0, curve, segA));
      let next = segB;
      for (let s = 1; s <= CURVE_STEPS; s += 1) {
        wave(s / CURVE_STEPS, curvePoint(a, b, s / CURVE_STEPS, curve, next));
        ew.line(prev, next, alpha, c3);
        [prev, next] = [next, prev];
      }
    }
    ew.end();

    // ---- filaments between cells (aggregated links), slowly swaying ----
    const bw = new Writer(bridgeGeo).begin();
    for (const br of graph.bridges.slice(0, 80)) {
      const A = layout.clusters.get(br.a); const B = layout.clusters.get(br.b); if (!A || !B) continue;
      const strength = Math.min(0.22, 0.03 + Math.sqrt(br.count) * 0.02) * dim;
      c3.set(CATEGORY_COLOR[clusterOf.get(br.a)?.category || "geral"]).lerp(WHITE, 0.45);
      const curve = 0.2 * (hash01(br.a + br.b) > 0.5 ? 1 : -1) + (motion ? Math.sin(t * 0.25 + hash01(br.b) * 6) * 0.04 : 0);
      for (let s = 0; s < 24; s += 1) {
        const u0 = s / 24, u1 = (s + 1) / 24;
        const fade = Math.sin((Math.PI * (u0 + u1)) / 2);
        curvePoint(A.center, B.center, u0, curve, segA); curvePoint(A.center, B.center, u1, curve, segB);
        bw.line(segA, segB, strength * fade, c3);
      }
    }
    bw.end();

    // ---- sparks: impulses running along the synapses; event pulses from the middle of the cell ----
    const sw = new Writer(sparkGeo).begin();
    if (motion) for (const [id, tch] of touches.current) {
      const age = now - tch.at; if (age < 0 || age > SIGNAL_MS || tch.s < 0.15) continue;
      const a = pos(id); const u = age / SIGNAL_MS;
      for (const other of (neighbours.get(id) || []).slice(0, 8)) {
        if (sw.full) break;
        const b = pos(other);
        const curve = 0.18 * (hash01(id < other ? `${id}|${other}` : `${other}|${id}`) - 0.5);
        sw.dot(curvePoint(a, b, u, curve, tmp), 1.4 + tch.s * 2, Math.min(1, tch.s * 1.3) * (1 - u * 0.4), GLOW);
        sw.dot(curvePoint(a, b, Math.max(0, u - 0.06), curve, tmp), 1 + tch.s, Math.min(1, tch.s) * 0.45, GLOW);
      }
    }
    for (const [id, hl] of highlights) {
      if (sw.full) break;
      const age = now - hl.at; if (age > 2600 || (hl.kind !== "recalled" && hl.kind !== "created")) continue;
      if (!has(id)) continue;
      const travel = settings.reducedMotion ? 1 : Math.min(1, age / 1800);
      sw.dot(curvePoint(hubOf(id), pos(id), travel, 0.08, tmp), 3.2, 1 - age / 2600, hl.kind === "created" ? ACTIVITY : GLOW);
    }
    sw.end();
  });

  // Picking a memory: the raycaster's threshold covers its point.
  const pick = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.index !== undefined ? nodes[e.index]?.id ?? null : null);
  // The water: the cursor is a current; a tap sends a ripple.
  const plane0 = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const onWaterMove = (e: ThreeEvent<PointerEvent>) => {
    if (!e.ray.intersectPlane(plane0, hit)) return;
    const h = world.current.hand;
    const moved = Math.hypot(hit.x - h.x, hit.y - h.y);
    h.x = hit.x; h.y = hit.y; h.s = Math.min(1, h.s + moved * 0.06);
  };
  const onWaterClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return; // a drag of the map, not a tap
    if (e.ray.intersectPlane(plane0, hit) && motion) world.current.ripples.push({ x: hit.x, y: hit.y, at: performance.now() });
    onSelect(null);
  };

  return (
    <>
      <Sea world={world} onMove={onWaterMove} onClick={onWaterClick} onLeave={() => { world.current.hand.s = 0; }} />
      <Plankton world={world} layout={layout} quality={settings.quality} />
      <Membranes graph={graph} layout={layout} pos={pos} amp={amp} world={world} sections={props.sections} keeper={props.keeper} focusClusterId={focusClusterId} readSet={props.readSet} onCluster={onCluster} />
      <lineSegments geometry={bridgeGeo} material={materials.bridges} frustumCulled={false} />
      <lineSegments geometry={edgeGeo} material={materials.edges} frustumCulled={false} />
      <points
        geometry={nodeGeo} material={materials.nodes} frustumCulled={false}
        onPointerMove={(e) => { e.stopPropagation(); onHover(pick(e)); onWaterMove(e); }}
        onPointerOut={() => onHover(null)}
        onClick={(e) => { e.stopPropagation(); onSelect(pick(e)); }}
      />
      <points geometry={sparkGeo} material={materials.sparks} frustumCulled={false} />
      <Fusions merges={props.merges} reduced={settings.reducedMotion} />
      <Lightning agent={props.agent} hubOf={hubOf} pos={pos} has={has} reduced={settings.reducedMotion} />
      <Medusa keeper={props.keeper} core={layout.core} pos={pos} has={has} world={world} reduced={settings.reducedMotion} touch={touch} />
      {settings.labels && <Labels {...props} index={index} clusterOf={clusterOf} pos={pos} />}
      <CameraRig command={camera} reduced={settings.reducedMotion} onUserMove={props.onUserMove} />
    </>
  );
}

// ================================================================== the water
function Sea({ world, onMove, onClick, onLeave }: { world: React.MutableRefObject<World>; onMove: (e: ThreeEvent<PointerEvent>) => void; onClick: (e: ThreeEvent<MouseEvent>) => void; onLeave: () => void }) {
  const material = useMemo(() => seaMaterial(), []);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(() => {
    material.uniforms.uTime.value = world.current.motion ? world.current.t : 0;
    const h = world.current.hand; (material.uniforms.uHand.value as THREE.Vector3).set(h.x, h.y, h.s);
  });
  return (
    <mesh position={[0, 0, -60]} material={material} onPointerMove={onMove} onClick={onClick} onPointerLeave={onLeave} renderOrder={-10}>
      <planeGeometry args={[9000, 9000]} />
    </mesh>
  );
}

/** Plankton: thousands of specks in a slow current, parting around the hand, the jellyfish and the ripples. */
function Plankton({ world, layout, quality }: { world: React.MutableRefObject<World>; layout: Layout; quality: Quality }) {
  const count = PLANKTON[quality];
  const bounds = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const c of layout.clusters.values()) { minX = Math.min(minX, c.center[0] - c.radius); maxX = Math.max(maxX, c.center[0] + c.radius); minY = Math.min(minY, c.center[1] - c.radius); maxY = Math.max(maxY, c.center[1] + c.radius); }
    if (!Number.isFinite(minX)) { minX = -200; maxX = 200; minY = -200; maxY = 200; }
    const m = 160;
    return { minX: minX - m, maxX: maxX + m, minY: minY - m, maxY: maxY + m };
  }, [layout]);
  const state = useMemo(() => {
    const px = new Float32Array(count), py = new Float32Array(count), vx = new Float32Array(count), vy = new Float32Array(count), pz = new Float32Array(count), tw = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      px[i] = bounds.minX + hash01(`p${i}`) * (bounds.maxX - bounds.minX);
      py[i] = bounds.minY + hash01(`p${i}`, 3) * (bounds.maxY - bounds.minY);
      pz[i] = -40 + hash01(`p${i}`, 5) * 50; tw[i] = hash01(`p${i}`, 9) * 6.28;
    }
    return { px, py, vx, vy, pz, tw };
  }, [count, bounds]);
  const geo = useMemo(() => dynamicGeometry(count, true), [count]);
  const material = useMemo(() => pointMaterial(1), []);
  useEffect(() => () => { geo.dispose(); material.dispose(); }, [geo, material]);
  const tint = useMemo(() => new THREE.Color(), []);
  useFrame((_, rawDelta) => {
    const w = world.current;
    if (w.motion) stepPlankton(state.px, state.py, state.vx, state.vy, Math.min(rawDelta, 0.05), w.t, bounds, pushersOf(w, performance.now()));
    const out = new Writer(geo).begin();
    for (let i = 0; i < count; i += 1) {
      const depth = (state.pz[i] + 40) / 50; // the far ones are fainter
      const twinkle = 0.55 + 0.45 * Math.sin(w.t * 1.3 + state.tw[i]);
      const speed = Math.min(1, Math.hypot(state.vx[i], state.vy[i]) / 18);
      tint.setRGB(0.45 + speed * 0.4, 0.85, 0.9);
      out.dot({ x: state.px[i], y: state.py[i], z: state.pz[i] }, 0.35 + depth * 0.5 + speed * 0.4, (0.08 + depth * 0.16) * twinkle + speed * 0.25, tint);
    }
    out.end();
  });
  return <points geometry={geo} material={material} frustumCulled={false} />;
}

// ================================================================== the cells
/**
 * One membrane per section: a metaball field around its memories (an envelope of the outermost ones plus the
 * most proven inside), breathing; it dims while the Zeladora has not reached it in her round, glows as she
 * reads it, flashes when its memories are touched, dents under the hand and the jellyfish, bulges with ripples.
 * A double click inside focuses the section.
 */
type Cell = { cluster: GraphCluster; box: { center: Vec3; radius: number }; members: string[]; size: number; material: THREE.ShaderMaterial; seed: number };
function Membranes({ graph, layout, pos, amp, world, sections, keeper, focusClusterId, readSet, onCluster }: {
  graph: MemoryGraph; layout: Layout; pos: (id: string) => Vec3; amp: (id: string, now: number) => number; world: React.MutableRefObject<World>;
  sections: Map<string, SectionState>; keeper: KeeperView | null; focusClusterId: string | null; readSet: Set<string> | null; onCluster: (id: string, double: boolean) => void;
}) {
  const cells = useMemo(() => {
    const relevance = new Map(graph.nodes.map((n) => [n.id, n.relevance]));
    const out: Cell[] = [];
    for (const c of graph.clusters) {
      const box = layout.clusters.get(c.id);
      if (!box || !c.nodeIds.length) continue;
      // The envelope: the farthest memory in each of 28 directions, then the most relevant others.
      const byDir = new Map<number, { id: string; d: number }>();
      for (const id of c.nodeIds) {
        const p = layout.nodes.get(id); if (!p) continue;
        const dx = p[0] - box.center[0], dy = p[1] - box.center[1];
        const k = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2)) * 28) % 28;
        const d = Math.hypot(dx, dy);
        if (!byDir.has(k) || byDir.get(k)!.d < d) byDir.set(k, { id, d });
      }
      const chosen = new Set([...byDir.values()].map((x) => x.id));
      for (const id of [...c.nodeIds].sort((a, b) => (relevance.get(b) || 0) - (relevance.get(a) || 0))) { if (chosen.size >= MEMBRANE_POINTS) break; chosen.add(id); }
      out.push({ cluster: c, box, members: [...chosen], size: box.radius * 2 + 90, material: membraneMaterial(), seed: hash01(c.id) });
    }
    return out;
  }, [graph, layout]);
  useEffect(() => () => { cells.forEach((c) => c.material.dispose()); }, [cells]);
  useFrame(() => {
    const w = world.current; const now = performance.now();
    const ripple = w.ripples.length ? w.ripples[w.ripples.length - 1] : null;
    const ring = ripple ? rippleRing(ripple, now) : null;
    const walking = Boolean(keeper?.enabled && keeper.phase === "andando" && readSet);
    for (const cell of cells) {
      const u = cell.material.uniforms;
      const pts = u.uPts.value as THREE.Vector4[];
      const r = Math.max(9, Math.min(26, cell.box.radius * 0.32));
      let pulse = 0;
      cell.members.forEach((id, i) => { const p = pos(id); pts[i].set(p[0], p[1], r * (0.85 + hash01(id) * 0.3), 0); pulse = Math.max(pulse, amp(id, now)); });
      u.uCount.value = cell.members.length;
      (u.uColor.value as THREE.Color).set(CATEGORY_COLOR[cell.cluster.category]);
      u.uTime.value = w.motion ? w.t : 0;
      u.uSeed.value = cell.seed;
      const sec = sections.get(cell.cluster.id);
      u.uQueued.value = walking && sec?.state === "na fila" ? 1 : 0;
      u.uFill.value = sec ? (sec.total ? sec.read / sec.total : 0) * (sec.state === "lendo" ? 1.4 : 0.8) : 0.5;
      u.uAlpha.value = focusClusterId && focusClusterId !== cell.cluster.id ? 0.4 : sec?.state === "lendo" ? 1.25 : 1;
      u.uPulse.value = Math.min(1, pulse);
      (u.uHand.value as THREE.Vector3).set(w.hand.x, w.hand.y, w.hand.s);
      (u.uJelly.value as THREE.Vector3).set(w.jelly.x, w.jelly.y, w.jelly.r);
      (u.uRipple.value as THREE.Vector4).set(ripple?.x || 0, ripple?.y || 0, ring?.r || 0, ring?.s || 0);
    }
  });
  return (
    <>
      {cells.map((cell) => (
        <mesh key={cell.cluster.id} position={[cell.box.center[0], cell.box.center[1], -1.5]} material={cell.material} renderOrder={-5}
          onDoubleClick={(e) => { const dx = e.point.x - cell.box.center[0], dy = e.point.y - cell.box.center[1]; if (Math.hypot(dx, dy) < cell.box.radius * 1.1) { e.stopPropagation(); onCluster(cell.cluster.id, true); } }}>
          <planeGeometry args={[cell.size, cell.size]} />
        </mesh>
      ))}
    </>
  );
}

// ================================================================== the Zeladora: a jellyfish
/**
 * A Zeladora (app/memoryKeeper.js) as a moon jellyfish seen from above. She swims by pulses of her bell to the
 * memory she reads; a fringe of fine tentacles waves at her margin; four oral arms trail behind her; her long
 * tentacles (Verlet ropes) trail in the water — and one reaches each memory she has just read: the memory
 * ripples and its light flows back up the tentacle to her. Linking, compacting and flagging make her bell
 * flash; her speech bubble says what she is doing. Her body pushes the water: plankton parts, membranes dent.
 */
const TENTACLES = 22;
const ARMS = 4;
const BELL = 10;
const FRINGE = 72;
function Medusa({ keeper, core, pos, has, world, reduced, touch }: { keeper: KeeperView | null; core: Vec3; pos: (id: string) => Vec3; has: (id: string) => boolean; world: React.MutableRefObject<World>; reduced: boolean; touch: (id: string, strength: number) => void }) {
  const swim = useRef(newSwim(core[0] + 30, core[1] - 30));
  const ropes = useRef<Rope[]>([]);
  const arms = useRef<Rope[]>([]);
  const bell = useRef<THREE.Mesh>(null);
  const group = useRef<THREE.Group>(null);
  const bellMat = useMemo(() => bellMaterial(), []);
  const lines = useMemo(() => dynamicGeometry((TENTACLES * 16 + ARMS * 18 * 2 + FRINGE) * 2, false), []);
  const dots = useMemo(() => dynamicGeometry(TENTACLES * 3 + 40, true), []);
  const lineMat = useMemo(() => lineMaterial(), []);
  const dotMat = useMemo(() => pointMaterial(2), []);
  useEffect(() => () => { bellMat.dispose(); lines.dispose(); dots.dispose(); lineMat.dispose(); dotMat.dispose(); }, [bellMat, lines, dots, lineMat, dotMat]);
  const reached = useRef(new Set<string>());
  const c3 = useMemo(() => new THREE.Color(), []);
  const pink = useMemo(() => new THREE.Color("#f58fb0"), []);
  const pale = useMemo(() => new THREE.Color("#bff4ff"), []);
  const white = useMemo(() => new THREE.Color("#ffffff"), []);

  useFrame(({ clock }, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const t = reduced ? 0 : clock.getElapsedTime();
    const visible = Boolean(keeper?.enabled);
    if (group.current) group.current.visible = visible;
    if (!visible || !keeper) { lines.setDrawRange(0, 0); dots.setDrawRange(0, 0); world.current.jelly.r = 0; return; }
    const now = Date.now();
    const s = swim.current;
    // Where she swims: beside the memory she reads; resting, near the middle of the sea.
    const reading = keeper.current && has(keeper.current) ? pos(keeper.current) : null;
    const target = reading ? { x: reading[0] + 12, y: reading[1] - 12 } : { x: core[0] + 30, y: core[1] - 30 };
    if (reduced) { s.x = target.x; s.y = target.y; s.contraction = 0; } else stepSwim(s, target, dt);
    const acting = keeper.saying ? Math.max(0, 1 - (now - keeper.saying.at) / 900) : 0;
    const R = BELL * (1 - s.contraction * 0.14);
    world.current.jelly = { x: s.x, y: s.y, r: R };
    if (group.current) group.current.position.set(s.x, s.y, 2);
    if (bell.current) { bell.current.scale.set(R * 2 * (1 + s.contraction * 0.05), R * 2 * (1 - s.contraction * 0.05), 1); bell.current.rotation.z = s.heading; }
    bellMat.uniforms.uTime.value = t; bellMat.uniforms.uContract.value = s.contraction; bellMat.uniforms.uFlash.value = acting * (keeper.saying?.action === "read" ? 0.4 : 1);
    const back = { x: -Math.cos(s.heading), y: -Math.sin(s.heading) };
    const speed = Math.hypot(s.vx, s.vy);
    const flow = { x: back.x * (1.5 + speed * 0.2), y: back.y * (1.5 + speed * 0.2) };
    const pushers = world.current.hand.s > 0.02 ? [{ x: world.current.hand.x, y: world.current.hand.y, r: 22, s: world.current.hand.s }] : [];

    const lw = new Writer(lines).begin();
    const dw = new Writer(dots).begin();
    // ---- the fringe at her margin (longer behind her as she swims) ----
    for (let i = 0; i < FRINGE; i += 1) {
      const a = (i / FRINGE) * Math.PI * 2 + s.heading;
      const behind = 0.5 + 0.5 * -Math.cos(a - s.heading);
      const len = 2 + behind * (3 + speed * 0.15) + Math.sin(t * 3 + i) * 0.6;
      const bx = s.x + Math.cos(a) * R * 0.97, by = s.y + Math.sin(a) * R * 0.97;
      lw.line({ x: bx, y: by, z: 2 }, { x: bx + Math.cos(a) * len * 0.5 + back.x * len * 0.5, y: by + Math.sin(a) * len * 0.5 + back.y * len * 0.5, z: 2 }, 0.45, pale, 0.05);
    }
    // ---- four oral arms trailing behind, frilly ----
    if (arms.current.length !== ARMS) arms.current = Array.from({ length: ARMS }, () => newRope(18, s.x, s.y, 1.9));
    arms.current.forEach((rope, k) => {
      const a = s.heading + Math.PI / 4 + (k * Math.PI) / 2;
      const ax = s.x + Math.cos(a) * R * 0.22, ay = s.y + Math.sin(a) * R * 0.22;
      if (!reduced) stepRope(rope, ax, ay, dt, { flow, sway: k * 1.7, t, pushers });
      for (let i = 1; i < rope.px.length; i += 1) {
        const f = 1 - i / rope.px.length;
        const frill = Math.sin(i * 1.3 + t * 3 + k) * 1.2 * f;
        const dx = rope.px[i] - rope.px[i - 1], dy = rope.py[i] - rope.py[i - 1]; const d = Math.hypot(dx, dy) || 1;
        const nx = -dy / d, ny = dx / d;
        c3.copy(pink).lerp(white, 0.3 * f);
        lw.line({ x: rope.px[i - 1], y: rope.py[i - 1], z: 1.5 }, { x: rope.px[i], y: rope.py[i], z: 1.5 }, 0.55 * f + 0.1, c3);
        lw.line({ x: rope.px[i - 1] + nx * frill, y: rope.py[i - 1] + ny * frill, z: 1.5 }, { x: rope.px[i] - nx * frill, y: rope.py[i] - ny * frill, z: 1.5 }, 0.3 * f, c3);
      }
    });
    // ---- long tentacles: trailing; one reaches each memory she just read ----
    if (ropes.current.length !== TENTACLES) ropes.current = Array.from({ length: TENTACLES }, () => newRope(16, s.x, s.y, 2.4));
    const readNow = (keeper.trail || []).filter((id) => has(id) && now - (keeper.trailAt[id] || 0) < 7000).slice(0, TENTACLES);
    ropes.current.forEach((rope, k) => {
      const a = (k / TENTACLES) * Math.PI * 2 + s.heading;
      const ax = s.x + Math.cos(a) * R * 0.92, ay = s.y + Math.sin(a) * R * 0.92;
      const id = readNow[k];
      const p = id ? pos(id) : null;
      const age = id ? now - (keeper.trailAt[id] || 0) : 0;
      if (id && age > 350 && !reached.current.has(`${id}:${keeper.trailAt[id]}`)) { reached.current.add(`${id}:${keeper.trailAt[id]}`); touch(id, 1); }
      if (!reduced) stepRope(rope, ax, ay, dt, { flow, sway: k * 0.9, t, reach: p ? { x: p[0], y: p[1] } : null, maxStretch: 4, pushers });
      const kind = id ? keeper.kinds[id] : undefined;
      c3.set(kind === "vaga" ? "#f05a8c" : kind === "valor" ? "#f2d14b" : "#9ff8ee");
      for (let i = 1; i < rope.px.length; i += 1) {
        const f = i / rope.px.length;
        lw.line({ x: rope.px[i - 1], y: rope.py[i - 1], z: 1 }, { x: rope.px[i], y: rope.py[i], z: 1 }, id ? 0.75 - f * 0.25 : 0.32 * (1 - f) + 0.05, c3);
      }
      if (id && p) {
        dw.dot(p, 2.2, 0.9, c3);
        // The memory's light comes back up the tentacle.
        if (age > 350 && age < 1400) { const u = 1 - (age - 350) / 1050; const j = Math.floor(u * (rope.px.length - 1)); dw.dot({ x: rope.px[j], y: rope.py[j], z: 1.2 }, 3.4, 1, white); }
      }
    });
    if (reached.current.size > 400) reached.current = new Set([...reached.current].slice(-200));
    lw.end(); dw.end();
  });

  const saying = keeper?.saying?.text || (keeper?.phase === "descansando" ? "descansando" : "");
  return (
    <>
      <lineSegments geometry={lines} material={lineMat} frustumCulled={false} />
      <points geometry={dots} material={dotMat} frustumCulled={false} />
      <group ref={group} visible={false}>
        <mesh ref={bell} material={bellMat} renderOrder={5}><planeGeometry args={[1, 1]} /></mesh>
        {saying && (
          <Html position={[BELL + 6, BELL + 6, 0]} zIndexRange={[30, 25]} style={{ pointerEvents: "none" }}>
            <div className={`lm-bubble ${keeper?.saying?.action || ""}`}><b>zeladora</b>{keeper?.called ? <i> · a seu pedido</i> : null}<span>{saying}</span></div>
          </Html>
        )}
      </group>
    </>
  );
}

// ================================================================== a question: an electric impulse
/**
 * How the Aurora reaches her memories in a chat turn (the brain working, not the Zeladora): an electric impulse
 * that jumps from memory A to memory B — the memories recalled into the turn, in the order the search ranked
 * them — crackling, hop by hop, across the cells; one memory alone is reached from the middle of its cell. The
 * candidates the search weighed glow faintly. All from the turn's real events; it fades when the turn ends.
 */
const BOLT = color("#e8f6ff");
const BOLT_GLOW = color("#7fd6ff");
function Lightning({ agent, hubOf, pos, has, reduced }: { agent: AgentState; hubOf: (id: string) => Vec3; pos: (id: string) => Vec3; has: (id: string) => boolean; reduced: boolean }) {
  const born = useRef(0);
  const endedAt = useRef<number | null>(null);
  const lines = useMemo(() => dynamicGeometry(12 * 14 * 2 * 2, false), []);
  const dots = useMemo(() => dynamicGeometry(60, true), []);
  const lineMat = useMemo(() => lineMaterial(), []);
  const dotMat = useMemo(() => pointMaterial(2), []);
  useEffect(() => () => { lines.dispose(); dots.dispose(); lineMat.dispose(); dotMat.dispose(); }, [lines, dots, lineMat, dotMat]);
  useEffect(() => { born.current = performance.now(); endedAt.current = null; }, [agent?.key]);
  useEffect(() => { if (agent?.ended && endedAt.current === null) endedAt.current = performance.now(); }, [agent?.ended]);
  const faint = useMemo(() => new THREE.Color("#9fb3c8"), []);
  useFrame(() => {
    const now = performance.now();
    const fade = endedAt.current !== null ? Math.max(0, 1 - (now - endedAt.current) / 3000) : 1;
    const lw = new Writer(lines).begin(); const dw = new Writer(dots).begin();
    if (agent && fade > 0) {
      for (const x of agent.tentacles) if (x.kind === "scanned" && has(x.id)) dw.dot(pos(x.id), 1.6, (0.25 + x.strength * 0.4) * fade, faint);
      const used = agent.tentacles.filter((x) => (x.kind === "recalled" || x.kind === "used" || x.kind === "created") && has(x.id)).sort((a, b) => a.order - b.order).slice(0, 12);
      const stops = used.map((x) => pos(x.id));
      const points: Vec3[] = stops.length === 1 ? [hubOf(used[0].id), stops[0]] : stops;
      const HOP = reduced ? 1 : 520;
      // The crackle: the bolt's kinks change every ~70 ms.
      const flicker = Math.floor(now / 70);
      for (let i = 0; i + 1 < points.length; i += 1) {
        const grow = reduced ? 1 : Math.max(0, Math.min(1, (now - born.current - i * HOP) / HOP));
        if (grow <= 0) break;
        const a = points[i], b = points[i + 1];
        const dx = b[0] - a[0], dy = b[1] - a[1]; const len = Math.hypot(dx, dy) || 1; const nx = -dy / len, ny = dx / len;
        let prev = { x: a[0], y: a[1], z: 3 };
        const SEG = 14;
        for (let s = 1; s <= SEG; s += 1) {
          const u = s / SEG; if (u > grow + 1 / SEG) break;
          const uu = Math.min(u, grow);
          const jag = s === SEG || uu >= grow ? 0 : (hash01(`${i}:${s}:${flicker}`) - 0.5) * Math.min(14, len * 0.12);
          const next = { x: a[0] + dx * uu + nx * jag, y: a[1] + dy * uu + ny * jag, z: 3 };
          lw.line(prev, next, 0.95 * fade, BOLT);
          lw.line({ x: prev.x + nx * 0.6, y: prev.y + ny * 0.6, z: 3 }, { x: next.x + nx * 0.6, y: next.y + ny * 0.6, z: 3 }, 0.35 * fade, BOLT_GLOW);
          prev = next;
        }
        dw.dot(a, 4, fade, BOLT);
        if (grow >= 1) dw.dot(b, 4.5, fade, BOLT); else dw.dot(prev, 5, 1, BOLT);
      }
    }
    lw.end(); dw.end();
  });
  return (
    <>
      <lineSegments geometry={lines} material={lineMat} frustumCulled={false} renderOrder={6} />
      <points geometry={dots} material={dotMat} frustumCulled={false} renderOrder={6} />
    </>
  );
}

// ================================================================== compaction: memories fusing
function Fusions({ merges, reduced }: { merges: Merge[]; reduced: boolean }) {
  const lines = useMemo(() => dynamicGeometry(200, false), []);
  const dots = useMemo(() => dynamicGeometry(120, true), []);
  const lineMat = useMemo(() => lineMaterial(), []);
  const dotMat = useMemo(() => pointMaterial(2), []);
  useEffect(() => () => { lines.dispose(); dots.dispose(); lineMat.dispose(); dotMat.dispose(); }, [lines, dots, lineMat, dotMat]);
  const violet = useMemo(() => new THREE.Color("#b49cff"), []);
  const white = useMemo(() => new THREE.Color("#ffffff"), []);
  const v1 = useMemo(() => new THREE.Vector3(), []);
  const v2 = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const now = Date.now();
    const lw = new Writer(lines).begin(); const dw = new Writer(dots).begin();
    for (const m of merges) {
      const age = now - m.at; if (age > 2400) continue;
      const u = reduced ? 1 : Math.min(1, age / 1300); const e = u * u * (3 - 2 * u);
      m.from.forEach((f, j) => {
        if (u >= 1) return;
        const curve = 0.32 * (j % 2 ? 1 : -1);
        const head = curvePoint(f, m.to, e, curve, v1); const tail = curvePoint(f, m.to, Math.max(0, e - 0.2), curve, v2);
        lw.line(tail, head, 0.9, violet, 0.1); dw.dot(head, 3.4, 1, violet);
      });
      if (u >= 1) {
        const r = (age - 1300) / 1100;
        dw.dot(m.to, 5 + r * 26, Math.max(0, 1 - r) * 0.85, white);
        for (let s = 0; s < 12; s += 1) { const a = (s / 12) * Math.PI * 2; dw.dot([m.to[0] + Math.cos(a) * r * 18, m.to[1] + Math.sin(a) * r * 18, m.to[2]], 1.8, Math.max(0, 1 - r), violet); }
      }
    }
    lw.end(); dw.end();
  });
  return (
    <>
      <lineSegments geometry={lines} material={lineMat} frustumCulled={false} />
      <points geometry={dots} material={dotMat} frustumCulled={false} />
    </>
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
function CameraRig({ command, reduced, onUserMove }: { command: CameraCommand; reduced: boolean; onUserMove: () => void }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: OrbitControlsImpl | null };
  const goal = useRef<{ target: THREE.Vector3; position: THREE.Vector3 } | null>(null);
  // The person moves the map (drags or zooms — not a mere tap on the water): the camera stops going anywhere
  // on its own (no tug of war).
  useEffect(() => {
    if (!controls) return undefined;
    let holding = false;
    const start = () => { holding = true; };
    const end = () => { holding = false; };
    const change = () => { if (holding) { goal.current = null; onUserMove(); } };
    const wheel = () => { goal.current = null; onUserMove(); };
    controls.addEventListener("start", start); controls.addEventListener("end", end); controls.addEventListener("change", change);
    const dom = (controls as unknown as { domElement?: HTMLElement }).domElement;
    dom?.addEventListener("wheel", wheel, { passive: true });
    return () => { controls.removeEventListener("start", start); controls.removeEventListener("end", end); controls.removeEventListener("change", change); dom?.removeEventListener("wheel", wheel); };
  }, [controls, onUserMove]);
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
        gl.setClearColor("#03111a");
        gl.domElement.addEventListener("webglcontextlost", (e) => { e.preventDefault(); props.onContextLost(); }, { once: true });
      }}
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
