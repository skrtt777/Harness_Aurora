// The MemoryChip's shape (MemoryChip.tsx draws it): the memory as a silicon die. Each category — a node of the
// Zeladora, or a k-means group — is a nucleus of banks of 60 cells; each memory is one cell, in the slot it was
// written to; copper buses join every nucleus to the inference core in the middle. Also the event contract every
// source speaks (auroraChipSource, mockChipSource), the fragments, bits and strength of a memory, and the six zoom
// levels. Pure (no DOM): tested in frontend/test/chip.test.mjs.

// ---------- the contract: what a source gives (snapshot) and emits (events) ----------
export type ChipLink = { id: string; score: number; kind: "similar" | "relation" };
export type ChipMemory = {
  id: string; text: string; snippet: string | null; category: string; createdAt: number;
  uses: number; lastUsedAt: number | null; links: ChipLink[];
  /** The signs of the first values of its real embedding, as hex (null: no embedding — bits come from the text's hash). */
  sig: string | null; sensitive: boolean; entities: string[];
  /** When it was forgotten (archived): it lives in the ARQUIVO nucleus from then on (restoring brings it back). */
  archivedAt?: number | null;
};
export type ChipCategory = { id: string; label: string };
/** An answer that used or wrote memory: what was asked, what it used (in order) and wrote; scores when measured live. */
export type ChipRecall = { id: string; at: number; query: string; used: string[]; created: string[]; scores?: Record<string, number>; scanned?: { id: string; score: number }[] };
export type ChipSnapshot = {
  memories: ChipMemory[]; categories: ChipCategory[]; recallsToday: number;
  /** The answers that used memory, newest first (the timeline and the replays go through them). */
  history?: ChipRecall[];
  /** How many archived memories there are in all (the ARQUIVO nucleus shows the newest). */
  forgottenTotal?: number;
};
/** The nucleus that holds what was forgotten (archived memories). */
export const ARCHIVE = "__arquivo";
export type ChipEvent =
  | { type: "memory.created"; memory: ChipMemory }
  | { type: "memory.updated"; id: string; text?: string; category?: string; mergedFrom?: string[] }
  /** archived: it goes to the ARQUIVO nucleus (it can be restored); otherwise it is gone for good. */
  | { type: "memory.deleted"; id: string; reason: "user" | "decay" | "merge"; archived?: boolean }
  /** replay: a past answer played again (it changes no counter). */
  | { type: "recall.started"; requestId: string; query: string; replay?: boolean }
  /** Every candidate the search scored (a faint glow); recalled ones go into the answer's context. */
  | { type: "memory.scanned"; requestId: string; id: string; score: number }
  | { type: "memory.recalled"; requestId: string; id: string; score: number; rank: number; chunk?: string }
  | { type: "recall.finished"; requestId: string; usedIds: string[] }
  | { type: "response.done"; requestId: string; tokensUsed?: number; memoriesUsed: string[]; created?: string[]; replay?: boolean }
  /** The Zeladora (the memory's keeper) reading a memory. */
  | { type: "keeper.read"; id: string }
  /** The whole state again (after a reconnection, or when a new memory needs its nucleus and fingerprint). */
  | { type: "snapshot"; snapshot: ChipSnapshot; quiet?: boolean };
export interface ChipSource {
  /** "ao vivo" or "simulação": shown on the chip. */
  label: string;
  mock: boolean;
  snapshot(): Promise<ChipSnapshot>;
  subscribe(onEvent: (e: ChipEvent) => void, onState?: (live: boolean) => void): () => void;
  actions?: { edit?: (id: string, text: string) => Promise<void>; forget?: (id: string) => Promise<void>; restore?: (id: string) => Promise<void> };
  /** The real cosine of two memories' embeddings (null when one has none). */
  similarity?: (a: string, b: string) => Promise<number | null>;
  /** Send the whole state again now (a "snapshot" event, quiet): the view around the chip changed. */
  resync?: () => void;
}

// ---------- colours ----------
export const GOLD = "#E2B85C", COPPER = "#B8743E", SILICON = "#07130F", GRID = "#2F5A49";
export const CATEGORY_COLORS = ["#FF5FA8", "#45D6FF", "#FFD24A", "#FF8A3D", "#A889FF", "#8DFF6A", "#5CF2C8", "#FF6B6B", "#6B8CFF", "#F2F26B", "#FF9AE6", "#9AD0FF"];
export const categoryColor = (i: number) => CATEGORY_COLORS[((i % CATEGORY_COLORS.length) + CATEGORY_COLORS.length) % CATEGORY_COLORS.length];

