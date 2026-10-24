// The MemoryChip's sources (chip.ts has the contract): the Aurora's real memory, and a simulation that speaks the
// same events (to see the chip work without a backend or a model running).
import { getMemoryGraph, getMemorySimilarity, setMemoryStatus, subscribeMemoryEvents, updateMemory, type MemoryGraphSnapshot, type MemoryLiveEvent } from "../api";
import { buildMemoryGraph, type Filters, type MemoryGraph, type ViewMode } from "./adapter";
import { ARCHIVE, bitsOf, compareBits, fragmentsOf, type ChipEvent, type ChipLink, type ChipMemory, type ChipRecall, type ChipSnapshot, type ChipSource } from "./chip";

/** How many forgotten memories the ARQUIVO nucleus shows (the newest; the rest are counted). */
export const ARCHIVE_SHOWN = 180;

const day = (t: number) => new Date(t).toDateString();

/** The nuclei in the order every part of the Mapa Vivo shows them (biggest first): their colours follow it. */
export function clusterOrder(graph: Pick<MemoryGraph, "clusters">) {
  return [...graph.clusters].sort((a, b) => b.nodeIds.length - a.nodeIds.length || (a.id < b.id ? -1 : 1));
}

/**
 * The Aurora's snapshot as the chip's, for the Mapa Vivo's mode and filters: the nuclei are its groups (the
 * Zeladora's nodes in "visão geral", folders or conversations in the other modes), the memories the ones the
 * filters let through.
 */
export function toChipSnapshot(s: MemoryGraphSnapshot, view: { mode: ViewMode; filters: Filters } = { mode: "geral", filters: {} }, now = Date.now()): ChipSnapshot {
  const graph = buildMemoryGraph(s, { mode: view.mode, filters: view.filters, now });
  const point = new Map((s.atlas?.points || []).map((p) => [p.id, p]));
  const lastUsed = new Map<string, number>();
  for (const r of s.recalls) for (const id of r.used) lastUsed.set(id, Math.max(lastUsed.get(id) || 0, Date.parse(r.at)));
  const visible = new Set(graph.nodes.map((n) => n.id));
  const relations = new Map<string, ChipLink[]>();
  for (const r of s.relations) for (const [a, b] of [[r.from, r.to], [r.to, r.from]]) {
    const list = relations.get(a) || []; list.push({ id: b, score: 1, kind: "relation" }); relations.set(a, list);
  }
  const memories: ChipMemory[] = graph.nodes.map(({ memory: m, clusterId }) => {
    const p = point.get(m.id);
    const links = [...(p?.neighbors || []).map((n) => ({ id: n.id, score: n.similarity, kind: "similar" as const, ...(n.across ? { across: true } : {}) })), ...(relations.get(m.id) || [])]
      .filter((l, i, all) => visible.has(l.id) && all.findIndex((x) => x.id === l.id) === i).slice(0, 5);
    return {
      id: m.id, category: clusterId, createdAt: Date.parse(m.createdAt) || 0, uses: m.uses, lastUsedAt: lastUsed.get(m.id) ?? null, links,
      // A sensitive memory keeps its place and shows nothing of itself.
      text: m.sensitive ? "memória privada" : m.title, snippet: m.sensitive ? null : m.snippet,
      sig: m.sensitive ? null : p?.sig ?? null, sensitive: m.sensitive,
      entities: m.sensitive ? [] : fragmentsOf({ text: m.title, snippet: m.snippet, tags: m.tags }),
    };
  });
  // What was forgotten (archived), newest first: the ARQUIVO nucleus, each alive from its birth to its archiving.
  const forgotten = (s.forgotten || []).slice(0, ARCHIVE_SHOWN).map((f): ChipMemory => ({
    id: f.id, category: ARCHIVE, createdAt: Date.parse(f.createdAt) || 0, archivedAt: Date.parse(f.archivedAt) || 0, uses: 0, lastUsedAt: lastUsed.get(f.id) ?? null, links: [],
    text: f.title, snippet: null, sig: null, sensitive: f.title === "memória privada", entities: f.title === "memória privada" ? [] : fragmentsOf({ text: f.title, snippet: null }),
  }));
  const history: ChipRecall[] = s.recalls.map((r) => ({ id: r.id, at: Date.parse(r.at) || 0, query: r.prompt || r.conversationTitle, used: r.used, created: r.created }));
  return {
    memories: [...memories, ...forgotten],
    categories: [...clusterOrder(graph).map((c) => ({ id: c.id, label: c.label })), ...(forgotten.length ? [{ id: ARCHIVE, label: "arquivo · esquecidas" }] : [])],
    recallsToday: s.recalls.filter((r) => day(Date.parse(r.at)) === day(now)).length,
    history, forgottenTotal: s.forgotten?.length || 0,
  };
}

