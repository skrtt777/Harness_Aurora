import { useCallback, useEffect, useRef, useState } from "react";
import {
  BANK, BANK_H, BANK_W, BITS, CELL_H, CELL_W, COPPER, slotRect, GOLD, GRID, LEVELS, SILICON, ZOOM_MAX, ZOOM_MIN,
  along, assignSlots, bitsOf, chunkAround, layerAlpha, layoutChip, levelAt, strengthOf,
  type ChipCategory, type ChipEvent, type ChipLayout, type ChipMemory, type ChipSnapshot, type ChipSource, type Rect,
} from "./chip";

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

/** inset: pixels on the right covered by something else (a chat beside it): the die stays clear of them. */
export default function MemoryChip({ source, onSwitchSource, inset = 0 }: { source: ChipSource; onSwitchSource?: () => void; inset?: number }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ui, setUi] = useState<Ui>({ live: false, z: 1, level: 0, crumbs: ["Chip"], focus: null, memories: 0, recallsToday: 0, recall: null, used: [], feed: [], occupancy: [], follow: false, diving: false, ready: false });
  const [narrow, setNarrow] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmForget, setConfirmForget] = useState(false);
  const E = useRef({
    mems: new Map<string, ChipMemory>(), cats: [] as ChipCategory[], slots: null as Map<string, (string | null)[]> | null, L: null as ChipLayout | null,
    bits: new Map<string, Uint8Array>(), fx: new Map<string, Fx>(), ghosts: [] as Ghost[], packets: [] as Packet[], traces: [] as Trace[],
    cam: { x: 0, y: 0, k: 1 }, kFit: 1, W: 800, H: 500, dpr: 1, fitted: false, fly: null as Fly | null, diving: false, follow: false,
    recall: null as Recall | null, recallsToday: 0, used: [] as { id: string; score: number }[], feed: [] as FeedItem[], queue: [] as ChipEvent[],
    live: false, focus: null as string | null, selected: null as string | null, dirty: true, uiAt: 0, drag: null as null | { x: number; y: number; cx: number; cy: number; moved: boolean },
    pointers: new Map<number, [number, number]>(), pinch: null as null | { d: number }, textW: new Map<string, string>(),
  });
  E.current.selected = selected;
  // ---------- the state: a snapshot, the events ----------
  const rebuild = useCallback(() => {
    const e = E.current;
    e.slots = assignSlots(e.slots, e.cats, [...e.mems.values()]);
    e.L = layoutChip(e.cats, e.slots);
    resizeFit();
    e.dirty = true;
  }, []);
  const feed = (mark: string, text: string, color: string) => { const e = E.current; e.feed.unshift({ at: Date.now(), mark, text, color }); if (e.feed.length > 40) e.feed.length = 40; e.dirty = true; };
  const colorOf = (id: string) => { const e = E.current; const c = e.L?.cell.get(id); return c && e.L ? e.L.nuclei[c.n].color : GOLD; };
  const bitsFor = (m: ChipMemory) => { const e = E.current; let b = e.bits.get(m.id); if (!b) { b = bitsOf(m.sig, m.text + m.id); e.bits.set(m.id, b); } return b; };

  const applySnapshot = useCallback((s: ChipSnapshot, animate: boolean) => {
    const e = E.current, now = performance.now();
    const before = new Set(e.mems.keys());
    e.mems = new Map(s.memories.map((m) => [m.id, m])); e.cats = s.categories; e.bits.clear();
    e.recallsToday = Math.max(e.recallsToday, s.recallsToday);
    rebuild();
    if (animate) for (const m of s.memories) if (!before.has(m.id)) built(m, now);
  }, [rebuild]);

  /** A new cell: it is built in its slot, a dashed trace routed from its nucleus' bus to it. */
  const built = (m: ChipMemory, now: number, quiet = false) => {
    const e = E.current, c = e.L?.cell.get(m.id); if (!c || !e.L) return;
    const fx = e.fx.get(m.id) || {}; fx.buildAt = now; e.fx.set(m.id, fx);
    const n = e.L.nuclei[c.n], p0 = n.bus[0], cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    if (!quiet && p0) e.traces.push({ pts: Math.abs(p0[0] - n.x) < 1 || Math.abs(p0[0] - (n.x + n.w)) < 1 ? [p0, [p0[0], cy], [cx, cy]] : [p0, [cx, p0[1]], [cx, cy]], t0: now });
    feed("+", `gravou «${m.text}»`, n.color);
  };

  const process = (ev: ChipEvent, burst: boolean) => {
    const e = E.current, now = performance.now();
    switch (ev.type) {
      case "snapshot": applySnapshot(ev.snapshot, true); break;
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
          e.mems.delete(from);
        }
        if (ev.mergedFrom?.length) { rebuild(); feed("≈", `juntou ${ev.mergedFrom.length} em «${m.text}»`, colorOf(m.id)); }
        else feed("~", `atualizou «${m.text}»`, colorOf(m.id));
        break;
      }
      case "memory.deleted": {
        const m = e.mems.get(ev.id); if (!m) break;
        const c = e.L?.cell.get(ev.id);
        if (c && !burst) e.ghosts.push({ rect: { x: c.x, y: c.y, w: c.w, h: c.h }, color: colorOf(ev.id), at: now, seed: hash(ev.id) });
        e.mems.delete(ev.id); rebuild();
        feed("↓", `esqueceu «${m.text}»${ev.reason === "decay" ? " · obsoleta" : ev.reason === "merge" ? " · juntada" : ""}`, "#ff8a7a");
        if (e.selected === ev.id) setSelected(null);
        break;
      }
      case "recall.started":
        e.recall = { id: ev.requestId, query: ev.query, at: now, scores: new Map(), used: [], doneAt: null }; e.recallsToday += 1;
        feed("?", `lembrando: «${ev.query.slice(0, 60)}»`, GOLD);
        break;
      case "memory.scanned": { const fx = e.fx.get(ev.id) || {}; fx.scan = ev.score; fx.scanAt = now; e.fx.set(ev.id, fx); e.recall?.scores.set(ev.id, ev.score); break; }
      case "memory.recalled": {
        const fx = e.fx.get(ev.id) || {}, delay = ev.rank * 180;
        fx.lit = ev.score; fx.litAt = now + delay; fx.fadeAt = undefined; e.fx.set(ev.id, fx);
        e.recall?.scores.set(ev.id, ev.score);
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
        for (const id of ev.memoriesUsed) { const m = e.mems.get(id); if (m) { m.uses += 1; m.lastUsedAt = Date.now(); } }
        if (e.recall) e.recall.doneAt = now;
        feed("✓", `respondeu usando ${ev.memoriesUsed.length} memória${ev.memoriesUsed.length === 1 ? "" : "s"}${ev.tokensUsed ? ` · ${ev.tokensUsed} tokens` : ""}`, "#8DFF6A");
        break;
      }
      case "keeper.read": { const fx = e.fx.get(ev.id) || {}; fx.probeAt = now; e.fx.set(ev.id, fx); break; }
    }
    e.dirty = true;
  };

  // ---------- camera ----------
  const resizeFit = () => {
    const e = E.current; if (!e.L) return;
    const b = e.L.bounds, bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    // Room at the top for the level's legend.
    e.kFit = Math.min(e.W / bw, (e.H - 84) / bh) * 0.96;
    if (!e.fitted && e.W > 50) { e.cam = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 - 42 / e.kFit, k: e.kFit }; e.fitted = true; }
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
    if (id) setSelected(id);
    const next = Math.min(LEVELS.length - 1, lv + 1);
    const target = lv === LEVELS.length - 1 ? z * 1.5 : LEVELS[next].from * 1.5;
    flyTo(c ? c.x + c.w / 2 : wx, c ? c.y + c.h / 2 : wy, target, 900);
  };
  const goLevel = (i: number) => {
    const e = E.current;
    const id = [e.selected, e.focus, e.used[0]?.id, [...e.mems.keys()][0]].find((x) => x && e.L?.cell.has(x)), c = id ? e.L?.cell.get(id) : null;
    const L = LEVELS[i], z = i === 0 ? 1 : Math.sqrt(L.from * Math.min(L.to, ZOOM_MAX));
    if (i === 0 && e.L) { const b = e.L.bounds; flyTo((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2 - 42 / e.kFit, 1, 1000); return; }
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
    const back: Fly = { x0: c.x + c.w / 2, y0: c.y + c.h / 2, l0: Math.log(1100 * e.kFit), x1: (b.x0 + b.x1) / 2, y1: (b.y0 + b.y1) / 2 - 42 / e.kFit, l1: Math.log(e.kFit), t0: 0, ms: 3500 };
    const hold: Fly = { ...back, x1: back.x0, y1: back.y0, l1: back.l0, ms: 2600, then: back };
    flyTo(c.x + c.w / 2, c.y + c.h / 2, 1100, 16000, hold);
    e.diving = true;
  };

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
      if (!e.pointers.has(ev.pointerId)) return;
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
    return () => {
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
      draw(ctx, now);
      // The panel: a few times a second.
      if (now - e.uiAt > 220) { e.uiAt = now; pushUi(); }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

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
      live: e.live, z, level, crumbs, focus: e.focus, memories: e.mems.size, recallsToday: e.recallsToday, recall,
      used: e.used.map((u) => ({ id: u.id, text: e.mems.get(u.id)?.text || "(esquecida)", score: u.score })), feed: [...e.feed],
      occupancy: (e.L?.nuclei || []).map((n) => ({ id: n.id, label: n.label, color: n.color, n: n.slots.filter(Boolean).length, cap: n.banks * 60 })),
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
      for (let i = 1; i < 6; i += 1) { const q = C.w * k * i / 6; ctx.strokeRect(X(C.x) + q / 2, Y(C.y) + q / 2, C.w * k - q, C.h * k - q); }
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
      ctx.fillText(recOn ? (rec!.doneAt ? "respondeu" : "lembrando…") : "em espera", X(C.x + C.w / 2), Y(C.y + C.h / 2) + fs * 0.6);
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
    // Built left to right in a second.
    const build = fx?.buildAt ? clamp((now - fx.buildAt) / 1000, 0, 1) : 1;
    ctx.fillStyle = hex(color, (a[0] * (0.2 + 0.5 * s)) + (1 - a[0]) * (0.07 + 0.1 * s));
    ctx.fillRect(x, y, w * build, h);
    if (build < 1) { ctx.fillStyle = hex("#ffffff", 0.8); ctx.fillRect(x + w * build - 1, y, 2, h); }
    if (cellPx > 14) { ctx.strokeStyle = hex(color, 0.35 + 0.4 * s); ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); }
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
        ctx.fillStyle = hex(GOLD, 0.65 * glow); ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = hex(GOLD, Math.min(1, glow * 1.3)); ctx.lineWidth = 1.5; ctx.strokeRect(x - 1.5, y - 1.5, w + 3, h + 3);
        if (lit > 0.05) { ctx.strokeStyle = hex(GOLD, 0.25 * lit); ctx.lineWidth = 1; ctx.strokeRect(x - 5, y - 5, w + 10, h + 10); }
      }
      if (fx.flashAt) { const f = 1 - clamp((now - fx.flashAt) / 900, 0, 1); if (f > 0) { ctx.fillStyle = hex("#ffffff", 0.55 * f); ctx.fillRect(x, y, w, h); } }
      if (fx.probeAt) {
        const f = 1 - clamp((now - fx.probeAt) / 2600, 0, 1);
        if (f > 0) { ctx.strokeStyle = hex(KEEPER, 0.9 * f); ctx.lineWidth = 1.2; const p = 4 + 3 * (1 - f); ctx.strokeRect(x - p, y - p, w + p * 2, h + p * 2); }
      }
    }
    if (e.selected === id) { ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.strokeRect(x - 2.5, y - 2.5, w + 5, h + 5); }

    // Level 2: the short text in the cell.
    const t2 = a[1] * clamp((w - 46) / 30, 0, 1);
    if (t2 > 0.02) {
      const fs = clamp(h * 0.42, 8, 13);
      ctx.font = `400 ${fs}px ${MONO}`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillStyle = hex(m.sensitive ? DIM : INK, t2 * (0.55 + 0.45 * s));
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
    const clouds = [{ id: m.id, x: cx, y: cy, score: 1, kind: "self" as string }, ...links.map((l, i) => {
      // Closer when more similar (all within the view at this level).
      const ang = -Math.PI / 2 + (i / Math.max(1, links.length)) * Math.PI * 2, r = 1.25 - clamp(l.score - 0.72, 0, 0.28) * 1.2;
      return { id: l.id, x: cx + Math.cos(ang) * r * 1.35, y: cy + Math.sin(ang) * r * 0.85, score: l.score, kind: l.kind };
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
      const label = ci === 0 ? m.text : `${other?.text || cl.id} · ${cl.kind === "relation" ? "relação" : `similaridade ${cl.score.toFixed(2).replace(".", ",")}`}`;
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
    const charged = (i: number, j: number) => !m.sensitive && bits[(j % 12) * 16 + (i % 16)] === 1;
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
    const line1 = m.sensitive ? "memória privada — o padrão de cargas não é mostrado" : `'${m.text.length > 60 ? `${m.text.slice(0, 59)}…` : m.text}' — gravada como padrão de cargas`;
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
          {ui.used.length ? <ol className="mc-used">{ui.used.map((u) => <li key={u.id}><button onClick={() => goTo(u.id)}>{u.text}</button><small>{u.score.toFixed(2).replace(".", ",")}</small></li>)}</ol> : <p className="mc-empty">Nenhuma resposta ainda nesta sessão.</p>}
        </section>
        {cm && cc && (
          <section className="mc-card" style={{ ["--c" as string]: E.current.L?.nuclei[cc.n].color }}>
            <h4>Memória em foco <button className="mc-x" onClick={() => setSelected(null)} aria-label="Fechar">×</button></h4>
            {editing === cm.id ? (
              <form onSubmit={(ev) => { ev.preventDefault(); const v = (new FormData(ev.currentTarget).get("t") as string || "").trim(); setEditing(null); if (v && v !== cm.text) source.actions?.edit?.(cm.id, v).then(() => enqueue({ type: "memory.updated", id: cm.id, text: v })).catch(() => feed("!", "não consegui editar", "#ff8a7a")); }}>
                <input name="t" defaultValue={cm.text} autoFocus /><button>salvar</button>
              </form>
            ) : <p className="mc-title">{cm.text}</p>}
            {cm.snippet && <p className="mc-text">{cm.snippet}</p>}
            <dl>
              <dt>núcleo</dt><dd>{E.current.L?.nuclei[cc.n].label}</dd>
              <dt>gravada</dt><dd>{date(cm.createdAt)}</dd>
              <dt>usos</dt><dd>{cm.uses}{cm.lastUsedAt ? ` · último ${date(cm.lastUsedAt)}` : ""}</dd>
              <dt>força</dt><dd>{Math.round(strengthOf(cm) * 100)}%</dd>
              {cm.entities.length > 0 && <><dt>fragmentos</dt><dd>{cm.entities.join(" · ")}</dd></>}
            </dl>
            {cm.links.length > 0 && <ul className="mc-links">{cm.links.filter((l) => E.current.mems.has(l.id)).map((l) => <li key={l.id}><button onClick={() => goTo(l.id)}>{E.current.mems.get(l.id)?.text}</button><small>{l.kind === "relation" ? "relação" : l.score.toFixed(2).replace(".", ",")}</small></li>)}</ul>}
            {source.actions && !cm.sensitive && (
              <div className="mc-actions">
                {source.actions.edit && <button onClick={() => setEditing(cm.id)}>editar</button>}
                {source.actions.forget && (confirmForget
                  ? <><button className="danger" onClick={() => { setConfirmForget(false); source.actions!.forget!(cm.id).then(() => enqueue({ type: "memory.deleted", id: cm.id, reason: "user" })).catch(() => feed("!", "não consegui esquecer", "#ff8a7a")); }}>confirmar: esquecer</button><button onClick={() => setConfirmForget(false)}>cancelar</button></>
                  : <button onClick={() => setConfirmForget(true)}>esquecer</button>)}
              </div>
            )}
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
          <button className={ui.follow ? "on" : ""} onClick={() => { E.current.follow = !E.current.follow; E.current.dirty = true; }} title="A cada recall a câmera vai até o núcleo mais usado; desliga quando você mexe no chip">seguir a IA {ui.follow ? "on" : "off"}</button>
        </div>
      </div>
    </div>
  );
}

export type { ChipSource };
