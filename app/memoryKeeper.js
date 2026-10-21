// A Zeladora das memórias: a spider that walks the web of the Aurora's memory and looks after it. She is not
// part of how the Aurora thinks (a chat turn never waits for her): she is the caretaker. Her round goes section
// by section — each section one "thought", the semantic groups the Mapa Vivo shows — and inside a section she
// walks the web, always to the nearest memory she has not read yet. For each memory she reads she:
//   - classifies it (valor, regra, preferência, combinado, fato) and marks a vague one ("vaga": too little to
//     be useful — a question for the person, nothing changed);
//   - compacts a thought: memories the Aurora extracted that say the same thing in the same place become one
//     memory holding every distinct sentence of them (nothing lost); the originals are archived with a
//     "derivation" relation to it. An exact copy is simply archived (join). Undo brings the originals back and
//     she never compacts them again. Never a memory written by hand, never an imported guide, never two that
//     disagree on a value;
//   - links two memories about the same thing that nothing connects ("thematic" relation);
//   - flags two memories about the same thing with different values ("263 mil" × "280 mil").
// After a full round she rests, then walks again. Each step is a memory event ("keeper"), so the map follows
// her live. Off with the setting memory_keeper=off.
import { getDb } from "./db.js";
import { cosineSimilarity, decodeEmbedding, resolveEmbeddingModel } from "./embeddings.js";
import { memoryAtlas } from "./memoryAtlas.js";
import { emitMemoryEvent } from "./memoryEvents.js";
import { createMemory, createRelation, getSetting, setSetting, setMemoryStatus } from "./store.js";

// Measured on a real base (196 memories, 19 110 pairs): different guides of the same family reach 0.93 cosine
// ("Jogos — Dados…" × "Jogos — Testes…"), so compacting needs the TEXT to share most words too, not only the
// embedding; 0.88 links ~31 pairs there.
const SAME_THOUGHT_SIMILARITY = 0.9;
const SAME_THOUGHT_WORDS = 0.5;      // with an embedding
const SAME_THOUGHT_WORDS_ALONE = 0.7; // without one (0.6 only links)
const COPY_WORDS = 0.8;
const LINK_SIMILARITY = 0.88;
const LINK_WORDS = 0.6;
const CONFLICT_SIMILARITY = 0.88;
const CONFLICT_WORDS = 0.6;
const MAX_LINKS_PER_MEMORY = 1;
const MAX_GROUP = 6;
const MAX_FLAGS = 100;
const MAX_FLAGS_PER_ROUND = 12;
const VAGUE_WORDS = 5;
const RECENT = 60;

const fold = (text) => String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const words = (text) => new Set(fold(text).match(/[a-z0-9]+/g) || []);
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let shared = 0; for (const w of a) if (b.has(w)) shared += 1; return shared / (a.size + b.size - shared); };
// Values as written ("263 mil", "R$ 1.200,50", "15%", "04/10"): the facts two similar memories may disagree on.
// A bare counter ("nota 11", "registro 110", "pedido 4512") is a name, not a value: it does not count.
export const valuesIn = (text) => new Set((String(text || "").match(/(?:r\$\s*)?\d[\d.,/]*(?:\s*(?:mil|milhões|milhoes|%|k|reais))?/gi) || [])
  .map((n) => n.replace(/\s+/g, " ").replace(/[.,]$/, "").toLowerCase())
  .filter((n) => /[%a-z$]/.test(n) || /\d[.,/]\d/.test(n)));
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const bucket = (m) => `${m.scope}|${m.project_id || ""}|${m.conversation_id || ""}`;
const sentencesOf = (text) => String(text || "").split(/(?<=[.!?;])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
const sleep = (ms, signal) => new Promise((resolve) => { const t = setTimeout(resolve, ms); signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true }); });

/** What kind of memory this is, read from its own words (the label she writes next to it on the map). */
export function classifyMemory({ title = "", content = "" }) {
  const text = fold(`${title} ${content}`);
  if ((fold(content).match(/[a-z0-9]+/g) || []).length < VAGUE_WORDS) return "vaga";
  if (valuesIn(content).size) return "valor";
  if (/\b(prefere|gosta|nao gosta|quer que|odeia|curte)\b/.test(text)) return "preferência";
  if (/\b(combinad|acordad|ficou definido|decidid|ficou certo)/.test(text)) return "combinado";
  if (/\b(deve|devem|precisa|nao pode|obrigatori|regra|sempre que|antes de|nunca)\b/.test(text)) return "regra";
  return "fato";
}