/**
 * The real memory: the snapshot from /api/memories/graph, the events from /api/memories/live, translated.
 *   created → a new snapshot (it brings the memory with its nucleus, neighbours and fingerprint) → memory.created;
 *   updated → memory.updated; the Zeladora's join / compact → memory.updated (mergedFrom) + memory.deleted (merge);
 *   her prune → memory.deleted (decay); archived / deleted otherwise → memory.deleted (user);
 *   turn-start → recall.started; scanned → memory.scanned; recalled → memory.recalled (by rank) + recall.finished;
 *   answered → response.done; her read → keeper.read. A reconnection brings a whole snapshot (reconciliation).
 */
export function auroraChipSource(opts: { load?: () => Promise<MemoryGraphSnapshot>; view?: () => { mode: ViewMode; filters: Filters } } = {}): ChipSource {
  const load = opts.load || getMemoryGraph;
  const shape = (s: MemoryGraphSnapshot) => toChipSnapshot(s, opts.view?.());
  let resync: (() => void) | null = null;
  return {
    label: "ao vivo", mock: false,
    snapshot: () => load().then(shape),
    // The mode or the filters changed: the whole state again, with no "written" animations.
    resync: () => resync?.(),
    actions: {
      edit: async (id, text) => { await updateMemory(id, { title: text }); },
      forget: async (id) => { await setMemoryStatus(id, "archived"); },
      restore: async (id) => { await setMemoryStatus(id, "active"); },
    },
    similarity: (a, b) => getMemorySimilarity(a, b).then((r) => r.similarity),
    subscribe(onEvent, onState) {
      let request = "", scores = new Map<string, number>(), wasLive = true;
      const gone = new Set<string>();
      let timer: ReturnType<typeof setTimeout> | null = null;
      const refresh = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { load().then((s) => onEvent({ type: "snapshot", snapshot: shape(s) })).catch(() => {}); }, 700);
      };
      resync = () => { load().then((s) => onEvent({ type: "snapshot", snapshot: shape(s), quiet: true })).catch(() => {}); };
      const forget = (id: string | undefined, reason: "user" | "decay" | "merge", archived = true) => { if (!id || gone.has(id)) return; gone.add(id); onEvent({ type: "memory.deleted", id, reason, archived }); };
      const on = (e: MemoryLiveEvent) => {
        switch (e.type) {
          case "created": refresh(); break;
          case "updated": if (e.id) onEvent({ type: "memory.updated", id: e.id, text: e.title }); break;
          case "restored": if (e.id) gone.delete(e.id); refresh(); break;
          // Who archived it is told by the Zeladora's event, which may come just after: wait a moment.
          case "archived": case "deleted": { const id = e.id, archived = e.type === "archived"; setTimeout(() => forget(id, "user", archived), 400); break; }
          case "turn-start": request = `r${e.seq ?? e.at}`; scores = new Map(); onEvent({ type: "recall.started", requestId: request, query: e.message || "" }); break;
          case "scanned": {
            const c = e.candidates || [];
            const top = Math.max(1e-6, ...c.map((x) => x.similarity ?? x.score));
            for (const x of c) { const s = Math.max(0, Math.min(1, (x.similarity ?? x.score) / (x.similarity == null ? top : 1))); scores.set(x.id, s); onEvent({ type: "memory.scanned", requestId: request, id: x.id, score: s }); }
            break;
          }
          case "recalled": {
            const ids = e.ids || [];
            ids.forEach((id, rank) => onEvent({ type: "memory.recalled", requestId: request, id, score: scores.get(id) ?? 0.5, rank }));
            onEvent({ type: "recall.finished", requestId: request, usedIds: ids });
            break;
          }
          case "answered": onEvent({ type: "response.done", requestId: request, memoriesUsed: e.used || [], created: e.created || [] }); if (e.created?.length) refresh(); break;
          case "keeper":
            if (e.action === "read" && e.id) onEvent({ type: "keeper.read", id: e.id });
            else if (e.action === "join" && e.kept && e.archived) { onEvent({ type: "memory.updated", id: e.kept, mergedFrom: [e.archived] }); forget(e.archived, "merge"); }
            else if (e.action === "compact" && e.id && e.merged?.length) { onEvent({ type: "memory.updated", id: e.id, mergedFrom: e.merged }); e.merged.forEach((m) => forget(m, "merge")); }
            else if (e.action === "prune" && e.id) forget(e.id, "decay");
            break;
          default: break;
        }
      };
      const stop = subscribeMemoryEvents(on, (live) => {
        onState?.(live);
        // Back after a fall: whatever happened meanwhile comes in a whole snapshot.
        if (live && !wasLive) refresh();
        wasLive = live;
      });
      return () => { stop(); resync = null; if (timer) clearTimeout(timer); };
    },
  };
}