// ---------- geometry (world units; 1× shows the whole die) ----------
export const CELL_W = 24, CELL_H = 9, GAP_X = 3, GAP_Y = 3;
export const BANK_COLS = 6, BANK_ROWS = 10, BANK = BANK_COLS * BANK_ROWS;
export const BANK_W = BANK_COLS * CELL_W + (BANK_COLS - 1) * GAP_X, BANK_H = BANK_ROWS * CELL_H + (BANK_ROWS - 1) * GAP_Y;
const PAD = 10, HEAD = 20, BANK_GAP = 12, GAP = 46, CORE = 132;

export type Rect = { x: number; y: number; w: number; h: number };
export type Nucleus = Rect & {
  id: string; label: string; index: number; color: string; banks: number; bankCols: number;
  /** The memory in each slot (null: empty — forgotten this session). */
  slots: (string | null)[];
  /** Where its bus leaves it, and the path to the core's pin. */
  bus: [number, number][];
};
export type ChipLayout = {
  nuclei: Nucleus[]; core: Rect; bounds: { x0: number; y0: number; x1: number; y1: number };
  cell: Map<string, { n: number; slot: number } & Rect>;
};

/**
 * The slots, kept from one update to the next: a memory keeps its slot; a new one takes the next slot of its
 * nucleus (holes left by forgotten memories stay empty until the chip is rebuilt from scratch). Memories in
 * order of creation, so a fresh build is the same in every session.
 */
export function assignSlots(prev: Map<string, (string | null)[]> | null, categories: ChipCategory[], memories: Pick<ChipMemory, "id" | "category" | "createdAt">[]): Map<string, (string | null)[]> {
  const next = new Map<string, (string | null)[]>();
  for (const c of categories) next.set(c.id, [...(prev?.get(c.id) || [])]);
  const want = new Map(memories.map((m) => [m.id, next.has(m.category) ? m.category : categories[0]?.id]));
  // Out: memories gone, or moved to another nucleus.
  for (const [cat, slots] of next) slots.forEach((id, i) => { if (id && want.get(id) !== cat) slots[i] = null; });
  const placed = new Set<string>();
  for (const slots of next.values()) for (const id of slots) if (id) placed.add(id);
  // In: in order of creation, at the end of their nucleus.
  for (const m of [...memories].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))) {
    const cat = want.get(m.id);
    if (!cat || placed.has(m.id)) continue;
    next.get(cat)!.push(m.id); placed.add(m.id);
  }
  return next;
}

/** Banks of 60 cells, side by side (at most 3 a row): a nucleus with 61 memories has two. */
function nucleusSize(n: number) {
  const banks = Math.max(1, Math.ceil(n / BANK)), cols = Math.min(3, banks), rows = Math.ceil(banks / cols);
  return { banks, cols, w: PAD * 2 + cols * BANK_W + (cols - 1) * BANK_GAP, h: HEAD + PAD * 2 + rows * BANK_H + (rows - 1) * BANK_GAP };
}

/** Where slot `s` of a nucleus is. */
export function slotRect(n: Pick<Nucleus, "x" | "y" | "bankCols">, s: number): Rect {
  const b = Math.floor(s / BANK), r = s % BANK;
  const bx = n.x + PAD + (b % n.bankCols) * (BANK_W + BANK_GAP), by = n.y + HEAD + PAD + Math.floor(b / n.bankCols) * (BANK_H + BANK_GAP);
  return { x: bx + (r % BANK_COLS) * (CELL_W + GAP_X), y: by + Math.floor(r / BANK_COLS) * (CELL_H + GAP_Y), w: CELL_W, h: CELL_H };
}

/**
 * The die: nuclei packed in rows (largest first), the inference core in the middle of the middle row, a copper
 * bus from each nucleus to a pin on the core's side that faces it (Manhattan routes, under the blocks, like a
 * metal layer).
 */
