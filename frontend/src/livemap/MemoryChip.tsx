import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  BANK, BANK_H, BANK_W, BITS, CELL_H, CELL_W, COPPER, slotRect, GOLD, GRID, LEVELS, SILICON, ZOOM_MAX, ZOOM_MIN,
  ARCHIVE, along, assignSlots, bitsOf, chunkAround, heatColor, heatOf, layerAlpha, layoutChip, levelAt, lifeAt, strengthOf, timelineBuckets,
  type ChipCategory, type ChipEvent, type ChipLayout, type ChipMemory, type ChipRecall, type ChipSnapshot, type ChipSource, type Rect,
} from "./chip";
import { ChipSound } from "./chipSound";
import ChipTimeline from "./ChipTimeline";
import ChipCompare from "./ChipCompare";

/**
 * MemoryChip — the memory, live, as a silicon die (chip.ts lays it out; a source feeds it: chipSources.ts).
 * Six levels of zoom (1× to 1200×), each showing one layer of what is really stored and hiding the one before:
 *   1 CHIP: nuclei (categories) with name and count, copper buses, packets going to the inference core;
 *   2 NÚCLEO: the cells (one per memory) with their text; they light up when recalled;
 *   3 MEMÓRIA: the cell in focus, its fragments (tags and weightiest words), when it was written, how often used;
 *   4 LEITURA: traces from each fragment to the bits of its real embedding; the current runs through them;
 *   5 ASSOCIAÇÕES: particle clouds of the memory and its real neighbours, with their similarity;
 *   6 GRAVAÇÃO: the crystal — a hexagonal lattice whose charged atoms are the embedding's positive dimensions.
 * Live: written (the cell is built, a dashed trace from its bus), recalled (it lights by score and a packet runs to
 * the core, in rank order), the answer (the cells it used, with scores, then they fade), updated (a flash; a merge
 * moves the old cell into the kept one), forgotten (the cell dissolves; its slot stays empty), the Zeladora reading.
 * Also, all from the real memory: a timeline (go back to any moment: memories not written yet disappear, the
 * forgotten ones are alive again until the day they were archived; play it to watch the memory grow, with every
 * past answer lighting the memories it used), replays of past answers (step by step), a heat layer (real uses and
 * recency), a comparison of two memories (their bits, where their signs agree, the real cosine from the server),
 * the ARQUIVO nucleus (what was forgotten, restorable), and sound (off by default; each tone is an event).
 * Nothing blinks (every light is a fade); every pattern is deterministic (seeded by the memory's id).
 */
