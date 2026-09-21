import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";
import { centralConfig, relevantCentralMemories } from './centralMemory.js';
import { cosineSimilarity, decodeEmbedding, embedText, encodeEmbedding, resolveEmbeddingModel } from "./embeddings.js";
import { taskProfile, queryTerms, referenceCompatibility, selectiveContext } from './contextSelection.js';

const now = () => new Date().toISOString();
const parseJsonArray = (value) => {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

function mapProject(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, instructions: row.instructions, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapConversation(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id || null,
    title: row.title,
    provider: row.provider,
    teacherProvider: row.teacher_provider || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    memoryStatus: row.memory_status || "none",
    correctionOf: row.correction_of || null,
    content: row.content,
    provider: row.provider || undefined,
    memoryAccess: parseJsonArray(row.memory_access),
    memoryCreated: parseJsonArray(row.memory_created),
    execution: row.execution ? JSON.parse(row.execution) : null,
    createdAt: row.created_at,
  };
}

function mapMemory(row) {
  if (!row) return null;
  return {
    id: row.id,
    scope: row.scope,
    projectId: row.project_id || null,
    conversationId: row.conversation_id || null,
    title: row.title,
    content: row.content,
    tags: parseJsonArray(row.tags),
    kind: row.kind,
    source: row.source || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    relations: [],
    relationTypes: {},
  };
}

const RELATION_TYPES = ["belonging", "thematic", "derivation", "correction"];

/**
 * Fills `relations`/`relationTypes` on already-mapped memories in one query,
 * instead of one query per memory. Only the declaring (`from`) side lists the
 * relation — matching the frontend's graph model (frontend/src/graph.ts),
 * which builds one edge per declared relation and exposes the reverse
 * direction separately via its own `incoming` map. Attaching both directions
 * here would make the atlas draw two overlapping edges per relation.
 */
function attachRelations(db, memories) {
  if (!memories.length) return memories;
  const ids = memories.map((m) => m.id);
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(`SELECT * FROM memory_relations WHERE from_id IN (${placeholders})`).all(...ids);
  const byId = new Map(memories.map((m) => [m.id, m]));
  for (const row of rows) {
    const from = byId.get(row.from_id);
    if (from && !from.relations.includes(row.to_id)) {
      from.relations.push(row.to_id);
      from.relationTypes[row.to_id] = row.type;
    }
  }
  return memories;
}

// ---------- Projects ----------

export async function listProjects() {
  const db = await getDb();
  const rows = db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all();
  return rows.map(mapProject);
}

export async function getProject(id) {
  const db = await getDb();
  return mapProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(id));
}

