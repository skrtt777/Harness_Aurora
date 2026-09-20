import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";
import { httpError, validateBody } from "./httpSecurity.js";

const scopes = new Set(["global", "project", "conversation"]);
const types = new Set(["belonging", "thematic", "derivation", "correction"]);
const key = m => JSON.stringify([m.scope, m.scope === "project" ? m.projectId : m.scope === "conversation" ? m.conversationId : null, m.title.trim().toLowerCase(), m.content.trim().toLowerCase()]);

// Validate everything, then perform a single synchronous SQLite transaction.
// Missing owners must not silently widen private project memories to global.
export async function importMemories(envelope) {
  if (envelope?.format !== "harness-aurora-memories" || envelope.version !== 1 || !Array.isArray(envelope.memories) || envelope.memories.length > 5000) throw httpError(400, "Formato de importação inválido (versão 1 esperada).");
  const db = await getDb();
  const ids = new Set();
  for (const entry of envelope.memories) {
    validateBody(entry);
    if (typeof entry.id !== "string" || !entry.id || ids.has(entry.id) || !scopes.has(entry.scope) || !entry.title?.trim() || !entry.content?.trim()) throw httpError(400, "Memória inválida ou ID repetido no arquivo.");
    ids.add(entry.id);
    if (entry.scope === "project" && !db.prepare("SELECT id FROM projects WHERE id = ?").get(entry.projectId || "")) throw httpError(400, "Projeto de uma memória importada não existe aqui. Nenhuma memória foi importada.");
    if (entry.scope === "conversation" && !db.prepare("SELECT id FROM conversations WHERE id = ?").get(entry.conversationId || "")) throw httpError(400, "Conversa de uma memória importada não existe aqui. Nenhuma memória foi importada.");
    if (entry.relations !== undefined && (!Array.isArray(entry.relations) || entry.relations.some(id => typeof id !== "string"))) throw httpError(400, "Relações inválidas.");
    if (entry.relationTypes !== undefined && (!entry.relationTypes || typeof entry.relationTypes !== "object" || Array.isArray(entry.relationTypes))) throw httpError(400, "Tipos de relações inválidos.");
  }
  for (const entry of envelope.memories) for (const id of entry.relations || []) {
    if (!ids.has(id) || id === entry.id || !types.has(entry.relationTypes?.[id])) throw httpError(400, "Relação aponta para memória ausente ou tem tipo inválido.");
  }
  const existing = new Map(db.prepare("SELECT *, project_id AS projectId, conversation_id AS conversationId FROM memories").all().map(row => [key(row), row.id]));
  const idMap = new Map();
  let imported = 0, skipped = 0, relationsCreated = 0;
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const insert = db.prepare("INSERT INTO memories(id,scope,project_id,conversation_id,title,content,tags,kind,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'imported',?,?,?)");
    for (const entry of envelope.memories) {
      const dedupe = key(entry);
      let id = existing.get(dedupe);
      if (id) skipped++;
      else {
        id = randomUUID();
        insert.run(id, entry.scope, entry.scope === "project" ? entry.projectId : null, entry.scope === "conversation" ? entry.conversationId : null, entry.title.trim(), entry.content.trim(), JSON.stringify(entry.tags || []), entry.source || "Importado", now, now);
        existing.set(dedupe, id); imported++;
      }
      idMap.set(entry.id, id);
    }
    const relation = db.prepare("INSERT OR IGNORE INTO memory_relations(id,from_id,to_id,type,created_at) VALUES(?,?,?,?,?)");
    for (const entry of envelope.memories) for (const target of entry.relations || []) {
      if (idMap.get(entry.id) !== idMap.get(target)) relationsCreated += Number(relation.run(randomUUID(), idMap.get(entry.id), idMap.get(target), entry.relationTypes[target], now).changes);
    }
    db.exec("COMMIT");
    return { imported, skipped, relationsCreated };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