/**
 * Every distinct sentence of a group, in order (the most used memory's first): a sentence another one already
 * says (≥ 80% of the same words) is said once. Nothing else is dropped or rewritten.
 */
export function compactText(texts) {
  const kept = [];
  for (const text of texts) for (const sentence of sentencesOf(text)) {
    const w = words(sentence);
    if (!kept.some((k) => jaccard(k.w, w) >= 0.8)) kept.push({ sentence, w });
  }
  return kept.map((k) => k.sentence).join(" ");
}

const emptyStats = () => ({ read: 0, linked: 0, joined: 0, compacted: 0, flagged: 0 });
const state = { running: false, phase: "parada", section: null, sectionLabel: null, area: null, areaLabel: null, current: null, round: 0, startedAt: null, restUntil: null, stats: emptyStats(), sections: [], areas: [], recent: [], readIds: [], visiting: null };
let controller = null;
// The person can call her: "come and organize these memories". The queue is served before the next memory of
// the round, and a call wakes her up if she is resting.
const visits = [];
let wake = null;

function remember(action) {
  state.recent.unshift({ ...action, at: new Date().toISOString() });
  state.recent.length = Math.min(state.recent.length, RECENT);
}
function emit(action, payload = {}, keep = true) {
  const event = { action, ...payload };
  if (action !== "read") remember(event);
  emitMemoryEvent("keeper", event, { keep });
}

export async function keeperEnabled() { return (await getSetting("memory_keeper", "on")) !== "off"; }
const readJsonSetting = async (key, fallback) => { try { return JSON.parse(await getSetting(key, JSON.stringify(fallback))); } catch { return fallback; } };
// Memories the person brought back after a join or a compaction: she never compacts them again.
async function spared() { return new Set(await readJsonSetting("memory_keeper_spared", [])); }
export async function keeperFlags() { return readJsonSetting("memory_keeper_flags", []); }
export async function keeperCompactions() { return readJsonSetting("memory_keeper_compactions", []); }

/** What the map shows: where she is, what she did this round, the open flags, what can be undone. */
export async function keeperState() {
  return { ...state, enabled: await keeperEnabled(), flags: await keeperFlags(), compactions: (await keeperCompactions()).slice(0, 20), last: await readJsonSetting("memory_keeper_last", null) };
}

/** The sections of a round (the general memory, then each semantic group), each walked along the web. */
async function loadRound(db, env) {
  const rows = db.prepare(`SELECT id, scope, project_id, conversation_id, title, content, tags, kind, embedding, embedding_model, uses, created_at, status
    FROM memories WHERE status != 'archived' ORDER BY created_at ASC`).all();
  const model = resolveEmbeddingModel(env);
  const atlas = await memoryAtlas({ env }).catch(() => null);
  const place = new Map((atlas?.memories || []).map((p) => [p.id, p]));
  const labels = new Map((atlas?.clusters || []).map((c) => [c.id, c.label]));
  const memories = rows.map((r) => ({ ...r, vector: r.embedding && r.embedding_model === model ? decodeEmbedding(r.embedding) : null, words: words(`${r.title} ${r.content}`), numbers: valuesIn(r.content), position: place.get(r.id)?.position || null }));
  const sectionOf = (m) => { if (m.scope === "global") return "geral"; const c = place.get(m.id)?.cluster; return c !== undefined && c >= 0 ? `sem:${c}` : "solta"; };
  const groups = new Map();
  for (const m of memories) { const key = sectionOf(m); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(m); }
  const order = (key) => (key === "geral" ? -1 : key === "solta" ? 1e9 : Number(key.slice(4)));
  const label = (key) => (key === "geral" ? "memória geral" : key === "solta" ? "sem posição" : labels.get(Number(key.slice(4))) || "pensamento");
  const sections = [...groups.entries()].sort((a, b) => order(a[0]) - order(b[0])).map(([key, list]) => ({ key, label: label(key), total: list.length, read: 0, list: walkOrder(list) }));
  return { memories, sections };
}

/** A spider on its web: start near the middle of the section, then always the nearest memory not read yet. */
function walkOrder(list) {
  const placed = list.filter((m) => m.position);
  if (placed.length < 2) return list;
  const center = [0, 1, 2].map((a) => placed.reduce((s, m) => s + m.position[a], 0) / placed.length);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const left = new Set(placed);
  let at = placed.reduce((best, m) => (dist(m.position, center) < dist(best.position, center) ? m : best));
  const path = [];
  while (at) {
    path.push(at); left.delete(at);
    let next = null;
    for (const m of left) if (!next || dist(m.position, at.position) < dist(next.position, at.position)) next = m;
    at = next;
  }
  return [...path, ...list.filter((m) => !m.position)];
}