export async function createProject({ name, instructions = "" }) {
  const db = await getDb();
  const id = randomUUID();
  const ts = now();
  db.prepare(
    "INSERT INTO projects (id, name, instructions, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, String(name || "Novo projeto").trim() || "Novo projeto", String(instructions || ""), ts, ts);
  return getProject(id);
}

export async function updateProject(id, patch) {
  const db = await getDb();
  const existing = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  if (!existing) return null;
  const name = patch.name !== undefined ? String(patch.name).trim() || existing.name : existing.name;
  const instructions = patch.instructions !== undefined ? String(patch.instructions) : existing.instructions;
  db.prepare("UPDATE projects SET name = ?, instructions = ?, updated_at = ? WHERE id = ?").run(
    name,
    instructions,
    now(),
    id,
  );
  return getProject(id);
}

export async function deleteProject(id) {
  const db = await getDb();
  const info = db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  return info.changes > 0;
}

// ---------- Conversations ----------

export async function listConversations({ projectId } = {}) {
  const db = await getDb();
  const rows = projectId
    ? db.prepare("SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC").all(projectId)
    : db.prepare("SELECT * FROM conversations ORDER BY updated_at DESC").all();
  return rows.map(mapConversation);
}

export async function getConversation(id) {
  const db = await getDb();
  return mapConversation(db.prepare("SELECT * FROM conversations WHERE id = ?").get(id));
}

export async function getConversationWithMessages(id) {
  const conversation = await getConversation(id);
  if (!conversation) return null;
  const db = await getDb();
  const rows = db
    .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC")
    .all(id);
  return { ...conversation, messages: rows.map(mapMessage) };
}

export async function createConversation({
  projectId = null,
  title = "Nova conversa",
  provider = "codex",
  teacherProvider = null,
} = {}) {
  const db = await getDb();
  if (projectId) {
    const project = db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
    if (!project) throw new Error("Projeto não encontrado.");
  }
  const id = randomUUID();
  const ts = now();
  db.prepare(
    "INSERT INTO conversations (id, project_id, title, provider, teacher_provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, projectId, title, provider, provider === "local" ? teacherProvider || "codex" : null, ts, ts);
  return getConversation(id);
}

export async function updateConversation(id, patch) {
  const db = await getDb();
  const existing = db.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
  if (!existing) return null;
  if (patch.projectId !== undefined && patch.projectId !== null) {
    const project = db.prepare("SELECT id FROM projects WHERE id = ?").get(patch.projectId);
    if (!project) throw new Error("Projeto não encontrado.");
  }
  const title = patch.title !== undefined ? String(patch.title).trim() || existing.title : existing.title;
  const projectId = patch.projectId !== undefined ? patch.projectId : existing.project_id;
  db.prepare("UPDATE conversations SET title = ?, project_id = ?, updated_at = ? WHERE id = ?").run(
    title,
    projectId,
    now(),
    id,
  );
  return getConversation(id);
}

export async function touchConversation(id) {
  const db = await getDb();
  db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now(), id);
}

export async function deleteConversation(id) {
  const db = await getDb();
  const info = db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
  return info.changes > 0;
}

// ---------- Messages ----------

export async function addMessage({ conversationId, role, content, provider, memoryAccess = [], memoryCreated = [], memoryStatus = "none", correctionOf = null, execution = null }) {
  const db = await getDb();
  const id = randomUUID();
  const ts = now();
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, provider, memory_access, memory_created, created_at, memory_status, correction_of)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, conversationId, role, content, provider || null, JSON.stringify(memoryAccess), JSON.stringify(memoryCreated), ts, memoryStatus, correctionOf);
  if(execution)db.prepare('UPDATE messages SET execution=? WHERE id=?').run(JSON.stringify(execution),id);
  await touchConversation(conversationId);
  return mapMessage(db.prepare("SELECT * FROM messages WHERE id = ?").get(id));
}

export async function listMessages(conversationId) {
  const db = await getDb();
  const rows = db
    .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC")
    .all(conversationId);
  return rows.map(mapMessage);
}

export async function getMessage(id) {
  const db = await getDb();
  return mapMessage(db.prepare("SELECT * FROM messages WHERE id = ?").get(id));
}

// ---------- Memories ----------

// Same text a keyword search would tokenize (title + content + tags) is
// what gets embedded, so both scoring methods in selectRelevantMemories()
// are judging the same "what is this memory about" surface.
function embeddingInputFor({ title, content, tags }) {
  return `${title || ""} ${content || ""} ${(tags || []).join(" ")}`.trim();
}

/**
 * Best-effort: computes and stores an embedding for a memory that was just
 * created or edited. Never throws and never blocks the caller on a missing
 * Ollama/model — see embedText()'s own doc comment. `env` is only ever
 * overridden by tests; production callers use the default process.env.
 */
async function attachEmbedding(db, id, text, env) {
  const revision = db.prepare("SELECT revision FROM memories WHERE id = ?").get(id)?.revision;
  if (revision === undefined) return;
  try {
    const vector = await embedText(text, env);
    if (!vector) return;
    db.prepare("UPDATE memories SET embedding = ?, embedding_model = ? WHERE id = ? AND revision = ?").run(encodeEmbedding(vector), resolveEmbeddingModel(env), id, revision);
  } catch {
    // The memory itself is already saved either way; a failed embedding
    // just means this memory falls back to keyword-only search for now.
  }
}

