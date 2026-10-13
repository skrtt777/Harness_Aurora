import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

// "requested" ({ conversationId, tool, summary }): the desktop app tells the person when the window
// is not in front (a scheduled agent waiting for a yes nobody saw just timed out).
export const approvalEvents = new EventEmitter();

/**
 * Tracks in-flight local-model turns (one per conversation) so the frontend
 * can poll for a human-readable stage instead of showing a generic
 * "pensando…" for what can now be a multi-minute pipeline (retries +
 * self-review, all local/free), and so a stuck or unwanted turn can be
 * cancelled. Deliberately in-memory only — this is UI-facing progress, not
 * data that needs to survive a restart.
 */
const pending = new Map();

/** How many turns are being worked on right now, and the stage of one of them. */
export function activeTurns() {
  const stages = [...pending.values()].map((entry) => entry.stage).filter(Boolean);
  return { count: pending.size, stage: stages[0] || null };
}

export function startTurn(conversationId) {
  if (pending.has(conversationId)) throw Object.assign(new Error("Esta conversa já tem uma resposta em andamento."), { status: 409 });
  const controller = new AbortController();
  pending.set(conversationId, { controller, stage: "Gerando resposta…", since: Date.now() });
  return controller;
}

export function setStage(conversationId, stage) {
  const entry = pending.get(conversationId);
  if (entry) { entry.stage = stage; if (/revis|professor|c[oó]pias|refazendo/i.test(String(stage))) entry.reviewed = true; }
}

/**
 * A guard of the agent that fired (app/chatAgent.js checks): the Sede's Conferência, where the
 * delivery is held back and fixed (numbers per row, a file asked for, "rodou" without running…).
 */
export function setCheck(conversationId, check) {
  const entry = pending.get(conversationId);
  if (!entry) return;
  entry.checks ||= [];
  entry.checks.push({ check: String(check || "conferência"), at: Date.now() });
  if (entry.checks.length > 20) entry.checks.shift();
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
  // Every tool the turn used, in order (the ficha's stations; the steps above keep only the last 40).
  entry.tools ||= [];
  if (step.tool && entry.tools.at(-1) !== step.tool) { entry.tools.push(step.tool); if (entry.tools.length > 80) entry.tools.shift(); }
}

export function getTurnSteps(conversationId) {
  return pending.get(conversationId)?.steps || [];
}

export function setTurnPlan(conversationId, plan) {
  const entry = pending.get(conversationId);
  if (entry) entry.plan = plan;
}

export function getTurnPlan(conversationId) {
  return pending.get(conversationId)?.plan || null;
}

/**
 * Pauses the turn until the user clicks Permitir/Negar in the chat. The
 * pending request is exposed through /pending (which the UI already polls);
 * cancelling the turn or ending it resolves it as denied, so a tool can
 * never run on a stale approval. Nobody answering (the user walked away, or
 * the message came from a headset with no approve button) must not hold the
 * conversation forever: after `timeoutMs` the request is rejected, and the
 * tool reports that no one answered rather than "the user said no".
 */
export const APPROVAL_TIMEOUT_MS = 120_000;

export function requestApproval(conversationId, request, { timeoutMs = APPROVAL_TIMEOUT_MS } = {}) {
  const entry = pending.get(conversationId);
  if (!entry) return Promise.resolve(false);
  entry.approval?.resolve(false);
  return new Promise((resolve, reject) => {
    const approval = { id: randomUUID(), tool: request.tool, summary: request.summary, detail: request.detail || "", rule: request.rule || null, expiresAt: Date.now() + timeoutMs, resolve: null };
    let timer;
    const settle = (fn) => { clearTimeout(timer); if (entry.approval === approval) entry.approval = null; fn(); };
    approval.resolve = (value) => settle(() => resolve(value === "always" ? "always" : Boolean(value)));
    timer = setTimeout(() => settle(() => reject(new Error(`Ninguém respondeu ao pedido de autorização em ${Math.round(timeoutMs / 1000)} s; a ação não foi executada.`))), timeoutMs);
    timer.unref?.();
    entry.approval = approval;
    approvalEvents.emit("requested", { conversationId, tool: approval.tool, summary: approval.summary });
    entry.controller.signal.addEventListener("abort", () => approval.resolve(false), { once: true });
  });
}