function related(db) {
  const pairs = new Set();
  for (const r of db.prepare("SELECT from_id, to_id FROM memory_relations").all()) { pairs.add(`${r.from_id}|${r.to_id}`); pairs.add(`${r.to_id}|${r.from_id}`); }
  return pairs;
}

async function addFlag(flags, flag) {
  if (state.stats.flagged >= MAX_FLAGS_PER_ROUND) return false;
  if (flags.some((f) => (f.id === flag.id && (f.otherId || null) === (flag.otherId || null)) || (flag.otherId && f.id === flag.otherId && f.otherId === flag.id))) return false;
  flags.unshift({ ...flag, at: new Date().toISOString() });
  flags.length = Math.min(flags.length, MAX_FLAGS);
  await setSetting("memory_keeper_flags", JSON.stringify(flags));
  state.stats.flagged += 1;
  emit("flag", flag);
  return true;
}

/** One memory read: classified, compared with the others, and what the comparison asks for done. */
export async function tendMemory(memory, round, ctx) {
  const { relations, archived, done, flags, keep = new Set(), env } = ctx;
  const kind = classifyMemory(memory);
  if (kind === "vaga") await addFlag(flags, { id: memory.id, otherId: null, title: memory.title, reason: "vaga: pouco conteúdo para ser útil" });

  // Compare with every other active memory once.
  const pairs = [];
  for (const other of round.memories) {
    if (other.id === memory.id || archived.has(other.id)) continue;
    const similarity = memory.vector && other.vector ? cosineSimilarity(memory.vector, other.vector) : null;
    const overlap = jaccard(memory.words, other.words);
    const disagree = memory.numbers.size > 0 && other.numbers.size > 0 && !sameSet(memory.numbers, other.numbers);
    pairs.push({ other, similarity, overlap, disagree, score: Math.round((similarity ?? overlap) * 1000) / 1000 });
  }

  // ---- compact the thought: the same thing said by memories the Aurora extracted, in the same place ----
  const mayCompact = (m) => m.kind === "extracted" && !keep.has(m.id);
  if (mayCompact(memory)) {
    const group = pairs.filter((p) => !p.disagree && mayCompact(p.other) && bucket(p.other) === bucket(memory)
      && (p.overlap >= COPY_WORDS || (p.similarity === null ? p.overlap >= SAME_THOUGHT_WORDS_ALONE : p.similarity >= SAME_THOUGHT_SIMILARITY && p.overlap >= SAME_THOUGHT_WORDS)))
      .sort((a, b) => b.score - a.score).slice(0, MAX_GROUP - 1).map((p) => p.other);
    if (group.length) {
      // The one kept: the most used, then the oldest, then the plainest title (a copy's title tends to grow).
      const all = [memory, ...group].sort((a, b) => (b.uses || 0) - (a.uses || 0) || String(a.created_at).localeCompare(String(b.created_at)) || a.title.length - b.title.length);
      const [best] = all;
      const merged = compactText(all.map((m) => m.content));
      const bestOwn = compactText([best.content]);
      if (merged === bestOwn) {
        // Exact copies: the best one stays, the copies go to the archive linked to it.
        for (const copy of all.slice(1)) {
          await setMemoryStatus(copy.id, "archived");
          await createRelation({ fromId: copy.id, toId: best.id, type: "derivation" }).catch(() => {});
          archived.add(copy.id);
          state.stats.joined += 1;
          emit("join", { kept: best.id, archived: copy.id, title: best.title, archivedTitle: copy.title });
        }
      } else {
        const tags = [...new Set(all.flatMap((m) => { try { return JSON.parse(m.tags || "[]"); } catch { return []; } }))];
        const compacted = await createMemory({ scope: best.scope, projectId: best.project_id, conversationId: best.conversation_id, title: best.title, content: merged, tags, kind: "extracted", source: `zeladora: compactou ${all.length} memórias`, dedupe: false, env });
        for (const m of all) {
          await setMemoryStatus(m.id, "archived");
          await createRelation({ fromId: m.id, toId: compacted.id, type: "derivation" }).catch(() => {});
          archived.add(m.id);
        }
        const record = { id: compacted.id, from: all.map((m) => m.id), title: best.title, titles: all.map((m) => m.title), at: new Date().toISOString() };
        const list = await keeperCompactions();
        list.unshift(record);
        await setSetting("memory_keeper_compactions", JSON.stringify(list.slice(0, 50)));
        keep.add(compacted.id);
        state.stats.compacted += 1;
        emit("compact", { id: compacted.id, merged: record.from, title: best.title, sentences: sentencesOf(merged).length });
      }
      if (archived.has(memory.id)) return kind;
    }
  }

  let links = 0;
  for (const { other, similarity, overlap, disagree, score } of pairs) {
    if (archived.has(other.id)) continue;
    const key = memory.id < other.id ? `${memory.id}|${other.id}` : `${other.id}|${memory.id}`;
    if (done.has(key)) continue;
    done.add(key);
    const close = (sim, wordsMin) => (similarity !== null ? similarity >= sim : false) || overlap >= wordsMin;
    // Disagreeing memories: flagged, never compacted (the person decides which one is right).
    if (disagree && close(CONFLICT_SIMILARITY, CONFLICT_WORDS)) {
      await addFlag(flags, { id: memory.id, otherId: other.id, title: memory.title, otherTitle: other.title, similarity: score, reason: `valores diferentes: ${[...memory.numbers].slice(0, 3).join(", ")} × ${[...other.numbers].slice(0, 3).join(", ")}` });
      continue;
    }
    // About the same thing, but nothing connects them yet.
    if (links < MAX_LINKS_PER_MEMORY && close(LINK_SIMILARITY, LINK_WORDS) && !relations.has(`${memory.id}|${other.id}`)) {
      await createRelation({ fromId: memory.id, toId: other.id, type: "thematic" }).catch(() => {});
      relations.add(`${memory.id}|${other.id}`); relations.add(`${other.id}|${memory.id}`);
      links += 1;
      state.stats.linked += 1;
      emit("link", { from: memory.id, to: other.id, similarity: score, title: memory.title, otherTitle: other.title });
    }
  }
  return kind;
}