const MONO = '"JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace';
const INK = "#d9e6df", DIM = "#7f978b", KEEPER = "#cfe9ff";
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const hash = (s: string, salt = 0) => { let h = 2166136261 ^ salt; for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const seeded = (seed: number) => { let s = seed >>> 0; return () => { s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return s / 4294967296; }; };
const date = (t: number) => (t ? new Date(t).toLocaleDateString("pt-BR") : "—");
const hex = (c: string, a: number) => `${c}${Math.round(clamp(a, 0, 1) * 255).toString(16).padStart(2, "0")}`;

type Fx = { buildAt?: number; lit?: number; litAt?: number; fadeAt?: number; scan?: number; scanAt?: number; flashAt?: number; probeAt?: number };
type Ghost = { rect: Rect; color: string; at: number; to?: Rect; seed: number };
type Packet = { pts: [number, number][]; t0: number; dur: number; color: string };
type Trace = { pts: [number, number][]; t0: number };
type Fly = { x0: number; y0: number; l0: number; x1: number; y1: number; l1: number; t0: number; ms: number; then?: Fly };
type Recall = { id: string; query: string; at: number; scores: Map<string, number>; used: string[]; doneAt: number | null };
type FeedItem = { at: number; mark: string; text: string; color: string };
type Ui = {
  live: boolean; z: number; level: number; crumbs: string[]; focus: string | null; memories: number; recallsToday: number;
  recall: string | null; used: { id: string; text: string; score: number }[]; feed: FeedItem[];
  occupancy: { id: string; label: string; color: string; n: number; cap: number }[]; follow: boolean; diving: boolean; ready: boolean;
};

/** Where the page around the chip sends it: to a memory, or to a nucleus (with a new key each time). */
export type ChipCommand = { kind: "memory" | "nucleus"; id: string; key: number } | null;
type Props = {
  source: ChipSource;
  onSwitchSource?: () => void;
  /** Pixels on the right covered by something else (a chat beside it): the die stays clear of them. */
  inset?: number;
  command?: ChipCommand;
  /** Memories a search found: they are ringed, the rest dim. */
  highlight?: string[];
  /** More actions for the memory in focus (open its conversation, call the Zeladora…). */
  extraActions?: (id: string) => ReactNode;
  onSelect?: (id: string | null) => void;
};

export default function MemoryChip({ source, onSwitchSource, inset = 0, command = null, highlight = [], extraActions, onSelect }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ui, setUi] = useState<Ui>({ live: false, z: 1, level: 0, crumbs: ["Chip"], focus: null, memories: 0, recallsToday: 0, recall: null, used: [], feed: [], occupancy: [], follow: false, diving: false, ready: false });
  const [narrow, setNarrow] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmForget, setConfirmForget] = useState(false);
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  // Timeline (null: now), playing it, the heat layer, the sound, a comparison, a replay's caption.
  const [timeT, setTimeT] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [heat, setHeat] = useState(false);
  const [sound, setSound] = useState(false);
  const [compareA, setCompareA] = useState<string | null>(null);
  const [compare, setCompare] = useState<{ a: string; b: string; sim: number | null | undefined } | null>(null);
  const [replayCap, setReplayCap] = useState<{ query: string; step: number; total: number; note: string } | null>(null);
  const [histVersion, setHistVersion] = useState(0);
  const E = useRef({
    mems: new Map<string, ChipMemory>(), cats: [] as ChipCategory[], slots: null as Map<string, (string | null)[]> | null, L: null as ChipLayout | null,
    bits: new Map<string, Uint8Array>(), fx: new Map<string, Fx>(), ghosts: [] as Ghost[], packets: [] as Packet[], traces: [] as Trace[],
    cam: { x: 0, y: 0, k: 1 }, kFit: 1, W: 800, H: 500, dpr: 1, fitted: false, fly: null as Fly | null, diving: false, follow: false,
    recall: null as Recall | null, recallsToday: 0, used: [] as { id: string; score: number }[], feed: [] as FeedItem[], queue: [] as ChipEvent[],
    live: false, focus: null as string | null, selected: null as string | null, dirty: true, uiAt: 0, drag: null as null | { x: number; y: number; cx: number; cy: number; moved: boolean },
    pointers: new Map<number, [number, number]>(), pinch: null as null | { d: number }, textW: new Map<string, string>(),
    /** The search's memories (ringed; the rest dim), the cell under the mouse, the Zeladora's probe gliding between cells. */
    lastAspect: 0, highlight: new Set<string>(), hover: null as string | null, mouse: null as [number, number] | null,
    probe: null as null | { x: number; y: number; to: string; at: number; label: string },
    /** The answers that used memory (live ones keep their scores and candidates), newest first. */
    history: [] as ChipRecall[], forgottenTotal: 0, timeT: null as number | null, prevT: null as number | null, playing: false, heat: false,
    sound: new ChipSound(), compareA: null as string | null, compareB: null as string | null, replayTimers: [] as number[], scanned: [] as { id: string; score: number }[],
  });
  E.current.selected = selected;
  E.current.highlight = new Set(highlight);
  E.current.playing = playing; E.current.heat = heat; E.current.compareA = compareA; E.current.compareB = compare?.b ?? null;
  useEffect(() => { E.current.sound.enable(sound); }, [sound]);
  // The timeline's moment: the frame moves it while playing (the panel follows a few times a second).
  useEffect(() => { E.current.timeT = timeT; E.current.dirty = true; }, [timeT]);
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect;
  useEffect(() => { onSelectRef.current?.(selected); }, [selected]);
  // ---------- the state: a snapshot, the events ----------
  const rebuild = useCallback(() => {
    const e = E.current;
    e.slots = assignSlots(e.slots, e.cats, [...e.mems.values()]);
    e.L = layoutChip(e.cats, e.slots, e.W / Math.max(200, e.H - 180));
    resizeFit();
    e.dirty = true;
  }, []);
  const feed = (mark: string, text: string, color: string) => { const e = E.current; e.feed.unshift({ at: Date.now(), mark, text, color }); if (e.feed.length > 40) e.feed.length = 40; e.dirty = true; };
  const colorOf = (id: string) => { const e = E.current; const c = e.L?.cell.get(id); return c && e.L ? e.L.nuclei[c.n].color : GOLD; };
  const bitsFor = (m: ChipMemory) => { const e = E.current; let b = e.bits.get(m.id); if (!b) { b = bitsOf(m.sig, m.text + m.id); e.bits.set(m.id, b); } return b; };

  const applySnapshot = useCallback((s: ChipSnapshot, animate: boolean) => {
    const e = E.current, now = performance.now();
    const before = new Set(e.mems.keys());
    // Other nuclei (another mode, a fresh grouping): the slots start over instead of leaving holes everywhere.
    const regrouped = e.cats.length > 0 && e.cats.map((c) => c.id).join("|") !== s.categories.map((c) => c.id).join("|");
    if (regrouped) e.slots = null;
    e.mems = new Map(s.memories.map((m) => [m.id, m])); e.cats = s.categories; e.bits.clear();
    e.recallsToday = Math.max(e.recallsToday, s.recallsToday);
    // The answers: the server's, plus the ones seen live this session (with their scores) not yet in it.
    const known = new Set((s.history || []).map((h) => h.at));
    e.history = [...e.history.filter((h) => h.id.startsWith("live:") && ![...known].some((t) => Math.abs(t - h.at) < 8000)), ...(s.history || [])].sort((a, b) => b.at - a.at);
    e.forgottenTotal = s.forgottenTotal || 0;
    setHistVersion((v) => v + 1);
    rebuild();
    // A new die: the whole of it in view again.
    if (regrouped && e.L) { const b = e.L.bounds; flyTo((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2 - 6 / e.kFit, 1, 900); }
    if (animate) for (const m of s.memories) if (!before.has(m.id)) built(m, now);
  }, [rebuild]);

  /** A new cell: it is built in its slot, a dashed trace routed from its nucleus' bus to it. */
  const built = (m: ChipMemory, now: number, quiet = false) => {
    const e = E.current, c = e.L?.cell.get(m.id); if (!c || !e.L) return;
    const fx = e.fx.get(m.id) || {}; fx.buildAt = now; e.fx.set(m.id, fx);
    const n = e.L.nuclei[c.n], p0 = n.bus[0], cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    if (!quiet && p0) e.traces.push({ pts: Math.abs(p0[0] - n.x) < 1 || Math.abs(p0[0] - (n.x + n.w)) < 1 ? [p0, [p0[0], cy], [cx, cy]] : [p0, [cx, p0[1]], [cx, cy]], t0: now });
    feed("+", `gravou «${m.text}»`, n.color);
    e.sound.written();
  };
  /** A memory goes to the ARQUIVO nucleus (forgotten, restorable): a packet carries it there. */
  const toArchive = (m: ChipMemory, now: number) => {
    const e = E.current, from = e.L?.cell.get(m.id);
    m.category = ARCHIVE; m.archivedAt = Date.now();
    if (!e.cats.some((c) => c.id === ARCHIVE)) e.cats = [...e.cats, { id: ARCHIVE, label: "arquivo · esquecidas" }];
    rebuild();
    const to = e.L?.cell.get(m.id);
    if (from && to) e.packets.push({ pts: [[from.x + from.w / 2, from.y + from.h / 2], [to.x + to.w / 2, to.y + to.h / 2]], t0: now + 300, dur: 1400, color: "#ff8a7a" });
  };

  const process = (ev: ChipEvent, burst: boolean) => {
    const e = E.current, now = performance.now();
    switch (ev.type) {
      case "snapshot": applySnapshot(ev.snapshot, !ev.quiet); break;
      case "memory.created": {
        if (e.mems.has(ev.memory.id)) break;
        if (!e.cats.some((c) => c.id === ev.memory.category)) e.cats = [...e.cats, { id: ev.memory.category, label: ev.memory.category }];
        e.mems.set(ev.memory.id, ev.memory); rebuild(); built(ev.memory, now, burst);
        break;
      }
      case "memory.updated": {
        const m = e.mems.get(ev.id); if (!m) break;
        if (ev.text) { m.text = ev.text; e.bits.delete(m.id); }
        if (ev.category && ev.category !== m.category) { m.category = ev.category; rebuild(); }
        const fx = e.fx.get(m.id) || {}; fx.flashAt = now; e.fx.set(m.id, fx);
        const to = e.L?.cell.get(m.id);
        for (const from of ev.mergedFrom || []) {
          const c = e.L?.cell.get(from);
          if (c && to) e.ghosts.push({ rect: { x: c.x, y: c.y, w: c.w, h: c.h }, color: colorOf(from), at: now, to: { x: to.x, y: to.y, w: to.w, h: to.h }, seed: hash(from) });
          // Joined into another: it is archived (the Zeladora's joins can be undone).
          const fm = e.mems.get(from); if (fm && !fm.archivedAt) { fm.category = ARCHIVE; fm.archivedAt = Date.now(); if (!e.cats.some((x) => x.id === ARCHIVE)) e.cats = [...e.cats, { id: ARCHIVE, label: "arquivo · esquecidas" }]; }
        }
        if (ev.mergedFrom?.length) { rebuild(); feed("≈", `juntou ${ev.mergedFrom.length} em «${m.text}»`, colorOf(m.id)); }
        else feed("~", `atualizou «${m.text}»`, colorOf(m.id));
        break;
      }
      case "memory.deleted": {
        const m = e.mems.get(ev.id); if (!m || m.archivedAt) break;
        const c = e.L?.cell.get(ev.id);
        if (c && !burst) e.ghosts.push({ rect: { x: c.x, y: c.y, w: c.w, h: c.h }, color: colorOf(ev.id), at: now, seed: hash(ev.id) });
        if (ev.archived) toArchive(m, now); else { e.mems.delete(ev.id); rebuild(); if (e.selected === ev.id) setSelected(null); }
        feed("↓", `esqueceu «${m.text}»${ev.reason === "decay" ? " · obsoleta" : ev.reason === "merge" ? " · juntada" : ""}${ev.archived ? " → arquivo" : " · apagada"}`, "#ff8a7a");
        e.sound.forgotten();
        break;
      }
      case "recall.started":
        e.recall = { id: ev.requestId, query: ev.query, at: now, scores: new Map(), used: [], doneAt: null }; e.scanned = [];
        if (!ev.replay) e.recallsToday += 1;
        feed(ev.replay ? "↺" : "?", `${ev.replay ? "replay" : "lembrando"}: «${ev.query.slice(0, 60)}»`, GOLD);
        break;
      case "memory.scanned": { const fx = e.fx.get(ev.id) || {}; fx.scan = ev.score; fx.scanAt = now; e.fx.set(ev.id, fx); e.recall?.scores.set(ev.id, ev.score); e.scanned.push({ id: ev.id, score: ev.score }); break; }
      case "memory.recalled": {
        const fx = e.fx.get(ev.id) || {}, delay = ev.rank * 180;
        // A score below 0: not measured (a past answer replayed): it lights fully, the list shows "—".
        fx.lit = ev.score < 0 ? 0.85 : ev.score; fx.litAt = now + delay; fx.fadeAt = undefined; e.fx.set(ev.id, fx);
        e.recall?.scores.set(ev.id, ev.score);
        if (!burst) e.sound.recalled(Math.max(0, ev.score), ev.rank);
        const c = e.L?.cell.get(ev.id);
        if (c && e.L && !burst) { const n = e.L.nuclei[c.n]; e.packets.push({ pts: [[c.x + c.w / 2, c.y + c.h / 2], ...n.bus], t0: now + delay, dur: 1100 + n.bus.length * 60, color: GOLD }); }
        break;
      }
      case "recall.finished": {
        if (e.recall) e.recall.used = ev.usedIds;
        // Follow the AI: to the nucleus it used most.
        if (e.follow && e.L && ev.usedIds.length) {
          const count = new Map<number, number>();
          for (const id of ev.usedIds) { const c = e.L.cell.get(id); if (c) count.set(c.n, (count.get(c.n) || 0) + 1); }
          const best = [...count].sort((a, b) => b[1] - a[1])[0];
          if (best) { const n = e.L.nuclei[best[0]]; flyTo(n.x + n.w / 2, n.y + n.h / 2, clamp(Math.min(e.W / n.w, e.H / n.h) * 0.75 / e.kFit, 1, 6), 1400); }
        }
        break;
      }
      case "response.done": {
        const scores = e.recall?.scores || new Map<string, number>();
        e.used = ev.memoriesUsed.filter((id) => e.mems.has(id)).map((id) => ({ id, score: scores.get(id) ?? e.fx.get(id)?.lit ?? 0 })).sort((a, b) => b.score - a.score);
        for (const id of [...ev.memoriesUsed, ...(e.recall?.used || [])]) { const fx = e.fx.get(id); if (fx) fx.fadeAt = now; }
        if (!ev.replay) {
          for (const id of ev.memoriesUsed) { const m = e.mems.get(id); if (m) { m.uses += 1; m.lastUsedAt = Date.now(); } }
          // Kept for the replays and the timeline, with what was measured live.
          if (e.recall) e.history = [{ id: `live:${ev.requestId}`, at: Date.now(), query: e.recall.query, used: ev.memoriesUsed, created: ev.created || [], scores: Object.fromEntries(e.recall.scores), scanned: e.scanned.slice(0, 24) }, ...e.history];
          setHistVersion((v) => v + 1);
        }
        // What the answer wrote is rebuilt in place (it is there already).
        for (const id of ev.created || []) { const fx = e.fx.get(id) || {}; fx.buildAt = now + 400; e.fx.set(id, fx); }
        if (e.recall) e.recall.doneAt = now;
        e.sound.answered(ev.memoriesUsed.length);
        feed(ev.replay ? "↺" : "✓", `respondeu usando ${ev.memoriesUsed.length} memória${ev.memoriesUsed.length === 1 ? "" : "s"}${ev.tokensUsed ? ` · ${ev.tokensUsed} tokens` : ""}`, "#8DFF6A");
        break;
      }
      case "keeper.read": {
        const fx = e.fx.get(ev.id) || {}; fx.probeAt = now; e.fx.set(ev.id, fx);
        e.sound.read();
        // Her probe glides from the cell she read before to this one.
        const c = e.L?.cell.get(ev.id);
        if (c) e.probe = { x: e.probe ? e.probe.x : c.x + c.w / 2, y: e.probe ? e.probe.y : c.y - 30, to: ev.id, at: now, label: e.mems.get(ev.id)?.text || "" };
        break;
      }
    }
    e.dirty = true;
  };

  // ---------- camera ----------
  const resizeFit = () => {
    const e = E.current; if (!e.L) return;
    const b = e.L.bounds, bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    // Room at the top for the level's legend, at the bottom for the timeline and the tools.
    e.kFit = Math.min(e.W / bw, (e.H - 180) / bh) * 0.96;
    if (!e.fitted && e.W > 50) { e.cam = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 - 6 / e.kFit, k: e.kFit }; e.fitted = true; }
  };
  const flyTo = (x: number, y: number, z: number, ms = 1000, then?: Fly) => {
    const e = E.current;
    e.fly = { x0: e.cam.x, y0: e.cam.y, l0: Math.log(e.cam.k), x1: x, y1: y, l1: Math.log(clamp(z, ZOOM_MIN, ZOOM_MAX) * e.kFit), t0: performance.now(), ms, then };
  };
  const interacted = () => { const e = E.current; e.fly = null; if (e.diving) { e.diving = false; } if (e.follow) e.follow = false; e.dirty = true; };
  /** The cell at a world point, or the nearest visible one to it (for deep zoom). */
  const cellNear = (wx: number, wy: number, maxD = Infinity): string | null => {
    const e = E.current; if (!e.L) return null;
    let best: string | null = null, bd = maxD;
    for (const [id, c] of e.L.cell) {
      const dx = Math.max(c.x - wx, 0, wx - (c.x + c.w)), dy = Math.max(c.y - wy, 0, wy - (c.y + c.h));
      const d = Math.hypot(dx, dy);
      if (d < bd) { bd = d; best = id; if (d === 0) break; }
    }
    return best;
  };
  const zoomAt = (sx: number, sy: number, factor: number) => {
    const e = E.current, c = e.cam;
    const wx = c.x + (sx - e.W / 2) / c.k, wy = c.y + (sy - e.H / 2) / c.k;
    const k = clamp(c.k * factor, ZOOM_MIN * e.kFit, ZOOM_MAX * e.kFit);
    c.x = wx - (sx - e.W / 2) / k; c.y = wy - (sy - e.H / 2) / k; c.k = k;
    // Past the memory level the zoom is drawn to the cell in focus (its deeper layers live around its middle).
    const z = k / e.kFit;
    if (z > 24 && factor > 1) {
      const id = cellNear(c.x, c.y, 40), cell = id ? e.L?.cell.get(id) : null;
      if (cell) { const w = clamp(Math.log(z / 24) / Math.log(5), 0, 1) * 0.35; c.x += (cell.x + cell.w / 2 - c.x) * w; c.y += (cell.y + cell.h / 2 - c.y) * w; }
    }
    e.dirty = true;
  };
  /** Down one level, at a point (onto the cell there, if any). */
  const descend = (wx: number, wy: number) => {
    const e = E.current, z = e.cam.k / e.kFit, lv = levelAt(z);
    const id = cellNear(wx, wy, z < 2.4 ? 30 : 4), c = id ? e.L?.cell.get(id) : null;
    if (id && e.compareA && id !== e.compareA) { openCompare(e.compareA, id); return; }
    if (id) setSelected(id);
    const next = Math.min(LEVELS.length - 1, lv + 1);
    const target = lv === LEVELS.length - 1 ? z * 1.5 : LEVELS[next].from * 1.5;
    flyTo(c ? c.x + c.w / 2 : wx, c ? c.y + c.h / 2 : wy, target, 900);
  };
  const goLevel = (i: number) => {
    const e = E.current;
    const id = [e.selected, e.focus, e.used[0]?.id, [...e.mems.keys()][0]].find((x) => x && e.L?.cell.has(x)), c = id ? e.L?.cell.get(id) : null;
    const L = LEVELS[i], z = i === 0 ? 1 : Math.sqrt(L.from * Math.min(L.to, ZOOM_MAX));
    if (i === 0 && e.L) { const b = e.L.bounds; flyTo((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2 - 6 / e.kFit, 1, 1000); return; }
    if (c) { if (!e.selected && id) setSelected(id); flyTo(c.x + c.w / 2, c.y + c.h / 2, z, 1100); }
  };
  const dive = () => {
    const e = E.current; if (!e.L) return;
    if (e.diving) { e.diving = false; e.fly = null; e.dirty = true; return; }
    const used = e.used[0]?.id;
    const id = [e.selected, used, e.focus, [...e.mems.values()].sort((a, b) => b.uses - a.uses)[0]?.id].find((x) => x && e.L?.cell.has(x));
    const c = id ? e.L.cell.get(id) : null; if (!c || !id) return;
    setSelected(id);
    const b = e.L.bounds;
    const back: Fly = { x0: c.x + c.w / 2, y0: c.y + c.h / 2, l0: Math.log(1100 * e.kFit), x1: (b.x0 + b.x1) / 2, y1: (b.y0 + b.y1) / 2 - 6 / e.kFit, l1: Math.log(e.kFit), t0: 0, ms: 3500 };
    const hold: Fly = { ...back, x1: back.x0, y1: back.y0, l1: back.l0, ms: 2600, then: back };
    flyTo(c.x + c.w / 2, c.y + c.h / 2, 1100, 16000, hold);
    e.diving = true;
  };

  /** Up one level, around what is in view (from the chip itself: the selection is let go). */
  const ascend = () => {
    const e = E.current, z = e.cam.k / e.kFit, lv = levelAt(z);
    if (lv === 0) { setSelected(null); return; }
    if (lv === 1) { goLevel(0); return; }
    const L = LEVELS[lv - 1];
    flyTo(e.cam.x, e.cam.y, Math.sqrt(L.from * L.to), 800);
  };

  // Commands from the page around (a memory from the chat or the search, a nucleus from its tab).
  useEffect(() => {
    const e = E.current; if (!command || !e.L) return;
    interacted();
    if (command.kind === "memory") {
      const c = e.L.cell.get(command.id);
      if (c) { setSelected(command.id); flyTo(c.x + c.w / 2, c.y + c.h / 2, 12, 1100); }
    } else {
      const n = e.L.nuclei.find((x) => x.id === command.id);
      if (n) flyTo(n.x + n.w / 2, n.y + n.h / 2, clamp((Math.min(e.W / n.w, e.H / n.h) * 0.8) / e.kFit, 1, 8), 1100);
    }
  }, [command?.key]);

  // Keyboard: Enter goes down a level, Esc up, + / − zoom, arrows move.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const e = E.current;
      if (ev.key === "Enter") { interacted(); descend(e.cam.x, e.cam.y); }
      else if (ev.key === "Escape") { interacted(); ascend(); }
      else if (ev.key === "+" || ev.key === "=") { interacted(); zoomAt(e.W / 2, e.H / 2, 1.6); }
      else if (ev.key === "-") { interacted(); zoomAt(e.W / 2, e.H / 2, 1 / 1.6); }
      else if (ev.key.startsWith("Arrow")) {
        ev.preventDefault(); interacted();
        const d = 90 / e.cam.k;
        if (ev.key === "ArrowLeft") e.cam.x -= d; if (ev.key === "ArrowRight") e.cam.x += d;
        if (ev.key === "ArrowUp") e.cam.y -= d; if (ev.key === "ArrowDown") e.cam.y += d;
      } else return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---------- the source ----------
  useEffect(() => {
    const e = E.current;
    let stop = () => {};
    let alive = true;
    e.mems.clear(); e.slots = null; e.fx.clear(); e.ghosts = []; e.packets = []; e.traces = []; e.feed = []; e.used = []; e.recall = null; e.fitted = false; e.queue = [];
    setUi((u) => ({ ...u, ready: false })); setSelected(null);
    source.snapshot().then((s) => {
      if (!alive) return;
      applySnapshot(s, false);
      setUi((u) => ({ ...u, ready: true }));
      stop = source.subscribe((ev) => {
        e.queue.push(ev);
        // A bounded queue: in a flood, the faint glows go first.
        if (e.queue.length > 400) e.queue = e.queue.filter((x) => x.type !== "memory.scanned" && x.type !== "keeper.read").slice(-400);
      }, (live) => { e.live = live; e.dirty = true; });
    }).catch(() => { if (alive) feed("!", "não consegui ler as memórias", "#ff8a7a"); });
    return () => { alive = false; stop(); };
  }, [source, applySnapshot]);

  // ---------- size, input ----------
  useEffect(() => {
    const canvas = canvasRef.current!, root = rootRef.current!, e = E.current;
    const ro = new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect();
      e.W = Math.max(10, r.width); e.H = Math.max(10, r.height); e.dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(e.W * e.dpr); canvas.height = Math.round(e.H * e.dpr);
      setNarrow(root.getBoundingClientRect().width < 820);
      // A view of another shape: the die is packed again to fill it (and the whole of it shown).
      if (e.L && Math.abs(e.W / Math.max(200, e.H - 180) - (e.lastAspect || 0)) > 0.25) { e.lastAspect = e.W / Math.max(200, e.H - 180); e.fitted = false; rebuild(); }
      resizeFit(); e.dirty = true;
    });
    ro.observe(canvas); ro.observe(root);
    const local = (ev: { clientX: number; clientY: number }): [number, number] => { const r = canvas.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
    const onWheel = (ev: WheelEvent) => { ev.preventDefault(); interacted(); const [x, y] = local(ev); zoomAt(x, y, Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0016))); };
    const onDown = (ev: PointerEvent) => {
      canvas.setPointerCapture(ev.pointerId);
      e.pointers.set(ev.pointerId, local(ev));
      if (e.pointers.size === 2) { const [a, b] = [...e.pointers.values()]; e.pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) }; e.drag = null; return; }
      const [x, y] = local(ev); e.drag = { x, y, cx: e.cam.x, cy: e.cam.y, moved: false };
    };
    const onMove = (ev: PointerEvent) => {
      if (!e.pointers.has(ev.pointerId)) { e.mouse = local(ev); return; }
      e.mouse = null;
      e.pointers.set(ev.pointerId, local(ev));
      if (e.pinch && e.pointers.size === 2) {
        const [a, b] = [...e.pointers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        interacted(); zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / Math.max(1, e.pinch.d)); e.pinch.d = d; return;
      }
      if (!e.drag) return;
      const [x, y] = local(ev);
      if (!e.drag.moved && Math.hypot(x - e.drag.x, y - e.drag.y) > 4) { e.drag.moved = true; interacted(); }
      if (e.drag.moved) { e.cam.x = e.drag.cx - (x - e.drag.x) / e.cam.k; e.cam.y = e.drag.cy - (y - e.drag.y) / e.cam.k; e.dirty = true; }
    };
    const onUp = (ev: PointerEvent) => {
      e.pointers.delete(ev.pointerId);
      if (e.pointers.size < 2) e.pinch = null;
      if (e.drag && !e.drag.moved) { interacted(); const [x, y] = local(ev); descend(e.cam.x + (x - e.W / 2) / e.cam.k, e.cam.y + (y - e.H / 2) / e.cam.k); }
      e.drag = null;
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp); canvas.addEventListener("pointercancel", onUp);
    const onLeave = () => { e.mouse = null; };
    canvas.addEventListener("pointerleave", onLeave);
    return () => {
      canvas.removeEventListener("pointerleave", onLeave);
      ro.disconnect(); canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointercancel", onUp);
    };
  }, []);

  // ---------- the frame ----------
  useEffect(() => {
    let raf = 0;
    const ctx = canvasRef.current!.getContext("2d")!;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const e = E.current, now = performance.now();
      // Events: a few a frame; in a burst, all at once without the animations.
      const burst = e.queue.length > 40;
      for (let i = 0; i < (burst ? e.queue.length : 8) && e.queue.length; i += 1) process(e.queue.shift()!, burst);
      if (e.fly) {
        const f = e.fly, u = clamp((now - f.t0) / f.ms, 0, 1), up = ease(Math.min(1, u * 1.6)), uz = ease(u);
        e.cam.x = f.x0 + (f.x1 - f.x0) * up; e.cam.y = f.y0 + (f.y1 - f.y0) * up; e.cam.k = Math.exp(f.l0 + (f.l1 - f.l0) * uz);
        if (u >= 1) { e.fly = f.then ? { ...f.then, t0: now } : null; if (!e.fly) e.diving = false; }
      }
      // The timeline: playing moves time forward; whatever happened between two frames happens on the chip.
      if (e.playing && e.timeT !== null) {
        const span = Math.max(1, Date.now() - e.history.reduce((t, h) => Math.min(t, h.at), [...e.mems.values()].reduce((t, m) => Math.min(t, m.createdAt), Date.now())));
        const next = Math.min(Date.now(), e.timeT + (span / 30000) * 16.7);
        if (next >= Date.now()) { e.timeT = null; setTimeT(null); setPlaying(false); }
        else { e.timeT = next; if (now - e.uiAt > 200) setTimeT(next); }
      }
      if (e.timeT !== null && e.prevT !== null && e.timeT > e.prevT) passTime(e.prevT, e.timeT, now);
      e.prevT = e.timeT;
      // The cell under the mouse (its name in a tip, its links drawn).
      const hv = e.mouse && e.L ? cellNear(e.cam.x + (e.mouse[0] - e.W / 2) / e.cam.k, e.cam.y + (e.mouse[1] - e.H / 2) / e.cam.k, 0.5) : null;
      if (hv !== e.hover) { e.hover = hv; setTip(hv && e.mouse ? { id: hv, x: e.mouse[0], y: e.mouse[1] } : null); }
      else if (hv && e.mouse) { const m = e.mouse; setTip((t) => (t && (Math.abs(t.x - m[0]) > 2 || Math.abs(t.y - m[1]) > 2) ? { id: hv, x: m[0], y: m[1] } : t)); }
      draw(ctx, now);
      // The panel: a few times a second.
      if (now - e.uiAt > 220) { e.uiAt = now; pushUi(); }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  /** Time went from a to b on the timeline: memories written then are built, answers then light what they used. */
  const passTime = (a: number, b: number, now: number) => {
    const e = E.current; if (!e.L) return;
    let built = 0;
    for (const m of e.mems.values()) {
      if (m.createdAt > a && m.createdAt <= b && built < 12) { const fx = e.fx.get(m.id) || {}; fx.buildAt = now; e.fx.set(m.id, fx); built += 1; }
      if (m.archivedAt && m.archivedAt > a && m.archivedAt <= b) { const fx = e.fx.get(m.id) || {}; fx.flashAt = now; e.fx.set(m.id, fx); }
    }
    for (const h of e.history) if (h.at > a && h.at <= b) h.used.forEach((id, rank) => {
      const c = e.L!.cell.get(id); if (!c) return;
      const fx = e.fx.get(id) || {}; fx.lit = h.scores?.[id] ?? 0.85; fx.litAt = now + rank * 120; fx.fadeAt = now + 900; e.fx.set(id, fx);
      const n = e.L!.nuclei[c.n]; e.packets.push({ pts: [[c.x + c.w / 2, c.y + c.h / 2], ...n.bus], t0: now + rank * 120, dur: 900, color: GOLD });
    });
  };

  /** Replay a past answer, step by step: the question, the candidates (if measured), the memories by rank, the answer. */
  const replay = (h: ChipRecall) => {
    const e = E.current;
    e.replayTimers.forEach((t) => window.clearTimeout(t)); e.replayTimers = [];
    const id = `replay:${h.id}:${Date.now()}`, used = h.used.filter((x) => e.mems.has(x));
    const at = (ms: number, f: () => void) => { e.replayTimers.push(window.setTimeout(f, ms)); };
    const cap = (step: number, note: string) => setReplayCap({ query: h.query, step, total: 4, note });
    // The camera goes to the nucleus it used most.
    if (e.L && used.length) {
      const count = new Map<number, number>();
      for (const u of used) { const c = e.L.cell.get(u); if (c) count.set(c.n, (count.get(c.n) || 0) + 1); }
      const best = [...count].sort((x, y) => y[1] - x[1])[0];
      if (best) { const n = e.L.nuclei[best[0]]; interacted(); flyTo(n.x + n.w / 2, n.y + n.h / 2, clamp((Math.min(e.W / n.w, e.H / n.h) * 0.75) / e.kFit, 1, 6), 1200); }
    }
    at(0, () => { cap(1, "a pergunta chega"); e.queue.push({ type: "recall.started", requestId: id, query: h.query, replay: true }); });
    at(1300, () => { cap(2, h.scanned?.length ? `${h.scanned.length} candidatas pontuadas` : "candidatas não registradas (resposta antiga)"); for (const c of h.scanned || []) if (e.mems.has(c.id)) e.queue.push({ type: "memory.scanned", requestId: id, id: c.id, score: c.score }); });
    at(2800, () => { cap(3, `${used.length} memória${used.length === 1 ? "" : "s"} no contexto`); used.forEach((u, rank) => e.queue.push({ type: "memory.recalled", requestId: id, id: u, score: h.scores?.[u] ?? -1, rank })); e.queue.push({ type: "recall.finished", requestId: id, usedIds: used }); });
    at(5200, () => { cap(4, `respondeu${h.created.length ? ` · gravou ${h.created.length}` : ""}`); e.queue.push({ type: "response.done", requestId: id, memoriesUsed: used, created: h.created.filter((x) => e.mems.has(x)), replay: true }); });
    at(8500, () => setReplayCap(null));
  };

  /** Compare two memories: the real cosine is asked to the source (the server); the bits are on the chip. */
  const openCompare = (a: string, b: string) => {
    setCompareA(null); setCompare({ a, b, sim: undefined });
    const sim = source.similarity ? source.similarity(a, b).catch(() => null) : Promise.resolve(null);
    void sim.then((v) => setCompare((c) => (c && c.a === a && c.b === b ? { ...c, sim: v } : c)));
    const e = E.current, ca = e.L?.cell.get(a), cb = e.L?.cell.get(b);
    if (ca && cb) { interacted(); const z = clamp((Math.min(e.W / (Math.abs(ca.x - cb.x) + 80), e.H / (Math.abs(ca.y - cb.y) + 60)) * 0.6) / e.kFit, 1, 10); flyTo((ca.x + cb.x) / 2 + 12, (ca.y + cb.y) / 2 + 4, z, 1000); }
  };
  useEffect(() => () => { E.current.replayTimers.forEach((t) => window.clearTimeout(t)); }, []);

  const pushUi = () => {
    const e = E.current, z = e.cam.k / e.kFit, level = levelAt(z);
    // The cell in focus: the one at the middle of the view (from the memory level on).
    e.focus = z >= 2.4 ? cellNear(e.cam.x, e.cam.y, z >= 8 ? 6 : 30) : null;
    const fm = e.focus ? e.mems.get(e.focus) : null, fc = e.focus ? e.L?.cell.get(e.focus) : null;
    const crumbs = ["Chip"];
    if (fc && e.L) crumbs.push(e.L.nuclei[fc.n].label);
    if (fm && z >= 8) crumbs.push(fm.text.length > 28 ? `${fm.text.slice(0, 27)}…` : fm.text);
    const recall = e.recall && (!e.recall.doneAt || performance.now() - e.recall.doneAt < 3000) ? e.recall.query : null;
    setUi({
      live: e.live, z, level, crumbs, focus: e.focus, memories: [...e.mems.values()].filter((m) => lifeAt(m, e.timeT) === "alive").length, recallsToday: e.recallsToday, recall,
      used: e.used.map((u) => ({ id: u.id, text: e.mems.get(u.id)?.text || "(esquecida)", score: u.score })), feed: [...e.feed],
      occupancy: (e.L?.nuclei || []).map((n) => ({ id: n.id, label: n.id === ARCHIVE && e.forgottenTotal > n.slots.filter(Boolean).length ? `${n.label} (+${e.forgottenTotal - n.slots.filter(Boolean).length} antigas)` : n.label, color: n.id === ARCHIVE ? "#ff8a7a" : n.color, n: n.slots.filter((x) => x && lifeAt(e.mems.get(x)!, e.timeT) !== "unborn").length, cap: n.banks * 60 })),
      follow: e.follow, diving: e.diving, ready: true,
    });
  };

  // ---------- drawing ----------
  const draw = (ctx: CanvasRenderingContext2D, now: number) => {
    const e = E.current, { W, H, dpr } = e, { x: camX, y: camY, k } = e.cam;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    const L = e.L; if (!L) return;
    const z = k / e.kFit;
    const X = (x: number) => (x - camX) * k + W / 2, Y = (y: number) => (y - camY) * k + H / 2;
    const vx0 = camX - W / 2 / k, vx1 = camX + W / 2 / k, vy0 = camY - H / 2 / k, vy1 = camY + H / 2 / k;
    const seen = (r: Rect, m = 0) => r.x + r.w >= vx0 - m && r.x <= vx1 + m && r.y + r.h >= vy0 - m && r.y <= vy1 + m;
    const a = LEVELS.map((_, i) => layerAlpha(z, i));
    const t = now / 1000;
    ctx.lineCap = "round"; ctx.lineJoin = "round";

    // The die and its grid (a reference that stays steady at any zoom).
    const b = L.bounds;
    ctx.fillStyle = SILICON; ctx.fillRect(X(b.x0), Y(b.y0), (b.x1 - b.x0) * k, (b.y1 - b.y0) * k);
    ctx.save(); ctx.beginPath(); ctx.rect(X(b.x0), Y(b.y0), (b.x1 - b.x0) * k, (b.y1 - b.y0) * k); ctx.clip();
    let g = Math.pow(10, Math.floor(Math.log10(26 / k)));
    for (const m of [1, 2, 5, 10]) if (g * m * k >= 26) { g *= m; break; }
    ctx.lineWidth = 1;
    for (let gx = Math.floor(Math.max(vx0, b.x0) / g) * g; gx <= Math.min(vx1, b.x1); gx += g) {
      const major = Math.abs(Math.round(gx / g) % 5) === 0;
      ctx.strokeStyle = hex(GRID, major ? 0.42 : 0.2); ctx.beginPath(); ctx.moveTo(Math.round(X(gx)) + 0.5, 0); ctx.lineTo(Math.round(X(gx)) + 0.5, H); ctx.stroke();
    }
    for (let gy = Math.floor(Math.max(vy0, b.y0) / g) * g; gy <= Math.min(vy1, b.y1); gy += g) {
      const major = Math.abs(Math.round(gy / g) % 5) === 0;
      ctx.strokeStyle = hex(GRID, major ? 0.42 : 0.2); ctx.beginPath(); ctx.moveTo(0, Math.round(Y(gy)) + 0.5); ctx.lineTo(W, Math.round(Y(gy)) + 0.5); ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = hex(GOLD, 0.55); ctx.lineWidth = 1; ctx.strokeRect(X(b.x0) + 0.5, Y(b.y0) + 0.5, (b.x1 - b.x0) * k, (b.y1 - b.y0) * k);

    // Buses (copper), under the blocks.
    const busA = a[0] + a[1] * 0.3;
    if (busA > 0.01) {
      for (const n of L.nuclei) {
        if (!n.bus.length) continue;
        ctx.beginPath(); n.bus.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
        ctx.strokeStyle = hex("#000000", 0.6 * busA); ctx.lineWidth = 4; ctx.stroke();
        ctx.strokeStyle = hex(COPPER, 0.85 * busA); ctx.lineWidth = 2; ctx.stroke();
      }
    }

    // The inference core.
    const C = L.core, rec = e.recall, recAge = rec ? now - rec.at : Infinity;
    const recOn = rec && (!rec.doneAt || now - rec.doneAt < 3000);
    if (seen(C, 40)) {
      ctx.fillStyle = "#0b1d16"; ctx.fillRect(X(C.x), Y(C.y), C.w * k, C.h * k);
      ctx.strokeStyle = GOLD; ctx.lineWidth = 1.5; ctx.strokeRect(X(C.x) + 0.5, Y(C.y) + 0.5, C.w * k, C.h * k);
      ctx.strokeStyle = hex(GOLD, 0.25); ctx.lineWidth = 1;
      // One inner ring per answer that used memory today (up to eight): the core's real load.
      const rings = Math.min(8, e.recallsToday);
      for (let i = 1; i <= rings; i += 1) { const q = (C.w * k * i) / (rings + 2); ctx.strokeStyle = hex(GOLD, 0.18 + 0.05 * i); ctx.strokeRect(X(C.x) + q / 2, Y(C.y) + q / 2, C.w * k - q, C.h * k - q); }
      if (recOn) {
        const p = 0.5 + 0.5 * Math.sin(recAge / 420);
        ctx.fillStyle = hex(GOLD, 0.08 + 0.12 * p); ctx.fillRect(X(C.x), Y(C.y), C.w * k, C.h * k);
        ctx.strokeStyle = hex(GOLD, 0.35 * (1 - ((recAge / 1600) % 1))); ctx.lineWidth = 1.5;
        const grow = ((recAge / 1600) % 1) * 22 * Math.max(1, k * 0.5);
        ctx.strokeRect(X(C.x) - grow, Y(C.y) - grow, C.w * k + grow * 2, C.h * k + grow * 2);
      }
      const fs = clamp(C.w * k * 0.075, 8, 15);
      ctx.font = `600 ${fs}px ${MONO}`; ctx.fillStyle = GOLD; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("INFERÊNCIA", X(C.x + C.w / 2), Y(C.y + C.h / 2) - fs * 0.7);
      ctx.font = `400 ${fs * 0.75}px ${MONO}`; ctx.fillStyle = hex(GOLD, 0.7);
      ctx.fillText(recOn ? (rec!.doneAt ? "respondeu" : "lembrando…") : `${e.recallsToday} hoje`, X(C.x + C.w / 2), Y(C.y + C.h / 2) + fs * 0.6);
      if (recOn && rec) {
        const q = rec.query.length > 54 ? `${rec.query.slice(0, 53)}…` : rec.query;
        ctx.font = `400 12px ${MONO}`; const w = ctx.measureText(q).width + 16;
        const lx = X(C.x + C.w / 2), ly = Y(C.y + C.h) + 18;
        ctx.fillStyle = "rgba(0,0,0,0.85)"; ctx.fillRect(lx - w / 2, ly - 10, w, 20);
        ctx.strokeStyle = hex(GOLD, 0.6); ctx.strokeRect(lx - w / 2 + 0.5, ly - 9.5, w - 1, 19);
        ctx.fillStyle = GOLD; ctx.fillText(`“${q}”`, lx, ly);
      }
    }

    // Nuclei, banks, cells.
    const cellPx = CELL_W * k;
    for (const n of L.nuclei) {
      if (!seen(n, 10)) continue;
      ctx.fillStyle = hex(n.color, 0.045); ctx.fillRect(X(n.x), Y(n.y), n.w * k, n.h * k);
      ctx.strokeStyle = hex(n.color, 0.55); ctx.lineWidth = 1; ctx.strokeRect(X(n.x) + 0.5, Y(n.y) + 0.5, n.w * k, n.h * k);
      const used = n.slots.filter(Boolean).length;
      const headA = Math.max(a[0], a[1] * 0.8);
      if (headA > 0.02) {
        const fsC = clamp(20 * k * 0.45, 9, 12), count = `${used}/${n.banks * 60}`, fsN = clamp(20 * k * 0.55, 10, 14);
        ctx.font = `400 ${fsC}px ${MONO}`; ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillStyle = hex(INK, 0.6 * headA);
        ctx.fillText(count, X(n.x + n.w) - 8, Y(n.y + 10));
        ctx.font = `600 ${fsN}px ${MONO}`; ctx.textAlign = "left";
        ctx.fillStyle = hex(n.color, headA); ctx.fillText(fit(n.label.toUpperCase(), n.w * k - 26 - count.length * fsC * 0.6, fsN, `n${n.id}`), X(n.x) + 8, Y(n.y + 10));
      }
      // Each bank's outline (a new one fades in as it is added).
      for (let bk = 0; bk < n.banks; bk += 1) {
        const first = slotRect(n, bk * BANK);
        ctx.strokeStyle = hex(GRID, 0.7); ctx.setLineDash([3, 3]);
        ctx.strokeRect(X(first.x - 3) + 0.5, Y(first.y - 3) + 0.5, (BANK_W + 6) * k, (BANK_H + 6) * k);
        ctx.setLineDash([]);
      }
      for (let s = 0; s < n.slots.length; s += 1) {
        const id = n.slots[s];
        const c = id ? L.cell.get(id)! : null;
        if (!c) {
          // An empty slot: something was forgotten here.
          if (a[1] + a[2] > 0.05) {
            const { x, y } = slotRect(n, s);
            if (x + CELL_W >= vx0 && x <= vx1 && y + CELL_H >= vy0 && y <= vy1) { ctx.setLineDash([2, 3]); ctx.strokeStyle = hex(GRID, 0.9); ctx.strokeRect(X(x) + 0.5, Y(y) + 0.5, CELL_W * k, CELL_H * k); ctx.setLineDash([]); }
          }
          continue;
        }
        if (!seen(c)) continue;
        drawCell(ctx, id!, c, n.color, now, z, a, X, Y, cellPx);
      }
    }

    // Jumper wires: the real links of the memory selected or under the mouse, cell to cell (dashed: a recorded
    // relation; solid: similar in meaning, brighter when more similar).
    const wireA = Math.max(a[0], a[1], a[2] * 0.8);
    if (wireA > 0.02) for (const id of [e.selected, e.hover]) {
      const m = id ? e.mems.get(id) : null, c0 = id ? L.cell.get(id) : null;
      if (!m || !c0) continue;
      const x0 = c0.x + c0.w / 2, y0 = c0.y + c0.h / 2;
      for (const l of m.links) {
        const c1 = L.cell.get(l.id); if (!c1) continue;
        const x1 = c1.x + c1.w / 2, y1 = c1.y + c1.h / 2, len = Math.hypot(x1 - x0, y1 - y0) || 1;
        const mx = (x0 + x1) / 2 - ((y1 - y0) / len) * len * 0.18, my = (y0 + y1) / 2 + ((x1 - x0) / len) * len * 0.18;
        ctx.strokeStyle = hex(l.kind === "relation" ? "#ffffff" : GOLD, wireA * (l.kind === "relation" ? 0.75 : 0.35 + 0.6 * l.score));
        ctx.lineWidth = 1.4; ctx.setLineDash(l.kind === "relation" ? [4, 4] : []);
        ctx.beginPath(); ctx.moveTo(X(x0), Y(y0)); ctx.quadraticCurveTo(X(mx), Y(my), X(x1), Y(y1)); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = hex(GOLD, wireA); ctx.beginPath(); ctx.arc(X(x1), Y(y1), 2.5, 0, Math.PI * 2); ctx.fill();
      }
    }

    // The Zeladora's probe: it glides to the cell she reads and stays a while after.
    if (e.probe) {
      const p = e.probe, c = L.cell.get(p.to), age = now - p.at;
      if (!c || age > 7000) e.probe = null;
      else {
        p.x += (c.x + c.w / 2 - p.x) * 0.12; p.y += (c.y + c.h / 2 - p.y) * 0.12;
        const f = age < 5000 ? 1 : 1 - (age - 5000) / 2000, sx = X(p.x), sy = Y(p.y), r = 11 + Math.sin(now / 260) * 1.5;
        ctx.strokeStyle = hex(KEEPER, 0.9 * f); ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke();
        for (let q = 0; q < 4; q += 1) { const an = q * Math.PI / 2 + now / 900; ctx.beginPath(); ctx.moveTo(sx + Math.cos(an) * (r + 3), sy + Math.sin(an) * (r + 3)); ctx.lineTo(sx + Math.cos(an) * (r + 9), sy + Math.sin(an) * (r + 9)); ctx.stroke(); }
        if (a[0] + a[1] > 0.3) {
          const label = `zeladora · lê «${p.label.length > 34 ? `${p.label.slice(0, 33)}…` : p.label}»`;
          ctx.font = `400 11px ${MONO}`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
          const tw = ctx.measureText(label).width + 12, lx = sx + r + 14 + tw > W - 40 ? sx - r - 14 - tw : sx + r + 14;
          ctx.fillStyle = `rgba(0,0,0,${0.85 * f})`; ctx.fillRect(lx, sy - 9, tw, 18);
          ctx.strokeStyle = hex(KEEPER, 0.5 * f); ctx.strokeRect(lx + 0.5, sy - 8.5, tw - 1, 17);
          ctx.fillStyle = hex(KEEPER, f); ctx.fillText(label, lx + 6, sy);
        }
      }
    }

    // Deep layers of the cell in focus.
    const fid = z >= 60 ? cellNear(camX, camY, 4) : null;
    const fcell = fid ? L.cell.get(fid) : null, fmem = fid ? e.mems.get(fid) : null;
    if (fcell && fmem && a[4] > 0.01) drawAssociations(ctx, fmem, fcell, now, a[4], X, Y, k);
    if (fcell && fmem && a[5] > 0.01) drawCrystal(ctx, fmem, fcell, a[5], X, Y, k, vx0, vx1, vy0, vy1);

    // Forgotten and merged cells, packets, build traces.
    e.ghosts = e.ghosts.filter((gh) => now - gh.at < 1600);
    for (const gh of e.ghosts) {
      const u = (now - gh.at) / (gh.to ? 1100 : 1500);
      if (gh.to) {
        const v = ease(clamp(u, 0, 1)), r = gh.rect, q = gh.to;
        const x = r.x + (q.x - r.x) * v, y = r.y + (q.y - r.y) * v;
        ctx.fillStyle = hex(gh.color, 0.5 * (1 - v)); ctx.fillRect(X(x), Y(y), r.w * k, r.h * k);
        ctx.strokeStyle = hex("#ffffff", 0.6 * (1 - v)); ctx.strokeRect(X(x), Y(y), r.w * k, r.h * k);
      } else {
        const rnd = seeded(gh.seed);
        for (let i = 0; i < 34; i += 1) {
          const px = gh.rect.x + rnd() * gh.rect.w, py = gh.rect.y + rnd() * gh.rect.h, ang = rnd() * Math.PI * 2, sp = (0.4 + rnd()) * 14;
          const d = ease(clamp(u, 0, 1)) * sp;
          ctx.fillStyle = hex(gh.color, (1 - u) * 0.9);
          ctx.fillRect(X(px + Math.cos(ang) * d) - 1.2, Y(py + Math.sin(ang) * d - u * 4) - 1.2, 2.4, 2.4);
        }
      }
    }
    const pktA = a[0] + a[1] * 0.6;
    e.packets = e.packets.filter((p) => now < p.t0 + p.dur + 200);
    for (const p of e.packets) {
      const u = (now - p.t0) / p.dur; if (u < 0 || u > 1 || pktA < 0.02) continue;
      for (let tail = 5; tail >= 0; tail -= 1) {
        const [x, y] = along(p.pts, u - tail * 0.012);
        ctx.fillStyle = hex(p.color, pktA * (tail ? 0.5 * (1 - tail / 6) : 1));
        ctx.beginPath(); ctx.arc(X(x), Y(y), tail ? 2 : 3.2, 0, Math.PI * 2); ctx.fill();
      }
    }
    e.traces = e.traces.filter((tr) => now - tr.t0 < 3200);
    for (const tr of e.traces) {
      const u = (now - tr.t0) / 3200;
      ctx.setLineDash([5, 4]); ctx.lineDashOffset = -now / 40;
      ctx.strokeStyle = hex(COPPER, (1 - u) * 0.95); ctx.lineWidth = 1.5;
      ctx.beginPath(); tr.pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
    }
    void t;
  };

  const drawCell = (ctx: CanvasRenderingContext2D, id: string, c: Rect, color: string, now: number, z: number, a: number[], X: (x: number) => number, Y: (y: number) => number, cellPx: number) => {
    const e = E.current, m = e.mems.get(id)!, k = e.cam.k, fx = e.fx.get(id);
    const x = X(c.x), y = Y(c.y), w = c.w * k, h = c.h * k;
    const s = strengthOf(m);
    // The timeline: not written yet at that moment (an empty slot), alive, or already forgotten (a fossil).
    const life = lifeAt(m, e.timeT);
    if (life === "unborn") {
      if (a[1] + a[2] > 0.05) { ctx.setLineDash([2, 3]); ctx.strokeStyle = hex(GRID, 0.9); ctx.strokeRect(x + 0.5, y + 0.5, w, h); ctx.setLineDash([]); }
      return;
    }
    const fossil = life === "fossil";
    // The heat layer: real uses and recency, cold silicon to white hot (the category stays on the nucleus' frame).
    const fill = e.heat && !fossil ? heatColor(heatOf(m)) : fossil ? "#3a1d1a" : color;
    // Built left to right in a second.
    const build = fx?.buildAt ? clamp((now - fx.buildAt) / 1000, 0, 1) : 1;
    ctx.fillStyle = e.heat && !fossil ? hex(fill, 0.35 + 0.6 * a[0] + 0.05) : hex(fill, fossil ? 0.55 : (a[0] * (0.2 + 0.5 * s)) + (1 - a[0]) * (0.07 + 0.1 * s));
    ctx.fillRect(x, y, w * build, h);
    if (build < 1) { ctx.fillStyle = hex("#ffffff", 0.8); ctx.fillRect(x + w * build - 1, y, 2, h); }
    if (fossil) { ctx.setLineDash([3, 2]); ctx.strokeStyle = hex("#ff8a7a", 0.55); ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); ctx.setLineDash([]); }
    else if (cellPx > 14) { ctx.strokeStyle = hex(color, 0.35 + 0.4 * s); ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); }
    // Being compared: A and B are marked.
    if (e.compareA === id || e.compareB === id) {
      ctx.strokeStyle = "#ffffff"; ctx.setLineDash([5, 3]); ctx.lineWidth = 1.5; ctx.strokeRect(x - 4, y - 4, w + 8, h + 8); ctx.setLineDash([]);
      ctx.font = `600 11px ${MONO}`; ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillStyle = "#ffffff"; ctx.fillText(e.compareA === id ? "A" : "B", x + w / 2, y - 6);
    }
    // Live light: recalled (by score, fades ~3 s after the answer), scanned (faint), updated (a flash), the Zeladora.
    if (fx) {
      let lit = 0;
      if (fx.lit !== undefined && fx.litAt !== undefined && now >= fx.litAt) {
        const rise = clamp((now - fx.litAt) / 300, 0, 1), fade = fx.fadeAt ? 1 - clamp((now - fx.fadeAt) / 3000, 0, 1) : 1 - clamp((now - fx.litAt - 20000) / 3000, 0, 1);
        lit = fx.lit * rise * fade;
        if (lit <= 0.001 && fade <= 0) { fx.lit = undefined; fx.litAt = undefined; fx.fadeAt = undefined; }
      }
      const scan = fx.scan !== undefined && fx.scanAt !== undefined ? fx.scan * (1 - clamp((now - fx.scanAt) / 5000, 0, 1)) * 0.35 : 0;
      const glow = Math.max(lit, scan);
      if (glow > 0.01) {
        // A real glow around what is being recalled (only the lit cells pay for the blur).
        ctx.shadowColor = GOLD; ctx.shadowBlur = 6 + 18 * glow;
        ctx.fillStyle = hex(GOLD, 0.65 * glow); ctx.fillRect(x, y, w, h);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = hex(GOLD, Math.min(1, glow * 1.3)); ctx.lineWidth = 1.5; ctx.strokeRect(x - 1.5, y - 1.5, w + 3, h + 3);
        if (lit > 0.05) { ctx.strokeStyle = hex(GOLD, 0.25 * lit); ctx.lineWidth = 1; ctx.strokeRect(x - 5, y - 5, w + 10, h + 10); }
      }
      if (fx.flashAt) { const f = 1 - clamp((now - fx.flashAt) / 900, 0, 1); if (f > 0) { ctx.fillStyle = hex("#ffffff", 0.55 * f); ctx.fillRect(x, y, w, h); } }
      if (fx.probeAt) {
        const f = 1 - clamp((now - fx.probeAt) / 2600, 0, 1);
        if (f > 0) { ctx.strokeStyle = hex(KEEPER, 0.9 * f); ctx.lineWidth = 1.2; const p = 4 + 3 * (1 - f); ctx.strokeRect(x - p, y - p, w + p * 2, h + p * 2); }
      }
    }
    // A search: what it found is ringed in blue, the rest steps back.
    if (e.highlight.size) {
      if (e.highlight.has(id)) { ctx.strokeStyle = "#45D6FF"; ctx.lineWidth = 1.5; ctx.shadowColor = "#45D6FF"; ctx.shadowBlur = 10; ctx.strokeRect(x - 2, y - 2, w + 4, h + 4); ctx.shadowBlur = 0; }
      else { ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(x, y, w, h); }
    }
    if (e.hover === id && e.selected !== id) { ctx.strokeStyle = hex("#ffffff", 0.7); ctx.lineWidth = 1; ctx.strokeRect(x - 1.5, y - 1.5, w + 3, h + 3); }
    if (e.selected === id) { ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.strokeRect(x - 2.5, y - 2.5, w + 5, h + 5); }

    // Level 2: the short text in the cell.
    const t2 = a[1] * clamp((w - 46) / 30, 0, 1);
    if (t2 > 0.02) {
      const fs = clamp(h * 0.42, 8, 13);
      ctx.font = `400 ${fs}px ${MONO}`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillStyle = hex(m.sensitive || fossil ? DIM : INK, t2 * (fossil ? 0.6 : 0.55 + 0.45 * s));
      ctx.fillText(fit(m.text, w - 8, fs, `${id}2`), x + 4, y + h / 2);
    }
    // Level 3: the memory and its fragments.
    if (a[2] > 0.02 && w > 140) drawMemory(ctx, m, c, color, a[2], X, Y, k, s);
    // Level 4: reading — traces, bits, the current.
    if (a[3] > 0.02 && w > 500) drawReading(ctx, m, c, color, now, a[3], X, Y, k);
    void z;
  };

  const fit = (text: string, width: number, fs: number, key: string) => {
    const e = E.current, n = Math.max(0, Math.floor(width / (fs * 0.6)));
    const ck = `${key}|${n}|${text}`;
    let v = e.textW.get(ck);
    if (v === undefined) { v = text.length <= n ? text : n > 1 ? `${text.slice(0, n - 1)}…` : ""; if (e.textW.size > 6000) e.textW.clear(); e.textW.set(ck, v); }
    return v;
  };

  /** The fragment pads of a cell (cell units: 24 × 9). */
  const pads = (m: ChipMemory) => {
    const n = Math.max(1, m.entities.length), gap = 0.5, w = (CELL_W - 2 - gap * (n - 1)) / n;
    return Array.from({ length: n }, (_, i) => ({ u: 1 + i * (w + gap), w, label: m.entities[i] || "" }));
  };

  const drawMemory = (ctx: CanvasRenderingContext2D, m: ChipMemory, c: Rect, color: string, al: number, X: (x: number) => number, Y: (y: number) => number, k: number, s: number) => {
    const fsT = clamp(k * 1.05, 10, 19), fsF = clamp(k * 0.55, 9, 15), fsS = clamp(k * 0.48, 9, 13);
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.font = `600 ${fsT}px ${MONO}`; ctx.fillStyle = hex(INK, al);
    ctx.fillText(fit(m.text, (CELL_W - 2) * k, fsT, `${m.id}3`), X(c.x + 1), Y(c.y + 1.7));
    if (m.sensitive || !m.entities.length) {
      ctx.font = `400 ${fsF}px ${MONO}`; ctx.fillStyle = hex(DIM, al);
      ctx.fillText(m.sensitive ? "memória privada — sem fragmentos visíveis" : "sem fragmentos (texto curto demais)", X(c.x + 1), Y(c.y + 4.6));
    } else {
      pads(m).forEach((p, i) => {
        const px = X(c.x + p.u), py = Y(c.y + 3.2), pw = p.w * k, ph = 2.8 * k;
        ctx.fillStyle = hex(color, 0.12 * al); ctx.fillRect(px, py, pw, ph);
        ctx.strokeStyle = hex(color, 0.8 * al); ctx.lineWidth = 1; ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
        ctx.font = `400 ${fsS * 0.85}px ${MONO}`; ctx.fillStyle = hex(color, 0.9 * al); ctx.textAlign = "left";
        ctx.fillText(`F${i + 1}`, px + 5, py + fsS * 0.75);
        ctx.font = `500 ${fsF}px ${MONO}`; ctx.fillStyle = hex(INK, al); ctx.textAlign = "center";
        ctx.fillText(fit(p.label, pw - 8, fsF, `${m.id}f${i}`), px + pw / 2, py + ph / 2 + fsS * 0.25);
        ctx.textAlign = "left";
      });
    }
    ctx.font = `400 ${fsS}px ${MONO}`; ctx.fillStyle = hex(DIM, al);
    ctx.fillText(fit(`gravada ${date(m.createdAt)} · ${m.uses} uso${m.uses === 1 ? "" : "s"} · força ${Math.round(s * 100)}%${m.lastUsedAt ? ` · usada ${date(m.lastUsedAt)}` : ""}`, (CELL_W - 2) * k, fsS, `${m.id}s`), X(c.x + 1), Y(c.y + 7.6));
  };

  const drawReading = (ctx: CanvasRenderingContext2D, m: ChipMemory, c: Rect, color: string, now: number, al: number, X: (x: number) => number, Y: (y: number) => number, k: number) => {
    const e = E.current, bits = bitsFor(m), P = pads(m), fx = e.fx.get(m.id);
    const reading = Boolean(fx?.lit !== undefined && fx.litAt !== undefined && now >= fx.litAt && (!fx.fadeAt || now - fx.fadeAt < 3000));
    const cur = Math.floor(now / 1300) % P.length;
    const COLS = 48, ROWS = BITS / COLS, bu = (CELL_W - 2) / COLS, bv = 1.9 / ROWS, by0 = 6.7;
    // Header: what is being read, or what this level is.
    const fs = clamp(k * 0.42, 10, 15);
    ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.font = `600 ${fs}px ${MONO}`;
    if (m.archivedAt) {
      ctx.fillStyle = hex("#ff8a7a", al);
      ctx.fillText(`${m.text.slice(0, 40)} · esquecida em ${date(m.archivedAt)}: fora do atlas, sem assinatura (restaure para voltar)`, X(c.x + 1), Y(c.y + 0.9));
      return;
    }
    if (reading && m.entities.length) {
      ctx.fillStyle = hex(GOLD, al); ctx.fillText(`LENDO FRAGMENTO ${cur + 1} · «${P[cur].label}»`, X(c.x + 1), Y(c.y + 0.9));
      ctx.font = `400 ${fs}px ${MONO}`; ctx.fillStyle = hex(INK, al);
      ctx.fillText(fit(chunkAround(m.snippet || m.text, P[cur].label), (CELL_W - 2) * k, fs, `${m.id}c${cur}`), X(c.x + 1), Y(c.y + 2.1));
    } else {
      ctx.fillStyle = hex(DIM, al);
      ctx.fillText(m.sensitive ? "memória privada — sem bits visíveis" : m.sig ? `${m.text.slice(0, 40)} · fragmentos → bits do embedding (sinais das primeiras ${BITS} dimensões)` : `${m.text.slice(0, 40)} · sem embedding: bits do hash do texto`, X(c.x + 1), Y(c.y + 0.9));
    }
    if (m.sensitive) return;
    // Pads (outlines only now), traces from each to its share of the bits.
    P.forEach((p, i) => {
      const on = reading && i === cur;
      ctx.strokeStyle = hex(on ? GOLD : color, (on ? 0.95 : 0.45) * al); ctx.lineWidth = on ? 2 : 1;
      ctx.strokeRect(X(c.x + p.u) + 0.5, Y(c.y + 3.2) + 0.5, p.w * k, 2.8 * k);
      ctx.font = `400 ${clamp(k * 0.3, 9, 12)}px ${MONO}`; ctx.fillStyle = hex(on ? GOLD : color, 0.8 * al); ctx.textAlign = "left";
      ctx.fillText(`F${i + 1} ${p.label}`, X(c.x + p.u) + 6, Y(c.y + 3.2) + 10);
      const c0 = Math.floor((i * COLS) / P.length), c1 = Math.floor(((i + 1) * COLS) / P.length);
      const tx = c.x + p.u + p.w / 2, bx = c.x + 1 + ((c0 + c1) / 2) * bu;
      const path: [number, number][] = [[tx, c.y + 6.0], [tx, c.y + 6.35], [bx, c.y + 6.35], [bx, c.y + by0]];
      ctx.strokeStyle = hex(COPPER, (on ? 1 : 0.7) * al); ctx.lineWidth = on ? 2.5 : 1.5;
      ctx.beginPath(); path.forEach(([x, y], j) => (j ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.stroke();
      // The current: along the pad's top edge, then down its trace (faster on the one being read).
      const full: [number, number][] = [[c.x + p.u, c.y + 3.2], [c.x + p.u + p.w, c.y + 3.2], [c.x + p.u + p.w, c.y + 6.0], [tx, c.y + 6.0], ...path.slice(1)];
      const u = ((now / (on ? 900 : 2600)) + i * 0.17) % 1;
      for (let tail = 4; tail >= 0; tail -= 1) {
        const [qx, qy] = along(full, u - tail * 0.015);
        ctx.fillStyle = hex(GOLD, al * (tail ? 0.45 * (1 - tail / 5) : 1)); ctx.beginPath(); ctx.arc(X(qx), Y(qy), tail ? 2 : 3, 0, Math.PI * 2); ctx.fill();
      }
      // The bits of this fragment's share.
      for (let col = c0; col < c1; col += 1) for (let row = 0; row < ROWS; row += 1) {
        const bit = bits[row * COLS + col];
        const x = X(c.x + 1 + col * bu), y = Y(c.y + by0 + row * bv), w = bu * k, h = bv * k;
        if (x + w < 0 || x > E.current.W || y + h < 0 || y > E.current.H) continue;
        if (bit) { ctx.fillStyle = hex(on ? GOLD : COPPER, (on ? 0.95 : 0.75) * al); ctx.fillRect(x + w * 0.15, y + h * 0.15, w * 0.7, h * 0.7); }
        else { ctx.strokeStyle = hex(GRID, 0.9 * al); ctx.lineWidth = 1; ctx.strokeRect(x + w * 0.15 + 0.5, y + h * 0.15 + 0.5, w * 0.7 - 1, h * 0.7 - 1); }
        if (w > 18) { ctx.font = `400 ${clamp(w * 0.38, 8, 12)}px ${MONO}`; ctx.textAlign = "center"; ctx.fillStyle = hex(bit ? "#000000" : DIM, al); ctx.fillText(bit ? "1" : "0", x + w / 2, y + h / 2 + 1); ctx.textAlign = "left"; }
      }
    });
  };

  const drawAssociations = (ctx: CanvasRenderingContext2D, m: ChipMemory, c: Rect, now: number, al: number, X: (x: number) => number, Y: (y: number) => number, k: number) => {
    const e = E.current, t = now / 1000;
    ctx.fillStyle = `rgba(0,0,0,${0.72 * al})`; ctx.fillRect(X(c.x), Y(c.y), c.w * k, c.h * k);
    const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    const links = m.links.filter((l) => e.mems.has(l.id)).slice(0, 5);
    const clouds = [{ id: m.id, x: cx, y: cy, score: 1, kind: "self" as string, across: false }, ...links.map((l, i) => {
      // Closer when more similar (all within the view at this level).
      const ang = -Math.PI / 2 + (i / Math.max(1, links.length)) * Math.PI * 2, r = 1.25 - clamp(l.score - 0.72, 0, 0.28) * 1.2;
      return { id: l.id, x: cx + Math.cos(ang) * r * 1.35, y: cy + Math.sin(ang) * r * 0.85, score: l.score, kind: l.kind as string, across: Boolean(l.across) };
    })];
    const pts = clouds.map((cl) => {
      const rnd = seeded(hash(cl.id, 31)), n = cl.kind === "self" ? 80 : 56, spread = cl.kind === "self" ? 0.2 : 0.13;
      return Array.from({ length: n }, () => {
        const g1 = Math.sqrt(-2 * Math.log(1e-6 + rnd())) * Math.cos(2 * Math.PI * rnd()), g2 = Math.sqrt(-2 * Math.log(1e-6 + rnd())) * Math.sin(2 * Math.PI * rnd()), ph = rnd() * 6.28;
        return [cl.x + g1 * spread + Math.sin(t * 0.35 + ph) * 0.012, cl.y + g2 * spread * 0.8 + Math.cos(t * 0.3 + ph) * 0.01] as [number, number];
      });
    });
    // Between the memory and each neighbour: a few long threads (brighter when more similar).
    clouds.slice(1).forEach((cl, i) => {
      const rnd = seeded(hash(cl.id + m.id));
      ctx.strokeStyle = hex(colorOf(cl.id), 0.35 * cl.score * al); ctx.lineWidth = 1;
      for (let j = 0; j < 9; j += 1) {
        const p = pts[0][Math.floor(rnd() * pts[0].length)], q = pts[i + 1][Math.floor(rnd() * pts[i + 1].length)];
        ctx.beginPath(); ctx.moveTo(X(p[0]), Y(p[1])); ctx.lineTo(X(q[0]), Y(q[1])); ctx.stroke();
      }
    });
    // Each cloud: its plexus and its particles, in its own nucleus' colour.
    clouds.forEach((cl, ci) => {
      const col = colorOf(cl.id), P = pts[ci], lim = 0.11;
      ctx.lineWidth = 1;
      for (let i = 0; i < P.length; i += 1) for (let j = i + 1; j < P.length; j += 1) {
        const d = Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]);
        if (d < lim) { ctx.strokeStyle = hex(col, (1 - d / lim) * 0.45 * al); ctx.beginPath(); ctx.moveTo(X(P[i][0]), Y(P[i][1])); ctx.lineTo(X(P[j][0]), Y(P[j][1])); ctx.stroke(); }
      }
      ctx.fillStyle = hex(col, 0.95 * al);
      for (const p of P) { ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), ci === 0 ? 2.4 : 2, 0, Math.PI * 2); ctx.fill(); }
      const other = e.mems.get(cl.id);
      const label = ci === 0 ? m.text : `${other?.text || cl.id} · ${cl.kind === "relation" ? "relação" : `similaridade ${cl.score.toFixed(2).replace(".", ",")}`}${cl.across ? " · outro núcleo" : ""}`;
      ctx.font = `${ci === 0 ? 600 : 400} ${ci === 0 ? 14 : 12}px ${MONO}`; ctx.textAlign = "center"; ctx.textBaseline = "top";
      const lx = X(cl.x), ly = Y(cl.y + (ci === 0 ? 0.3 : 0.22)) + 6;
      const tw = Math.min(ctx.measureText(label).width, 320) + 12;
      ctx.fillStyle = `rgba(0,0,0,${0.75 * al})`; ctx.fillRect(lx - tw / 2, ly - 2, tw, ci === 0 ? 20 : 18);
      ctx.fillStyle = hex(ci === 0 ? "#ffffff" : col, al); ctx.fillText(fit(label, 320, ci === 0 ? 14 : 12, `${cl.id}a`), lx, ly);
    });
    if (!links.length) {
      ctx.font = `400 13px ${MONO}`; ctx.textAlign = "center"; ctx.fillStyle = hex(DIM, al);
      ctx.fillText("nenhuma vizinha próxima em sentido (similaridade ≥ 0,72) nem relação gravada", X(cx), Y(cy) - 60);
    }
  };

  const drawCrystal = (ctx: CanvasRenderingContext2D, m: ChipMemory, c: Rect, al: number, X: (x: number) => number, Y: (y: number) => number, k: number, vx0: number, vx1: number, vy0: number, vy1: number) => {
    const bits = bitsFor(m), A = 0.06, RH = A * 0.866;
    ctx.save(); ctx.beginPath(); ctx.rect(X(c.x), Y(c.y), c.w * k, c.h * k); ctx.clip();
    ctx.fillStyle = `rgba(2,8,6,${0.9 * al})`; ctx.fillRect(X(c.x), Y(c.y), c.w * k, c.h * k);
    const j0 = Math.max(0, Math.floor((vy0 - c.y) / RH) - 1), j1 = Math.min(Math.ceil(c.h / RH), Math.ceil((vy1 - c.y) / RH) + 1);
    const i0 = Math.max(0, Math.floor((vx0 - c.x) / A) - 1), i1 = Math.min(Math.ceil(c.w / A), Math.ceil((vx1 - c.x) / A) + 1);
    const charged = (i: number, j: number) => !m.sensitive && !m.archivedAt && bits[(j % 12) * 16 + (i % 16)] === 1;
    const pos = (i: number, j: number): [number, number] => [X(c.x + i * A + (j % 2 ? A / 2 : 0)), Y(c.y + j * RH)];
    if ((i1 - i0) * (j1 - j0) < 9000) {
      ctx.strokeStyle = hex(GRID, 0.55 * al); ctx.lineWidth = 1; ctx.beginPath();
      for (let j = j0; j < j1; j += 1) for (let i = i0; i < i1; i += 1) {
        const [x, y] = pos(i, j), [rx, ry] = pos(i + 1, j);
        ctx.moveTo(x, y); ctx.lineTo(rx, ry);
        const [dx, dy] = pos(j % 2 ? i + 1 : i, j + 1), [ex, ey] = pos(j % 2 ? i : i - 1, j + 1);
        ctx.moveTo(x, y); ctx.lineTo(dx, dy); ctx.moveTo(x, y); ctx.lineTo(ex, ey);
      }
      ctx.stroke();
      for (let j = j0; j < j1; j += 1) for (let i = i0; i < i1; i += 1) {
        const [x, y] = pos(i, j);
        if (charged(i, j)) {
          ctx.fillStyle = hex(GOLD, 0.16 * al); ctx.beginPath(); ctx.arc(x, y, A * k * 0.42, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = hex(GOLD, 0.95 * al); ctx.beginPath(); ctx.arc(x, y, A * k * 0.15, 0, Math.PI * 2); ctx.fill();
        } else { ctx.fillStyle = hex(GRID, 0.95 * al); ctx.beginPath(); ctx.arc(x, y, Math.max(1.2, A * k * 0.06), 0, Math.PI * 2); ctx.fill(); }
      }
    }
    ctx.restore();
    // The caption, fixed on the screen.
    const W = E.current.W, H = E.current.H;
    const line1 = m.archivedAt ? `'${m.text.slice(0, 50)}' — esquecida: o cristal está descarregado` : m.sensitive ? "memória privada — o padrão de cargas não é mostrado" : `'${m.text.length > 60 ? `${m.text.slice(0, 59)}…` : m.text}' — gravada como padrão de cargas`;
    const line2 = m.sig ? `átomo dourado = dimensão positiva do embedding · cada ladrilho 16×12 = as primeiras ${BITS} dimensões` : "sem embedding: as cargas vêm do hash do texto";
    ctx.font = `600 14px ${MONO}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const tw = Math.max(ctx.measureText(line1).width, 420) + 40;
    const tw2 = Math.max(tw, (ctx.font = `400 11px ${MONO}`, ctx.measureText(line2).width + 40));
    ctx.fillStyle = `rgba(0,0,0,${0.85 * al})`; ctx.fillRect(W / 2 - tw2 / 2, H - 112, tw2, 50);
    ctx.strokeStyle = hex(GOLD, 0.5 * al); ctx.strokeRect(W / 2 - tw2 / 2 + 0.5, H - 111.5, tw2 - 1, 49);
    ctx.font = `600 14px ${MONO}`; ctx.fillStyle = hex(GOLD, al); ctx.fillText(line1, W / 2, H - 95);
    ctx.font = `400 11px ${MONO}`; ctx.fillStyle = hex(INK, 0.75 * al); ctx.fillText(line2, W / 2, H - 75);
  };

  // ---------- panel ----------
  const card = selected ?? (ui.z >= 8 ? ui.focus : null);
  const cm = card ? E.current.mems.get(card) : null;
  const cc = card ? E.current.L?.cell.get(card) : null;
  const goTo = (id: string, z = 12) => { const c = E.current.L?.cell.get(id); if (!c) return; setSelected(id); interacted(); flyTo(c.x + c.w / 2, c.y + c.h / 2, z, 1000); };
  const lv = LEVELS[ui.level];
  const lz = (z: number) => Math.log10(z / ZOOM_MIN) / Math.log10(ZOOM_MAX / ZOOM_MIN);
  const enqueue = (ev: ChipEvent) => { E.current.queue.push(ev); };

  return (
    <div ref={rootRef} className={`mc ${narrow ? "mc-narrow" : ""}`}>
      <aside className="mc-panel" aria-label="Memória ao vivo">
        <header>
          <b>MEMORY CHIP</b>
          <span className={`mc-live ${ui.live ? "on" : ""}`}>{source.mock ? "SIMULAÇÃO" : ui.live ? "AO VIVO" : "RECONECTANDO"}</span>
          {onSwitchSource && <button onClick={onSwitchSource} title="Trocar entre a memória real e uma simulação com os mesmos eventos">{source.mock ? "ver ao vivo" : "simular"}</button>}
        </header>
        <div className="mc-counters">
          <div><b>{ui.memories}</b><span>memórias</span></div>
          <div><b>{ui.recallsToday}</b><span>recalls hoje</span></div>
          <div className={ui.recall ? "on" : ""}><b>{ui.recall ? "●" : "—"}</b><span>{ui.recall ? "recall em andamento" : "nenhum recall"}</span></div>
        </div>
        {ui.recall && <p className="mc-query">“{ui.recall}”</p>}
        <section>
          <h4>Ocupação por núcleo</h4>
          <ul className="mc-occ">
            {ui.occupancy.map((o) => <li key={o.id} style={{ ["--c" as string]: o.color }}><span>{o.label}</span><i><em style={{ width: `${(o.n / Math.max(1, o.cap)) * 100}%` }} /></i><small>{o.n}/{o.cap}</small></li>)}
          </ul>
        </section>
        <section>
          <h4>Usadas nesta resposta</h4>
          {ui.used.length ? <ol className="mc-used">{ui.used.map((u) => <li key={u.id}><button onClick={() => goTo(u.id)}>{u.text}</button><small title={u.score < 0 ? "resposta antiga: o score não foi registrado" : "score da busca"}>{u.score < 0 ? "—" : u.score.toFixed(2).replace(".", ",")}</small></li>)}</ol> : <p className="mc-empty">Nenhuma resposta ainda nesta sessão.</p>}
        </section>
        <section>
          <h4>Respostas com memória <small>{E.current.history.length}</small></h4>
          {E.current.history.length ? <ol className="mc-replays" data-v={histVersion}>
            {E.current.history.slice(0, 8).map((h) => (
              <li key={h.id}>
                <button className="mc-play" onClick={() => replay(h)} title="Repetir esta resposta passo a passo">▶</button>
                <span title={h.query}>{h.query || "(sem texto)"}</span>
                <small>{new Date(h.at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · {h.used.length} usada{h.used.length === 1 ? "" : "s"}{h.created.length ? ` · ${h.created.length} gravada${h.created.length === 1 ? "" : "s"}` : ""}</small>
              </li>
            ))}
          </ol> : <p className="mc-empty">Nenhuma resposta usou memória ainda.</p>}
        </section>
        {compareA && <p className="mc-hint">Comparar: clique em outra célula para ser a B. <button onClick={() => setCompareA(null)}>cancelar</button></p>}
        {cm && cc && (
          <section className="mc-card" style={{ ["--c" as string]: E.current.L?.nuclei[cc.n].color }}>
            <h4>Memória em foco <button className="mc-x" onClick={() => setSelected(null)} aria-label="Fechar">×</button></h4>
            {editing === cm.id ? (
              <form onSubmit={(ev) => { ev.preventDefault(); const v = (new FormData(ev.currentTarget).get("t") as string || "").trim(); setEditing(null); if (v && v !== cm.text) source.actions?.edit?.(cm.id, v).then(() => enqueue({ type: "memory.updated", id: cm.id, text: v })).catch(() => feed("!", "não consegui editar", "#ff8a7a")); }}>
                <input name="t" defaultValue={cm.text} autoFocus /><button>salvar</button>
              </form>
            ) : <p className="mc-title">{cm.text}</p>}
            {cm.archivedAt ? <p className="mc-text mc-gone">Esquecida (arquivada) em {date(cm.archivedAt)}. Fica no arquivo e pode voltar.</p> : null}
            {cm.snippet && <p className="mc-text">{cm.snippet}</p>}
            <dl>
              <dt>núcleo</dt><dd>{E.current.L?.nuclei[cc.n].label}</dd>
              <dt>gravada</dt><dd>{date(cm.createdAt)}</dd>
              <dt>usos</dt><dd>{cm.uses}{cm.lastUsedAt ? ` · último ${date(cm.lastUsedAt)}` : ""}</dd>
              <dt>força</dt><dd>{Math.round(strengthOf(cm) * 100)}%</dd>
              {cm.entities.length > 0 && <><dt>fragmentos</dt><dd>{cm.entities.join(" · ")}</dd></>}
            </dl>
            {cm.links.length > 0 && <ul className="mc-links">{cm.links.filter((l) => E.current.mems.has(l.id)).map((l) => <li key={l.id}><button onClick={() => goTo(l.id)}>{E.current.mems.get(l.id)?.text}</button><small>{l.kind === "relation" ? "relação" : l.score.toFixed(2).replace(".", ",")}</small></li>)}</ul>}
            <div className="mc-actions">
              {!cm.archivedAt && <button onClick={() => { setCompareA(cm.id); setSelected(null); }} title="Escolha outra célula para comparar bits, sinais e similaridade real">comparar</button>}
              {cm.archivedAt && source.actions?.restore && <button onClick={() => source.actions!.restore!(cm.id).then(() => { const m = E.current.mems.get(cm.id); if (m && source.mock) { m.archivedAt = null; m.category = E.current.cats[0]?.id || m.category; rebuild(); } feed("↑", `restaurou «${cm.text}»`, "#8DFF6A"); }).catch(() => feed("!", "não consegui restaurar", "#ff8a7a"))}>restaurar</button>}
            </div>
            {source.actions && !cm.sensitive && !cm.archivedAt && (
              <div className="mc-actions">
                {source.actions.edit && <button onClick={() => setEditing(cm.id)}>editar</button>}
                {source.actions.forget && (confirmForget
                  ? <><button className="danger" onClick={() => { setConfirmForget(false); source.actions!.forget!(cm.id).then(() => enqueue({ type: "memory.deleted", id: cm.id, reason: "user" })).catch(() => feed("!", "não consegui esquecer", "#ff8a7a")); }}>confirmar: esquecer</button><button onClick={() => setConfirmForget(false)}>cancelar</button></>
                  : <button onClick={() => setConfirmForget(true)}>esquecer</button>)}
              </div>
            )}
            {extraActions && <div className="mc-actions">{extraActions(cm.id)}</div>}
          </section>
        )}
        <section className="mc-feed-wrap">
          <h4>Eventos</h4>
          <ol className="mc-feed">{ui.feed.map((f, i) => <li key={`${f.at}-${i}`} style={{ ["--c" as string]: f.color }}><time>{new Date(f.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><b>{f.mark}</b><span>{f.text}</span></li>)}</ol>
        </section>
      </aside>

      <div className="mc-stage" style={{ marginRight: narrow ? 0 : inset }}>
        <canvas ref={canvasRef} className="mc-canvas" aria-label="Chip de memória: cada célula é uma memória gravada" />
        {!ui.ready && <div className="mc-loading">lendo as memórias…</div>}
        {replayCap && <div className="mc-replay-cap"><b>↺ REPLAY · {String(replayCap.step).padStart(2, "0")}/{String(replayCap.total).padStart(2, "0")}</b><span>“{replayCap.query.slice(0, 80)}”</span><small>{replayCap.note}</small></div>}
        {timeT !== null && <div className="mc-past">VOLTANDO NO TEMPO · {new Date(timeT).toLocaleString("pt-BR")} · {ui.memories} memórias vivas</div>}
        {heat && <div className="mc-heat-legend"><span>frio</span><i /><span>quente</span><small>usos reais + recência</small></div>}
        {compare && (() => {
          const a = E.current.mems.get(compare.a), b = E.current.mems.get(compare.b);
          if (!a || !b) return null;
          return <ChipCompare a={a} b={b} bitsA={bitsFor(a)} bitsB={bitsFor(b)} colorA={colorOf(a.id)} colorB={colorOf(b.id)} similarity={compare.sim} mock={source.mock} onClose={() => setCompare(null)} />;
        })()}
        {(() => {
          const ms = [...E.current.mems.values()];
          if (!ms.length) return null;
          const t0 = Math.min(...ms.map((m) => m.createdAt).filter((x) => x > 0), ...E.current.history.map((h) => h.at)), t1 = Date.now();
          return <ChipTimeline t0={t0} t1={t1} value={timeT} playing={playing} buckets={timelineBuckets(ms, E.current.history, t0, t1)}
            onChange={(t) => { setPlaying(false); setTimeT(t >= t1 - 60_000 ? null : t); }}
            onPlay={() => { if (playing) { setPlaying(false); return; } E.current.prevT = null; setTimeT((t) => t ?? t0); setPlaying(true); }}
            onLive={() => { setPlaying(false); setTimeT(null); }} />;
        })()}
        {tip && ui.level <= 1 && (() => {
          const m = E.current.mems.get(tip.id), c = E.current.L?.cell.get(tip.id), n = c && E.current.L ? E.current.L.nuclei[c.n] : null;
          if (!m || !n) return null;
          return (
            <div className="mc-tip" style={{ left: tip.x + 14, top: tip.y + 14, ["--c" as string]: n.color }} role="status">
              <b>{m.text}</b>
              <span>{n.label} · {m.uses} uso{m.uses === 1 ? "" : "s"} · força {Math.round(strengthOf(m) * 100)}% · {m.links.length} vizinha{m.links.length === 1 ? "" : "s"}</span>
              <small>clique para descer · Enter / Esc sobe e desce</small>
            </div>
          );
        })()}
        <div className="mc-legend">
          <h3>NÍVEL {ui.level + 1} DE 6 · {lv.name}</h3>
          <p>{lv.say}</p>
          <nav className="mc-crumbs">{ui.crumbs.map((c, i) => <span key={i}>{i > 0 && " › "}<button onClick={() => goLevel(i === 0 ? 0 : i === 1 ? 1 : 2)}>{c}</button></span>)}</nav>
        </div>
        <div className="mc-ruler" aria-label="Profundidade">
          {LEVELS.map((L, i) => {
            const top = lz(Math.max(ZOOM_MIN, L.from)), bottom = lz(Math.min(ZOOM_MAX, L.to));
            return <button key={L.name} className={i === ui.level ? "on" : ""} style={{ top: `${top * 100}%`, height: `${(bottom - top) * 100}%` }} onClick={() => { interacted(); goLevel(i); }} title={`${i + 1} · ${L.name}`}><span>{i + 1}</span></button>;
          })}
          <i style={{ top: `${clamp(lz(ui.z), 0, 1) * 100}%` }}><em>{ui.z < 10 ? ui.z.toFixed(1).replace(".", ",") : Math.round(ui.z)}×</em></i>
        </div>
        <div className="mc-tools">
          <button onClick={() => { interacted(); zoomAt(E.current.W / 2, E.current.H / 2, 2); }} aria-label="Aproximar">+</button>
          <button onClick={() => { interacted(); zoomAt(E.current.W / 2, E.current.H / 2, 0.5); }} aria-label="Afastar">−</button>
          <button className={ui.diving ? "on" : ""} onClick={() => { dive(); E.current.dirty = true; }}>{ui.diving ? "parar mergulho" : "mergulho automático"}</button>
          <button className={heat ? "on" : ""} onClick={() => setHeat((h) => !h)} title="Pintar cada célula pelo uso real (quantas vezes e quão recente)">calor de uso</button>
          <button className={sound ? "on" : ""} onClick={() => setSound((v) => !v)} title="Um som para cada evento real: lembrar, gravar, esquecer, responder, a zeladora lendo">som {sound ? "on" : "off"}</button>
          <button className={ui.follow ? "on" : ""} onClick={() => { E.current.follow = !E.current.follow; E.current.dirty = true; }} title="A cada recall a câmera vai até o núcleo mais usado; desliga quando você mexe no chip">seguir a IA {ui.follow ? "on" : "off"}</button>
        </div>
      </div>
    </div>
  );
}

export type { ChipSource };