export async function createMemory({
  scope = "global",
  projectId = null,
  conversationId = null,
  title,
  content,
  tags = [],
  kind = "manual",
  source,
  env = process.env,
}) {
  if (!Array.isArray(tags) || tags.some(t => typeof t !== "string")) throw new Error("Tags devem ser uma lista de textos.");
  const db = await getDb();
  if (!["global", "project", "conversation"].includes(scope)) throw new Error("Escopo inválido.");
  if (scope === "project" && !projectId) throw new Error("Memória de projeto requer projectId.");
  if (scope === "conversation" && !conversationId) throw new Error("Memória de conversa requer conversationId.");
  const cleanContent = String(content || "").trim();
  if (!cleanContent) throw new Error("O conteúdo da memória é obrigatório.");
  const id = randomUUID();
  const ts = now();
  const cleanTitle = String(title || "Memória").trim() || "Memória";
  db.prepare(
    `INSERT INTO memories (id, scope, project_id, conversation_id, title, content, tags, kind, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    scope,
    scope === "project" ? projectId : null,
    scope === "conversation" ? conversationId : null,
    cleanTitle,
    cleanContent,
    JSON.stringify(tags || []),
    kind,
    source || null,
    ts,
    ts,
  );
  await attachEmbedding(db, id, embeddingInputFor({ title: cleanTitle, content: cleanContent, tags }), env);
  return attachRelations(db, [mapMemory(db.prepare("SELECT * FROM memories WHERE id = ?").get(id))])[0];
}

export async function createRelation({ fromId, toId, type }) {
  if (!RELATION_TYPES.includes(type)) throw new Error("Tipo de relação inválido.");
  if (!fromId || !toId || fromId === toId) throw new Error("Relação precisa de duas memórias diferentes.");
  const db = await getDb();
  db.prepare(
    "INSERT OR IGNORE INTO memory_relations (id, from_id, to_id, type, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(randomUUID(), fromId, toId, type, now());
}

export async function updateMemory(id, patch, env = process.env) {
  if (patch.tags !== undefined && (!Array.isArray(patch.tags) || patch.tags.some(t => typeof t !== "string"))) throw Object.assign(new Error("Tags inválidas."), {status: 400});
  const db = await getDb();
  const existing = db.prepare("SELECT * FROM memories WHERE id = ?").get(id);
  if (!existing) return null;
  const title = patch.title !== undefined ? String(patch.title).trim() || existing.title : existing.title;
  const content = patch.content !== undefined ? String(patch.content).trim() || existing.content : existing.content;
  const tagsChanged = patch.tags !== undefined;
  const tags = tagsChanged ? JSON.stringify(patch.tags) : existing.tags;
  db.prepare("UPDATE memories SET title = ?, content = ?, tags = ?, updated_at = ?, embedding = NULL, embedding_model = NULL, revision = revision + 1 WHERE id = ?").run(
    title,
    content,
    tags,
    now(),
    id,
  );
  // Only recompute the embedding when the text it's derived from actually
  // changed — re-embedding on every touch (e.g. just re-saving tags-only
  // patches unchanged) would be wasted work for identical content.
  {
    await attachEmbedding(db, id, embeddingInputFor({ title, content, tags: parseJsonArray(tags) }), env);
  }
  return attachRelations(db, [mapMemory(db.prepare("SELECT * FROM memories WHERE id = ?").get(id))])[0];
}

export async function deleteMemory(id) {
  const db = await getDb();
  const info = db.prepare("DELETE FROM memories WHERE id = ?").run(id);
  return info.changes > 0;
}

export async function listMemories({ scope, projectId, conversationId, kind, query } = {}) {
  const db = await getDb();
  const clauses = [];
  const params = [];
  if (scope) {
    clauses.push("scope = ?");
    params.push(scope);
  }
  if (projectId) {
    clauses.push("project_id = ?");
    params.push(projectId);
  }
  if (conversationId) {
    clauses.push("conversation_id = ?");
    params.push(conversationId);
  }
  if (kind) {
    clauses.push("kind = ?");
    params.push(kind);
  }
  if (query) {
    clauses.push("(title LIKE ? OR content LIKE ? OR tags LIKE ?)");
    const like = `%${query}%`;
    params.push(like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`SELECT * FROM memories ${where} ORDER BY created_at DESC`).all(...params);
  return attachRelations(db, rows.map(mapMemory));
}

function tokenize(text) {
  return new Set(String(text || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
}

function scoreMemory(memory, queryTokens) {
  const words = tokenize(`${memory.title} ${memory.content} ${memory.tags.join(" ")}`);
  let overlap = 0;
  for (const word of words) if (queryTokens.has(word)) overlap += 1;
  return overlap;
}

// Scales cosine similarity (roughly 0..1 for embedding vectors) into the
// same rough magnitude as keyword-overlap counts (usually a handful of
// words), so neither signal drowns out the other by default. A memory that
// shares no words with the query but is clearly "about" the same thing —
// exactly the synonym/reformulation gap ROADMAP_MELHORIAS.md's Marco 3
// calls out — can now still out-rank a memory with a stray word match.
const SEMANTIC_SCALE = 5;
// Below this, cosine similarity is treated as noise rather than signal —
// unrelated text still tends to land well above 0 in embedding space, so a
// low-but-nonzero score isn't meaningful relevance on its own.
const SEMANTIC_THRESHOLD = 0.5;
const pendingEmbeddings = new Set();

/**
 * Selects the most relevant memories for a prompt, pulling from the
 * conversation's own memory first, then its project, then the global pool.
 * This is what makes memory "real": every conversation reads back its own
 * neurons plus whatever it inherited from its project and from the general
 * context, instead of a single undifferentiated bag of facts.
 *
 * Marco 3 (ROADMAP_MELHORIAS.md): ranking combines the original
 * keyword-overlap score with semantic (embedding) similarity when both the
 * query and a given memory have a vector available — computed in parallel,
 * not as a replacement, per the roadmap's own principle of preferring
 * local/reversible changes. When no embedding is available for the query
 * (Ollama not running, model not pulled yet, ...) this degrades exactly to
 * the pre-Marco-3 keyword-only ranking — same scores, same order.
 */
export async function selectRelevantMemories(input, { conversationId, projectId } = {}, limit = 12, env = process.env, signal) {
  const db = await getDb();
  const profile = taskProfile(input);
  const selective=selectiveContext(env);
  const queryTokens = selective ? new Set(profile.terms) : tokenize(input);
  if ((selective&&!queryTokens.size) || limit <= 0) return [];
  const queryEmbedding = await embedText(selective?profile.query:input, env, signal);
  const central = await centralConfig();
  const shared = central.downloadEnabled ? await relevantCentralMemories(selective ? profile.query : input) : [];
  const pools = [
    { scope: "conversation", weight: 1.6, rows: conversationId ? db.prepare("SELECT * FROM memories WHERE scope = 'conversation' AND conversation_id = ?").all(conversationId) : [] },
    { scope: "project", weight: 1.3, rows: projectId ? db.prepare("SELECT * FROM memories WHERE scope = 'project' AND project_id = ?").all(projectId) : [] },
    { scope: "global", weight: 1, rows: db.prepare("SELECT * FROM memories WHERE scope = 'global'").all() },
    { scope: 'personal', weight: 0.8, rows: central.crossChatEnabled ? db.prepare("SELECT * FROM memories WHERE scope='conversation' AND conversation_id != ?").all(conversationId || '') : [] },
    { scope: 'central', weight: 0.65, rows: shared.map(m => ({ id:m.id, scope:'central', title:m.title, content:m.content, tags:JSON.stringify(m.tags), kind:'imported', source:m.source, created_at:m.createdAt, updated_at:m.updatedAt })) },
  ];
  const scored = [];
  if (queryEmbedding) {
    // Incrementally repair legacy/missing vectors without delaying this search.
    for (const row of pools.filter(p => p.scope !== 'central').flatMap(p => p.rows).filter(r => !r.embedding || r.embedding_model !== resolveEmbeddingModel(env)).slice(0, 5)) {
      if (pendingEmbeddings.has(row.id)) continue;
      pendingEmbeddings.add(row.id);
      void attachEmbedding(db, row.id, embeddingInputFor(mapMemory(row)), env).finally(() => pendingEmbeddings.delete(row.id));
    }
  }
  for (const pool of pools) {
    for (const row of pool.rows) {
      const memory = mapMemory(row);
      const compatibility = selective?referenceCompatibility(profile,memory):{compatible:true,reason:'legacy'};
      if (!compatibility.compatible) continue;
      const headline = new Set(queryTerms(memory.title+' '+memory.tags.filter(t=>!t.startsWith('biblioteca-')).join(' ')));
      const words = new Set(queryTerms(memory.content));
      const titleMatches = [...queryTokens].filter(w=>headline.has(w));
      const overlap = [...queryTokens].filter(w=>words.has(w)).length;
      // Remote and cross-chat references must match the request even in legacy mode.
      if (['central','personal'].includes(pool.scope) && !titleMatches.length && overlap < 2) continue;
      if(selective&&compatibility.reason==='cross_domain' && titleMatches.length<2) continue;
      let semantic = 0;
      let similarity = null;
      if (queryEmbedding && row.embedding && row.embedding_model === resolveEmbeddingModel(env)) {
        const memoryEmbedding = decodeEmbedding(row.embedding);
        similarity = memoryEmbedding ? cosineSimilarity(queryEmbedding, memoryEmbedding) : 0;
        if (similarity >= SEMANTIC_THRESHOLD) semantic = similarity * SEMANTIC_SCALE;
      }
      if (selective&&!titleMatches.length && !(similarity >= 0.65) && overlap < 3) continue;
      const score = selective?(titleMatches.length * 2 + overlap * 0.3 + semantic) * pool.weight:(scoreMemory(memory,queryTokens)+semantic)*pool.weight+pool.weight*0.01;
      scored.push({ memory:{...memory,retrieval:{score,similarity,titleMatches,contentMatches:overlap,reason:compatibility.reason}}, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  if(!selective)return scored.slice(0,limit).map(s=>s.memory);
  const seen = new Set();
  return scored.filter(({memory})=>{const key=memory.content.trim().replace(/\s+/g,' ').toLowerCase();if(seen.has(key))return false;seen.add(key);return true;}).slice(0, Math.min(limit,3)).map((s) => s.memory);
}

/**
 * Small pool of pre-existing memories "nearby" a conversation (its own
 * memory, then its project's, then global), offered to the extractor as
 * candidates it may link a newly extracted memory to. Kept separate from
 * selectRelevantMemories() because this has no query to score against — it's
 * just "what's already there to potentially relate to", most recent first.
 */
export async function listNearbyMemories({ conversationId, projectId } = {}, limit = 8) {
  const db = await getDb();
  const pools = [
    conversationId ? db.prepare("SELECT * FROM memories WHERE scope = 'conversation' AND conversation_id = ? ORDER BY created_at DESC").all(conversationId) : [],
    projectId ? db.prepare("SELECT * FROM memories WHERE scope = 'project' AND project_id = ? ORDER BY created_at DESC").all(projectId) : [],
    db.prepare("SELECT * FROM memories WHERE scope = 'global' ORDER BY created_at DESC").all(),
  ];
  const seen = new Set();
  const result = [];
  for (const pool of pools) {
    for (const row of pool) {
      if (seen.has(row.id) || result.length >= limit) continue;
      seen.add(row.id);
      result.push(mapMemory(row));
    }
  }
  return result.slice(0, limit);
}

export async function countMemories() {
  const db = await getDb();
  const rows = db.prepare("SELECT scope, kind, COUNT(*) AS count FROM memories GROUP BY scope, kind").all();
  return rows;
}

/**
 * Token-savings math, derived entirely from existing message rows (no
 * separate counter to keep in sync). Every successful local-model turn is
 * saved with provider "Local"; every teacher correction is saved with
 * provider "<Codex|Claude> (corrigindo)". Sending the same turn straight to
 * Codex/Claude would have cost 2 paid calls (the answer + the automatic
 * memory extraction that runs after every non-local turn); a local turn
 * costs 0 paid calls, and a corrected one costs exactly 1 (the correction
 * call folds extraction into itself) — so the baseline this compares
 * against is `localTurns * 2`, never inflated by turns that were never local.
 */
export async function getSavingsStats() {
  const db = await getDb();
  const { localTurns } = db.prepare("SELECT COUNT(*) AS localTurns FROM messages WHERE provider = 'Local'").get();
  const { corrections } = db
    .prepare("SELECT COUNT(*) AS corrections FROM messages WHERE provider LIKE '%(corrigindo)%'")
    .get();
  const baselineCalls = localTurns * 2;
  const actualCalls = corrections;
  const savedCalls = Math.max(0, baselineCalls - actualCalls);
  const savingsPercent = baselineCalls > 0 ? Math.round((savedCalls / baselineCalls) * 100) : 0;
  return { localTurns, corrections, baselineCalls, actualCalls, savedCalls, savingsPercent };
}

// ---------- Settings (small key/value store, e.g. the chosen local model) ----------

export async function getSetting(key, fallback = null) {
  const db = await getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  const db = await getDb();
  db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(key, String(value), now());
  return value;
}