export function layoutChip(categories: ChipCategory[], slots: Map<string, (string | null)[]>): ChipLayout {
  const items = categories.map((c, index) => ({ c, index, ...nucleusSize(slots.get(c.id)?.length || 0) }))
    .sort((a, b) => b.h - a.h || b.w - a.w || a.index - b.index);
  const area = items.reduce((s, it) => s + (it.w + GAP) * (it.h + GAP), (CORE + GAP) ** 2);
  const target = Math.max(BANK_W * 2.2, Math.sqrt(area * 1.75));
  const rows: (typeof items[number] | "core")[][] = [[]];
  let width = 0;
  for (const it of items) {
    if (width > 0 && width + it.w > target) { rows.push([]); width = 0; }
    rows[rows.length - 1].push(it); width += it.w + GAP;
  }
  const mid = Math.floor((rows.length - 1) / 2);
  rows[mid].splice(Math.ceil(rows[mid].length / 2), 0, "core");
  const nuclei: Nucleus[] = [];
  let core: Rect = { x: -CORE / 2, y: -CORE / 2, w: CORE, h: CORE };
  let y = 0;
  const rowBoxes: { y: number; h: number }[] = [];
  for (const row of rows) {
    const h = Math.max(...row.map((it) => (it === "core" ? CORE : it.h)));
    const w = row.reduce((s, it) => s + (it === "core" ? CORE : it.w), 0) + GAP * (row.length - 1);
    let x = -w / 2;
    for (const it of row) {
      if (it === "core") { core = { x, y: y + (h - CORE) / 2, w: CORE, h: CORE }; x += CORE + GAP; continue; }
      nuclei.push({ id: it.c.id, label: it.c.label, index: it.index, color: it.c.id === ARCHIVE ? "#ff8a7a" : categoryColor(it.index), x, y: y + (h - it.h) / 2, w: it.w, h: it.h, banks: it.banks, bankCols: it.cols, slots: slots.get(it.c.id) || [], bus: [] });
      x += it.w + GAP;
    }
    rowBoxes.push({ y, h }); y += h + GAP;
  }
  // Centre the die on the core.
  const cx = core.x + CORE / 2, cy = core.y + CORE / 2;
  core = { ...core, x: core.x - cx, y: core.y - cy };
  for (const n of nuclei) { n.x -= cx; n.y -= cy; }
  // Buses: by the side of the core each nucleus faces; pins spread along that side.
  const side = (n: Nucleus) => {
    const ncx = n.x + n.w / 2, ncy = n.y + n.h / 2;
    if (n.y + n.h < core.y) return "top"; if (n.y > core.y + core.h) return "bottom";
    return ncx < 0 ? "left" : "right";
  };
  for (const s of ["top", "bottom", "left", "right"] as const) {
    const group = nuclei.filter((n) => side(n) === s).sort((a, b) => (s === "top" || s === "bottom" ? a.x - b.x : a.y - b.y));
    group.forEach((n, i) => {
      const t = (i + 1) / (group.length + 1);
      if (s === "left" || s === "right") {
        const px = s === "left" ? n.x + n.w : n.x, py = n.y + n.h / 2;
        const pinX = s === "left" ? core.x : core.x + core.w, pinY = core.y + core.h * t;
        const midX = s === "left" ? core.x - 14 - i * 5 : core.x + core.w + 14 + i * 5;
        n.bus = [[px, py], [midX, py], [midX, pinY], [pinX, pinY]];
      } else {
        const px = n.x + n.w / 2, py = s === "top" ? n.y + n.h : n.y;
        const pinX = core.x + core.w * t, pinY = s === "top" ? core.y : core.y + core.h;
        const midY = s === "top" ? core.y - 14 - i * 5 : core.y + core.h + 14 + i * 5;
        n.bus = [[px, py], [px, midY], [pinX, midY], [pinX, pinY]];
      }
    });
  }
  const cell = new Map<string, { n: number; slot: number } & Rect>();
  nuclei.forEach((n, ni) => n.slots.forEach((id, s) => { if (id) cell.set(id, { n: ni, slot: s, ...slotRect(n, s) }); }));
  let x0 = core.x, y0 = core.y, x1 = core.x + core.w, y1 = core.y + core.h;
  for (const n of nuclei) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h); }
  return { nuclei, core, bounds: { x0: x0 - 30, y0: y0 - 30, x1: x1 + 30, y1: y1 + 30 }, cell };
}

/** A path along a polyline: the point at fraction t of its length. */
export function along(pts: [number, number][], t: number): [number, number] {
  const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  let d = Math.max(0, Math.min(1, t)) * lens.reduce((s, l) => s + l, 0);
  for (let i = 0; i < lens.length; i += 1) {
    if (d <= lens[i] || i === lens.length - 1) { const u = lens[i] ? Math.min(1, d / lens[i]) : 0; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u]; }
    d -= lens[i];
  }
  return pts[pts.length - 1];
}

