import { randomUUID } from "node:crypto";

/**
 * Tracks in-flight (and recently finished) browser-agent runs so the
 * frontend can poll for progress and cancel a stuck/unwanted run — the
 * same in-memory, not-persisted-to-disk design as pendingTurns.js, for the
 * same reason: this is UI-facing progress, not data that needs to survive
 * a restart. Kept as a separate module (not folded into pendingTurns.js)
 * because a browser-agent run isn't tied to a conversation the way a local
 * chat turn is — it's keyed by its own runId.
 */
const runs = new Map();

// Caps how many step events a single run keeps in memory — a runaway agent
// hitting the step limit still shouldn't grow this unbounded.
const MAX_STEPS_KEPT = 200;

export function createRun() {
  if ([...runs.values()].some(r => r.status === "running")) throw Object.assign(new Error("Já existe um agente de navegador em execução."), { status: 409 });
  for (const [id, run] of runs) if (Date.now() - run.createdAt > 3600000 || runs.size >= 50) runs.delete(id);
  const id = randomUUID();
  const controller = new AbortController();
  runs.set(id, { id, controller, createdAt: Date.now(), status: "running", steps: [], result: null });
  return { id, controller };
}

export function pushStep(id, event) {
  const run = runs.get(id);
  if (!run) return;
  run.steps.push({ ...event, at: new Date().toISOString() });
  if (run.steps.length > MAX_STEPS_KEPT) run.steps.splice(0, run.steps.length - MAX_STEPS_KEPT);
}

export function finishRun(id, result) {
  const run = runs.get(id);
  if (!run) return;
  run.status = result?.cancelled ? "cancelled" : result?.ok ? "done" : "error";
  run.result = result;
}

export function getRun(id) {
  return runs.get(id) || null;
}
export function getActiveRun() { return [...runs.values()].find(r => r.status === "running") || null; }

export function cancelRun(id) {
  const run = runs.get(id);
  if (!run) return false;
  run.controller.abort();
  return true;
}

export function resetAgentRunsForTests() {
  runs.clear();
}
