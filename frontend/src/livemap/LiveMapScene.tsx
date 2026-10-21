import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { ACTIVITY_COLOR, CATEGORY_COLOR, type KeeperView, type MemoryGraph, type SectionState } from "./adapter";
import { hash01, type Vec3 } from "./layout";
import { pathBetween, pathTo, type MemoryTree, type TreeLayout } from "./tree";
import { dynamicGeometry, gradient, lineMaterial, pointMaterial, ribbonGeometry, ribbonMaterial, RibbonWriter, Writer } from "./gfx";

/**
 * Memórias / Mapa Vivo — the memory as a living search tree (tree.ts), drawn like an instrument:
 *   - the ROOT at the bottom is the Aurora; one branch per section fans out from it; forks join memories that
 *     mean nearly the same thing near the canopy and different ones near the base; each memory is a LEAF (a
 *     point of light), the newest ones highest;
 *   - a question to the Aurora is a SEARCH WAVE that sweeps the canopy from the root (the memories it weighed
 *     light up as it passes), then the memories it really used are reached by a GLOWING PATH that climbs the
 *     branches from the root to each of them, with a callout at the best one;
 *   - the Zeladora is a smaller wave that walks the canopy memory by memory; each step draws her way from the
 *     memory she read to the next along the branches (A → B through their common fork); a link she makes is
 *     an arc between two leaves; a section she has not tended yet is dim;
 *   - she also shapes the tree: a new memory she adopts grows in with a green path from the root, an obsolete
 *     one she prunes is cut and falls to the ground, a new node (a section split off or sprouted for a new
 *     subject) lights up from its base, a node she folds closes in on itself and its memories go to the next;
 *   - the recent questions stay at the base as small bushes (one twig per memory used); a click replays one;
 *   - the person's cursor is a lens (branches and leaves near it brighten; the nearest memory shows its way
 *     from the root); a tap anywhere sends a wave from the root.
 * Nothing is invented: every leaf is a stored memory, every path and wave a real event.
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
/** A recent answer and the memories it used (a bush at the base of the tree). */
export type RecallBush = { id: string; at: string; prompt: string; used: string[] };

type SceneProps = {
  graph: MemoryGraph;
  layout: TreeLayout;
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
  recalls: RecallBush[];
  /** The person moved the map: automatic camera moves stop for a while. */
  onUserMove: () => void;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
  onCluster: (id: string, double: boolean) => void;
  onContextLost: () => void;
};

const col = (hex: string) => new THREE.Color(hex);
const ACTIVE_MS = 9000;
const REVEAL_MS = 1150;
const C = {
  branch: col("#8796ab"), leaf: col("#e8eef6"), dust: col("#a9bad0"), white: col("#ffffff"),
  wave: col("#8fc2ff"), waveHot: col("#eaf4ff"),
  keeper: col("#3fd6c6"), keeperHot: col("#cbfff7"),
  recall: col("#ff9d5c"), created: col(ACTIVITY_COLOR), flag: col("#f2d14b"), select: col("#ff7aa8"), search: col("#9cc8ff"),
  prune: col("#ff7a4d"), pruneDim: col("#7a3a26"), fold: col("#b9a2ff"),
};
type PathKind = "consulta" | "zeladora" | "criada" | "selecao" | "hover";
const PALETTE: Record<PathKind, [number, THREE.Color][]> = {
  consulta: [[0, col("#f4e4ff")], [0.45, col("#ffffff")], [0.8, col("#93f5d4")], [1, col("#ff9a55")]],
  zeladora: [[0, col("#d4fff8")], [1, col("#3fd6c6")]],
  criada: [[0, col("#eaffef")], [1, col(ACTIVITY_COLOR)]],
  selecao: [[0, col("#ffffff")], [1, col("#ff7aa8")]],
  hover: [[0, col("#aab7c8")], [1, col("#ffffff")]],
};
type PathSpec = { key: string; nodes: number[]; kind: PathKind; at: number; strength: number; until?: number };
type WaveKind = "busca" | "ronda" | "toque";
type Wave = { at: number; a0: number; a1: number; dur: number; s: number; seed: number; kind: WaveKind };
const WAVE_COLOR: Record<WaveKind | "zeladora", [THREE.Color, THREE.Color]> = { busca: [C.wave, C.waveHot], ronda: [C.keeper, C.keeperHot], toque: [col("#b8c6d8"), C.white], zeladora: [C.keeper, C.keeperHot] };
// What lit a node most recently (its colour while it glows).
const GLOW_COLOR = [C.white, C.wave, C.keeper, C.recall, C.created];
const HL_COLOR: Record<Highlight["kind"], THREE.Color> = { recalled: C.recall, created: C.created, search: C.search, read: C.keeper, linked: C.keeper, flagged: C.flag, joined: C.white };
const DUST: Record<Quality, number> = { alta: 1600, media: 800, baixa: 0 };
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const easeOut = (u: number) => 1 - Math.pow(1 - u, 3);
const PRUNE_MS = 3400, ARRIVAL_MS = 2400, ADOPT_MS = 2800, BORN_MS = 4800, GONE_MS = 3200;
/** Where a memory and a section were last drawn (kept after they leave the tree: a pruned leaf falls from there). */
export type LastSeen = { leaves: Map<string, [number, number]>; sections: Map<string, { x: number; y: number; bx: number; by: number }> };

/** Where everything shares: the cursor (a lens), the camera's world-per-pixel, the clock. */
type World = { hand: { x: number; y: number; s: number }; wpp: number; t: number };

