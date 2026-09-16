import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";

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
    content: row.content,
    provider: row.provider || undefined,
    memoryAccess: parseJsonArray(row.memory_access),
    memoryCreated: parseJsonArray(row.memory_created),
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
  };
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
    .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC")
    .all(id);
  return { ...conversation, messages: rows.map(mapMessage) };
}

export async function createConversation({ projectId = null, title = "Nova conversa", provider = "codex" } = {}) {
  const db = await getDb();
  if (projectId) {
    const project = db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
    if (!project) throw new Error("Projeto não encontrado.");
  }
  const id = randomUUID();
  const ts = now();
  db.prepare(
    "INSERT INTO conversations (id, project_id, title, provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, projectId, title, provider, ts, ts);
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

export async function addMessage({ conversationId, role, content, provider, memoryAccess = [], memoryCreated = [] }) {
  const db = await getDb();
  const id = randomUUID();
  const ts = now();
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, provider, memory_access, memory_created, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, conversationId, role, content, provider || null, JSON.stringify(memoryAccess), JSON.stringify(memoryCreated), ts);
  await touchConversation(conversationId);
  return mapMessage(db.prepare("SELECT * FROM messages WHERE id = ?").get(id));
}

export async function listMessages(conversationId) {
  const db = await getDb();
  const rows = db
    .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC")
    .all(conversationId);
  return rows.map(mapMessage);
}

// ---------- Memories ----------

export async function createMemory({
  scope = "global",
  projectId = null,
  conversationId = null,
  title,
  content,
  tags = [],
  kind = "manual",
  source,
}) {
  const db = await getDb();
  if (!["global", "project", "conversation"].includes(scope)) throw new Error("Escopo inválido.");
  if (scope === "project" && !projectId) throw new Error("Memória de projeto requer projectId.");
  if (scope === "conversation" && !conversationId) throw new Error("Memória de conversa requer conversationId.");
  const cleanContent = String(content || "").trim();
  if (!cleanContent) throw new Error("O conteúdo da memória é obrigatório.");
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
    String(title || "Memória").trim() || "Memória",
    cleanContent,
    JSON.stringify(tags || []),
    kind,
    source || null,
    ts,
    ts,
  );
  return mapMemory(db.prepare("SELECT * FROM memories WHERE id = ?").get(id));
}

export async function updateMemory(id, patch) {
  const db = await getDb();
  const existing = db.prepare("SELECT * FROM memories WHERE id = ?").get(id);
  if (!existing) return null;
  const title = patch.title !== undefined ? String(patch.title).trim() || existing.title : existing.title;
  const content = patch.content !== undefined ? String(patch.content).trim() || existing.content : existing.content;
  const tags = patch.tags !== undefined ? JSON.stringify(patch.tags) : existing.tags;
  db.prepare("UPDATE memories SET title = ?, content = ?, tags = ?, updated_at = ? WHERE id = ?").run(
    title,
    content,
    tags,
    now(),
    id,
  );
  return mapMemory(db.prepare("SELECT * FROM memories WHERE id = ?").get(id));
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
  return rows.map(mapMemory);
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

/**
 * Selects the most relevant memories for a prompt, pulling from the
 * conversation's own memory first, then its project, then the global pool.
 * This is what makes memory "real": every conversation reads back its own
 * neurons plus whatever it inherited from its project and from the general
 * context, instead of a single undifferentiated bag of facts.
 */
export async function selectRelevantMemories(input, { conversationId, projectId } = {}, limit = 12) {
  const db = await getDb();
  const queryTokens = tokenize(input);
  const pools = [
    { scope: "conversation", weight: 1.6, rows: conversationId ? db.prepare("SELECT * FROM memories WHERE scope = 'conversation' AND conversation_id = ?").all(conversationId) : [] },
    { scope: "project", weight: 1.3, rows: projectId ? db.prepare("SELECT * FROM memories WHERE scope = 'project' AND project_id = ?").all(projectId) : [] },
    { scope: "global", weight: 1, rows: db.prepare("SELECT * FROM memories WHERE scope = 'global'").all() },
  ];
  const scored = [];
  for (const pool of pools) {
    for (const row of pool.rows) {
      const memory = mapMemory(row);
      const overlap = scoreMemory(memory, queryTokens);
      scored.push({ memory, score: overlap * pool.weight + pool.weight * 0.01 });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.memory);
}

export async function countMemories() {
  const db = await getDb();
  const rows = db.prepare("SELECT scope, kind, COUNT(*) AS count FROM memories GROUP BY scope, kind").all();
  return rows;
}