/** One full round over every active memory, section by section. `paceMs` is how long she stays on each one. */
export async function keeperRound({ paceMs = 1200, signal, env = process.env } = {}) {
  const db = await getDb();
  const round = await loadRound(db, env);
  state.round += 1; state.startedAt = new Date().toISOString(); state.restUntil = null; state.phase = "andando";
  state.stats = emptyStats();
  state.readIds = [];
  state.sections = round.sections.map(({ key, label, total }) => ({ key, label, total, read: 0 }));
  state.areas = state.sections;
  emit("round", { round: state.round, total: round.memories.length, sections: state.sections, areas: state.sections });
  const ctx = { db, env, relations: related(db), archived: new Set(), done: new Set(), flags: await keeperFlags(), keep: await spared() };
  for (const [index, section] of round.sections.entries()) {
    if (signal?.aborted) break;
    state.section = state.area = section.key; state.sectionLabel = state.areaLabel = section.label;
    emit("walk", { section: section.key, area: section.key, label: section.label, total: section.total, index });
    for (const memory of section.list) {
      if (signal?.aborted) return state.stats;
      if (visits.length) {
        await serveVisits(round, ctx, { paceMs, signal });
        state.section = state.area = section.key; state.sectionLabel = state.areaLabel = section.label;
        emit("walk", { section: section.key, area: section.key, label: section.label, total: section.total, index, back: true });
      }
      if (!(await keeperEnabled())) { state.phase = "parada"; return state.stats; }
      const progress = state.sections[index];
      if (ctx.archived.has(memory.id)) { progress.read += 1; continue; }
      const still = db.prepare("SELECT status FROM memories WHERE id = ?").get(memory.id);
      if (!still || still.status === "archived") { ctx.archived.add(memory.id); progress.read += 1; continue; }
      state.current = memory.id;
      const kind = classifyMemory(memory);
      emit("read", { id: memory.id, section: section.key, area: section.key, title: memory.title, kind }, false);
      await tendMemory(memory, round, ctx);
      state.stats.read += 1; progress.read += 1; state.readIds.push(memory.id);
      if (paceMs) await sleep(paceMs, signal);
    }
  }
  state.current = null;
  await setSetting("memory_keeper_last", JSON.stringify({ round: state.round, at: new Date().toISOString(), ...state.stats }));
  return state.stats;
}

