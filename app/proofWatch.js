/**
 * The resposta viva over the database: each answer with a comprovante is checked again against its files
 * (app/proofLive.js) and the result is kept in the message (execution.live), so the chat shows "mudou"
 * where the number is written and the home can list the answers that went out of date.
 */
import { getDb } from "./db.js";
import { getConversationWithMessages, getProject } from "./store.js";
import { liveIo, recheckAnswer, recheckSummary } from "./proofLive.js";

const sameLive = (a, b) => JSON.stringify(a?.claims?.map((c) => [c.raw, c.status, c.now]) || null) === JSON.stringify(b?.claims?.map((c) => [c.raw, c.status, c.now]) || null);

/** The answers of one conversation, checked again: { [messageId]: live }. Stored when the result changed. */
export async function recheckConversation(id, { env = process.env, limit = 40, now = new Date() } = {}) {
  const conversation = await getConversationWithMessages(id);
  if (!conversation) return null;
  const project = conversation.projectId ? await getProject(conversation.projectId).catch(() => null) : null;
  const db = await getDb();
  const out = {};
  const proven = conversation.messages.map((m, k) => ({ m, k })).filter(({ m }) => m.role === "assistant" && m.execution?.proof).slice(-limit);
  for (const { m, k } of proven) {
    const request = [...conversation.messages.slice(0, k)].reverse().find((x) => x.role === "user")?.content || "";
    let live = null;
    try { live = await recheckAnswer(m, await liveIo({ workspace: project?.workspaceDir || "", request, env }), { now }); } catch { continue; }
    if (!live) continue;
    out[m.id] = live;
    if (!sameLive(live, m.execution.live)) db.prepare("UPDATE messages SET execution = ? WHERE id = ?").run(JSON.stringify({ ...m.execution, live }), m.id);
  }
  return out;
}

/**
 * The answers that went out of date, across the conversations: the most recent answers with a comprovante,
 * checked again; those with a number that changed or is gone. A stat per file when nothing changed.
 */
export async function staleAnswers({ env = process.env, scan = 120, now = new Date() } = {}) {
  const db = await getDb();
  const rows = db.prepare("SELECT id, conversation_id FROM messages WHERE role = 'assistant' AND execution LIKE '%\"proof\":{%' ORDER BY created_at DESC LIMIT ?").all(scan);
  const conversations = [...new Set(rows.map((r) => r.conversation_id))];
  const stale = [];
  for (const id of conversations) {
    const conversation = await getConversationWithMessages(id);
    if (!conversation || conversation.archivedAt) continue;
    const lives = await recheckConversation(id, { env, now }).catch(() => ({}));
    for (const [messageId, live] of Object.entries(lives || {})) {
      if (live.verdict !== "mudou") continue;
      const m = conversation.messages.find((x) => x.id === messageId);
      stale.push({ conversationId: id, title: conversation.title, messageId, answeredAt: m?.createdAt || null, files: live.files.filter((f) => f.changed || f.missing).map((f) => f.name), changed: live.changed, summary: recheckSummary(live) });
    }
  }
  return stale.sort((a, b) => String(b.answeredAt).localeCompare(String(a.answeredAt)));
}
