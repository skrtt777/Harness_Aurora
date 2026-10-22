import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { ACTIVITY_COLOR, reviewOf, type KeeperView, type MemoryGraph, type SectionState } from "./adapter";
import { hash01, type Vec3 } from "./layout";
import { buildField, cloudColor, grainPerMemory, type CloudLayout } from "./clouds";
import { dynamicGeometry, fieldGeometry, fieldMaterial, FIELD_CLOUDS, FIELD_WAVES, lineMaterial, pointMaterial, ribbonGeometry, ribbonMaterial, RibbonWriter, Writer } from "./gfx";

/**
 * Memórias / Mapa Vivo — the memory as a field of clouds (clouds.ts), drawn like the reference's crawler:
 *   - each section (a node of the Zeladora) is a dense cloud of grain and fibres where its memories' meaning
 *     puts it; the memories are its bright points — a solid dot when proven (used, or written by a person), a
 *     hollow square while still in review (extracted and never used, or flagged);
 *   - the whole field is grey; a section lights up in its own colour only while something happens in it;
 *   - the Zeladora is a reader with a grid body and tentacles: she sits in the section she tends, reaches each
 *     memory she reads (a chip names it and what she found), travels to the next section along a long arc, and
 *     shapes the field: a memory she prunes is cut and falls, a node born opens from its centre, a node folded
 *     closes in on itself; a memory she adopts is reached by a green thread;
 *   - a question to the Aurora is a probe of her own (orange): a wave from where the search looks, thin
 *     tentacles to every memory it weighed, bright ones to the memories it really used, a callout at the best;
 *   - the person's cursor is a lens over the grain; a tap sends a wave; a double click focuses a section.
 * Nothing is invented: every bright point is a stored memory, every tentacle and wave a real event.
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
/** A recent answer and the memories it used. */
export type RecallBush = { id: string; at: string; prompt: string; used: string[] };