// ---------- what a memory is made of ----------
const STOP = new Set(("a o as os um uma uns umas de do da dos das em no na nos nas por pelo pela pelos pelas para pra com sem sob sobre entre ate até " +
  "e ou mas que se como quando onde porque pois isso isto esse essa este esta esses essas estes estas aquele aquela ele ela eles elas eu tu voce você " +
  "nos vos lhe lhes meu minha seu sua seus suas nosso nossa ja já nao não sim mais menos muito muita muitos muitas tambem também so só ainda sempre nunca " +
  "ser estar ter haver foi era sao são tem têm está estão pode podem deve devem fazer feito vai vão ao aos à às num numa the and for with from this that " +
  "uso usar usa usado usada sobre cada todo toda todos todas quer qual quais").split(/\s+/));
const fold = (w: string) => w.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** The fragments of a memory: its tags, then the words that weigh most in its text (no stop words). */
export function fragmentsOf(m: { text: string; snippet: string | null; tags?: string[] }, max = 5): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (w: string) => { const k = fold(w); if (!k || seen.has(k) || out.length >= max) return; seen.add(k); out.push(w); };
  for (const t of m.tags || []) add(t.trim());
  const words = `${m.text} ${m.text} ${m.snippet || ""}`.split(/[^\p{L}\p{N}_+#.-]+/u).map((w) => w.replace(/^[.-]+|[.-]+$/g, "")).filter((w) => w.length >= 4 && !STOP.has(fold(w)) && !/^\d+$/.test(w));
  const count = new Map<string, { w: string; n: number; first: number }>();
  words.forEach((w, i) => { const k = fold(w); const c = count.get(k); if (c) c.n += 1; else count.set(k, { w, n: 1, first: i }); });
  [...count.values()].sort((a, b) => b.n - a.n || b.w.length - a.w.length || a.first - b.first).forEach((c) => add(c.w));
  return out;
}

/** The bits shown at level 4 and the charges at level 6: the signature's, or (no embedding) the text's hash. */
export const BITS = 192;
export function bitsOf(sig: string | null, text: string): Uint8Array {
  const bits = new Uint8Array(BITS);
  if (sig && /^[0-9a-f]+$/i.test(sig)) {
    for (let i = 0; i < BITS; i += 1) { const nib = parseInt(sig[i >> 2] || "0", 16); bits[i] = (nib >> (3 - (i & 3))) & 1; }
    return bits;
  }
  let h = 2166136261;
  for (let i = 0; i < BITS; i += 1) {
    if (i % 32 === 0) for (let j = 0; j < text.length; j += 1) { h ^= text.charCodeAt(j) + i; h = Math.imul(h, 16777619); }
    bits[i] = (h >>> (i % 32)) & 1;
  }
  return bits;
}

/** How alive a memory is: real uses, and how recently it was used (exponential decay, two weeks' half-life). */
export function strengthOf(m: Pick<ChipMemory, "uses" | "lastUsedAt" | "createdAt">, now = Date.now()): number {
  const since = Math.max(0, now - (m.lastUsedAt ?? m.createdAt)) / 86_400_000;
  const recency = Math.pow(0.5, since / 14);
  return Math.min(1, 0.2 + 0.45 * recency + 0.35 * (1 - Math.exp(-m.uses / 4)));
}

/** The part of the text around a fragment (what is "read" at level 4). */
export function chunkAround(text: string, fragment: string, size = 90): string {
  const i = fold(text).indexOf(fold(fragment));
  if (i < 0) return text.slice(0, size);
  const a = Math.max(0, i - Math.floor(size / 3));
  return `${a > 0 ? "…" : ""}${text.slice(a, a + size)}${a + size < text.length ? "…" : ""}`;
}

// ---------- the six levels (zoom relative to the whole die) ----------
export const ZOOM_MIN = 0.6, ZOOM_MAX = 1200;
export const LEVELS = [
  { name: "CHIP", from: 0, to: 2.4, say: "Cada núcleo é um grupo de memórias; os fios de cobre levam o que é lembrado ao núcleo de inferência." },
  { name: "NÚCLEO", from: 2.4, to: 8, say: "Cada célula é uma memória gravada; ela acende quando é lembrada numa resposta." },
  { name: "MEMÓRIA", from: 8, to: 32, say: "A memória em foco e os fragmentos de que ela é feita: etiquetas e as palavras que mais pesam." },
  { name: "LEITURA", from: 32, to: 120, say: "As trilhas ligam cada fragmento aos bits do embedding; a corrente mostra o que está sendo lido." },
  { name: "ASSOCIAÇÕES", from: 120, to: 420, say: "A memória e as vizinhas mais parecidas em sentido, com a similaridade de cada uma." },
  { name: "GRAVAÇÃO", from: 420, to: Infinity, say: "O cristal: cada átomo carregado é uma dimensão positiva do embedding desta memória." },
] as const;
export const levelAt = (z: number) => { let i = 0; while (i < LEVELS.length - 1 && z >= LEVELS[i].to) i += 1; return i; };
/** How visible level i is at zoom z: 1 inside its band, a smooth crossfade (in log scale) at its edges. */
export function layerAlpha(z: number, i: number, half = 0.07): number {
  const lz = Math.log10(Math.max(1e-6, z)), L = LEVELS[i];
  const s = (e: number) => (e <= 0 ? 0 : e >= 1 ? 1 : e * e * (3 - 2 * e));
  const lo = L.from > 0 ? s((lz - Math.log10(L.from) + half) / (2 * half)) : 1;
  const hi = Number.isFinite(L.to) ? s((Math.log10(L.to) + half - lz) / (2 * half)) : 1;
  return lo * hi;
}

// ---------- time, heat, comparison ----------
/** A memory at moment t of the timeline: not written yet, alive, or already forgotten. */
export function lifeAt(m: Pick<ChipMemory, "createdAt" | "archivedAt">, t: number | null): "unborn" | "alive" | "fossil" {
  const archived = m.archivedAt ?? null;
  if (t === null) return archived !== null ? "fossil" : "alive";
  if (m.createdAt > t) return "unborn";
  return archived !== null && archived <= t ? "fossil" : "alive";
}

/** How hot a memory is (0–1): its real uses and how recently it was used, half and half. */
export function heatOf(m: Pick<ChipMemory, "uses" | "lastUsedAt" | "createdAt">, now = Date.now()): number {
  const since = Math.max(0, now - (m.lastUsedAt ?? m.createdAt)) / 86_400_000;
  return Math.min(1, 0.5 * (1 - Math.exp(-m.uses / 4)) + 0.5 * (m.lastUsedAt ? Math.pow(0.5, since / 14) : 0));
}
/** The heat scale: cold silicon → copper → gold → white hot. */
export function heatColor(h: number): string {
  const stops: [number, [number, number, number]][] = [[0, [16, 40, 32]], [0.35, [184, 116, 62]], [0.7, [226, 184, 92]], [1, [255, 246, 214]]];
  let i = 0; while (i < stops.length - 2 && h > stops[i + 1][0]) i += 1;
  const [a, ca] = stops[i], [b, cb] = stops[i + 1], u = Math.max(0, Math.min(1, (h - a) / (b - a)));
  return `#${ca.map((x, k) => Math.round(x + (cb[k] - x) * u).toString(16).padStart(2, "0")).join("")}`;
}

/** Two memories' bits side by side: where their embeddings' signs agree, and the share that agrees. */
export function compareBits(a: Uint8Array, b: Uint8Array): { agree: Uint8Array; share: number } {
  const agree = new Uint8Array(Math.min(a.length, b.length));
  let n = 0;
  for (let i = 0; i < agree.length; i += 1) { agree[i] = a[i] === b[i] ? 1 : 0; n += agree[i]; }
  return { agree, share: agree.length ? n / agree.length : 0 };
}

/** The births per bucket over [t0, t1] (the timeline's histogram), and where answers and forgettings fall. */
export function timelineBuckets(memories: Pick<ChipMemory, "createdAt" | "archivedAt">[], history: Pick<ChipRecall, "at">[], t0: number, t1: number, n = 120) {
  const born = new Array(n).fill(0), gone = new Array(n).fill(0), asked = new Array(n).fill(0);
  const at = (t: number) => Math.max(0, Math.min(n - 1, Math.floor(((t - t0) / Math.max(1, t1 - t0)) * n)));
  for (const m of memories) { born[at(m.createdAt)] += 1; if (m.archivedAt) gone[at(m.archivedAt)] += 1; }
  for (const r of history) asked[at(r.at)] += 1;
  return { born, gone, asked };
}
