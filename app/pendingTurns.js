import { randomUUID } from "node:crypto";

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
  if (pending.has(conversationId)) throw Object.assign(new Error("Esta conversa já tem uma resposta em andamento."), { status: 409 });
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

// Text generated so far, for engines that stream (slow on-device inference).
export function setPartial(conversationId, text) {
  const entry = pending.get(conversationId);
  if (entry) entry.partial = text;
}

export function getPartial(conversationId) {
  return pending.get(conversationId)?.partial || null;
}

// Live tool steps of the chat agent, so the UI can show "Abrindo youtube.com…"
// as a list while the turn runs.
export function pushTurnStep(conversationId, step) {
  const entry = pending.get(conversationId);
  if (!entry) return;
  entry.steps ||= [];
  const last = entry.steps.at(-1);
  if (last?.status === "running" && step.status !== "running" && last.tool === step.tool) entry.steps[entry.steps.length - 1] = step;
  else entry.steps.push(step);
  if (entry.steps.length > 40) entry.steps.splice(0, entry.steps.length - 40);
}

export function getTurnSteps(conversationId) {
  return pending.get(conversationId)?.steps || [];
}

/**
 * Pauses the turn until the user clicks Permitir/Negar in the chat. The
 * pending request is exposed through /pending (which the UI already polls);
 * cancelling the turn or ending it resolves it as denied, so a tool can
 * never run on a stale approval.
 */
export function requestApproval(conversationId, request) {
  const entry = pending.get(conversationId);
  if (!entry) return Promise.resolve(false);
  entry.approval?.resolve(false);
  return new Promise((resolve) => {
    const approval = { id: randomUUID(), tool: request.tool, summary: request.summary, detail: request.detail || "", resolve: null };
    approval.resolve = (value) => { if (entry.approval === approval) entry.approval = null; resolve(Boolean(value)); };
    entry.approval = approval;
    entry.controller.signal.addEventListener("abort", () => approval.resolve(false), { once: true });
  });
}

export function getApproval(conversationId) {
  const approval = pending.get(conversationId)?.approval;
  return approval ? { id: approval.id, tool: approval.tool, summary: approval.summary, detail: approval.detail } : null;
}

export function resolveApproval(conversationId, id, approved) {
  const approval = pending.get(conversationId)?.approval;
  if (!approval || approval.id !== id) return false;
  approval.resolve(approved === true);
  return true;
}

export function endTurn(conversationId, controller) {
  const entry = pending.get(conversationId);
  if (!controller || entry?.controller === controller) {
    entry?.approval?.resolve(false);
    pending.delete(conversationId);
  }
}

export function cancelTurn(conversationId) {
  const entry = pending.get(conversationId);
  if (!entry) return false;
  entry.controller.abort();
  return true;
}