// ---------- the simulation ----------
const MOCK_CATS = [
  { id: "m0", label: "preferências", words: ["café sem açúcar", "tema escuro", "respostas curtas", "música lo-fi", "reuniões de manhã", "atalhos de teclado"] },
  { id: "m1", label: "projetos", words: ["app de vendas", "painel de BI", "migração do banco", "site da loja", "API de pagamentos", "relatório mensal"] },
  { id: "m2", label: "pessoas", words: ["Ana do financeiro", "cliente Marcos", "time de suporte", "fornecedor de peças", "sócio Paulo", "contador"] },
  { id: "m3", label: "código", words: ["React com Vite", "SQLite com WAL", "testes com node:test", "deploy no Windows", "Python isolado", "regex de CPF"] },
  { id: "m4", label: "agenda", words: ["fechamento dia 5", "backup semanal", "revisão às sextas", "férias em janeiro", "pagamento dia 10", "auditoria trimestral"] },
  { id: "m5", label: "regras", words: ["nunca apagar arquivos", "confirmar antes de enviar", "planilhas em xlsx", "valores em reais", "datas dd/mm/aaaa", "sem dados sensíveis"] },
];
const VERBS = ["prefere", "usa", "decidiu", "lembrar de", "evitar", "combinou"];
let mockSeq = 0;
const rnd = (seed: number) => { let s = seed >>> 0; return () => { s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return s / 4294967296; }; };
function mockMemory(r: () => number, at: number, cat?: number): ChipMemory {
  const c = cat ?? Math.floor(r() * MOCK_CATS.length), C = MOCK_CATS[c];
  const w = C.words[Math.floor(r() * C.words.length)], v = VERBS[Math.floor(r() * VERBS.length)];
  const text = `${v[0].toUpperCase()}${v.slice(1)} ${w}`;
  const snippet = `${text}: anotado numa conversa sobre ${C.label}; vale para ${C.words[Math.floor(r() * C.words.length)]} também.`;
  let sig = ""; for (let i = 0; i < 48; i += 1) sig += Math.floor(r() * 16).toString(16);
  mockSeq += 1;
  return { id: `mock-${mockSeq}`, text, snippet, category: C.id, createdAt: at, uses: Math.floor(r() * r() * 12), lastUsedAt: r() < 0.6 ? at + r() * 5e8 : null, links: [], sig, sensitive: r() < 0.03, entities: [] };
}

