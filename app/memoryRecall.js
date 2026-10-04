import { getDb } from "./db.js";
import { cosineSimilarity, decodeEmbedding, embedText, resolveEmbeddingModel } from "./embeddings.js";
import { selectiveContext } from "./contextSelection.js";
import { selectRelevantMemories } from "./store.js";

/**
 * The questions an agent's memory map has to answer: "what would I remember
 * for this prompt, and why?" and "what did I actually remember lately?".
 *
 * recallProbe() runs the exact selection the chat uses (selectRelevantMemories)
 * and adds the near misses — memories close in meaning that stayed out —
 * with the reason they stayed out. Nothing is written: usage counters only
 * move when a real answer uses a memory.
 */
const NEAR_MIN = 0.5;
const EVIDENCE = 0.7;

export async function recallProbe(query, { projectId, conversationId, env = process.env, signal } = {}) {
  const text = String(query || "").trim();
  if (!text) return { query: text, selective: selectiveContext(env), limit: 0, selected: [], near: [] };
  const selective = selectiveContext(env);
  const limit = selective ? 3 : 12;
  const selected = await selectRelevantMemories(text, { projectId, conversationId }, 12, env, signal);
  const chosen = new Set(selected.map((m) => m.id));

  const near = [];
  const vector = await embedText(text, env, signal).catch(() => null);
  if (vector) {
    const db = await getDb();
    const model = resolveEmbeddingModel(env);
    const rows = db.prepare("SELECT id, title, scope, embedding, embedding_model FROM memories WHERE status != 'archived' AND embedding IS NOT NULL").all();
    for (const row of rows) {
      if (chosen.has(row.id) || row.embedding_model !== model) continue;
      const embedding = decodeEmbedding(row.embedding);
      if (!embedding) continue;
      const similarity = cosineSimilarity(vector, embedding);
      if (similarity < NEAR_MIN) continue;
      near.push({
        id: row.id,
        title: row.title,
        scope: row.scope,
        similarity,
        why: similarity >= EVIDENCE
          ? `Parecida (${Math.round(similarity * 100)}%), mas ficou fora do limite de ${limit}`
          : `Parecida só ${Math.round(similarity * 100)}% e sem palavra do título na pergunta`,
      });
    }
    near.sort((a, b) => b.similarity - a.similarity);
  }
  return {
    query: text,
    selective,
    limit,
    embeddings: !!vector,
    selected: selected.map((m, rank) => ({
      id: m.id,
      title: m.title,
      scope: m.scope,
      rank: rank + 1,
      score: m.retrieval?.score ?? null,
      similarity: m.retrieval?.similarity ?? null,
      titleMatches: m.retrieval?.titleMatches ?? [],
      contentMatches: m.retrieval?.contentMatches ?? 0,
    })),
    near: near.slice(0, 8),
  };
}

/** The latest answers that used memory: the question, and which memories went in or came out. */
export async function recentRecalls(limit = 12) {
  const db = await getDb();
  const rows = db.prepare(`
    SELECT m.id, m.conversation_id, m.created_at, m.memory_access, m.memory_created, c.title AS conversation_title,
      (SELECT u.content FROM messages u WHERE u.conversation_id = m.conversation_id AND u.role = 'user' AND u.created_at <= m.created_at ORDER BY u.created_at DESC LIMIT 1) AS prompt
    FROM messages m LEFT JOIN conversations c ON c.id = m.conversation_id
    WHERE m.role = 'assistant' AND ((m.memory_access IS NOT NULL AND m.memory_access != '[]') OR (m.memory_created IS NOT NULL AND m.memory_created != '[]'))
    ORDER BY m.created_at DESC LIMIT ?`).all(limit);
  const ids = (value) => {
    try {
      const parsed = JSON.parse(value || "[]");
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  };
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    conversationTitle: r.conversation_title || "Conversa",
    at: r.created_at,
    prompt: String(r.prompt || "").replace(/\s+/g, " ").slice(0, 160),
    used: ids(r.memory_access),
    created: ids(r.memory_created),
  }));
}
