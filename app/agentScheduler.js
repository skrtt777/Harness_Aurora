import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "./db.js";

/**
 * Phase D of docs/AGENTES_ROTEIRO.md: agents that start on their own. A schedule ("every N
 * minutes", or "at HH:MM on these weekdays") or a new file in a folder starts a run, one per
 * agent at a time and at most DAILY_LIMIT a day, so a bad trigger can't loop. Files already in
 * the folder when the watch starts never fire; only the ones that arrive later.
 */

export const TICK_MS = 30_000;
export const DAILY_LIMIT = 24;

const pad = (n) => String(n).padStart(2, "0");
const localDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Is a schedule trigger due now, given the start of its last scheduled run (ISO or null)? */
export function scheduleDue(trigger, lastStart, now = new Date()) {
  if (trigger?.type !== "schedule") return false;
  const last = lastStart ? new Date(lastStart) : null;
  if (trigger.everyMinutes) return !last || now - last >= trigger.everyMinutes * 60_000;
  const [h, m] = String(trigger.at || "").split(":").map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return false;
  if (!(trigger.weekdays || [1, 2, 3, 4, 5]).includes(now.getDay())) return false;
  const at = new Date(now);
  at.setHours(h, m, 0, 0);
  // Due from HH:MM on, once a day: a run that started after today's HH:MM already counted.
  return now >= at && !(last && last >= at);
}

/** "*.pdf", "nota*", "*" → a test for file names (case-insensitive). */
export function patternTest(pattern = "*") {
  const source = String(pattern || "*").split(/[;,]/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `^${p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`).join("|");
  const re = new RegExp(source || "^.*$", "i");
  return (name) => re.test(name);
}

/** Files directly in `folder` that match, as path → mtime. Unreadable folder → empty. */
export function folderFiles(folder, pattern) {
  const test = patternTest(pattern);
  const out = new Map();
  try {
    for (const name of readdirSync(folder)) {
      if (!test(name) || name.startsWith("~$")) continue;
      try { const st = statSync(join(folder, name)); if (st.isFile()) out.set(join(folder, name), st.mtimeMs); } catch { /* vanished */ }
    }
  } catch { /* folder missing or not readable */ }
  return out;
}

async function ready() {
  const db = await getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS agent_seen_files (
      agent_id TEXT NOT NULL, path TEXT NOT NULL, mtime REAL NOT NULL, PRIMARY KEY (agent_id, path))`);
  return db;
}

/**
 * Files that arrived since the last look. The first look at a folder only records what is
 * there (so turning a watch on doesn't process the whole backlog). A file saved again (newer
 * mtime) counts as new.
 */
export async function newFilesFor(agent) {
  const db = await ready();
  const now = folderFiles(agent.trigger.folder, agent.trigger.pattern);
  const seen = new Map(db.prepare("SELECT path, mtime FROM agent_seen_files WHERE agent_id = ?").all(agent.id).map((r) => [r.path, r.mtime]));
  const firstLook = !seen.size;
  const fresh = [...now].filter(([path, mtime]) => !seen.has(path) || mtime > seen.get(path) + 1).map(([path]) => path);
  const upsert = db.prepare("INSERT INTO agent_seen_files (agent_id, path, mtime) VALUES (?, ?, ?) ON CONFLICT(agent_id, path) DO UPDATE SET mtime = excluded.mtime");
  for (const [path, mtime] of now) upsert.run(agent.id, path, mtime);
  // An empty folder on the first look has no backlog: mark it watched so the next file fires.
  if (firstLook && !now.size) upsert.run(agent.id, "\u0000watching", 0);
  return firstLook ? [] : fresh;
}

const listeners = new Set();
/** Called with (agent, run) when a scheduled or file-triggered run finishes (desktop notification). */
export function onAutomaticRun(listener) { listeners.add(listener); return () => listeners.delete(listener); }

/**
 * One pass: start every due agent. `deps` makes it testable: listAgents, runAgent(id, opts),
 * isAgentRunning(id), lastRunStart(id, trigger), runsToday(id), now().
 */
export async function schedulerTick({ listAgents, runAgent, isAgentRunning, lastRunStart, runsToday, handleChatTurn, now = () => new Date() } = {}) {
  const started = [];
  for (const agent of await listAgents()) {
    const trigger = agent.trigger || {};
    if (!agent.enabled || !["schedule", "file"].includes(trigger.type) || isAgentRunning(agent.id)) continue;
    if ((await runsToday(agent.id)) >= DAILY_LIMIT) continue;
    let request = null;
    if (trigger.type === "schedule" && scheduleDue(trigger, await lastRunStart(agent.id, "schedule"), now())) request = trigger.request || agent.mission;
    if (trigger.type === "file") {
      const files = await newFilesFor(agent);
      // One run per arrival batch, naming the files: the agent treats them together.
      if (files.length) request = `${trigger.request || agent.mission}\n\nArquivo(s) novo(s) na pasta observada:\n${files.slice(0, 20).map((f) => `- ${f}`).join("\n")}`;
    }
    if (!request) continue;
    started.push(agent.id);
    void runAgent(agent.id, { request, trigger: trigger.type, handleChatTurn })
      .then((run) => { for (const listener of listeners) { try { listener(agent, run); } catch { /* a listener never breaks the scheduler */ } } })
      .catch(() => {});
  }
  return started;
}

let timer = null;
/** Starts the background scheduler (the desktop app does; tests and scripts don't). */
export function startAgentScheduler(deps) {
  if (timer) return;
  const tick = () => schedulerTick(deps).catch(() => {});
  timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  setTimeout(tick, 5_000).unref?.();
}

export function stopAgentScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Last start of a run with this trigger, and how many runs started today (local day). */
export async function runStats() {
  const db = await getDb();
  return {
    lastRunStart: async (id, trigger) => db.prepare("SELECT started_at FROM agent_runs WHERE agent_id = ? AND trigger = ? ORDER BY started_at DESC LIMIT 1").get(id, trigger)?.started_at || null,
    runsToday: async (id) => db.prepare("SELECT started_at FROM agent_runs WHERE agent_id = ? AND trigger != 'manual' ORDER BY started_at DESC LIMIT ?").all(id, DAILY_LIMIT + 1).filter((r) => localDay(new Date(r.started_at)) === localDay(new Date())).length,
  };
}
