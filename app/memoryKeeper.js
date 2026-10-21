// A Zeladora das memórias: the being that walks the Aurora's memory and looks after it, one memory at a time
// (the Mapa Vivo draws her where she is). For each memory she reads she compares it with the others and does
// real work, all of it reversible:
//   - liga (link): two memories about the same thing that nothing connects get a "thematic" relation;
//   - junta (join): a near-identical copy in the same place is archived, with a "derivation" relation to the
//     one kept (more used, else older) — never a memory the person wrote by hand, never two that disagree;
//   - marca (flag): two memories about the same thing with different numbers ("meta 263 mil" × "meta 280 mil")
//     are flagged for the person to decide; nothing is changed.
// After a full round she rests, then walks again (new and changed memories come in the next round).
// Each step is a memory event ("keeper"), so the map follows her live. Off with the setting memory_keeper=off.
import { getDb } from "./db.js";
import { cosineSimilarity, decodeEmbedding, resolveEmbeddingModel } from "./embeddings.js";
import { emitMemoryEvent } from "./memoryEvents.js";
import { createRelation, getSetting, setSetting, setMemoryStatus } from "./store.js";

// Measured on a real base (196 memories, 19 110 pairs): different guides of the same family reach 0.93 cosine
// ("Jogos — Dados…" × "Jogos — Testes…"), so a join needs the TEXT nearly identical too; 0.88 links ~31 pairs.
const JOIN_SIMILARITY = 0.9;
const JOIN_WORDS = 0.8;
const LINK_SIMILARITY = 0.88;
const LINK_WORDS = 0.6;
const CONFLICT_SIMILARITY = 0.88;
const CONFLICT_WORDS = 0.6;
const MAX_LINKS_PER_MEMORY = 1;
const MAX_FLAGS = 100;
const MAX_FLAGS_PER_ROUND = 12;
const RECENT = 60;

const words = (text) => new Set(String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().match(/[a-z0-9]+/g) || []);
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let shared = 0; for (const w of a) if (b.has(w)) shared += 1; return shared / (a.size + b.size - shared); };
// Values as written ("263 mil", "R$ 1.200,50", "15%", "04/10"): the facts two similar memories may disagree on.
// A bare counter ("nota 11", "registro 110", "pedido 4512") is a name, not a value: it does not count.
export const valuesIn = (text) => new Set((String(text || "").match(/(?:r\$\s*)?\d[\d.,/]*(?:\s*(?:mil|milhões|milhoes|%|k|reais))?/gi) || [])
  .map((n) => n.replace(/\s+/g, " ").replace(/[.,]$/, "").toLowerCase())
  .filter((n) => /[%a-z$]/.test(n) || /\d[.,/]\d/.test(n)));
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const bucket = (m) => `${m.scope}|${m.project_id || ""}|${m.conversation_id || ""}`;
const areaOf = (m) => (m.project_id ? `projeto:${m.project_id}` : m.conversation_id ? `conversa:${m.conversation_id}` : "geral");
const sleep = (ms, signal) => new Promise((resolve) => { const t = setTimeout(resolve, ms); signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true }); });

const state = { running: false, phase: "parada", area: null, areaLabel: null, current: null, round: 0, startedAt: null, restUntil: null, stats: { read: 0, linked: 0, joined: 0, flagged: 0 }, areas: [], recent: [] };
let controller = null;

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
// Memories the person brought back after a join: she never joins them again.
async function spared() { try { return new Set(JSON.parse(await getSetting("memory_keeper_spared", "[]"))); } catch { return new Set(); } }
export async function keeperFlags() { try { return JSON.parse(await getSetting("memory_keeper_flags", "[]")); } catch { return []; } }

/** What the map and Configurações show: where she is, what she did this round, the open flags. */
export async function keeperState() {
  return { ...state, enabled: await keeperEnabled(), flags: await keeperFlags(), last: JSON.parse(await getSetting("memory_keeper_last", "null") || "null") };
}

async function loadRound(db) {
  const rows = db.prepare(`SELECT id, scope, project_id, conversation_id, title, content, kind, embedding, embedding_model, uses, created_at, status
    FROM memories WHERE status != 'archived' ORDER BY created_at ASC`).all();
  const projects = new Map(db.prepare("SELECT id, name FROM projects").all().map((p) => [p.id, p.name]));
  const conversations = new Map(db.prepare("SELECT id, title FROM conversations").all().map((c) => [c.id, c.title]));
  const model = resolveEmbeddingModel();
  const memories = rows.map((r) => ({ ...r, vector: r.embedding && r.embedding_model === model ? decodeEmbedding(r.embedding) : null, words: words(`${r.title} ${r.content}`), numbers: valuesIn(r.content), area: areaOf(r) }));
  const groups = new Map();
  for (const m of memories) { if (!groups.has(m.area)) groups.set(m.area, []); groups.get(m.area).push(m); }
  const label = (key) => (key === "geral" ? "memória geral" : key.startsWith("projeto:") ? projects.get(key.slice(8)) || "projeto" : conversations.get(key.slice(9)) || "conversa");
  const areas = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([key, list]) => ({ key, label: label(key), total: list.length, read: 0, list }));
  return { memories, areas };
}

function related(db) {
  const pairs = new Set();
  for (const r of db.prepare("SELECT from_id, to_id FROM memory_relations").all()) { pairs.add(`${r.from_id}|${r.to_id}`); pairs.add(`${r.to_id}|${r.from_id}`); }
  return pairs;
}