type SceneProps = {
  graph: MemoryGraph;
  layout: CloudLayout;
  settings: MapSettings;
  selectedId: string | null;
  hoveredId: string | null;
  focusClusterId: string | null;
  highlights: Map<string, Highlight>;
  camera: CameraCommand;
  agent: AgentState;
  keeper: KeeperView | null;
  /** Each section's state in the Zeladora's round. */
  sections: Map<string, SectionState>;
  /** The memories the Zeladora has read in this round (sections still waiting stay dim while she works); null: all lit. */
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
const C = {
  memory: col("#c9d1dc"), white: col("#ffffff"), grey: col("#8e98a8"),
  keeper: col("#cfe9ff"), recall: col("#ff9d5c"), recallHot: col("#ffe2c9"), scan: col("#8fb8e8"),
  created: col(ACTIVITY_COLOR), flag: col("#f2d14b"), select: col("#ff7aa8"), search: col("#9cc8ff"),
  prune: col("#ff7a4d"), pruneDim: col("#7a3a26"), fold: col("#b9a2ff"),
};
const HL_COLOR: Record<Highlight["kind"], THREE.Color> = { recalled: C.recall, created: C.created, search: C.search, read: C.keeper, linked: C.keeper, flagged: C.flag, joined: C.white };
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const easeOut = (u: number) => 1 - Math.pow(1 - u, 3);
const PRUNE_MS = 3400, ARRIVAL_MS = 2400, ADOPT_MS = 2800, BORN_MS = 4800, GONE_MS = 3200;
/** Where a memory and a section were last drawn (kept after they leave the field: a pruned memory falls from there). */
export type LastSeen = { memories: Map<string, [number, number]>; clouds: Map<string, { x: number; y: number; r: number }> };
type Wave = { x: number; y: number; at: number; s: number };

function Scene(props: SceneProps) {
  const { graph, layout, settings, selectedId, hoveredId, focusClusterId, highlights, camera, agent, keeper, onHover, onSelect, onCluster } = props;
  const R = layout.R;
  const motion = !settings.paused && !settings.reducedMotion;
  const reduced = settings.reducedMotion;
  const nodeOf = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const ids = useMemo(() => [...layout.nodes.keys()], [layout]);
  const hand = useRef({ x: 0, y: 0, s: 0 });
  const size = useThree((s) => s.size);
  const cam = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const clock = useThree((s) => s.clock);
  const cloudById = useMemo(() => new Map(layout.clouds.map((c) => [c.id, c])), [layout]);
  const colors = useMemo(() => layout.clouds.map((c) => col(cloudColor(c.index))), [layout]);
  const flagged = useMemo(() => { const s = new Set<string>(); for (const f of keeper?.flags || []) { s.add(f.id); if (f.otherId) s.add(f.otherId); } return s; }, [keeper?.flags]);

  // ---------- where each memory and cloud is drawn: eased from where it was when the field changes ----------
  type Display = { x: Float32Array; y: Float32Array; sx: Float32Array; sy: Float32Array; cx: Float32Array; cy: Float32Array; scx: Float32Array; scy: Float32Array; at: number; born: number };
  const disp = useRef<Display | null>(null);
  const prevPos = useRef(new Map<string, [number, number]>());
  const prevCloud = useRef(new Map<string, [number, number]>());
  const lastSeen = useRef<LastSeen>({ memories: new Map(), clouds: new Map() });
  const display = useMemo(() => {
    const now = performance.now();
    const n = ids.length, m = layout.clouds.length;
    const D: Display = { x: new Float32Array(n), y: new Float32Array(n), sx: new Float32Array(n), sy: new Float32Array(n), cx: new Float32Array(m), cy: new Float32Array(m), scx: new Float32Array(m), scy: new Float32Array(m), at: now, born: disp.current ? now - 10_000 : now };
    layout.clouds.forEach((c, i) => { const p = prevCloud.current.get(c.id); D.scx[i] = p ? p[0] : c.x; D.scy[i] = p ? p[1] : c.y; D.cx[i] = D.scx[i]; D.cy[i] = D.scy[i]; });
    ids.forEach((id, i) => {
      const p = prevPos.current.get(id);
      const c = layout.clouds[layout.cloudOf.get(id) ?? 0];
      // A memory seen for the first time grows out of its cloud's centre.
      D.sx[i] = p ? p[0] : c ? c.x : 0; D.sy[i] = p ? p[1] : c ? c.y : 0; D.x[i] = D.sx[i]; D.y[i] = D.sy[i];
    });
    for (const [id, p] of layout.nodes) { prevPos.current.set(id, [p[0], p[1]]); lastSeen.current.memories.set(id, [p[0], p[1]]); }
    for (const c of layout.clouds) { prevCloud.current.set(c.id, [c.x, c.y]); lastSeen.current.clouds.set(c.id, { x: c.x, y: c.y, r: c.r }); }
    disp.current = D;
    return D;
  }, [layout, ids]);
  const indexOf = useMemo(() => new Map(ids.map((id, i) => [id, i])), [ids]);
  const posOf = (id: string): [number, number] | null => { const i = indexOf.get(id); return i === undefined ? null : [display.x[i], display.y[i]]; };

  // ---------- the grain: static on the GPU, rebuilt only when the field changes ----------
  const field = useMemo(() => buildField(layout, grainPerMemory(settings.quality, ids.length)), [layout, settings.quality, ids.length]);
  const grain = useMemo(() => ({ points: fieldGeometry(field.points), fibres: fieldGeometry(field.fibres) }), [field]);
  useEffect(() => () => { grain.points.dispose(); grain.fibres.dispose(); }, [grain]);
  const fieldMats = useMemo(() => ({ points: fieldMaterial(true), fibres: fieldMaterial(false) }), []);
  useEffect(() => () => { fieldMats.points.dispose(); fieldMats.fibres.dispose(); }, [fieldMats]);

  // ---------- dynamic buffers ----------
  const geo = useMemo(() => ({
    dots: dynamicGeometry(ids.length + 1, true),
    lines: dynamicGeometry(40000, false),
    sparks: dynamicGeometry(3000, true),
    ribbons: ribbonGeometry(4000),
  }), [ids.length]);
  useEffect(() => () => { Object.values(geo).forEach((g) => g.dispose()); }, [geo]);
  const mats = useMemo(() => ({ points: pointMaterial(), lines: lineMaterial(), ribbons: ribbonMaterial() }), []);
  useEffect(() => () => { Object.values(mats).forEach((m) => m.dispose()); }, [mats]);
  const c3 = useMemo(() => new THREE.Color(), []);
  const c4 = useMemo(() => new THREE.Color(), []);

  // ---------- each cloud's heat (its colour) and light, eased every frame ----------
  const heat = useMemo(() => new Float32Array(layout.clouds.length), [layout]);
  const glow = useMemo(() => new Float32Array(ids.length), [ids]);
  const cloudIndexOf = (id?: string | null) => (id ? cloudById.get(id)?.index ?? -1 : -1);

  // ---------- waves: a search, a round of the Zeladora, a tap, a node born ----------
  const waves = useRef<Wave[]>([]);
  const pushWave = (x: number, y: number, s: number) => { if (!motion) return; waves.current = [...waves.current.filter((w) => clock.elapsedTime - w.at < 2.6), { x, y, at: clock.elapsedTime, s }].slice(-FIELD_WAVES); };

  // ---------- the turn: what the search weighed, what was used, what was created ----------
  const seenAt = useRef(new Map<string, number>());
  const lastScan = useRef("");
  const probe = useRef({ x: 0, y: 0, on: 0, key: "" });
  useEffect(() => {
    if (!agent) return;
    const now = performance.now();
    for (const t of agent.tentacles) { const k = `${agent.key}:${t.id}:${t.kind}`; if (!seenAt.current.has(k)) seenAt.current.set(k, now + (t.kind === "scanned" ? t.order * 25 : Math.max(0, t.order - 6) * 160)); }
    if (agent.tentacles.some((t) => t.kind === "scanned") && lastScan.current !== agent.key && agent.target) {
      lastScan.current = agent.key;
      pushWave(agent.target[0], agent.target[1], 1);
    }
  }, [agent]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- the Zeladora: her body, where she goes, the arc of her last journey ----------
  const kz = useRef({ x: 0, y: 0, on: 0, cloud: -1, travel: null as null | { ax: number; ay: number; bx: number; by: number; at: number } });
  const lastRound = useRef<number | null>(null);
  useEffect(() => {
    if (!keeper?.running || !keeper.enabled) return;
    if (lastRound.current !== null && keeper.round !== lastRound.current && kz.current.on > 0.1) pushWave(kz.current.x, kz.current.y, 0.7);
    lastRound.current = keeper.round;
  }, [keeper?.round, keeper?.running, keeper?.enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  // Shaping: a wave where a node is born or a memory arrives.
  const seenGrowth = useRef(new Set<string>());
  useEffect(() => {
    for (const g of keeper?.growth || []) {
      const key = `${g.kind}:${g.id || g.section}:${g.at}`;
      if (seenGrowth.current.has(key) || Date.now() - g.at > 3000) continue;
      seenGrowth.current.add(key);
      if (g.kind === "born" && g.section) { const c = cloudById.get(g.section); if (c) pushWave(c.x, c.y, 0.9); }
      if (g.kind === "arrival" && g.id) { const p = layout.nodes.get(g.id); if (p) pushWave(p[0], p[1], 0.6); }
    }
  }, [keeper?.growth, cloudById, layout]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- the memories the turn reaches (or the last question's, faintly, when nothing happens) ----------
  const reach = useMemo(() => {
    const out: { id: string; kind: AgentTentacle["kind"]; strength: number; at: number }[] = [];
    if (agent) for (const t of agent.tentacles) out.push({ id: t.id, kind: t.kind, strength: t.strength, at: seenAt.current.get(`${agent.key}:${t.id}:${t.kind}`) ?? performance.now() });
    else if (props.recalls[0]) props.recalls[0].used.slice(0, 10).forEach((id, k) => out.push({ id, kind: "recalled", strength: k === 0 ? 0.55 : 0.3, at: performance.now() + k * 120 }));
    return out;
  }, [agent, props.recalls]);
  const focusIds = useMemo(() => {
    const s = new Set<string>();
    const anchor = selectedId || hoveredId;
    if (anchor) { s.add(anchor); for (const e of graph.edges) { if (e.from === anchor) s.add(e.to); if (e.to === anchor) s.add(e.from); } }
    return s;
  }, [selectedId, hoveredId, graph.edges]);

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const now = performance.now(), nowMs = Date.now();
    const t = state.clock.getElapsedTime();
    const wpp = (2 * Math.max(1, cam.position.z) * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(1, size.height);
    const D = display;
    const k = reduced ? 1 : easeOut(Math.min(1, (now - D.at) / 1100));
    for (let i = 0; i < ids.length; i += 1) { const p = layout.nodes.get(ids[i])!; D.x[i] = D.sx[i] + (p[0] - D.sx[i]) * k; D.y[i] = D.sy[i] + (p[1] - D.sy[i]) * k; }
    layout.clouds.forEach((c, i) => { D.cx[i] = D.scx[i] + (c.x - D.scx[i]) * k; D.cy[i] = D.scy[i] + (c.y - D.scy[i]) * k; });
    for (let i = 0; i < glow.length; i += 1) glow[i] *= Math.exp(-dt * 1.4);
    const h = hand.current; h.s *= Math.exp(-dt * 1.2);
    const lensR = Math.max(R * 0.08, 70 * wpp);
    const lens = (x: number, y: number) => { if (h.s < 0.02) return 0; const d = Math.hypot(x - h.x, y - h.y); return d < lensR ? h.s * (1 - d / lensR) ** 2 : 0; };
    waves.current = waves.current.filter((w) => t - w.at < 2.6);
    const waveSpeed = R * 0.75, waveBand = R * 0.05;
    const waveAt = (x: number, y: number) => { let v = 0; for (const w of waves.current) { const age = t - w.at; const d = Math.abs(Math.hypot(x - w.x, y - w.y) - age * waveSpeed); if (d < waveBand) v = Math.max(v, w.s * (1 - d / waveBand) * (1 - age / 2.6)); } return v; };

    // ---- which sections are active now: their colour comes up, the rest of the field stays grey ----
    const target = new Float32Array(layout.clouds.length);
    const lift = (ci: number, v: number) => { if (ci >= 0 && ci < target.length) target[ci] = Math.max(target[ci], v); };
    const keeperOn = Boolean(keeper?.enabled && keeper.running);
    const kCur = keeperOn && keeper!.current ? layout.cloudOf.get(keeper!.current) : undefined;
    if (kCur !== undefined && keeper!.phase === "andando") lift(kCur, 1);
    if (agent) for (const r of reach) { const ci = layout.cloudOf.get(r.id); if (ci !== undefined) lift(ci, r.kind === "scanned" ? 0.35 : agent.ended ? 0.6 : 1); }
    lift(cloudIndexOf(focusClusterId), 0.85);
    if (selectedId) { const ci = layout.cloudOf.get(selectedId); if (ci !== undefined) lift(ci, 0.6); }
    if (hoveredId) { const ci = layout.cloudOf.get(hoveredId); if (ci !== undefined) lift(ci, 0.3); }
    for (const g of keeper?.growth || []) {
      const age = nowMs - g.at;
      if (g.kind === "born" && age < BORN_MS) lift(cloudIndexOf(g.section), 1 - smooth(0.6, 1, age / BORN_MS));
      if (g.kind === "gone" && age < GONE_MS) lift(cloudIndexOf(g.into), 0.8 * (1 - age / GONE_MS));
      if (g.kind === "adopt" && age < ADOPT_MS) lift(cloudIndexOf(g.section), 0.7 * (1 - age / ADOPT_MS));
    }
    const ease = reduced ? 1 : 1 - Math.exp(-dt * 2.6);
    for (let i = 0; i < heat.length; i += 1) heat[i] += (target[i] - heat[i]) * ease;
    const fadeIn = reduced ? 1 : smooth(0, 900, now - D.born);
    const light = layout.clouds.map((c) => {
      const st = props.sections.get(c.id);
      const waiting = props.readSet && st?.state === "na fila" ? 0.55 : 1;
      return (focusClusterId && focusClusterId !== c.id ? 0.5 : 1) * waiting * (0.35 + 0.65 * fadeIn);
    });

    // ---- the grain's uniforms ----
    for (const m of [fieldMats.points, fieldMats.fibres]) {
      const u = m.uniforms;
      u.uTime.value = t; u.uMotion.value = motion ? 1 : 0; u.uDrift.value = R * 0.0035;
      (u.uHand.value as THREE.Vector3).set(h.x, h.y, h.s); u.uLensR.value = lensR;
      u.uWaveSpeed.value = waveSpeed; u.uWaveBand.value = waveBand; u.uRef.value = R * 2.3;
      const cols = u.uColor.value as THREE.Color[]; const hs = u.uHeat.value as number[]; const ls = u.uLight.value as number[];
      for (let i = 0; i < FIELD_CLOUDS; i += 1) { const j = i % Math.max(1, colors.length); if (colors[j]) cols[i].copy(colors[j]); hs[i] = heat[i] ?? 0; ls[i] = light[i] ?? 1; }
      const wv = u.uWaves.value as THREE.Vector4[];
      for (let i = 0; i < FIELD_WAVES; i += 1) { const w = waves.current[i]; if (w) wv[i].set(w.x, w.y, w.at, w.s); else wv[i].set(0, 0, 0, 0); }
    }
    (mats.points.uniforms.uRef as { value: number }).value = R * 2.3;

    const lw = new Writer(geo.lines).begin();
    const sw = new Writer(geo.sparks).begin();
    const rw = new RibbonWriter(geo.ribbons).begin();
    const curve = (ax: number, ay: number, bx: number, by: number, bend: number, alpha: number, ca: THREE.Color, steps = 18, alphaB = alpha, cb = ca, upTo = 1) => {
      const mx = (ax + bx) / 2, my = (ay + by) / 2, dx = bx - ax, dy = by - ay;
      const qx = mx - dy * bend, qy = my + dx * bend;
      let px = ax, py = ay;
      const last = Math.max(1, Math.round(steps * upTo));
      for (let s = 1; s <= last; s += 1) {
        const u = s / steps, v = 1 - u;
        const x = v * v * ax + 2 * v * u * qx + u * u * bx, y = v * v * ay + 2 * v * u * qy + u * u * by;
        c3.copy(ca).lerp(cb, u);
        lw.line(px, py, x, y, alpha + (alphaB - alpha) * (u - 1 / steps), c3, alpha + (alphaB - alpha) * u);
        px = x; py = y;
      }
      return [px, py] as const;
    };
    const curveRibbon = (ax: number, ay: number, bx: number, by: number, bend: number, w: number, alpha: number, ca: THREE.Color, cb: THREE.Color, upTo = 1) => {
      const mx = (ax + bx) / 2, my = (ay + by) / 2, dx = bx - ax, dy = by - ay;
      const qx = mx - dy * bend, qy = my + dx * bend;
      const steps = 22; let px = ax, py = ay;
      const last = Math.max(1, Math.round(steps * upTo));
      for (let s = 1; s <= last; s += 1) {
        const u = s / steps, v = 1 - u;
        const x = v * v * ax + 2 * v * u * qx + u * u * bx, y = v * v * ay + 2 * v * u * qy + u * u * by;
        c3.copy(ca).lerp(cb, (s - 1) / steps); c4.copy(ca).lerp(cb, u);
        rw.seg({ x: px, y: py }, { x, y }, w, alpha * (0.6 + 0.4 * (s - 1) / steps), alpha * (0.6 + 0.4 * u), c3, c4);
        px = x; py = y;
      }
      return [px, py] as const;
    };
    const ring = (x: number, y: number, r: number, alpha: number, c: THREE.Color, segs = 48) => {
      let px = x + r, py = y;
      for (let s = 1; s <= segs; s += 1) { const a = (s / segs) * Math.PI * 2; const nx = x + Math.cos(a) * r, ny = y + Math.sin(a) * r; lw.line(px, py, nx, ny, alpha, c); px = nx; py = ny; }
    };

    // ---- the Zeladora: a grid body with tentacles, in the section she tends ----
    const z = kz.current;
    const curIdx = keeperOn && keeper!.current ? indexOf.get(keeper!.current) : undefined;
    if (keeperOn && curIdx !== undefined) {
      const ci = layout.cloudOf.get(keeper!.current!) ?? 0;
      const cx = D.cx[ci], cy = D.cy[ci];
      // She sits between the section's centre and the memory she reads (her tentacles do the reaching).
      const tx = cx + (D.x[curIdx] - cx) * 0.45, ty = cy + (D.y[curIdx] - cy) * 0.45;
      if (z.on < 0.01) { z.x = tx; z.y = ty; z.cloud = ci; }
      if (ci !== z.cloud) { z.travel = { ax: z.x, ay: z.y, bx: tx, by: ty, at: now }; z.cloud = ci; }
      const e = reduced ? 1 : 1 - Math.exp(-dt * 2.4);
      z.x += (tx - z.x) * e; z.y += (ty - z.y) * e;
      z.on = Math.min(keeper!.phase === "andando" ? 1 : 0.45, z.on + dt * 1.5);
    } else if (keeperOn && z.on > 0) z.on = Math.max(0.3, z.on - dt * 0.8);
    else z.on = Math.max(0, z.on - dt * 1.5);
    if (z.on > 0.01) {
      const ci = Math.max(0, z.cloud);
      const kc = colors[ci] || C.keeper;
      const body = Math.max(24 * wpp, (layout.clouds[ci]?.r || 60) * 0.17);
      const rx = body * 0.8, ry = body;
      const breathe = motion ? 1 + Math.sin(t * 2.2) * 0.04 : 1;
      // Tentacles to the memories she read (the newest brightest), wavering; the one she reads now a ribbon.
      const trail = (keeper?.trail || []).slice(0, 16);
      trail.forEach((id, j) => {
        const p = indexOf.get(id); if (p === undefined) return;
        const at = keeper!.trailAt[id] ?? nowMs - 30_000;
        const age = nowMs - at;
        const reachU = reduced ? 1 : Math.min(1, age / 500);
        const a = Math.max(0.3, 1 - age / 26_000) * z.on;
        const bend = (motion ? Math.sin(t * 1.6 + j * 1.3) : 0.5) * 0.14;
        const ang = Math.atan2(D.y[p] - z.y, D.x[p] - z.x);
        const sx = z.x + Math.cos(ang) * rx * 0.9, sy = z.y + Math.sin(ang) * ry * 0.9;
        if (j === 0) {
          const [ex, ey] = curveRibbon(sx, sy, D.x[p], D.y[p], bend, 1.8 * wpp, 0.95 * z.on, C.white, kc, reachU);
          sw.dot(ex, ey, 6, z.on, C.white);
          if (reachU >= 1 && motion) { const u = (t * 0.9) % 1; const v = 1 - u; const qx = (sx + D.x[p]) / 2 - (D.y[p] - sy) * bend, qy = (sy + D.y[p]) / 2 + (D.x[p] - sx) * bend; sw.dot(v * v * sx + 2 * v * u * qx + u * u * D.x[p], v * v * sy + 2 * v * u * qy + u * u * D.y[p], 4, z.on * 0.9, kc); }
        } else curve(sx, sy, D.x[p], D.y[p], bend, a * 0.55, kc, 16, a * 0.9, C.white, reachU);
        glow[p] = Math.max(glow[p], a * (j === 0 ? 1 : 0.6));
      });
      // The idle legs: short curling hairs all around her body.
      const legs = 22;
      for (let l = 0; l < legs; l += 1) {
        const a0 = (l / legs) * Math.PI * 2 + (motion ? Math.sin(t * 0.5 + l) * 0.08 : 0);
        const len = body * (1.0 + 0.9 * hash01(`leg${l}`) + (motion ? Math.sin(t * 1.7 + l * 2.1) * 0.25 : 0));
        let px = z.x + Math.cos(a0) * rx * breathe, py = z.y + Math.sin(a0) * ry * breathe;
        for (let s = 1; s <= 4; s += 1) {
          const curl = (motion ? Math.sin(t * 2.3 + l + s) : 0.6) * 0.22 * s;
          const nx = px + Math.cos(a0 + curl) * len / 4, ny = py + Math.sin(a0 + curl) * len / 4;
          lw.line(px, py, nx, ny, z.on * 0.5 * (1 - s / 5), kc, z.on * 0.5 * (1 - (s + 1) / 5));
          px = nx; py = ny;
        }
        if (hash01(`leg${l}`, 2) > 0.6) sw.dot(px, py, 2, z.on * 0.6, kc);
      }
      // The body: an ellipsoid of grid lines turning slowly, a diamond heart in her section's colour.
      c3.copy(C.white).lerp(kc, 0.35);
      let px = z.x + rx * breathe, py = z.y;
      for (let s = 1; s <= 40; s += 1) { const a = (s / 40) * Math.PI * 2; const nx = z.x + Math.cos(a) * rx * breathe, ny = z.y + Math.sin(a) * ry * breathe; lw.line(px, py, nx, ny, 0.85 * z.on, c3); px = nx; py = ny; }
      const spin = motion ? t * 0.8 : 0.4;
      for (let m = 0; m < 6; m += 1) {
        const ph = spin + (m / 6) * Math.PI; const sx = Math.cos(ph);
        if (Math.sin(ph) < 0) continue;
        let qx = z.x + rx * sx * breathe, qy = z.y - ry * breathe;
        for (let s = 1; s <= 16; s += 1) { const a = -Math.PI / 2 + (s / 16) * Math.PI; const nx = z.x + rx * sx * Math.cos(a) * breathe, ny = z.y + ry * Math.sin(a) * breathe; lw.line(qx, qy, nx, ny, 0.4 * z.on, c3); qx = nx; qy = ny; }
      }
      for (let m = 1; m < 6; m += 1) { const yy = -1 + (2 * m) / 6; const w = Math.sqrt(1 - yy * yy); lw.line(z.x - rx * w * breathe, z.y + ry * yy * breathe, z.x + rx * w * breathe, z.y + ry * yy * breathe, 0.35 * z.on, c3); }
      const dmd = body * 0.32;
      lw.line(z.x, z.y + dmd, z.x + dmd * 0.8, z.y, z.on, kc); lw.line(z.x + dmd * 0.8, z.y, z.x, z.y - dmd, z.on, kc);
      lw.line(z.x, z.y - dmd, z.x - dmd * 0.8, z.y, z.on, kc); lw.line(z.x - dmd * 0.8, z.y, z.x, z.y + dmd, z.on, kc);
      sw.dot(z.x, z.y, 7 + (motion ? Math.sin(t * 3) : 0), z.on, kc);
      sw.dot(z.x, z.y, 26, 0.12 * z.on, kc);
    }
    // Her last journey: a long arc from the section she left to the one she went to.
    if (z.travel) {
      const age = now - z.travel.at;
      if (age > 5200) z.travel = null;
      else {
        const u = reduced ? 1 : easeOut(Math.min(1, age / 900));
        const a = (1 - smooth(2500, 5200, age)) * 0.75;
        const kc = colors[Math.max(0, z.cloud)] || C.keeper;
        const [ex, ey] = curve(z.travel.ax, z.travel.ay, z.x, z.y, 0.22, a * 0.25, kc, 36, a, C.white, u);
        if (u < 1) sw.dot(ex, ey, 6, a, C.white);
        sw.dot(z.travel.ax, z.travel.ay, 3, a * 0.6, kc);
      }
    }

    // ---- the Aurora's probe: thin tentacles to what the search weighed, bright ones to what it used ----
    const chosen = reach.filter((r) => r.kind !== "scanned");
    const focusPts = (chosen.length ? chosen : reach.slice(0, 6)).map((r) => indexOf.get(r.id)).filter((i): i is number => i !== undefined);
    const pr = probe.current;
    if (focusPts.length) {
      const tx = focusPts.reduce((s, i) => s + D.x[i], 0) / focusPts.length, ty = focusPts.reduce((s, i) => s + D.y[i], 0) / focusPts.length;
      // Off the memories a little, so the tentacles show (above the field's centre of what it reaches).
      const ox = tx + R * 0.02, oy = ty + R * 0.07;
      if (pr.on < 0.01 || pr.key !== (agent?.key || "last")) { pr.x = ox; pr.y = oy; pr.key = agent?.key || "last"; }
      const e = reduced ? 1 : 1 - Math.exp(-dt * 3);
      pr.x += (ox - pr.x) * e; pr.y += (oy - pr.y) * e;
      pr.on = Math.min(agent ? (agent.ended ? 0.7 : 1) : 0.45, pr.on + dt * 2);
    } else pr.on = Math.max(0, pr.on - dt * 1.5);
    if (pr.on > 0.01) {
      for (const r of reach) {
        const p = indexOf.get(r.id); if (p === undefined) continue;
        const u = reduced ? 1 : Math.max(0, Math.min(1, (now - r.at) / 650));
        if (u <= 0) continue;
        const bend = 0.08 + hash01(r.id, 4) * 0.1;
        if (r.kind === "scanned") { curve(pr.x, pr.y, D.x[p], D.y[p], bend, 0.05 * pr.on, C.scan, 14, (0.12 + 0.3 * r.strength) * pr.on, C.scan, u); glow[p] = Math.max(glow[p], 0.25 * r.strength * u); continue; }
        const cEnd = r.kind === "created" ? C.created : C.recall;
        const [ex, ey] = curveRibbon(pr.x, pr.y, D.x[p], D.y[p], bend, (r.strength >= 1 ? 2 : 1.3) * wpp, r.strength * pr.on, C.recallHot, cEnd, easeOut(u));
        if (u < 1) sw.dot(ex, ey, 6, pr.on, C.recallHot);
        glow[p] = Math.max(glow[p], r.strength * u);
      }
      sw.dot(pr.x, pr.y, 8 + (motion ? Math.sin(t * 4) * 1.2 : 0), pr.on, C.recallHot);
      sw.dot(pr.x, pr.y, 22, 0.18 * pr.on, C.recall);
      ring(pr.x, pr.y, 11 * wpp * (1 + (motion ? (t % 1.6) / 1.6 : 0.4)), pr.on * (motion ? 1 - (t % 1.6) / 1.6 : 0.5) * 0.7, C.recall, 32);
    }

    // ---- the Zeladora's links: an arc between two memories ----
    for (const l of (keeper?.links || []).slice(-6)) {
      const age = nowMs - l.at; if (age > 8000) continue;
      const a = indexOf.get(l.from), b = indexOf.get(l.to); if (a === undefined || b === undefined) continue;
      const fade = (1 - age / 8000) * 0.9;
      const ci = layout.cloudOf.get(l.from) ?? 0;
      curve(D.x[a], D.y[a], D.x[b], D.y[b], 0.3, fade, colors[ci] || C.keeper, 24, fade, C.white);
      const u = (age % 1400) / 1400, v = 1 - u; const mx = (D.x[a] + D.x[b]) / 2, my = (D.y[a] + D.y[b]) / 2; const qx = mx - (D.y[b] - D.y[a]) * 0.3, qy = my + (D.x[b] - D.x[a]) * 0.3;
      sw.dot(v * v * D.x[a] + 2 * v * u * qx + u * u * D.x[b], v * v * D.y[a] + 2 * v * u * qy + u * u * D.y[b], 4, fade, C.white);
      glow[a] = Math.max(glow[a], fade); glow[b] = Math.max(glow[b], fade);
    }

    // ---- the links of the memory in focus ----
    for (const e of graph.edges) {
      if (!(focusIds.has(e.from) && focusIds.has(e.to))) continue;
      const a = indexOf.get(e.from), b = indexOf.get(e.to); if (a === undefined || b === undefined) continue;
      curve(D.x[a], D.y[a], D.x[b], D.y[b], 0.12, 0.45, C.memory, 12);
    }

    // ---- the Zeladora shaping the field: a pruned memory falls, a node opens, a folded one closes ----
    for (const g of keeper?.growth || []) {
      const age = nowMs - g.at;
      if (g.kind === "prune" && g.id && age < PRUNE_MS) {
        const p = lastSeen.current.memories.get(g.id); if (!p) continue;
        const u = age / PRUNE_MS, d = 9 * wpp;
        if (age < 700) { const kk = 1 - age / 700; lw.line(p[0] - d, p[1] - d, p[0] + d, p[1] + d, kk, C.prune); lw.line(p[0] - d, p[1] + d, p[0] + d, p[1] - d, kk, C.prune); ring(p[0], p[1], d * (1 + 3 * easeOut(age / 700)), kk * 0.8, C.prune); }
        const fade = 1 - smooth(0.62, 1, u);
        for (let s = 0; s < 5; s += 1) {
          const v = Math.max(0, u - s * 0.022);
          c3.copy(C.prune).lerp(C.pruneDim, Math.min(1, u * 1.4));
          sw.dot(p[0] + Math.sin(v * 8 + hash01(g.id) * 6.28) * R * 0.012 * v, p[1] - R * 0.25 * v * v, (5.5 - s) * (1 - u * 0.4), fade * (1 - s * 0.2), c3);
        }
      }
      if (g.kind === "arrival" && g.id && age < ARRIVAL_MS) {
        const p = indexOf.get(g.id); if (p === undefined) continue;
        const u = age / ARRIVAL_MS;
        ring(D.x[p], D.y[p], (6 + 40 * easeOut(u)) * wpp, (1 - u) * 0.85, C.created);
        glow[p] = Math.max(glow[p], 1 - u);
      }
      if (g.kind === "adopt" && g.id && age < ADOPT_MS) {
        const p = indexOf.get(g.id); const ci = layout.cloudOf.get(g.id); if (p === undefined || ci === undefined) continue;
        const u = age / ADOPT_MS;
        curveRibbon(D.cx[ci], D.cy[ci], D.x[p], D.y[p], 0.15, 1.5 * wpp, (1 - smooth(0.6, 1, u)) * 0.9, C.white, C.created, easeOut(Math.min(1, u * 2)));
        glow[p] = Math.max(glow[p], 1 - u);
      }
      if (g.kind === "born" && g.section && age < BORN_MS) {
        const ci = cloudIndexOf(g.section); if (ci < 0) continue;
        const c = layout.clouds[ci]; const u = age / BORN_MS, env = 1 - smooth(0.5, 1, u);
        ring(D.cx[ci], D.cy[ci], c.r * (0.2 + 0.95 * easeOut(Math.min(1, u * 1.5))), env * 0.75, C.white, 64);
        ring(D.cx[ci], D.cy[ci], c.r * (0.1 + 0.6 * easeOut(Math.min(1, u * 1.2))), env * 0.5, colors[ci], 64);
        const pi = cloudIndexOf(g.from);
        if (pi >= 0) curve(D.cx[pi], D.cy[pi], D.cx[ci], D.cy[ci], 0.2, env * 0.3, colors[pi], 36, env * 0.85, colors[ci], easeOut(Math.min(1, u * 2)));
      }
      if (g.kind === "gone" && g.section && age < GONE_MS) {
        const p = lastSeen.current.clouds.get(g.section); if (!p) continue;
        const u = age / GONE_MS;
        ring(p.x, p.y, p.r * (1 - easeOut(u)) + 2 * wpp, (1 - u) * 0.8, C.fold, 64);
        ring(p.x, p.y, p.r * 0.6 * (1 - easeOut(u)) + wpp, (1 - u) * 0.5, C.fold, 64);
        const ii = cloudIndexOf(g.into);
        if (ii >= 0) curve(p.x, p.y, D.cx[ii], D.cy[ii], 0.15, (1 - u) * 0.7, C.fold, 30, (1 - u) * 0.3, colors[ii], easeOut(Math.min(1, u * 2)));
      }
    }

    // ---- merges (compaction): the memories fly into the one that keeps them ----
    for (const m of props.merges) {
      const age = nowMs - m.at; if (age > 1600) continue;
      const u = easeOut(Math.min(1, age / 1300));
      for (const f of m.from) for (let tail = 0; tail < 4; tail += 1) {
        const v = Math.max(0, u - tail * 0.05);
        sw.dot(f[0] + (m.to[0] - f[0]) * v, f[1] + (m.to[1] - f[1]) * v, 5 - tail, (1 - age / 1600) * (1 - tail * 0.22), C.white);
      }
    }
    lw.end(); rw.end();

    // ---- the memories: bright points (proven: a dot; in review: a hollow square) ----
    const dw = new Writer(geo.dots).begin();
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i];
      const n = nodeOf.get(id); if (!n) continue;
      const ci = layout.cloudOf.get(id) ?? 0;
      const hh = heat[ci] ?? 0;
      const hl = highlights.get(id);
      const active = hl && now - hl.at < ACTIVE_MS ? 1 - (now - hl.at) / ACTIVE_MS : 0;
      const gl = glow[i];
      const ln = lens(D.x[i], D.y[i]);
      const wv = waveAt(D.x[i], D.y[i]);
      const review = reviewOf(n.memory, flagged.has(id)) === "revisar";
      const isSel = id === selectedId, isHover = id === hoveredId;
      const twinkle = motion ? 0.85 + 0.15 * Math.sin(t * (0.8 + hash01(id, 7) * 1.6) + hash01(id) * 6.28) : 1;
      const base = (2.3 + n.relevance * 2.6) * twinkle;
      const sz = base + gl * 3 + ln * 2.5 + active * 2.5 + wv * 2 + hh * 0.8 + (isSel ? 4 : isHover ? 2.5 : 0);
      const alpha = Math.min(1, (0.5 + n.relevance * 0.35) * (light[ci] ?? 1) + hh * 0.3 + gl + ln * 0.5 + active + wv * 0.6 + (isSel || isHover ? 1 : 0));
      c3.copy(C.memory);
      if (hh > 0.02 && colors[ci]) c3.lerp(colors[ci], Math.min(1, hh * 0.8));
      if (gl > 0.05) c3.lerp(C.white, Math.min(0.7, gl * 0.6));
      if (review && flagged.has(id)) c3.lerp(C.flag, 0.7);
      if (active > 0 && hl) c3.lerp(HL_COLOR[hl.kind], Math.min(1, active * 1.2));
      if (isSel) c3.lerp(C.select, 0.6);
      dw.dot(D.x[i], D.y[i], review ? -(sz * 1.05 + 1.5) : sz, review ? alpha * 0.8 : alpha, c3);
    }
    dw.end();
    sw.end();
  });

  // ---------- the person: a lens, hover the nearest memory, tap for a wave, double click focuses a section ----------
  const plane0 = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const lastHover = useRef<string | null>(null);
  const wppNow = () => (2 * Math.max(1, cam.position.z) * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(1, size.height);
  const nearest = (x: number, y: number): string | null => {
    const max = 12 * wppNow();
    let best: string | null = null, bd = max * max;
    for (let i = 0; i < ids.length; i += 1) { const d = (display.x[i] - x) ** 2 + (display.y[i] - y) ** 2; if (d < bd) { bd = d; best = ids[i]; } }
    return best;
  };
  const cloudAt = (x: number, y: number) => layout.clouds.find((c) => Math.hypot(x - c.x, y - c.y) < c.r * 1.05) || null;
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (!e.ray.intersectPlane(plane0, hit)) return;
    const hh = hand.current;
    const moved = Math.hypot(hit.x - hh.x, hit.y - hh.y) / Math.max(0.001, wppNow());
    hh.x = hit.x; hh.y = hit.y; hh.s = Math.min(1, hh.s + moved * 0.02);
    const id = nearest(hit.x, hit.y);
    if (id !== lastHover.current) { lastHover.current = id; onHover(id); }
  };
  const onTap = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4 || !e.ray.intersectPlane(plane0, hit)) return;
    const id = nearest(hit.x, hit.y);
    if (id) { onSelect(id); return; }
    pushWave(hit.x, hit.y, 0.6);
    onSelect(null);
  };
  const onDouble = (e: ThreeEvent<MouseEvent>) => {
    if (!e.ray.intersectPlane(plane0, hit)) return;
    const c = cloudAt(hit.x, hit.y);
    if (c) onCluster(c.id, true);
  };

  return (
    <>
      <mesh position={[0, 0, -0.5]} onPointerMove={onMove} onPointerLeave={() => { hand.current.s = 0; lastHover.current = null; onHover(null); }} onClick={onTap} onDoubleClick={onDouble}>
        <planeGeometry args={[R * 10, R * 10]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      <lineSegments geometry={grain.fibres} material={fieldMats.fibres} frustumCulled={false} />
      <points geometry={grain.points} material={fieldMats.points} frustumCulled={false} />
      <lineSegments geometry={geo.lines} material={mats.lines} frustumCulled={false} />
      <mesh geometry={geo.ribbons} material={mats.ribbons} frustumCulled={false} />
      <points geometry={geo.dots} material={mats.points} frustumCulled={false} />
      <points geometry={geo.sparks} material={mats.points} frustumCulled={false} />
      <Labels {...props} reach={reach} lastSeen={lastSeen.current} flagged={flagged} />
      <CameraRig command={camera} reduced={reduced} onUserMove={props.onUserMove} R={R} />
    </>
  );
}

// ================================================================== words on the field
/** Chips that would cover each other move apart vertically (each side of the cloud on its own). */
function placeChips(list: { id: string; x: number; y: number; left: boolean }[], wpp: number) {
  const out = list.map((c) => ({ ...c }));
  for (const side of [true, false]) {
    const mine = out.filter((c) => c.left === side).sort((a, b) => b.y - a.y);
    for (let i = 1; i < mine.length; i += 1) {
      const prev = mine[i - 1];
      if (Math.abs(mine[i].x - prev.x) < 260 * wpp && prev.y - mine[i].y < 19 * wpp) mine[i].y = prev.y - 19 * wpp;
    }
  }
  // A chip pushed far from its memory would name the wrong point: it is left out.
  return out.filter((c) => Math.abs(c.y - list.find((o) => o.id === c.id)!.y) <= 40 * wpp);
}
const shortText = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/**
 * Each section's name with its count and state (the reference's "objective · 23/23 words · done"), chips on
 * the memories the Zeladora is reading (what she found in each), names of a few memories (hovered, selected,
 * just created), the callout at the best memory of a question, and what she just did to the field.
 */
function Labels({ graph, layout, selectedId, hoveredId, focusClusterId, highlights, sections, settings, keeper, agent, reach, lastSeen, flagged }: SceneProps & { reach: { id: string; kind: AgentTentacle["kind"]; strength: number }[]; lastSeen: LastSeen; flagged: Set<string> }) {
  const R = layout.R;
  const [, tick] = useState(0);
  // How many world units one pixel is now, in coarse steps (the labels re-render only when it changes much).
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const viewH = useThree((s) => s.size.height);
  const zoomStep = useRef(0);
  const [, setZoom] = useState(0);
  useFrame(() => {
    const w = (2 * Math.max(1, camera.position.z) * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, viewH);
    const step = Math.round(Math.log2(w) * 3);
    if (step !== zoomStep.current) { zoomStep.current = step; setZoom(step); }
  });
  const wpp = (2 * Math.max(1, camera.position.z) * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, viewH);
  const shaping = (keeper?.growth || []).filter((g) => (g.kind === "prune" || g.kind === "born" || g.kind === "gone") && Date.now() - g.at < (g.kind === "born" ? BORN_MS : g.kind === "gone" ? GONE_MS : PRUNE_MS) + 600);
  useEffect(() => { if (!shaping.length) return undefined; const t = window.setInterval(() => tick((x) => x + 1), 600); return () => window.clearInterval(t); }, [shaping.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const nodeOf = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const clusterOf = useMemo(() => new Map(graph.clusters.map((c) => [c.id, c])), [graph.clusters]);
  const now = performance.now();
  const at = (id: string): Vec3 => layout.nodes.get(id) || [0, 0, 0];
  const colorOfMemory = (id: string) => cloudColor(layout.cloudOf.get(id) ?? 0);
  const keeperOn = Boolean(keeper?.enabled && keeper.running);
  const here = keeperOn && keeper!.current ? layout.cloudOf.get(keeper!.current) : undefined;
  // The chips: the memories she read in this section, newest first (what she found in each).
  // While the Aurora answers a question, the map speaks of the question (her chips wait).
  const turnNow = Boolean(agent && !agent.ended);
  const chips = keeperOn && keeper!.phase === "andando" && !turnNow ? (keeper!.trail || []).filter((id) => layout.cloudOf.get(id) === here).slice(0, 6) : [];
  const chipSet = new Set(chips);
  const main = reach.find((r) => r.kind === "recalled" || r.kind === "used") || reach.find((r) => r.kind === "created");
  const mainId = agent && main ? main.id : null;
  const names = new Set<string>();
  if (hoveredId && hoveredId !== mainId && !chipSet.has(hoveredId)) names.add(hoveredId);
  if (selectedId && selectedId !== mainId && !chipSet.has(selectedId)) names.add(selectedId);
  for (const [id, h] of [...highlights].sort((a, b) => b[1].at - a[1].at)) { if (names.size >= 5) break; if (now - h.at < 5000 && id !== mainId && !chipSet.has(id) && (h.kind === "created" || h.kind === "joined")) names.add(id); }
  // Used memories of the question beyond the best one: a small orange chip each.
  const used = agent ? reach.filter((r) => (r.kind === "recalled" || r.kind === "used") && r.id !== mainId).slice(0, 6).map((r) => r.id) : [];
  const mainNode = mainId ? nodeOf.get(mainId) : null;
  const score = mainId ? highlights.get(mainId)?.score : undefined;
  if (!settings.labels) return null;
  return (
    <>
      {layout.clouds.map((c, k) => {
        const cl = clusterOf.get(c.id); if (!cl) return null;
        const st = sections.get(c.id);
        const on = c.id === focusClusterId || st?.state === "lendo" || here === c.index;
        const px = c.r / wpp;
        // Far away only the bigger sections keep a name; close enough, each says how far she is in it.
        if (!on && (k >= 16 || px < 16 || (px < 30 && k >= 8))) return null;
        return (
          <Html key={c.id} position={[c.x - c.r * 0.55, c.y + c.r * 0.92, 0]} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
            <div className={`lm-sec ${on ? "on" : ""} ${st?.state === "na fila" ? "queued" : st?.state === "feito" ? "done" : ""}`} style={{ ["--c" as string]: cloudColor(c.index) }}>
              <b>{cl.label}</b>
              {(on || px > 46) && <span>{st ? `${st.read}/${st.total} memórias · ${st.state === "lendo" ? "lendo" : st.state === "feito" ? "feito" : "na fila"}` : `${cl.nodeIds.length} memórias`}</span>}
            </div>
          </Html>
        );
      })}
      {placeChips(chips.map((id) => ({ id, x: at(id)[0], y: at(id)[1], left: here !== undefined && at(id)[0] < layout.clouds[here].x })), wpp).map(({ id, x, y, left }) => {
        const n = nodeOf.get(id); if (!n) return null;
        const j = chips.indexOf(id); const kind = keeper!.kinds[id];
        const flag = flagged.has(id) || kind === "vaga";
        return (
          <Html key={`k:${id}`} position={[x, y, 0]} zIndexRange={[22, 12]} style={{ pointerEvents: "none" }}>
            <div className={`lm-chip ${left ? "left" : ""} ${j === 0 ? "now" : ""} ${flag ? "flag" : ""}`} style={{ ["--c" as string]: colorOfMemory(id) }}>
              {shortText(n.memory.title, 26)}{flag ? <em> ⚑ {kind === "vaga" ? "vaga" : "revisar"}</em> : kind ? <em> · {kind}</em> : null}
            </div>
          </Html>
        );
      })}
      {used.map((id) => nodeOf.get(id) && (
        <Html key={`u:${id}`} position={[at(id)[0], at(id)[1], 0]} zIndexRange={[22, 12]} style={{ pointerEvents: "none" }}>
          <div className="lm-chip used">{shortText(nodeOf.get(id)!.memory.title, 26)}</div>
        </Html>
      ))}
      {[...names].filter((id) => nodeOf.has(id)).map((id) => {
        const [x] = at(id); const h = highlights.get(id);
        return (
          <Html key={`n:${id}`} position={at(id)} zIndexRange={[20, 10]} style={{ pointerEvents: "none" }}>
            <div className={`lm-leaf ${x > R * 0.55 ? "left" : ""} ${id === selectedId ? "sel" : ""} ${h && now - h.at < ACTIVE_MS ? h.kind : ""}`}>
              {nodeOf.get(id)!.label}{h?.note && now - h.at < ACTIVE_MS ? <em> · {h.note}</em> : null}
            </div>
          </Html>
        );
      })}
      {mainNode && mainId && (
        <Html key={`main:${mainId}`} position={at(mainId)} zIndexRange={[30, 20]} style={{ pointerEvents: "none" }}>
          <div className={`lm-callout ${at(mainId)[0] > R * 0.45 ? "left" : ""}`} style={{ ["--c" as string]: main?.kind === "created" ? ACTIVITY_COLOR : "#ff9a55" }}>
            <b>{main?.kind === "created" ? "criada agora" : agent?.ended ? "usada na resposta" : "consultada"}{score != null ? ` · pontuação ${score.toFixed(2).replace(".", ",")}` : ""}</b>
            <span>{mainNode.memory.title}</span>
            <small>{clusterOf.get(mainNode.clusterId)?.label || "—"}{mainNode.memory.uses ? ` · usada ${mainNode.memory.uses}×` : ""} · {reviewOf(mainNode.memory, flagged.has(mainId)) === "comprovada" ? "comprovada" : "em revisão"}</small>
          </div>
        </Html>
      )}
      {shaping.slice(0, 4).map((g) => {
        const key = `${g.kind}:${g.id || g.section}:${g.at}`;
        if (g.kind === "prune") {
          const p = g.id ? lastSeen.memories.get(g.id) : undefined; if (!p) return null;
          return <Html key={key} position={[p[0], p[1], 0]} zIndexRange={[28, 18]} style={{ pointerEvents: "none" }}><div className={`lm-grow prune ${p[0] > R * 0.45 ? "left" : ""}`}><b>podada · zeladora</b><span>{g.label || "memória"}</span><small>{g.reason || "obsoleta"}</small></div></Html>;
        }
        if (g.kind === "born") {
          const c = layout.clouds.find((x) => x.id === g.section); if (!c) return null;
          const from = g.from ? clusterOf.get(g.from)?.label : null;
          return <Html key={key} position={[c.x, c.y - c.r * 1.05, 0]} center zIndexRange={[28, 18]} style={{ pointerEvents: "none" }}><div className="lm-grow born" style={{ ["--c" as string]: cloudColor(c.index) }}><b>nódulo novo</b><span>{clusterOf.get(c.id)?.label || g.label}</span><small>{from ? `saiu de ${from}` : "assunto novo"} · {clusterOf.get(c.id)?.nodeIds.length || 0} memórias</small></div></Html>;
        }
        const p = g.section ? lastSeen.clouds.get(g.section) : undefined; if (!p) return null;
        const into = g.into ? clusterOf.get(g.into)?.label : null;
        return <Html key={key} position={[p.x, p.y, 0]} center zIndexRange={[28, 18]} style={{ pointerEvents: "none" }}><div className="lm-grow gone"><b>nódulo recolhido</b><span>{g.label}</span><small>{into ? `as memórias foram para ${into}` : "ficou vazio"}</small></div></Html>;
      })}
    </>
  );
}

/** Moves the camera smoothly to a target (a section, a memory, the whole field) when the view asks. */
function CameraRig({ command, reduced, onUserMove, R }: { command: CameraCommand; reduced: boolean; onUserMove: () => void; R: number }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: OrbitControlsImpl | null };
  const goal = useRef<{ target: THREE.Vector3; position: THREE.Vector3 } | null>(null);
  const placed = useRef(false);
  useEffect(() => {
    if (!controls || placed.current) return;
    placed.current = true;
    controls.target.set(0, 0, 0); camera.position.set(0, 0, R * 2.3); controls.update();
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
  const R = props.layout.R;
  return (
    <Canvas
      className="lm-canvas"
      dpr={high ? [1, 2] : 1}
      gl={{ antialias: true, powerPreference: "high-performance", alpha: false }}
      camera={{ position: [0, 0, R * 2.3], fov: 45, near: 1, far: 20000 }}
      onCreated={({ gl }) => {
        gl.setClearColor("#121418");
        gl.domElement.addEventListener("webglcontextlost", (e) => { e.preventDefault(); props.onContextLost(); }, { once: true });
      }}
    >
      <Scene {...props} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} enableRotate={false} screenSpacePanning minDistance={30} maxDistance={R * 5} zoomSpeed={0.9} panSpeed={0.9}
        mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }} touches={{ ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN }} />
      {high && (
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur intensity={0.6} luminanceThreshold={0.22} luminanceSmoothing={0.35} radius={0.5} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