function Scene(props: SceneProps) {
  const { graph, layout, settings, selectedId, hoveredId, focusClusterId, highlights, camera, agent, keeper, onHover, onSelect, onCluster } = props;
  const tree = layout.tree;
  const R = tree.R;
  const motion = !settings.paused && !settings.reducedMotion;
  const reduced = settings.reducedMotion;
  const polarX = (r: number, a: number) => R * r * Math.sin(a);
  const polarY = (r: number, a: number) => R * r * Math.cos(a);
  const nodeOf = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const leaves = useMemo(() => [...tree.leafOf.entries()], [tree]);
  const world = useRef<World>({ hand: { x: 0, y: 0, s: 0 }, wpp: 1, t: 0 });
  const size = useThree((s) => s.size);
  const cam = useThree((s) => s.camera) as THREE.PerspectiveCamera;

  // ---------- the colours of each branch and leaf (its section's, faintly) ----------
  const paint = useMemo(() => {
    const secColor = tree.sections.map((s) => col(CATEGORY_COLOR[graph.clusters.find((c) => c.id === s.id)?.category || "geral"]));
    const branch = new Float32Array(tree.count * 3);
    const leaf = new Float32Array(tree.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < tree.count; i += 1) {
      const sc = tree.section[i] >= 0 ? secColor[tree.section[i]] : C.white;
      c.copy(C.branch).lerp(sc, 0.22); branch.set([c.r, c.g, c.b], i * 3);
      c.copy(C.leaf).lerp(sc, 0.38); leaf.set([c.r, c.g, c.b], i * 3);
    }
    const heaviest = Math.max(1, ...tree.sections.map((s) => tree.carried[s.node]));
    return { branch, leaf, heaviest, secColor };
  }, [tree, graph.clusters]);

  // ---------- where each node is drawn: eased from where it was when the tree changes; grown at first ----------
  type Display = { x: Float32Array; y: Float32Array; sx: Float32Array; sy: Float32Array; born: Float64Array; at: number; tree: MemoryTree };
  const disp = useRef<Display | null>(null);
  const lastSeen = useRef<LastSeen>({ leaves: new Map(), sections: new Map() });
  const firstLoad = useRef(true);
  const display = useMemo(() => {
    const now = performance.now();
    const old = disp.current;
    const n = tree.count;
    const D: Display = { x: new Float32Array(n), y: new Float32Array(n), sx: new Float32Array(n), sy: new Float32Array(n), born: new Float64Array(n), at: now, tree };
    const seen = lastSeen.current;
    for (const t of old ? [old.tree, tree] : [tree]) {
      const X = t === tree ? tree.x : old!.x, Y = t === tree ? tree.y : old!.y;
      for (const [id, i] of t.leafOf) seen.leaves.set(id, [X[i], Y[i]]);
      for (const s of t.sections) seen.sections.set(s.id, { x: s.labelX, y: s.labelY, bx: X[s.node], by: Y[s.node] });
    }
    const has = new Uint8Array(n); const cnt = new Float32Array(n); const sumX = new Float32Array(n); const sumY = new Float32Array(n);
    if (old) for (const [id, i] of tree.leafOf) { const j = old.tree.leafOf.get(id); if (j !== undefined) { D.sx[i] = old.x[j]; D.sy[i] = old.y[j]; has[i] = 1; } }
    for (let i = n - 1; i >= 1; i -= 1) {
      if (!has[i] && cnt[i] > 0) { D.sx[i] = sumX[i] / cnt[i]; D.sy[i] = sumY[i] / cnt[i]; has[i] = 1; }
      if (has[i]) { const p = tree.parent[i]; sumX[p] += D.sx[i]; sumY[p] += D.sy[i]; cnt[p] += 1; }
    }
    for (let i = 0; i < n; i += 1) {
      if (!has[i]) { D.sx[i] = tree.x[i]; D.sy[i] = tree.y[i]; }
      D.x[i] = D.sx[i]; D.y[i] = D.sy[i];
      // The first time the tree grows from the root out to the canopy; later, only what is new grows in.
      D.born[i] = firstLoad.current ? now + 150 + tree.r[i] * 2300 : has[i] || i === 0 ? -1e9 : now;
    }
    firstLoad.current = false;
    disp.current = D;
    return D;
  }, [tree]);

  // ---------- glow: what lights a node now (waves, paths, the Zeladora), fading by itself ----------
  const glow = useMemo(() => ({ w: new Float32Array(tree.count), k: new Uint8Array(tree.count) }), [tree]);
  const lightNode = (i: number, s: number, kind: number) => { if (s > glow.w[i]) { glow.w[i] = s; glow.k[i] = kind; } };

  // ---------- the turn: what the search weighed, what was used, what was created ----------
  const turnKinds = useMemo(() => new Map((agent?.tentacles || []).map((t) => [t.id, t.kind])), [agent]);
  const seenAt = useRef(new Map<string, number>());
  const waves = useRef<Wave[]>([]);
  const lastScan = useRef("");
  useEffect(() => {
    if (!agent) return;
    const now = performance.now();
    for (const t of agent.tentacles) { const k = `${agent.key}:${t.id}:${t.kind}`; if (!seenAt.current.has(k)) seenAt.current.set(k, now + (t.kind === "scanned" ? 0 : Math.min(6, t.order - 6) * 140)); }
    // The search: one wave from the root over the whole canopy when the candidates arrive.
    if (agent.tentacles.some((t) => t.kind === "scanned") && lastScan.current !== agent.key) {
      lastScan.current = agent.key;
      if (motion) waves.current.push({ at: now, a0: -tree.span - 0.05, a1: tree.span + 0.05, dur: 2100, s: 1, seed: hash01(agent.key), kind: "busca" });
    }
  }, [agent, motion, tree.span]);
  const lastRound = useRef<number | null>(null);
  useEffect(() => {
    if (!keeper?.running || !keeper.enabled) return;
    if (lastRound.current !== null && keeper.round !== lastRound.current && motion) waves.current.push({ at: performance.now(), a0: -tree.span - 0.05, a1: tree.span + 0.05, dur: 2800, s: 0.75, seed: keeper.round * 0.37, kind: "ronda" });
    lastRound.current = keeper.round;
  }, [keeper?.round, keeper?.running, keeper?.enabled, motion, tree.span]);

  // ---------- the Zeladora's way: from the memory she read to the next, along the branches ----------
  const trails = useRef<PathSpec[]>([]);
  const lastRead = useRef<string | null>(null);
  useEffect(() => {
    const cur = keeper?.current || null;
    if (!cur || cur === lastRead.current) return;
    const a = lastRead.current ? tree.leafOf.get(lastRead.current) : undefined;
    const b = tree.leafOf.get(cur);
    lastRead.current = cur;
    if (b === undefined) return;
    const now = performance.now();
    trails.current = [...trails.current.filter((p) => (p.until || 0) > now), { key: `z:${cur}:${now}`, nodes: a !== undefined ? pathBetween(tree, a, b) : pathTo(tree, b).slice(-4), kind: "zeladora" as const, at: now, strength: 0.8, until: now + 2400 }].slice(-2);
  }, [keeper?.current, tree]);

  // ---------- a memory she adopts grows in: a green path from the root to it (by id: the tree changes) ----------
  const growTrails = useRef<{ id: string; at: number; until: number }[]>([]);
  const seenGrowth = useRef(new Set<string>());
  useEffect(() => {
    const now = performance.now();
    for (const g of keeper?.growth || []) {
      const key = `${g.kind}:${g.id || g.section}:${g.at}`;
      if (g.kind !== "adopt" || !g.id || seenGrowth.current.has(key) || Date.now() - g.at > ADOPT_MS) continue;
      seenGrowth.current.add(key);
      growTrails.current = [...growTrails.current.filter((p) => p.until > now), { id: g.id, at: now, until: now + ADOPT_MS }].slice(-4);
    }
  }, [keeper?.growth]);

  // ---------- a recent question replayed (a click on its bush) ----------
  const [replay, setReplay] = useState<{ bush: RecallBush; at: number } | null>(null);
  useEffect(() => { if (!replay) return undefined; const t = window.setTimeout(() => setReplay(null), 14000); return () => window.clearTimeout(t); }, [replay]);

  // ---------- the glowing paths, root → memory ----------
  const paths = useMemo(() => {
    const out: PathSpec[] = [];
    const leafPath = (id: string) => { const i = tree.leafOf.get(id); return i === undefined ? null : pathTo(tree, i); };
    if (replay) replay.bush.used.slice(0, 10).forEach((id, k) => { const p = leafPath(id); if (p) out.push({ key: `r:${id}`, nodes: p, kind: "consulta", at: replay.at + k * 140, strength: k === 0 ? 1 : 0.5 }); });
    else if (agent) {
      const used = agent.tentacles.filter((t) => t.kind === "recalled" || t.kind === "used").slice(0, 12);
      used.forEach((t, k) => { const p = leafPath(t.id); if (p) out.push({ key: `t:${agent.key}:${t.id}`, nodes: p, kind: "consulta", at: seenAt.current.get(`${agent.key}:${t.id}:${t.kind}`) ?? performance.now(), strength: (k === 0 ? 1 : 0.5) * (agent.ended ? 0.7 : 1) }); });
      agent.tentacles.filter((t) => t.kind === "created").slice(0, 6).forEach((t) => { const p = leafPath(t.id); if (p) out.push({ key: `c:${t.id}`, nodes: p, kind: "criada", at: seenAt.current.get(`${agent.key}:${t.id}:created`) ?? performance.now(), strength: 0.8 }); });
    } else if (props.recalls[0]) {
      // Nothing happening: the way of the last real question stays drawn (its memories, from the root).
      const last = props.recalls[0];
      last.used.slice(0, 8).forEach((id, k) => { const p = leafPath(id); if (p) out.push({ key: `l:${last.id}:${id}`, nodes: p, kind: "consulta", at: performance.now() + 900 + k * 160, strength: k === 0 ? 0.75 : 0.32 }); });
    }
    if (selectedId) { const p = leafPath(selectedId); if (p) out.push({ key: `s:${selectedId}`, nodes: p, kind: "selecao", at: performance.now(), strength: 0.9 }); }
    if (hoveredId && hoveredId !== selectedId) { const p = leafPath(hoveredId); if (p) out.push({ key: `h:${hoveredId}`, nodes: p, kind: "hover", at: performance.now() - REVEAL_MS * 0.6, strength: 0.6 }); }
    return out;
  }, [tree, agent, replay, selectedId, hoveredId, props.recalls]);
  // Keep each path's start time across re-renders (the reveal plays once).
  const pathAt = useRef(new Map<string, number>());
  for (const p of paths) { const at = pathAt.current.get(p.key); if (at === undefined) pathAt.current.set(p.key, p.at); else p.at = at; }

  // ---------- the bushes: the last questions at the base ----------
  const bushes = useMemo(() => {
    const slots = [-0.36, 0.36, -0.66, 0.66];
    return props.recalls.slice(0, 4).map((rc, k) => {
      const bx = R * slots[k] * 1.08, h = R * (0.075 + 0.05 * Math.min(1, rc.used.length / 10));
      const used = rc.used.slice(0, 24); const m = Math.max(1, used.length);
      const forks = Math.min(3, m);
      const leavesXY = used.map((id, j) => { const a = m > 1 ? -0.95 + (1.9 * j) / (m - 1) : 0; const r = h * (0.82 + 0.18 * hash01(id + rc.id)); return { id, x: bx + Math.sin(a) * r * 1.15, y: Math.cos(a) * r, fork: Math.min(forks - 1, Math.floor((j / m) * forks)) }; });
      const forkXY = Array.from({ length: forks }, (_, f) => { const mine = leavesXY.filter((l) => l.fork === f); const a = mine.length ? mine.reduce((s, l) => s + Math.atan2(l.x - bx, l.y), 0) / mine.length : 0; return { x: bx + Math.sin(a) * h * 0.42, y: Math.cos(a) * h * 0.42 }; });
      return { rc, bx, h, leaves: leavesXY, forks: forkXY };
    });
  }, [props.recalls, R]);
  const [hoverBush, setHoverBush] = useState<number | null>(null);

  // ---------- the field of faint stars behind the tree ----------
  const dust = useMemo(() => {
    const n = DUST[settings.quality];
    const xs = new Float32Array(n), ys = new Float32Array(n), ph = new Float32Array(n), sz = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      xs[i] = (hash01(`d${i}`, 1) - 0.5) * 2.5 * R; ys[i] = (hash01(`d${i}`, 2) * 1.2 - 0.06) * R;
      ph[i] = hash01(`d${i}`, 3); sz[i] = 0.9 + hash01(`d${i}`, 4) * 1.1;
    }
    return { n, xs, ys, ph, sz };
  }, [settings.quality, R]);

  // ---------- buffers ----------
  const geo = useMemo(() => ({
    branches: dynamicGeometry(tree.count * 2, false),
    edges: dynamicGeometry(Math.max(1, graph.edges.length) * 2, false),
    leaves: dynamicGeometry(tree.leafOf.size + 1, true),
    dust: dynamicGeometry(dust.n + 1, true),
    waves: dynamicGeometry(14000, false),
    sparks: dynamicGeometry(1600 + tree.count, true),
    bushes: dynamicGeometry(4 * 60 * 2, false),
    ribbons: ribbonGeometry(3000),
  }), [tree, graph.edges.length, dust.n]);
  useEffect(() => () => { Object.values(geo).forEach((g) => g.dispose()); }, [geo]);
  const mats = useMemo(() => ({ points: pointMaterial(), lines: lineMaterial(), ribbons: ribbonMaterial() }), []);
  useEffect(() => () => { Object.values(mats).forEach((m) => m.dispose()); }, [mats]);
  const c3 = useMemo(() => new THREE.Color(), []);
  const c4 = useMemo(() => new THREE.Color(), []);
  const pa = useMemo(() => ({ x: 0, y: 0 }), []);
  const pb = useMemo(() => ({ x: 0, y: 0 }), []);
  const focusIds = useMemo(() => {
    const ids = new Set<string>();
    const anchor = selectedId || hoveredId;
    if (anchor) { ids.add(anchor); for (const e of graph.edges) { if (e.from === anchor) ids.add(e.to); if (e.to === anchor) ids.add(e.from); } }
    return ids;
  }, [selectedId, hoveredId, graph.edges]);
  // Each section's light: dim while waiting for the Zeladora, others dim when one is in focus.
  const secLight = useMemo(() => tree.sections.map((s) => {
    const st = props.sections.get(s.id);
    const waiting = props.readSet && st?.state === "na fila" ? 0.42 : 1;
    return (focusClusterId && focusClusterId !== s.id ? 0.32 : 1) * waiting;
  }), [tree, props.sections, props.readSet, focusClusterId]);
  const kz = useRef({ a: 0, r: 0.8, on: 0 });

  useFrame(({ clock }, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const now = performance.now();
    const t = clock.getElapsedTime();
    const w = world.current; w.t = t;
    w.wpp = (2 * Math.max(1, cam.position.z) * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(1, size.height);
    (mats.points.uniforms.uRef as { value: number }).value = R * 1.56;
    w.hand.s *= Math.exp(-dt * 1.2);
    const D = display;
    const k = reduced ? 1 : easeOut(Math.min(1, (now - D.at) / 900));
    for (let i = 0; i < tree.count; i += 1) { D.x[i] = D.sx[i] + (tree.x[i] - D.sx[i]) * k; D.y[i] = D.sy[i] + (tree.y[i] - D.sy[i]) * k; }
    const grown = (i: number) => (reduced ? 1 : Math.max(0, Math.min(1, (now - D.born[i]) / 650)));
    for (let i = 0; i < tree.count; i += 1) glow.w[i] *= Math.exp(-dt * 1.6);

    // ---- the cursor's lens ----
    const lensR = R * 0.1;
    const lens = (x: number, y: number) => { if (w.hand.s < 0.02) return 0; const d = Math.hypot(x - w.hand.x, y - w.hand.y); return d < lensR ? w.hand.s * (1 - d / lensR) ** 2 : 0; };

    // ---- waves: a search, a round of the Zeladora, a tap ----
    waves.current = waves.current.filter((wv) => now - wv.at < wv.dur);
    const ww = new Writer(geo.waves).begin();
    const sw = new Writer(geo.sparks).begin();
    const drawWave = (a0: number, a1: number, r: number, s: number, seed: number, kind: WaveKind | "zeladora", glowKind: number) => {
      const [cBase, cHot] = WAVE_COLOR[kind];
      const band = 0.022 + 0.045 * r;
      const steps = Math.max(8, Math.min(240, Math.round((a1 - a0) / 0.013)));
      const da = (a1 - a0) / steps;
      for (let layer = 0; layer < 2; layer += 1) {
        let p1x = 0, p1y = 0, p2x = 0, p2y = 0;
        for (let j = 0; j <= steps; j += 1) {
          const h = hash01(`${seed}:${layer}:${j}`);
          const a = a0 + j * da + (hash01(`${seed}:${layer}:${j}`, 5) - 0.5) * da * 0.9;
          const off = (h - 0.5) * 2 * band + (motion ? Math.sin(t * 5 + j * 1.7 + layer) * band * 0.25 : 0);
          const x = polarX(r + off, a), y = polarY(r + off, a);
          const edge = smooth(a0, a0 + 0.12, a) * (1 - smooth(a1 - 0.12, a1, a));
          const alpha = s * edge * (0.22 + 0.78 * Math.min(1, r)) * 0.75;
          c3.copy(cBase).lerp(cHot, h * 0.6);
          if (j >= 1) ww.line(p1x, p1y, x, y, alpha, c3);
          if (j >= 2) ww.line(p2x, p2y, x, y, alpha * 0.7, c3);
          if (h > 0.74) { const sp = band * (1 + hash01(`${seed}:${j}`, 7) * 1.6); ww.line(x, y, polarX(r + off + sp, a + (h - 0.87) * 0.04), polarY(r + off + sp, a + (h - 0.87) * 0.04), alpha * 0.8, c3, 0); }
          if (h > 0.9) sw.dot(x, y, 2.6, alpha * 1.2, cHot);
          p2x = p1x; p2y = p1y; p1x = x; p1y = y;
        }
      }
      // The nodes the wave passes light up (the memories it weighs).
      for (let i = 1; i < tree.count; i += 1) {
        const ang = tree.angle[i]; if (ang < a0 || ang > a1) continue;
        const dr = Math.abs(tree.r[i] - r); if (dr > band * 1.4) continue;
        lightNode(i, s * (1 - dr / (band * 1.4)), glowKind);
      }
    };
    for (const wv of waves.current) {
      const u = (now - wv.at) / wv.dur;
      const r = 0.03 + (tree.reach + 0.06) * easeOut(u);
      const env = smooth(0, 0.08, u) * (1 - smooth(0.7, 1, u));
      drawWave(wv.a0, wv.a1, r, wv.s * env, wv.seed, wv.kind, wv.kind === "ronda" ? 2 : 1);
    }
    // The Zeladora walking: a small wave where she reads, gliding from memory to memory.
    const kLeaf = keeper?.enabled && keeper.running && keeper.phase === "andando" && keeper.current ? tree.leafOf.get(keeper.current) : undefined;
    const z = kz.current;
    if (kLeaf !== undefined) {
      const ease = reduced ? 1 : 1 - Math.exp(-dt * 4);
      if (z.on < 0.01) { z.a = tree.angle[kLeaf]; z.r = tree.r[kLeaf]; }
      z.a += (tree.angle[kLeaf] - z.a) * ease; z.r += (tree.r[kLeaf] - z.r) * ease;
      z.on = Math.min(1, z.on + dt * 2);
    } else z.on = Math.max(0, z.on - dt * 1.5);
    if (z.on > 0.01) drawWave(z.a - 0.13, z.a + 0.13, z.r, 0.75 * z.on, Math.floor(t * 3) * 0.13, "zeladora", 2);

    // ---- the Zeladora's links: an arc between two leaves ----
    const nowMs = Date.now();
    for (const l of (keeper?.links || []).slice(-6)) {
      const age = nowMs - l.at; if (age > 8000) continue;
      const a = tree.leafOf.get(l.from), b = tree.leafOf.get(l.to); if (a === undefined || b === undefined) continue;
      const fade = (1 - age / 8000) * 0.9;
      const mx = (D.x[a] + D.x[b]) / 2, my = (D.y[a] + D.y[b]) / 2; const ml = Math.hypot(mx, my) || 1;
      const lift = Math.hypot(D.x[b] - D.x[a], D.y[b] - D.y[a]) * 0.35 + R * 0.02;
      const cx = mx + (mx / ml) * lift, cy = my + (my / ml) * lift;
      let px = D.x[a], py = D.y[a];
      for (let s = 1; s <= 20; s += 1) {
        const u = s / 20, v = 1 - u;
        const x = v * v * D.x[a] + 2 * v * u * cx + u * u * D.x[b], y = v * v * D.y[a] + 2 * v * u * cy + u * u * D.y[b];
        ww.line(px, py, x, y, fade, C.keeperHot);
        px = x; py = y;
      }
      const u = ((age % 1400) / 1400), v = 1 - u;
      sw.dot(v * v * D.x[a] + 2 * v * u * cx + u * u * D.x[b], v * v * D.y[a] + 2 * v * u * cy + u * u * D.y[b], 4, fade, C.keeperHot);
      lightNode(a, fade, 2); lightNode(b, fade, 2);
    }

    // ---- the Zeladora shaping the tree: a pruned leaf falls, a new node lights up, a folded one closes ----
    const ring = (x: number, y: number, r: number, alpha: number, c: THREE.Color) => {
      let px = x + r, py = y;
      for (let s = 1; s <= 40; s += 1) { const a = (s / 40) * Math.PI * 2; const nx = x + Math.cos(a) * r, ny = y + Math.sin(a) * r; ww.line(px, py, nx, ny, alpha, c); px = nx; py = ny; }
    };
    const sectionIndex = (id?: string | null) => (id ? tree.sections.findIndex((s) => s.id === id) : -1);
    const lightSection = (si: number, s: number, kind: number) => { if (si < 0) return; for (let i = 1; i < tree.count; i += 1) if (tree.section[i] === si) lightNode(i, s, kind); };
    for (const g of keeper?.growth || []) {
      const age = nowMs - g.at;
      if (g.kind === "prune" && g.id && age < PRUNE_MS) {
        const p = lastSeen.current.leaves.get(g.id); if (!p) continue;
        const u = age / PRUNE_MS;
        // The cut: a short snip where the leaf was, then the leaf falls to the ground, swaying, and fades.
        if (age < 700) { const k = 1 - age / 700, d = R * 0.018; ww.line(p[0] - d, p[1] - d, p[0] + d, p[1] + d, k, C.prune); ww.line(p[0] - d, p[1] + d, p[0] + d, p[1] - d, k, C.prune); ring(p[0], p[1], R * (0.01 + 0.03 * easeOut(age / 700)), k * 0.8, C.prune); }
        const at = (v: number) => [p[0] + Math.sin(v * 8 + hash01(g.id!) * 6.28) * R * 0.02 * v, p[1] * (1 - v * v)] as const;
        const fade = 1 - smooth(0.62, 1, u);
        for (let k = 0; k < 5; k += 1) {
          const v = Math.max(0, u - k * 0.022);
          const [x, y] = at(v);
          c3.copy(C.prune).lerp(C.pruneDim, Math.min(1, u * 1.4));
          sw.dot(x, y, (5.5 - k) * (1 - u * 0.4), fade * (1 - k * 0.2), c3);
        }
        if (!motion) continue;
      }
      if (g.kind === "arrival" && g.id && age < ARRIVAL_MS) {
        const i = tree.leafOf.get(g.id); if (i === undefined) continue;
        const u = age / ARRIVAL_MS;
        ring(D.x[i], D.y[i], R * (0.008 + 0.045 * easeOut(u)), (1 - u) * 0.85, C.created);
        lightNode(i, 1 - u, 4);
      }
      if (g.kind === "born" && g.section && age < BORN_MS) {
        const si = sectionIndex(g.section); if (si < 0) continue;
        const u = age / BORN_MS, env = 1 - smooth(0.5, 1, u);
        const b = tree.sections[si].node;
        // The whole new node lights up from its base; rings open where it starts.
        lightSection(si, env * 0.95, 2);
        ring(D.x[b], D.y[b], R * (0.015 + 0.13 * easeOut(Math.min(1, u * 1.5))), env * 0.75, C.keeperHot);
        ring(D.x[b], D.y[b], R * (0.01 + 0.07 * easeOut(Math.min(1, u * 1.2))), env * 0.5, C.keeper);
        // Split from another node: a thread from where it came.
        const pi = sectionIndex(g.from);
        if (pi >= 0) {
          const a = tree.sections[pi].node;
          const cx = (D.x[a] + D.x[b]) / 2, cy = Math.max(D.y[a], D.y[b]) + R * 0.08;
          let px = D.x[a], py = D.y[a];
          for (let s = 1; s <= 24; s += 1) { const t1 = s / 24, v = 1 - t1; const x = v * v * D.x[a] + 2 * v * t1 * cx + t1 * t1 * D.x[b], y = v * v * D.y[a] + 2 * v * t1 * cy + t1 * t1 * D.y[b]; ww.line(px, py, x, y, env * 0.8, C.keeperHot); px = x; py = y; }
          lightSection(pi, env * 0.35, 2);
        }
      }
      if (g.kind === "gone" && g.section && age < GONE_MS) {
        const p = lastSeen.current.sections.get(g.section); if (!p) continue;
        const u = age / GONE_MS;
        // Closing in on itself, and its memories now light up where they went.
        ring(p.bx, p.by, R * 0.12 * (1 - easeOut(u)) + R * 0.004, (1 - u) * 0.8, C.fold);
        ring(p.bx, p.by, R * 0.07 * (1 - easeOut(u)) + R * 0.002, (1 - u) * 0.5, C.fold);
        lightSection(sectionIndex(g.into), (1 - u) * 0.7, 2);
      }
    }
    ww.end();

    // ---- glowing paths: ribbons climbing the branches, a spark running along them ----
    const rw = new RibbonWriter(geo.ribbons).begin();
    trails.current = trails.current.filter((p) => (p.until || 0) > now);
    growTrails.current = growTrails.current.filter((g) => g.until > now);
    const grownPaths: PathSpec[] = [];
    for (const g of growTrails.current) { const i = tree.leafOf.get(g.id); if (i !== undefined) grownPaths.push({ key: `g:${g.id}`, nodes: pathTo(tree, i), kind: "criada", at: g.at, strength: 0.85, until: g.until }); }
    for (const p of [...paths, ...trails.current, ...grownPaths]) {
      if (p.nodes.length < 2) continue;
      const fade = p.until ? Math.min(1, (p.until - now) / 900) : 1;
      const reveal = reduced ? 1 : Math.max(0, Math.min(1, (now - p.at) / (p.kind === "zeladora" ? 600 : REVEAL_MS)));
      if (reveal <= 0) continue;
      let total = 0; const L = [0];
      for (let s = 1; s < p.nodes.length; s += 1) { total += Math.hypot(D.x[p.nodes[s]] - D.x[p.nodes[s - 1]], D.y[p.nodes[s]] - D.y[p.nodes[s - 1]]); L.push(total); }
      if (total <= 0) continue;
      const head = easeOut(reveal) * total;
      const stops = PALETTE[p.kind];
      const core = (p.kind === "hover" ? 1.1 : p.kind === "zeladora" ? 1.3 : p.strength >= 1 ? 2.1 : 1.5) * w.wpp;
      const halo = (p.kind === "hover" || p.kind === "zeladora" ? 0 : p.strength >= 1 ? 11 : 6) * w.wpp;
      let hx = D.x[p.nodes[0]], hy = D.y[p.nodes[0]], ht = 0;
      for (let s = 1; s < p.nodes.length; s += 1) {
        if (L[s - 1] >= head) break;
        const i0 = p.nodes[s - 1], i1 = p.nodes[s];
        const part = Math.min(1, (head - L[s - 1]) / Math.max(0.0001, L[s] - L[s - 1]));
        pa.x = D.x[i0]; pa.y = D.y[i0];
        pb.x = D.x[i0] + (D.x[i1] - D.x[i0]) * part; pb.y = D.y[i0] + (D.y[i1] - D.y[i0]) * part;
        const t0 = L[s - 1] / total, t1 = (L[s - 1] + (L[s] - L[s - 1]) * part) / total;
        gradient(stops, t0, c3); gradient(stops, t1, c4);
        const a0 = p.strength * fade * (0.55 + 0.45 * t0), a1 = p.strength * fade * (0.55 + 0.45 * t1);
        rw.seg(pa, pb, core, a0, a1, c3, c4);
        if (halo > 0) rw.seg(pa, pb, halo, a0 * 0.16, a1 * 0.16, c3, c4);
        if (p.kind !== "hover") { lightNode(i0, 0.55 * p.strength * fade, p.kind === "zeladora" ? 2 : p.kind === "criada" ? 4 : 3); if (part >= 1) lightNode(i1, 0.55 * p.strength * fade, p.kind === "zeladora" ? 2 : p.kind === "criada" ? 4 : 3); }
        hx = pb.x; hy = pb.y; ht = t1;
      }
      if (p.kind !== "hover") {
        gradient(stops, ht, c3);
        sw.dot(hx, hy, p.strength >= 1 ? 9 : 6, fade * (reveal < 1 ? 1 : 0.85), c3);
        // Once there, a spark keeps running up the path: the memory being reached.
        if (reveal >= 1 && motion && (p.kind === "consulta" || p.kind === "zeladora") && p.strength >= 0.85) {
          const u = ((now - p.at) % 2600) / 2600; const at = u * total;
          let s = 1; while (s < L.length - 1 && L[s] < at) s += 1;
          const f = (at - L[s - 1]) / Math.max(0.0001, L[s] - L[s - 1]);
          gradient(stops, u, c3);
          sw.dot(D.x[p.nodes[s - 1]] + (D.x[p.nodes[s]] - D.x[p.nodes[s - 1]]) * f, D.y[p.nodes[s - 1]] + (D.y[p.nodes[s]] - D.y[p.nodes[s - 1]]) * f, 5, fade * 0.9, c3);
        }
      }
    }
    rw.end();

    // ---- merges (compaction): the memories fly into the one that keeps them ----
    for (const m of props.merges) {
      const age = nowMs - m.at; if (age > 1600) continue;
      const u = easeOut(Math.min(1, age / 1300));
      for (const f of m.from) for (let tail = 0; tail < 4; tail += 1) {
        const v = Math.max(0, u - tail * 0.05);
        sw.dot(f[0] + (m.to[0] - f[0]) * v, f[1] + (m.to[1] - f[1]) * v, 5 - tail, (1 - age / 1600) * (1 - tail * 0.22), C.white);
      }
    }

    // ---- forks: small dim stars where branches split ----
    for (let i = 1; i < tree.count; i += 1) {
      if (tree.memoryAt[i] || grown(i) < 1) continue;
      const si = tree.section[i];
      const gl = glow.w[i];
      sw.dot(D.x[i], D.y[i], 1.6 + gl * 2, (0.28 + gl * 0.7 + lens(D.x[i], D.y[i]) * 0.5) * (si >= 0 ? secLight[si] : 1), gl > 0.05 ? GLOW_COLOR[glow.k[i]] : C.branch);
    }

    // ---- the root: the Aurora ----
    sw.dot(0, 0, 9 + (motion ? Math.sin(t * 1.6) * 0.8 : 0), 0.95, C.white);
    sw.dot(0, 0, 22, 0.16, C.wave);

    // ---- branches: hairlines, brighter where many memories pass ----
    const bw = new Writer(geo.branches).begin();
    for (let i = 1; i < tree.count; i += 1) {
      const g = grown(i); if (g <= 0) continue;
      const p = tree.parent[i];
      const si = tree.section[i];
      const light = si >= 0 ? secLight[si] : 1;
      const x1 = D.x[p] + (D.x[i] - D.x[p]) * g, y1 = D.y[p] + (D.y[i] - D.y[p]) * g;
      const weight = Math.sqrt(tree.carried[i] / paint.heaviest);
      const gl = Math.max(glow.w[i], glow.w[p] * 0.5);
      const ln = lens((D.x[p] + x1) / 2, (D.y[p] + y1) / 2);
      const alpha = (0.1 + 0.3 * weight) * light + gl * 0.75 + ln * 0.35;
      c3.setRGB(paint.branch[i * 3], paint.branch[i * 3 + 1], paint.branch[i * 3 + 2]);
      if (gl > 0.02) c3.lerp(GLOW_COLOR[glow.k[i]], Math.min(1, gl * 1.2)).lerp(C.white, gl * 0.3);
      bw.line(D.x[p], D.y[p], x1, y1, alpha * (tree.memoryAt[p] ? 1 : 1), c3, alpha * (tree.memoryAt[i] ? 0.8 : 1));
    }
    bw.end();

    // ---- links between memories: a faint mesh in the canopy ----
    const ew = new Writer(geo.edges).begin();
    for (const e of graph.edges) {
      const a = tree.leafOf.get(e.from), b = tree.leafOf.get(e.to); if (a === undefined || b === undefined) continue;
      // Only the links of the memory in focus (the tree itself is the structure).
      if (!(focusIds.has(e.from) && focusIds.has(e.to))) continue;
      const g = Math.min(grown(a), grown(b)); if (g <= 0) continue;
      const alpha = 0.45 * g;
      const lit = true;
      c3.setRGB(paint.leaf[a * 3], paint.leaf[a * 3 + 1], paint.leaf[a * 3 + 2]);
      if (lit) c3.lerp(C.white, 0.5);
      ew.line(D.x[a], D.y[a], D.x[b], D.y[b], alpha, c3);
    }
    ew.end();

    // ---- leaves: the memories ----
    const lw = new Writer(geo.leaves).begin();
    for (const [id, i] of leaves) {
      const n = nodeOf.get(id); if (!n) continue;
      const g = grown(i); if (g <= 0) continue;
      const hl = highlights.get(id);
      const active = hl && now - hl.at < ACTIVE_MS ? 1 - (now - hl.at) / ACTIVE_MS : 0;
      const tk = turnKinds.get(id);
      const turnLit = tk ? (tk === "scanned" ? 0.35 : 0.9) * (agent?.ended ? 0.6 : 1) : 0;
      const si = tree.section[i];
      const unread = props.readSet && !props.readSet.has(id) ? 0.45 : 1;
      const light = (si >= 0 ? secLight[si] : 1) * unread;
      const ln = lens(D.x[i], D.y[i]);
      const gl = glow.w[i];
      const twinkle = motion ? 0.82 + 0.18 * Math.sin(t * (0.8 + hash01(id, 7) * 1.6) + hash01(id) * 6.28) : 1;
      const isSel = id === selectedId, isHover = id === hoveredId;
      const sz = ((2.6 + n.relevance * 2.6) * twinkle + gl * 3 + ln * 2.5 + active * 2.5 + turnLit * 2.5 + (isSel ? 4 : isHover ? 2.5 : 0)) * g;
      const alpha = Math.min(1, (0.68 + n.relevance * 0.3) * twinkle * light + gl + ln * 0.5 + active + turnLit + (isSel || isHover ? 1 : 0));
      c3.setRGB(paint.leaf[i * 3], paint.leaf[i * 3 + 1], paint.leaf[i * 3 + 2]);
      if (gl > 0.02) c3.lerp(GLOW_COLOR[glow.k[i]], Math.min(1, gl));
      if (tk) c3.lerp(tk === "scanned" ? C.search : tk === "created" ? C.created : C.recall, turnLit);
      if (active > 0 && hl) c3.lerp(HL_COLOR[hl.kind], Math.min(1, active * 1.2));
      if (isSel) c3.lerp(C.select, 0.6);
      lw.dot(D.x[i], D.y[i], sz, alpha, c3);
    }
    lw.end();

    // ---- the faint stars; a passing wave brightens them ----
    const dw = new Writer(geo.dust).begin();
    const rings = waves.current.map((wv) => { const u = (now - wv.at) / wv.dur; return { r: (0.03 + (tree.reach + 0.06) * easeOut(u)) * R, s: wv.s * (1 - smooth(0.7, 1, u)) }; });
    for (let i = 0; i < dust.n; i += 1) {
      const x = dust.xs[i], y = dust.ys[i];
      let boost = 0;
      if (rings.length) { const d = Math.hypot(x, y); for (const rg of rings) { const dd = Math.abs(d - rg.r) / (R * 0.05); if (dd < 1) boost = Math.max(boost, rg.s * (1 - dd)); } }
      const tw = motion ? 0.5 + 0.5 * Math.sin(t * (0.5 + dust.ph[i] * 1.5) + dust.ph[i] * 40) : 0.7;
      dw.dot(x, y, dust.sz[i] + boost * 1.5, (0.05 + 0.16 * tw) + boost * 0.6 + lens(x, y) * 0.3, boost > 0.05 ? C.waveHot : C.dust);
    }
    dw.end();

    // ---- the bushes at the base ----
    const uw = new Writer(geo.bushes).begin();
    bushes.forEach((b, k) => {
      const on = hoverBush === k || replay?.bush.id === b.rc.id;
      const a = on ? 0.55 : 0.2;
      b.forks.forEach((f) => uw.line(b.bx, 0, f.x, f.y, a, C.branch));
      b.leaves.forEach((l, j) => {
        const f = b.forks[l.fork];
        uw.line(f.x, f.y, l.x, l.y, a * 0.85, C.branch);
        if (j > 0) uw.line(b.leaves[j - 1].x, b.leaves[j - 1].y, l.x, l.y, a * 0.3, C.branch);
        const n = nodeOf.get(l.id);
        c3.set(n ? CATEGORY_COLOR[n.category] : "#7b8794").lerp(C.white, 0.5);
        sw.dot(l.x, l.y, on ? 3.2 : 2.2, on ? 0.95 : 0.5, c3);
      });
      sw.dot(b.bx, 0, on ? 4.5 : 3.2, on ? 0.9 : 0.55, C.white);
    });
    uw.end();
    sw.end();
  });

  // ---------- the person: a lens, hover the nearest memory, tap for a wave, click a bush to replay it ----------
  const plane0 = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const lastHover = useRef<string | null>(null);
  const nearestLeaf = (x: number, y: number): string | null => {
    const D = display; const max = 11 * world.current.wpp;
    let best: string | null = null, bd = max * max;
    for (const [id, i] of leaves) { const d = (D.x[i] - x) ** 2 + (D.y[i] - y) ** 2; if (d < bd) { bd = d; best = id; } }
    return best;
  };
  const bushAt = (x: number, y: number) => bushes.findIndex((b) => Math.abs(x - b.bx) < b.h * 1.3 && y > -R * 0.02 && y < b.h * 1.15);
  const sectionAt = (x: number, y: number) => {
    const a = Math.atan2(x, y); const r = Math.hypot(x, y) / R;
    if (r < 0.12 || r > tree.reach + 0.1) return null;
    return tree.sections.find((s) => a >= s.from - 0.02 && a <= s.to + 0.02) || null;
  };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (!e.ray.intersectPlane(plane0, hit)) return;
    const h = world.current.hand;
    const moved = Math.hypot(hit.x - h.x, hit.y - h.y) / Math.max(0.001, world.current.wpp);
    h.x = hit.x; h.y = hit.y; h.s = Math.min(1, h.s + moved * 0.02);
    const id = nearestLeaf(hit.x, hit.y);
    if (id !== lastHover.current) { lastHover.current = id; onHover(id); }
    const b = bushAt(hit.x, hit.y);
    if ((b < 0 ? null : b) !== hoverBush) setHoverBush(b < 0 ? null : b);
  };
  const onTap = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4 || !e.ray.intersectPlane(plane0, hit)) return;
    const id = nearestLeaf(hit.x, hit.y);
    if (id) { onSelect(id); return; }
    const b = bushAt(hit.x, hit.y);
    if (b >= 0) { setReplay({ bush: bushes[b].rc, at: performance.now() }); return; }
    if (motion) {
      const a = Math.atan2(hit.x, hit.y);
      waves.current.push({ at: performance.now(), a0: Math.max(-tree.span - 0.05, a - 0.8), a1: Math.min(tree.span + 0.05, a + 0.8), dur: 1700, s: 0.6, seed: Math.random(), kind: "toque" });
    }
    onSelect(null);
  };
  const onDouble = (e: ThreeEvent<MouseEvent>) => {
    if (!e.ray.intersectPlane(plane0, hit)) return;
    const s = sectionAt(hit.x, hit.y);
    if (s) onCluster(s.id, true);
  };

  return (
    <>
      <mesh position={[0, R * 0.5, -0.5]} onPointerMove={onMove} onPointerLeave={() => { world.current.hand.s = 0; lastHover.current = null; onHover(null); setHoverBush(null); }} onClick={onTap} onDoubleClick={onDouble}>
        <planeGeometry args={[R * 8, R * 6]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      <points geometry={geo.dust} material={mats.points} frustumCulled={false} />
      <lineSegments geometry={geo.edges} material={mats.lines} frustumCulled={false} />
      <lineSegments geometry={geo.branches} material={mats.lines} frustumCulled={false} />
      <lineSegments geometry={geo.bushes} material={mats.lines} frustumCulled={false} />
      <lineSegments geometry={geo.waves} material={mats.lines} frustumCulled={false} />
      <mesh geometry={geo.ribbons} material={mats.ribbons} frustumCulled={false} />
      <points geometry={geo.leaves} material={mats.points} frustumCulled={false} />
      <points geometry={geo.sparks} material={mats.points} frustumCulled={false} />
      <Labels {...props} paths={paths} bushes={bushes} hoverBush={hoverBush} replay={replay} lastSeen={lastSeen.current} />
      <CameraRig command={camera} reduced={reduced} onUserMove={props.onUserMove} R={R} />
    </>
  );
}

