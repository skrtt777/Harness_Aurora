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
  return { id: row.id, name: row.name, instructions: row.instructions, workspaceDir: row.workspace_dir || "", createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapConversation(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id || null,
    title: row.title,
    provider: row.provider,
    teacherProvider: row.teacher_provider || null,
    archivedAt: row.archived_at || null,
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
    stats: { uses: row.uses || 0, helped: row.helped || 0, failed: row.failed || 0 },
    status: row.status || "active",
    candidate: isCandidateLesson(row),
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

export async function createProject({ name, instructions = "", workspaceDir = "" }) {
  const db = await getDb();
  const id = randomUUID();
  const ts = now();
  db.prepare(
    "INSERT INTO projects (id, name, instructions, workspace_dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, String(name || "Novo projeto").trim() || "Novo projeto", String(instructions || ""), String(workspaceDir || "").trim() || null, ts, ts);
  return getProject(id);
}

export async function updateProject(id, patch) {
  const db = await getDb();
  const existing = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  if (!existing) return null;
  const name = patch.name !== undefined ? String(patch.name).trim() || existing.name : existing.name;
  const instructions = patch.instructions !== undefined ? String(patch.instructions) : existing.instructions;
  const workspaceDir = patch.workspaceDir !== undefined ? String(patch.workspaceDir).trim() || null : existing.workspace_dir;
  db.prepare("UPDATE projects SET name = ?, instructions = ?, workspace_dir = ?, updated_at = ? WHERE id = ?").run(
    name,
    instructions,
    workspaceDir,
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

export async function listConversations({ projectId, archived = false } = {}) {
  const db = await getDb();
  const archivedClause = archived ? "archived_at IS NOT NULL" : "archived_at IS NULL";
  const rows = projectId
    ? db.prepare(`SELECT * FROM conversations WHERE project_id = ? AND ${archivedClause} ORDER BY updated_at DESC`).all(projectId)
    : db.prepare(`SELECT * FROM conversations WHERE ${archivedClause} ORDER BY updated_at DESC`).all();
  return rows.map(mapConversation);
}

// Marco 6 (ROADMAP_MELHORIAS.md): a busca da sidebar só olha o título, então
// uma conversa com título genérico ("Nova conversa" truncado) é praticamente
// impossível de reencontrar por assunto. Isto varre o conteúdo das
// mensagens também — LIKE simples (case-insensitive via COLLATE NOCASE),
// não é busca semântica.
export async function searchConversations(query) {
  const db = await getDb();
  const like = `%${query}%`;
  const rows = db
    .prepare(
      `SELECT DISTINCT c.* FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id
       WHERE c.archived_at IS NULL AND (c.title LIKE ? COLLATE NOCASE OR m.content LIKE ? COLLATE NOCASE)
       ORDER BY c.updated_at DESC
       LIMIT 50`,
    )
    .all(like, like);
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
  const archivedAt = patch.archived !== undefined ? (patch.archived ? now() : null) : existing.archived_at;
  if(patch.teacherProvider!==undefined&&!['codex','claude'].includes(patch.teacherProvider))throw new Error('Professor inválido.');
  const teacherProvider=patch.teacherProvider===undefined?existing.teacher_provider:patch.teacherProvider;
  db.prepare("UPDATE conversations SET title = ?, project_id = ?, archived_at = ?, teacher_provider = ?, updated_at = ? WHERE id = ?").run(
    title,
    projectId,
    archivedAt,
    teacherProvider,
    now(),
    id,
  );
  return getConversation(id);
}

export async function touchConversation(id) {
  const db = await getDb();
  db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now(), id);
}

// Backlog item (ROADMAP_MELHORIAS.md): "tentar de novo do zero" mantendo o
// histórico anterior intacto como referência — copia a conversa inteira
// (mensagens incluídas) para uma nova, sem tocar na original. Timestamps
// das mensagens são preservados (é uma cópia do histórico, não turnos
// novos); memory_access/memory_created/memory_status voltam ao estado
// inicial porque a duplicata não passou de fato pela extração de memória —
// só a conversa original passou. correction_of é remapeado para o id da
// mensagem duplicada correspondente, nunca para o id original.
export async function duplicateConversation(id) {
  const db = await getDb();
  const original = db.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
  if (!original) return null;
  const messages = db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC").all(id);
  const newId = randomUUID();
  const ts = now();
  db.prepare(
    "INSERT INTO conversations (id, project_id, title, provider, teacher_provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(newId, original.project_id, `${original.title} (cópia)`, original.provider, original.teacher_provider, ts, ts);
  const idMap = new Map();
  const insert = db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, provider, memory_access, memory_created, created_at, memory_status, correction_of, execution)
     VALUES (?, ?, ?, ?, ?, '[]', '[]', ?, 'none', ?, ?)`,
  );
  for (const m of messages) {
    const newMessageId = randomUUID();
    insert.run(newMessageId, newId, m.role, m.content, m.provider, m.created_at, m.correction_of ? idMap.get(m.correction_of) || null : null, m.execution);
    idMap.set(m.id, newMessageId);
  }
  return getConversation(newId);
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

const DUPLICATE_WORD_OVERLAP = 0.8;
const DUPLICATE_SIMILARITY = 0.93;

const dedupeWords = (text) => new Set(String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[a-z0-9]+/g) || []);

/**
 * Automatic lessons repeat a lot (the distillation runs saved the same
 * number-formatting rule 4 times). A near-identical memory in the same scope
 * is returned instead of stored again — by word overlap, or by embedding when
 * one is available. Memories the user writes by hand are never merged.
 */
export function findDuplicateMemory(rows, content, vector, model) {
  const words = dedupeWords(content);
  for (const row of rows) {
    const other = dedupeWords(row.content);
    const shared = [...words].filter((w) => other.has(w)).length;
    const union = new Set([...words, ...other]).size;
    if (union && shared / union >= DUPLICATE_WORD_OVERLAP) return row;
    if (vector && row.embedding && row.embedding_model === model) {
      const existing = decodeEmbedding(row.embedding);
      if (existing && cosineSimilarity(vector, existing) >= DUPLICATE_SIMILARITY) return row;
    }
  }
  return null;
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
  dedupe = kind !== "manual",
}) {
  if (!Array.isArray(tags) || tags.some(t => typeof t !== "string")) throw new Error("Tags devem ser uma lista de textos.");
  const db = await getDb();
  if (!["global", "project", "conversation"].includes(scope)) throw new Error("Escopo inválido.");
  if (scope === "project" && !projectId) throw new Error("Memória de projeto requer projectId.");
  if (scope === "conversation" && !conversationId) throw new Error("Memória de conversa requer conversationId.");
  const cleanContent = String(content || "").trim();
  if (!cleanContent) throw new Error("O conteúdo da memória é obrigatório.");
  const cleanTitle = String(title || "Memória").trim() || "Memória";
  const embeddingText = embeddingInputFor({ title: cleanTitle, content: cleanContent, tags });
  const vector = dedupe ? await embedText(embeddingText, env).catch(() => null) : null;
  if (dedupe) {
    const siblings = db.prepare("SELECT * FROM memories WHERE scope = ? AND IFNULL(project_id, '') = ? AND IFNULL(conversation_id, '') = ?")
      .all(scope, scope === "project" ? projectId : "", scope === "conversation" ? conversationId : "");
    const duplicate = findDuplicateMemory(siblings, cleanContent, vector, resolveEmbeddingModel(env));
    if (duplicate) return { ...attachRelations(db, [mapMemory(duplicate)])[0], deduplicated: true };
  }
  const id = randomUUID();
  const ts = now();
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
  if (vector) db.prepare("UPDATE memories SET embedding = ?, embedding_model = ? WHERE id = ?").run(encodeEmbedding(vector), resolveEmbeddingModel(env), id);
  else await attachEmbedding(db, id, embeddingText, env);
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

/** Archive (kept, out of the prompt and the Atlas) or bring back a memory. */
export async function setMemoryStatus(id, status) {
  if (!["active", "archived"].includes(status)) throw Object.assign(new Error("Estado inválido (use active ou archived)."), { status: 400 });
  const db = await getDb();
  const info = db.prepare("UPDATE memories SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), id);
  return info.changes > 0 ? mapMemory(db.prepare("SELECT * FROM memories WHERE id = ?").get(id)) : null;
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
// A memory only enters the prompt with evidence that it is about the request: a
// meaningful word of its title/tags, or similarity at least this high. Measured with
// nomic-embed-text on the real memory base (scripts/eval-memory-retrieval.mjs):
// unrelated requests peak at 0.675, while targets below 0.70 all share a title word.
const SEMANTIC_EVIDENCE = 0.7;
// A title word only counts as evidence when it is distinctive: present in few titles.
// Generic words of the base ("jogos", "movimento") would otherwise admit dozens of memories.
const distinctiveLimit = total => Math.max(5, Math.ceil(total * 0.06));
const headlineTerms = memory => new Set(queryTerms(memory.title+' '+memory.tags.filter(t=>!t.startsWith('biblioteca-')).join(' ')));
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
  const local = pools.filter(p => p.scope !== 'central').flatMap(p => p.rows);
  const frequency = new Map();
  for (const row of local) for (const w of headlineTerms(mapMemory(row))) frequency.set(w, (frequency.get(w) || 0) + 1);
  const evidenceTerms = new Set(queryTerms(input).filter(w => (frequency.get(w) || 0) <= distinctiveLimit(local.length)));
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
      if (row.status === "archived") continue;
      const memory = mapMemory(row);
      const compatibility = selective?referenceCompatibility(profile,memory):{compatible:true,reason:'legacy'};
      if (!compatibility.compatible) continue;
      const headline = headlineTerms(memory);
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
      if (!selective) {
        // Without a vector for either side, fall back to meaningful word overlap only.
        const titleEvidence = [...evidenceTerms].some(w => headline.has(w));
        const semanticEvidence = similarity !== null && similarity >= SEMANTIC_EVIDENCE;
        const contentEvidence = similarity === null && [...evidenceTerms].filter(w => words.has(w)).length >= 2;
        if (!titleEvidence && !semanticEvidence && !contentEvidence) continue;
      }
      const score = (selective?(titleMatches.length * 2 + overlap * 0.3 + semantic) * pool.weight:(scoreMemory(memory,queryTokens)+semantic)*pool.weight+pool.weight*0.01) * usefulness(row);
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

// A teacher's lesson is a candidate until it helps once: a correction made without
// context ("pergunte antes de atualizar valores") went in at full weight and made the
// next answers worse (04/10/2026).
const TEACHER_SOURCE = /^(Lição de|Correção ensinada|Esqueleto ensinado)/;
export function isCandidateLesson(row) {
  return TEACHER_SOURCE.test(String(row.source || "")) && !(row.helped > 0);
}

// Proven lessons rank higher, lessons that keep failing sink (0.5x–1.5x); candidates start at 0.6x.
function usefulness(row) {
  const helped = row.helped || 0;
  const failed = row.failed || 0;
  if (isCandidateLesson(row)) return Math.max(0.3, 0.6 - 0.15 * failed);
  return Math.min(1.5, Math.max(0.5, 1 + 0.1 * helped - 0.15 * failed));
}

const ARCHIVE_AFTER_FAILURES = 3;
// A candidate that failed twice without ever helping goes sooner.
const ARCHIVE_CANDIDATE_AFTER = 2;

/**
 * Records how a turn went for the memories that were in its context.
 * "helped"/"failed" come from the teaching loop (clean turn vs. error or
 * teacher verdict "fix"); a memory that failed ARCHIVE_AFTER_FAILURES times
 * without ever helping is archived — kept, but no longer injected.
 */
export async function recordMemoryOutcome(ids = [], outcome) {
  const unique = [...new Set(ids)].filter((id) => typeof id === "string");
  if (!unique.length || !["helped", "failed", "used"].includes(outcome)) return;
  const db = await getDb();
  const update = db.prepare(`UPDATE memories SET uses = uses + 1${outcome === "used" ? "" : `, ${outcome} = ${outcome} + 1`} WHERE id = ?`);
  const archive = db.prepare("UPDATE memories SET status = 'archived' WHERE id = ? AND kind != 'manual' AND helped = 0 AND failed >= (CASE WHEN source LIKE 'Lição de%' OR source LIKE 'Correção ensinada%' OR source LIKE 'Esqueleto ensinado%' THEN ? ELSE ? END)");
  db.exec("BEGIN");
  try {
    for (const id of unique) { update.run(id); archive.run(id, ARCHIVE_CANDIDATE_AFTER, ARCHIVE_AFTER_FAILURES); }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

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