/** A simulation: ~240 memories in six nuclei, then a stream of the same events the real memory emits. */
export function mockChipSource(count = 240): ChipSource {
  const r = rnd(7);
  const t0 = Date.now() - 90 * 86_400_000;
  const memories = Array.from({ length: count }, (_, i) => mockMemory(r, t0 + i * 3e7));
  const fix = (m: ChipMemory, all: ChipMemory[]) => {
    if (m.sensitive) { m.text = "memória privada"; m.snippet = null; m.sig = null; }
    m.entities = m.sensitive ? [] : fragmentsOf(m);
    const same = all.filter((x) => x.id !== m.id && x.category === m.category);
    m.links = Array.from({ length: Math.min(same.length, 2 + Math.floor(r() * 3)) }, () => same[Math.floor(r() * same.length)])
      .filter((x, i, a) => a.indexOf(x) === i).map((x) => ({ id: x.id, score: Math.round((0.72 + r() * 0.25) * 100) / 100, kind: "similar" as const }));
  };
  memories.forEach((m) => fix(m, memories));
  const live = [...memories];
  const archived: ChipMemory[] = Array.from({ length: 14 }, (_, i) => { const m = mockMemory(r, t0 + i * 4e8); fix(m, memories); return { ...m, category: ARCHIVE, archivedAt: m.createdAt + (2 + r() * 20) * 86_400_000, links: [] }; });
  const history: ChipRecall[] = Array.from({ length: 24 }, (_, i) => {
    const used = Array.from({ length: 2 + Math.floor(r() * 3) }, () => live[Math.floor(r() * live.length)].id);
    return { id: `h${i}`, at: Date.now() - (24 - i) * 3.4 * 86_400_000, query: `Pergunta simulada ${i + 1}`, used, created: [], scores: Object.fromEntries(used.map((u) => [u, Math.round((0.5 + r() * 0.45) * 100) / 100])) };
  }).reverse();
  return {
    label: "simulação", mock: true,
    snapshot: async () => ({
      memories: [...live, ...archived].map((m) => ({ ...m })), categories: [...MOCK_CATS.map(({ id, label }) => ({ id, label })), { id: ARCHIVE, label: "arquivo · esquecidas" }],
      recallsToday: 3, history, forgottenTotal: archived.length,
    }),
    actions: {
      edit: async (id, text) => { const m = live.find((x) => x.id === id); if (m) m.text = text; },
      forget: async (id) => { const i = live.findIndex((x) => x.id === id); if (i >= 0) { const [m] = live.splice(i, 1); archived.unshift({ ...m, category: ARCHIVE, archivedAt: Date.now() }); } },
      restore: async (id) => { const i = archived.findIndex((x) => x.id === id); if (i >= 0) { const [m] = archived.splice(i, 1); live.push({ ...m, category: MOCK_CATS[0].id, archivedAt: null }); } },
    },
    // In the simulation there are no embeddings: the angle its random fingerprints would give (labelled simulação).
    similarity: async (a, b) => {
      const A = [...live, ...archived].find((m) => m.id === a), B = [...live, ...archived].find((m) => m.id === b);
      if (!A?.sig || !B?.sig) return null;
      return Math.round(Math.cos(Math.PI * (1 - compareBits(bitsOf(A.sig, ""), bitsOf(B.sig, "")).share)) * 1000) / 1000;
    },
    subscribe(onEvent, onState) {
      const timers: ReturnType<typeof setTimeout>[] = [];
      let req = 0, stopped = false;
      const later = (ms: number, f: () => void) => { timers.push(setTimeout(() => { if (!stopped) f(); }, ms)); };
      onState?.(true);
      const recall = () => {
        if (!live.length) return;
        const id = `q${++req}`;
        const pick = Array.from({ length: 12 }, () => live[Math.floor(r() * live.length)]).filter((x, i, a) => a.indexOf(x) === i);
        const topic = pick[0].entities[0] || pick[0].text;
        onEvent({ type: "recall.started", requestId: id, query: `O que eu tinha decidido sobre ${topic}?` });
        const scored = pick.map((m) => ({ m, s: Math.round((0.35 + r() * 0.6) * 100) / 100 })).sort((a, b) => b.s - a.s);
        later(500, () => scored.forEach(({ m, s }) => onEvent({ type: "memory.scanned", requestId: id, id: m.id, score: s })));
        const used = scored.slice(0, 3 + Math.floor(r() * 3));
        later(1300, () => {
          used.forEach(({ m, s }, rank) => onEvent({ type: "memory.recalled", requestId: id, id: m.id, score: s, rank, chunk: m.snippet || undefined }));
          onEvent({ type: "recall.finished", requestId: id, usedIds: used.map((u) => u.m.id) });
        });
        later(4200, () => { used.forEach(({ m }) => { m.uses += 1; m.lastUsedAt = Date.now(); }); onEvent({ type: "response.done", requestId: id, tokensUsed: 400 + Math.floor(r() * 900), memoriesUsed: used.map((u) => u.m.id) }); });
      };
      const tick = () => {
        const x = r();
        if (x < 0.4) recall();
        else if (x < 0.65) { const m = mockMemory(r, Date.now()); fix(m, live); live.push(m); onEvent({ type: "memory.created", memory: { ...m } }); }
        else if (x < 0.75 && live.length) { const m = live[Math.floor(r() * live.length)]; if (!m.sensitive) { m.text = `${m.text} (revisado)`.replace(/( \(revisado\))+/, " (revisado)"); onEvent({ type: "memory.updated", id: m.id, text: m.text }); } }
        else if (x < 0.83 && live.length > 20) { const i = Math.floor(r() * live.length); const [m] = live.splice(i, 1); archived.unshift({ ...m, category: ARCHIVE, archivedAt: Date.now() }); onEvent({ type: "memory.deleted", id: m.id, reason: r() < 0.5 ? "decay" : "user", archived: true }); }
        else if (x < 0.9 && live.length > 20) {
          const a = live[Math.floor(r() * live.length)], b = live.find((m) => m.category === a.category && m.id !== a.id);
          if (b) { live.splice(live.indexOf(b), 1); archived.unshift({ ...b, category: ARCHIVE, archivedAt: Date.now() }); onEvent({ type: "memory.updated", id: a.id, mergedFrom: [b.id] }); onEvent({ type: "memory.deleted", id: b.id, reason: "merge", archived: true }); }
        } else if (live.length) for (let k = 0; k < 4; k += 1) later(k * 700, () => onEvent({ type: "keeper.read", id: live[Math.floor(r() * live.length)].id }));
        later(2600 + r() * 2600, tick);
      };
      later(1500, tick);
      return () => { stopped = true; timers.forEach(clearTimeout); onState?.(false); };
    },
  };
}

export type { ChipEvent };
