// The Mapa Vivo de Memórias' data (frontend/src/livemap): one snapshot of what is really stored — each memory
// (without its whole text), the explicit relations, the semantic atlas (clusters, positions, nearest
// neighbours by embedding similarity), the projects and conversations they belong to, and the latest turns
// that used memory. The frontend's MemoryGraphAdapter turns it into nodes, edges and clusters; the live
// events come through /api/memories/live (app/memoryEvents.js).
import { getDb } from "./db.js";
import { memoryAtlas } from "./memoryAtlas.js";
import { recentRecalls } from "./memoryRecall.js";
import { recentMemoryEvents } from "./memoryEvents.js";

const SNIPPET = 280;
const parse = (s, fallback) => { try { const v = JSON.parse(s || ""); return v ?? fallback; } catch { return fallback; } };

export async function memoryGraphSnapshot({ env = process.env, limit = 5000 } = {}) {
  const db = await getDb();
  const columns = new Set(db.prepare("PRAGMA table_info(memories)").all().map((c) => c.name));
  const has = (c) => columns.has(c);
  const rows = db.prepare(`SELECT id, scope, project_id, conversation_id, title, content, tags, kind, source, created_at, updated_at
    ${has("uses") ? ", uses, helped, failed" : ""}${has("status") ? ", status" : ""}${has("sensitive") ? ", sensitive" : ""}
    FROM memories ${has("status") ? "WHERE status != 'archived'" : ""} ORDER BY created_at ASC LIMIT ?`).all(limit);
  const ids = new Set(rows.map((r) => r.id));
  // A sensitive memory keeps its place on the map but shows nothing of itself (no text, no fingerprint).
  const sensitive = new Set(rows.filter((r) => r.sensitive).map((r) => r.id));
  const relations = db.prepare("SELECT from_id, to_id, type FROM memory_relations").all()
    .filter((r) => ids.has(r.from_id) && ids.has(r.to_id) && r.from_id !== r.to_id)
    .map((r) => ({ from: r.from_id, to: r.to_id, type: r.type }));
  const atlas = await memoryAtlas({ env }).catch(() => null);
  const projects = db.prepare("SELECT id, name FROM projects").all();
  const conversations = db.prepare("SELECT id, title, project_id FROM conversations").all().map((c) => ({ id: c.id, title: c.title || "Conversa", projectId: c.project_id || null }));
  return {
    generatedAt: new Date().toISOString(),
    memories: rows.map((r) => ({
      id: r.id, title: r.title, scope: r.scope, projectId: r.project_id || null, conversationId: r.conversation_id || null,
      kind: r.kind, source: r.source || null, tags: parse(r.tags, []),
      snippet: r.sensitive ? null : String(r.content || "").replace(/\s+/g, " ").slice(0, SNIPPET),
      sensitive: Boolean(r.sensitive), createdAt: r.created_at, updatedAt: r.updated_at,
      uses: r.uses || 0, helped: r.helped || 0, failed: r.failed || 0, status: r.status || "active",
    })),
    relations,
    atlas: atlas ? {
      model: atlas.model,
      clusters: atlas.clusters,
      // The sections are the Zeladora's nodes (stable): the map follows them as they are born and fold.
      nodes: Boolean(atlas.nodes),
      points: atlas.memories.filter((m) => ids.has(m.id)).map((m) => ({ id: m.id, position: m.position, cluster: m.cluster, neighbors: m.neighbors, ...(m.sig && !sensitive.has(m.id) ? { sig: m.sig } : {}) })),
    } : null,
    projects,
    conversations,
    recalls: await recentRecalls(30).catch(() => []),
    events: recentMemoryEvents({ limit: 60 }),
  };
}