/** One memory read: compared with every other active one, and what that comparison asks for done. */
export async function tendMemory(memory, round, { db, relations, archived, done, flags, keep = new Set() }) {
  let links = 0;
  for (const other of round.memories) {
    if (other.id === memory.id || archived.has(other.id) || archived.has(memory.id)) continue;
    const key = memory.id < other.id ? `${memory.id}|${other.id}` : `${other.id}|${memory.id}`;
    if (done.has(key)) continue;
    done.add(key);
    const similarity = memory.vector && other.vector ? cosineSimilarity(memory.vector, other.vector) : null;
    const overlap = jaccard(memory.words, other.words);
    const close = (sim, wordsMin) => (similarity !== null ? similarity >= sim : false) || overlap >= wordsMin;
    const score = Math.round((similarity ?? overlap) * 1000) / 1000;
    const disagree = memory.numbers.size > 0 && other.numbers.size > 0 && !sameSet(memory.numbers, other.numbers);
    // Disagreeing memories: flagged, never joined (the person decides which one is right).
    if (disagree && close(CONFLICT_SIMILARITY, CONFLICT_WORDS)) {
      if (state.stats.flagged < MAX_FLAGS_PER_ROUND && !flags.some((f) => (f.id === memory.id && f.otherId === other.id) || (f.id === other.id && f.otherId === memory.id))) {
        const reason = `valores diferentes: ${[...memory.numbers].slice(0, 3).join(", ")} × ${[...other.numbers].slice(0, 3).join(", ")}`;
        flags.unshift({ id: memory.id, otherId: other.id, title: memory.title, otherTitle: other.title, reason, similarity: score, at: new Date().toISOString() });
        flags.length = Math.min(flags.length, MAX_FLAGS);
        await setSetting("memory_keeper_flags", JSON.stringify(flags));
        state.stats.flagged += 1;
        emit("flag", { id: memory.id, otherId: other.id, reason, similarity: score, title: memory.title });
      }
      continue;
    }
    // Copies in the same place: the less used (else newer) is archived, linked to the one kept. Only memories the
    // Aurora extracted herself (never one written by hand, never an imported guide), and only when the text
    // itself is nearly the same — a close embedding alone is a relative, not a copy.
    const copy = overlap >= JOIN_WORDS && (similarity === null || similarity >= JOIN_SIMILARITY);
    if (!disagree && copy && bucket(memory) === bucket(other) && memory.kind === "extracted" && other.kind === "extracted" && !keep.has(memory.id) && !keep.has(other.id)) {
      const [kept, gone] = (memory.uses || 0) !== (other.uses || 0) ? ((memory.uses || 0) > (other.uses || 0) ? [memory, other] : [other, memory]) : memory.created_at <= other.created_at ? [memory, other] : [other, memory];
      await setMemoryStatus(gone.id, "archived");
      await createRelation({ fromId: gone.id, toId: kept.id, type: "derivation" }).catch(() => {});
      archived.add(gone.id);
      state.stats.joined += 1;
      emit("join", { kept: kept.id, archived: gone.id, similarity: score, title: kept.title, archivedTitle: gone.title });
      if (gone.id === memory.id) return;
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
}

/** One full round over every active memory, area by area. `paceMs` is how long she stays on each memory. */
export async function keeperRound({ paceMs = 1200, signal } = {}) {
  const db = await getDb();
  const round = await loadRound(db);
  state.round += 1; state.startedAt = new Date().toISOString(); state.restUntil = null; state.phase = "andando";
  state.stats = { read: 0, linked: 0, joined: 0, flagged: 0 };
  state.areas = round.areas.map(({ key, label, total }) => ({ key, label, total, read: 0 }));
  emit("round", { round: state.round, total: round.memories.length, areas: state.areas });
  const ctx = { db, relations: related(db), archived: new Set(), done: new Set(), flags: await keeperFlags(), keep: await spared() };
  for (const [index, area] of round.areas.entries()) {
    if (signal?.aborted) break;
    state.area = area.key; state.areaLabel = area.label;
    emit("walk", { area: area.key, label: area.label, total: area.total, index });
    for (const memory of area.list) {
      if (signal?.aborted || !(await keeperEnabled())) { signal?.aborted || (state.phase = "parada"); return state.stats; }
      if (ctx.archived.has(memory.id)) { state.areas[index].read += 1; continue; }
      const still = db.prepare("SELECT status FROM memories WHERE id = ?").get(memory.id);
      if (!still || still.status === "archived") { ctx.archived.add(memory.id); state.areas[index].read += 1; continue; }
      state.current = memory.id;
      emit("read", { id: memory.id, area: area.key, title: memory.title }, false);
      await tendMemory(memory, round, ctx);
      state.stats.read += 1; state.areas[index].read += 1;
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
        try { await keeperRound({ paceMs, signal }); } catch (error) { emit("error", { message: String(error?.message || error).slice(0, 200) }); }
      }
      if (signal.aborted) break;
      state.phase = "descansando"; state.area = null; state.areaLabel = null;
      state.restUntil = new Date(Date.now() + restMs).toISOString();
      emit("rest", { until: state.restUntil, stats: state.stats });
      await sleep(restMs, signal);
    }
    state.running = false; state.phase = "parada";
  })();
  return stopMemoryKeeper;
}

export function stopMemoryKeeper() {
  controller?.abort();
  controller = null;
  state.running = false; state.phase = "parada";
}

/** Undo a join (the archived copy comes back) or dismiss a flag. */
export async function undoJoin(id) {
  const keep = await spared();
  keep.add(id);
  await setSetting("memory_keeper_spared", JSON.stringify([...keep].slice(-500)));
  return setMemoryStatus(id, "active");
}
export async function dismissFlag(id, otherId) {
  const flags = (await keeperFlags()).filter((f) => !(f.id === id && (!otherId || f.otherId === otherId)));
  await setSetting("memory_keeper_flags", JSON.stringify(flags));
  return flags;
}
