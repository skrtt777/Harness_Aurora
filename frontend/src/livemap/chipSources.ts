// The MemoryChip's sources (chip.ts has the contract): the Aurora's real memory, and a simulation that speaks the
// same events (to see the chip work without a backend or a model running).
import { getMemoryGraph, setMemoryStatus, subscribeMemoryEvents, updateMemory, type MemoryGraphSnapshot, type MemoryLiveEvent } from "../api";
import { fragmentsOf, type ChipEvent, type ChipLink, type ChipMemory, type ChipSnapshot, type ChipSource } from "./chip";

const day = (t: number) => new Date(t).toDateString();

/** The Aurora's snapshot as the chip's: nuclei are the Zeladora's nodes (or the atlas' groups, or the kinds). */
export function toChipSnapshot(s: MemoryGraphSnapshot, now = Date.now()): ChipSnapshot {
  const point = new Map((s.atlas?.points || []).map((p) => [p.id, p]));
  const lastUsed = new Map<string, number>();
  for (const r of s.recalls) for (const id of r.used) lastUsed.set(id, Math.max(lastUsed.get(id) || 0, Date.parse(r.at)));
  const byAtlas = Boolean(s.atlas?.clusters.length);
  const categories = byAtlas
    ? s.atlas!.clusters.map((c) => ({ id: String(c.id), label: c.label }))
    : [...new Set(s.memories.map((m) => m.kind))].map((k) => ({ id: `k:${k}`, label: k }));
  const known = new Set(categories.map((c) => c.id));
  const relations = new Map<string, ChipLink[]>();
  for (const r of s.relations) for (const [a, b] of [[r.from, r.to], [r.to, r.from]]) {
    const list = relations.get(a) || []; list.push({ id: b, score: 1, kind: "relation" }); relations.set(a, list);
  }
  const memories: ChipMemory[] = s.memories.map((m) => {
    const p = point.get(m.id);
    let category = byAtlas ? String(p?.cluster ?? -1) : `k:${m.kind}`;
    if (!known.has(category)) { categories.push({ id: category, label: category === "-1" ? "sem embedding" : category }); known.add(category); }
    const links = [...(p?.neighbors || []).map((n) => ({ id: n.id, score: n.similarity, kind: "similar" as const })), ...(relations.get(m.id) || [])]
      .filter((l, i, all) => all.findIndex((x) => x.id === l.id) === i).slice(0, 5);
    return {
      id: m.id, category, createdAt: Date.parse(m.createdAt) || 0, uses: m.uses, lastUsedAt: lastUsed.get(m.id) ?? null, links,
      // A sensitive memory keeps its place and shows nothing of itself.
      text: m.sensitive ? "memória privada" : m.title, snippet: m.sensitive ? null : m.snippet,
      sig: m.sensitive ? null : p?.sig ?? null, sensitive: m.sensitive,
      entities: m.sensitive ? [] : fragmentsOf({ text: m.title, snippet: m.snippet, tags: m.tags }),
    };
  });
  return { memories, categories, recallsToday: s.recalls.filter((r) => day(Date.parse(r.at)) === day(now)).length };
}

/**
 * The real memory: the snapshot from /api/memories/graph, the events from /api/memories/live, translated.
 *   created → a new snapshot (it brings the memory with its nucleus, neighbours and fingerprint) → memory.created;
 *   updated → memory.updated; the Zeladora's join / compact → memory.updated (mergedFrom) + memory.deleted (merge);
 *   her prune → memory.deleted (decay); archived / deleted otherwise → memory.deleted (user);
 *   turn-start → recall.started; scanned → memory.scanned; recalled → memory.recalled (by rank) + recall.finished;
 *   answered → response.done; her read → keeper.read. A reconnection brings a whole snapshot (reconciliation).
 */
export function auroraChipSource(): ChipSource {
  return {
    label: "ao vivo", mock: false,
    snapshot: () => getMemoryGraph().then((s) => toChipSnapshot(s)),
    actions: {
      edit: async (id, text) => { await updateMemory(id, { title: text }); },
      forget: async (id) => { await setMemoryStatus(id, "archived"); },
    },
    subscribe(onEvent, onState) {
      let request = "", scores = new Map<string, number>(), wasLive = true;
      const gone = new Set<string>();
      let timer: ReturnType<typeof setTimeout> | null = null;
      const refresh = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { getMemoryGraph().then((s) => onEvent({ type: "snapshot", snapshot: toChipSnapshot(s) })).catch(() => {}); }, 700);
      };
      const forget = (id: string | undefined, reason: "user" | "decay" | "merge") => { if (!id || gone.has(id)) return; gone.add(id); onEvent({ type: "memory.deleted", id, reason }); };
      const on = (e: MemoryLiveEvent) => {
        switch (e.type) {
          case "created": refresh(); break;
          case "updated": if (e.id) onEvent({ type: "memory.updated", id: e.id, text: e.title }); break;
          case "restored": refresh(); break;
          // Who archived it is told by the Zeladora's event, which may come just after: wait a moment.
          case "archived": case "deleted": { const id = e.id; setTimeout(() => forget(id, "user"), 400); break; }
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
          case "answered": onEvent({ type: "response.done", requestId: request, memoriesUsed: e.used || [] }); if (e.created?.length) refresh(); break;
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
      return () => { stop(); if (timer) clearTimeout(timer); };
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
  return {
    label: "simulação", mock: true,
    snapshot: async () => ({ memories: live.map((m) => ({ ...m })), categories: MOCK_CATS.map(({ id, label }) => ({ id, label })), recallsToday: 3 }),
    actions: {
      edit: async (id, text) => { const m = live.find((x) => x.id === id); if (m) m.text = text; },
      forget: async (id) => { const i = live.findIndex((x) => x.id === id); if (i >= 0) live.splice(i, 1); },
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
        else if (x < 0.83 && live.length > 20) { const i = Math.floor(r() * live.length); const [m] = live.splice(i, 1); onEvent({ type: "memory.deleted", id: m.id, reason: r() < 0.5 ? "decay" : "user" }); }
        else if (x < 0.9 && live.length > 20) {
          const a = live[Math.floor(r() * live.length)], b = live.find((m) => m.category === a.category && m.id !== a.id);
          if (b) { live.splice(live.indexOf(b), 1); onEvent({ type: "memory.updated", id: a.id, mergedFrom: [b.id] }); onEvent({ type: "memory.deleted", id: b.id, reason: "merge" }); }
        } else if (live.length) for (let k = 0; k < 4; k += 1) later(k * 700, () => onEvent({ type: "keeper.read", id: live[Math.floor(r() * live.length)].id }));
        later(2600 + r() * 2600, tick);
      };
      later(1500, tick);
      return () => { stopped = true; timers.forEach(clearTimeout); onState?.(false); };
    },
  };
}

export type { ChipEvent };
