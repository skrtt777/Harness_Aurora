/**
 * Tracks in-flight local-model turns (one per conversation) so the frontend
 * can poll for a human-readable stage instead of showing a generic
 * "pensando…" for what can now be a multi-minute pipeline (retries +
 * self-review, all local/free), and so a stuck or unwanted turn can be
 * cancelled. Deliberately in-memory only — this is UI-facing progress, not
 * data that needs to survive a restart.
 */
const pending = new Map();

export function startTurn(conversationId) {
  const controller = new AbortController();
  pending.set(conversationId, { controller, stage: "Gerando resposta…" });
  return controller;
}

export function setStage(conversationId, stage) {
  const entry = pending.get(conversationId);
  if (entry) entry.stage = stage;
}

export function getStage(conversationId) {
  return pending.get(conversationId)?.stage || null;
}

export function endTurn(conversationId) {
  pending.delete(conversationId);
}

export function cancelTurn(conversationId) {
  const entry = pending.get(conversationId);
  if (!entry) return false;
  entry.controller.abort();
  return true;
}