// ================================================================== words on the instrument
type BushView = { rc: RecallBush; bx: number; h: number };
const fmtTime = (iso: string) => { try { return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
const PATH_WORD: Record<PathKind, string> = { consulta: "consultada", zeladora: "zeladora", criada: "criada agora", selecao: "selecionada", hover: "" };
/**
 * Section names along the canopy, the names of a few memories (hovered, selected, active), and the callout at
 * the end of the main path: depth, what happened, the memory, its section.
 */
function Labels({ graph, layout, selectedId, hoveredId, focusClusterId, highlights, sections, settings, paths, bushes, hoverBush, replay, keeper, recalls, lastSeen }: SceneProps & { paths: PathSpec[]; bushes: BushView[]; hoverBush: number | null; replay: { bush: RecallBush; at: number } | null; lastSeen: LastSeen }) {
  const tree = layout.tree; const R = tree.R;
  // What she just did to the shape of the tree, in words for a few seconds (re-rendered while there is any).
  const [, tick] = useState(0);
  const shaping = (keeper?.growth || []).filter((g) => (g.kind === "prune" || g.kind === "born" || g.kind === "gone") && Date.now() - g.at < (g.kind === "born" ? BORN_MS : g.kind === "gone" ? GONE_MS : PRUNE_MS) + 600);
  useEffect(() => { if (!shaping.length) return undefined; const t = window.setInterval(() => tick((x) => x + 1), 600); return () => window.clearInterval(t); }, [shaping.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const nodeOf = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const clusterOf = useMemo(() => new Map(graph.clusters.map((c) => [c.id, c])), [graph.clusters]);
  const total = Math.max(1, graph.nodes.length);
  const now = performance.now();
  const at = (id: string): Vec3 => layout.nodes.get(id) || [0, 0, 0];
  // The main path's memory: a replayed question, the turn's best memory, else the selected one.
  const main = paths.find((p) => p.kind === "consulta" && p.strength >= 0.7) || paths.find((p) => p.kind === "criada") || paths.find((p) => p.kind === "selecao");
  const mainId = main ? tree.memoryAt[main.nodes[main.nodes.length - 1]] : null;
  const names = new Set<string>();
  if (hoveredId && hoveredId !== mainId) names.add(hoveredId);
  if (selectedId && selectedId !== mainId) names.add(selectedId);
  // Only what is rare enough to read: a memory just created, flagged or joined (the Zeladora's reading and a
  // question's memories already show as her wave and the glowing paths).
  for (const [id, h] of [...highlights].sort((a, b) => b[1].at - a[1].at)) { if (names.size >= 5) break; if (now - h.at < 5000 && id !== mainId && (h.kind === "created" || h.kind === "joined" || (h.kind === "flagged" && h.note))) names.add(id); }
  if (keeper?.current && keeper.current !== mainId) names.add(keeper.current);
  if (!settings.labels) names.clear();
  const sectionFor = (id: string) => clusterOf.get(nodeOf.get(id)?.clusterId || "");
  const mainNode = mainId ? nodeOf.get(mainId) : null;
  const score = mainId ? highlights.get(mainId)?.score : undefined;
  const mainColor = main?.kind === "criada" ? ACTIVITY_COLOR : main?.kind === "selecao" ? "#ff7aa8" : "#ff9a55";
  // The names of the biggest sections (the others on focus or while she reads them), at alternating heights.
  const biggest = new Set([...graph.clusters].sort((a, b) => b.nodeIds.length - a.nodeIds.length).slice(0, 7).map((c) => c.id));
  return (
    <>
      {settings.labels && tree.sections.map((s, k) => {
        const c = clusterOf.get(s.id); if (!c) return null;
        const st = sections.get(s.id);
        const big = biggest.has(s.id) && c.nodeIds.length >= Math.max(2, total * 0.02);
        if (!big && s.id !== focusClusterId && st?.state !== "lendo") return null;
        return (
          <Html key={s.id} position={[s.labelX, s.labelY + (k % 2) * R * 0.05, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
            <div className={`lm-sec ${s.id === focusClusterId ? "on" : ""} ${st?.state === "lendo" ? "reading" : st?.state === "na fila" ? "queued" : ""}`} style={{ ["--c" as string]: CATEGORY_COLOR[c.category] }}>
              <b>{c.label}</b><span>{st ? `${st.read}/${st.total}` : c.nodeIds.length}</span>
            </div>
          </Html>
        );
      })}
      {[...names].filter((id) => nodeOf.has(id)).map((id) => {
        const [x, y] = at(id); const h = highlights.get(id);
        const left = x < 0;
        return (
          <Html key={`n:${id}`} position={[x, y, 0]} zIndexRange={[20, 10]} style={{ pointerEvents: "none" }}>
            <div className={`lm-leaf ${left ? "left" : ""} ${id === selectedId ? "sel" : ""} ${h && now - h.at < ACTIVE_MS ? h.kind : ""} ${id === keeper?.current ? "keeper" : ""}`}>
              {nodeOf.get(id)!.label}{h?.note && now - h.at < ACTIVE_MS ? <em> · {h.note}</em> : null}
            </div>
          </Html>
        );
      })}
      {main && mainNode && (
        <Html key={`main:${mainId}`} position={[at(mainId!)[0], at(mainId!)[1], 0]} zIndexRange={[30, 20]} style={{ pointerEvents: "none" }}>
          <div className={`lm-callout ${at(mainId!)[0] > R * 0.45 ? "left" : ""}`} style={{ ["--c" as string]: mainColor }}>
            <b>profundidade {main.nodes.length - 1} · {replay ? `pergunta das ${fmtTime(replay.bush.at)}` : main.key.startsWith("l:") && recalls[0] ? `última pergunta · ${fmtTime(recalls[0].at)}` : PATH_WORD[main.kind]}</b>
            <span>{mainNode.memory.title}</span>
            <small>{sectionFor(mainId!)?.label || "—"}{score != null ? ` · similaridade ${score.toFixed(2).replace(".", ",")}` : ""}{mainNode.memory.uses ? ` · usada ${mainNode.memory.uses}×` : ""}</small>
          </div>
        </Html>
      )}
      <Html position={[0, -R * 0.035, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div className="lm-root">aurora · {graph.nodes.length} memórias</div>
      </Html>
      {settings.labels && shaping.slice(0, 4).map((g) => {
        const key = `${g.kind}:${g.id || g.section}:${g.at}`;
        if (g.kind === "prune") {
          const p = g.id ? lastSeen.leaves.get(g.id) : undefined; if (!p) return null;
          return <Html key={key} position={[p[0], p[1], 0]} zIndexRange={[28, 18]} style={{ pointerEvents: "none" }}><div className={`lm-grow prune ${p[0] > R * 0.45 ? "left" : ""}`}><b>podada · zeladora</b><span>{g.label || "memória"}</span><small>{g.reason || "obsoleta"}</small></div></Html>;
        }
        if (g.kind === "born") {
          const s = tree.sections.find((x) => x.id === g.section); if (!s) return null;
          const from = g.from ? clusterOf.get(g.from)?.label : null;
          return <Html key={key} position={[s.labelX, s.labelY + R * 0.1, 0]} center zIndexRange={[28, 18]} style={{ pointerEvents: "none" }}><div className="lm-grow born"><b>nódulo novo</b><span>{clusterOf.get(s.id)?.label || g.label}</span><small>{from ? `saiu de ${from}` : "assunto novo"} · {clusterOf.get(s.id)?.nodeIds.length || 0} memórias</small></div></Html>;
        }
        const p = g.section ? lastSeen.sections.get(g.section) : undefined; if (!p) return null;
        const into = g.into ? clusterOf.get(g.into)?.label : null;
        return <Html key={key} position={[p.x, p.y + R * 0.1, 0]} center zIndexRange={[28, 18]} style={{ pointerEvents: "none" }}><div className="lm-grow gone"><b>nódulo recolhido</b><span>{g.label}</span><small>{into ? `as memórias foram para ${into}` : "ficou vazio"}</small></div></Html>;
      })}
      {bushes.map((b, k) => (hoverBush === k || replay?.bush.id === b.rc.id) && (
        <Html key={`b:${b.rc.id}`} position={[b.bx, -R * 0.035, 0]} center zIndexRange={[25, 15]} style={{ pointerEvents: "none" }}>
          <div className="lm-bush">“{b.rc.prompt.slice(0, 54)}{b.rc.prompt.length > 54 ? "…" : ""}”<small>{fmtTime(b.rc.at)} · usou {b.rc.used.length} {b.rc.used.length === 1 ? "memória" : "memórias"}{hoverBush === k ? " · clique para rever o caminho" : ""}</small></div>
        </Html>
      ))}
    </>
  );
}

/** Moves the camera smoothly to a target (a section, a memory, the whole tree) when the view asks. */
function CameraRig({ command, reduced, onUserMove, R }: { command: CameraCommand; reduced: boolean; onUserMove: () => void; R: number }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: OrbitControlsImpl | null };
  const goal = useRef<{ target: THREE.Vector3; position: THREE.Vector3 } | null>(null);
  const placed = useRef(false);
  // The first frame: the whole tree in view.
  useEffect(() => {
    if (!controls || placed.current) return;
    placed.current = true;
    controls.target.set(0, R * 0.56, 0); camera.position.set(0, R * 0.56, R * 1.56); controls.update();
  }, [controls, camera, R]);
  // The person moves the map (drags or zooms — not a mere tap): the camera stops going anywhere on its own.
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
    const target = new THREE.Vector3(command.target[0], command.target[1], 0);
    goal.current = { target, position: new THREE.Vector3(target.x, target.y, command.distance) };
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
  const R = props.layout.tree.R;
  return (
    <Canvas
      className="lm-canvas"
      dpr={high ? [1, 2] : 1}
      gl={{ antialias: true, powerPreference: "high-performance", alpha: false }}
      camera={{ position: [0, R * 0.56, R * 1.56], fov: 45, near: 1, far: 12000 }}
      onCreated={({ gl }) => {
        gl.setClearColor("#010307");
        gl.domElement.addEventListener("webglcontextlost", (e) => { e.preventDefault(); props.onContextLost(); }, { once: true });
      }}
    >
      <Scene {...props} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} enableRotate={false} screenSpacePanning minDistance={30} maxDistance={R * 4} zoomSpeed={0.9} panSpeed={0.9}
        mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }} touches={{ ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN }} />
      {high && (
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur intensity={0.85} luminanceThreshold={0.16} luminanceSmoothing={0.35} radius={0.55} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