/** Walks, rests, walks again — until stopped. Desktop app only (server.js), like the other background work. */
export function startMemoryKeeper({ paceMs = 1200, restMs = 15 * 60_000, firstDelayMs = 20_000 } = {}) {
  if (controller) return stopMemoryKeeper;
  controller = new AbortController();
  const { signal } = controller;
  state.running = true;
  void (async () => {
    await sleep(firstDelayMs, signal);
    while (!signal.aborted) {
      if (await keeperEnabled()) {
        try { await keeperRound({ paceMs, signal }); } catch (error) { emit("error", { reason: String(error?.message || error).slice(0, 200) }); }
      }
      if (signal.aborted) break;
      state.phase = "descansando"; state.section = state.area = null; state.sectionLabel = state.areaLabel = null;
      state.restUntil = new Date(Date.now() + restMs).toISOString();
      emit("rest", { until: state.restUntil, stats: state.stats });
      // Resting until the time is up — or until the person calls her.
      await new Promise((resolve) => { const t = setTimeout(resolve, restMs); wake = () => { clearTimeout(t); resolve(); }; signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true }); });
      wake = null;
      while (visits.length && !signal.aborted && (await keeperEnabled())) {
        try {
          const db = await getDb();
          const round = await loadRound(db, process.env);
          const ctx = { db, env: process.env, relations: related(db), archived: new Set(), done: new Set(), flags: await keeperFlags(), keep: await spared() };
          await serveVisits(round, ctx, { paceMs, signal });
        } catch (error) { emit("error", { reason: String(error?.message || error).slice(0, 200) }); visits.length = 0; }
      }
    }
    state.running = false; state.phase = "parada";
  })();
  return stopMemoryKeeper;
}

/**
 * The person asked her to organize some memories (a section, or one memory) now: she walks there, reads and
 * tends each one, and then goes back to where she was. Returns how many were queued.
 */
export function visitMemories(ids, label = "a seu pedido") {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(String))].slice(0, 300);
  if (!list.length) return 0;
  visits.push({ ids: list, label: String(label || "a seu pedido").slice(0, 80) });
  emit("called", { label, total: list.length });
  wake?.();
  return list.length;
}

async function serveVisits(round, ctx, { paceMs, signal }) {
  const byId = new Map(round.memories.map((m) => [m.id, m]));
  while (visits.length && !signal?.aborted) {
    const visit = visits.shift();
    const list = walkOrder(visit.ids.map((id) => byId.get(id)).filter(Boolean));
    state.visiting = visit.label; state.phase = "andando";
    state.section = state.area = "pedido"; state.sectionLabel = state.areaLabel = visit.label;
    emit("walk", { section: "pedido", area: "pedido", label: visit.label, total: list.length, called: true });
    for (const memory of list) {
      if (signal?.aborted || ctx.archived.has(memory.id)) continue;
      const still = ctx.db.prepare("SELECT status FROM memories WHERE id = ?").get(memory.id);
      if (!still || still.status === "archived") continue;
      state.current = memory.id;
      emit("read", { id: memory.id, section: "pedido", area: "pedido", title: memory.title, kind: classifyMemory(memory), called: true }, false);
      await tendMemory(memory, round, ctx);
      state.stats.read += 1; if (!state.readIds.includes(memory.id)) state.readIds.push(memory.id);
      if (paceMs) await sleep(paceMs, signal);
    }
    state.visiting = null;
  }
}

export function stopMemoryKeeper() {
  controller?.abort();
  controller = null;
  state.running = false; state.phase = "parada";
}

/**
 * Undo: for a compaction, the compacted memory goes to the archive and its originals come back; for a join,
 * the archived copy comes back. Either way she never compacts those memories again.
 */
export async function undoKeeper(id) {
  const keep = await spared();
  const compactions = await keeperCompactions();
  const compaction = compactions.find((c) => c.id === id);
  const back = compaction ? compaction.from : [id];
  for (const m of back) keep.add(m);
  await setSetting("memory_keeper_spared", JSON.stringify([...keep].slice(-500)));
  if (compaction) {
    await setMemoryStatus(compaction.id, "archived");
    await setSetting("memory_keeper_compactions", JSON.stringify(compactions.filter((c) => c.id !== id)));
  }
  let restored = null;
  for (const m of back) restored = (await setMemoryStatus(m, "active")) || restored;
  return restored;
}
export const undoJoin = undoKeeper;

export async function dismissFlag(id, otherId) {
  const flags = (await keeperFlags()).filter((f) => !(f.id === id && (!otherId || f.otherId === otherId)));
  await setSetting("memory_keeper_flags", JSON.stringify(flags));
  return flags;
}