export function getApproval(conversationId) {
  const approval = pending.get(conversationId)?.approval;
  return approval ? { id: approval.id, tool: approval.tool, summary: approval.summary, detail: approval.detail, rule: approval.rule, expiresAt: new Date(approval.expiresAt).toISOString() } : null;
}

/** `always` also turns the offered rule (e.g. "npm test") into a standing permission. */
export function resolveApproval(conversationId, id, approved, always = false) {
  const approval = pending.get(conversationId)?.approval;
  if (!approval || approval.id !== id) return false;
  approval.resolve(approved === true ? (always && approval.rule ? "always" : true) : false);
  return true;
}

export function endTurn(conversationId, controller) {
  const entry = pending.get(conversationId);
  if (!controller || entry?.controller === controller) {
    entry?.approval?.resolve(false);
    if (entry) { recent.unshift({ conversationId, since: entry.since, endedAt: Date.now(), cancelled: entry.controller.signal.aborted, tools: entry.tools || [], checks: (entry.checks || []).length, reviewed: !!entry.reviewed }); recent.length = Math.min(recent.length, 30); }
    pending.delete(conversationId);
  }
}

/**
 * A subagent of the turn (app/agentTools/subagents.js) and what it is doing, for the office:
 * patch { name, task, stage, step, done, ok, since, endedAt }; a step joins its last steps.
 */
export function setSubagent(conversationId, id, patch) {
  const entry = pending.get(conversationId);
  if (!entry) return;
  entry.subagents ||= new Map();
  const sub = entry.subagents.get(id) || { id, steps: [] };
  const { step, ...rest } = patch;
  Object.assign(sub, rest);
  if (step) {
    const last = sub.steps.at(-1);
    if (last?.status === "running" && step.status !== "running" && last.tool === step.tool) sub.steps[sub.steps.length - 1] = step; else sub.steps.push(step);
    if (sub.steps.length > 3) sub.steps.splice(0, sub.steps.length - 3);
  }
  entry.subagents.set(id, sub);
}

// Turns that ended lately (the office shows who just delivered taking a coffee): in memory only.
const recent = [];

/**
 * What every turn is doing right now, for the agents' office (app/office.js): its stage, the last
 * steps, the permission it waits for, how far its plan is; and the turns that ended in the last
 * `withinMs`.
 */
export function turnSnapshots({ withinMs = 5 * 60_000, now = Date.now() } = {}) {
  const active = [...pending.entries()].map(([conversationId, e]) => ({
    conversationId, stage: e.stage || null, since: e.since || null,
    steps: (e.steps || []).slice(-3).map((s) => ({ tool: s.tool, status: s.status || null, summary: String(s.summary || s.stage || "").slice(0, 160) })),
    approval: e.approval ? { tool: e.approval.tool, summary: String(e.approval.summary || "").slice(0, 160) } : null,
    plan: Array.isArray(e.plan) ? { done: e.plan.filter((p) => p.status === "done").length, total: e.plan.length } : null,
    tools: e.tools || [], checks: (e.checks || []).length, checkedAt: e.checks?.at(-1)?.at || 0, lastCheck: e.checks?.at(-1)?.check || null, reviewed: !!e.reviewed,
    subagents: [...(e.subagents?.values() || [])].map((sa) => ({ id: sa.id, name: sa.name, task: sa.task, stage: sa.stage || null, done: !!sa.done, ok: sa.ok ?? null, since: sa.since || null, endedAt: sa.endedAt || null,
      steps: sa.steps.map((st) => ({ tool: st.tool, status: st.status || null, summary: String(st.summary || st.stage || "").slice(0, 160) })) })),
  }));
  const ended = recent.filter((r) => now - r.endedAt <= withinMs && !pending.has(r.conversationId));
  return { active, ended };
}

export function cancelTurn(conversationId) {
  const entry = pending.get(conversationId);
  if (!entry) return false;
  entry.controller.abort();
  return true;
}
