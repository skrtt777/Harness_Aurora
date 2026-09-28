import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./db.js";
import { httpError } from "./httpSecurity.js";

// One benchmark at a time; its progress lives in memory, results in SQLite
// so the success-rate curve survives restarts.
let current = null;

async function ready() {
  const db = await getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS agent_eval_runs(id TEXT PRIMARY KEY, created_at TEXT NOT NULL, model TEXT, with_memories INTEGER NOT NULL, memory_count INTEGER NOT NULL DEFAULT 0, passed INTEGER NOT NULL, total INTEGER NOT NULL, document TEXT NOT NULL)`);
  return db;
}

export async function listEvalRuns(limit = 30) {
  return (await ready()).prepare("SELECT * FROM agent_eval_runs ORDER BY created_at DESC LIMIT ?").all(limit).map((row) => ({
    id: row.id, createdAt: row.created_at, model: row.model, withMemories: !!row.with_memories, memoryCount: row.memory_count, passed: row.passed, total: row.total, ...JSON.parse(row.document),
  }));
}

export function evalStatus() {
  return current ? { running: true, id: current.id, withMemories: current.withMemories, progress: current.progress, startedAt: current.startedAt } : { running: false };
}

export async function startEvalRun({ withMemories = true, env = process.env, runner = fileURLToPath(new URL("./agentEvalRunner.mjs", import.meta.url)) } = {}) {
  if (current) throw httpError(409, "Já existe uma avaliação em andamento.");
  const db = await ready();
  const folder = mkdtempSync(join(tmpdir(), "aurora-eval-db-"));
  const copy = join(folder, "copia.db");
  db.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
  const memoryCount = withMemories ? db.prepare("SELECT count(*) n FROM memories WHERE status != 'archived'").get().n : 0;
  const run = { id: randomUUID(), withMemories, memoryCount, progress: null, startedAt: new Date().toISOString() };
  current = run;
  const child = spawn(process.execPath, [runner, ...(withMemories ? [] : ["--no-memories"])], {
    env: { ...process.env, ...env, HARNESS_DB_FILE: copy, ELECTRON_RUN_AS_NODE: "1", EMBEDDINGS_ENABLED: env.EMBEDDINGS_ENABLED ?? process.env.EMBEDDINGS_ENABLED ?? "" },
    windowsHide: true,
  });
  run.child = child;
  let buffer = "";
  let done = null;
  let failure = null;
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    buffer += chunk;
    for (let i = buffer.indexOf("\n"); i >= 0; i = buffer.indexOf("\n")) {
      const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
      try { const event = JSON.parse(line); if (event.progress) run.progress = event.progress; if (event.done) done = event.done; if (event.error) failure = event.error; } catch { /* log lines */ }
    }
  });
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr = (stderr + chunk).slice(-2000); });
  run.finished = new Promise((resolve) => child.on("close", async () => {
    try {
      if (done) {
        (await ready()).prepare("INSERT INTO agent_eval_runs(id,created_at,model,with_memories,memory_count,passed,total,document) VALUES(?,?,?,?,?,?,?,?)")
          .run(run.id, run.startedAt, done.model, withMemories ? 1 : 0, memoryCount, done.summary.passed, done.summary.total, JSON.stringify({ summary: done.summary, results: done.results }));
      } else run.error = failure || stderr.split("\n").filter(Boolean).at(-1) || "A avaliação terminou sem resultado.";
    } finally {
      current = null;
      rmSync(folder, { recursive: true, force: true });
      resolve(run);
    }
  }));
  return { id: run.id };
}

export function cancelEvalRun() {
  if (!current?.child) return false;
  current.child.kill();
  return true;
}
