// Child process for the agent benchmark: runs against a COPY of the user's
// database (passed in HARNESS_DB_FILE by agentEvalRuns.js), prints one JSON
// line per progress event and a final {"done":…} line. Usable by hand too:
//   HARNESS_DB_FILE=<copia.db> node app/agentEvalRunner.mjs [--no-memories]
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.BROWSER_AGENT_HEADLESS = "1";
process.env.BROWSER_AGENT_PROFILE_DIR ||= mkdtempSync(join(tmpdir(), "aurora-eval-profile-"));
if (!process.env.HARNESS_DB_FILE) { console.error("Defina HARNESS_DB_FILE com uma cópia do banco."); process.exit(2); }

const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
try {
  const { getDb } = await import("./db.js");
  const db = await getDb();
  if (process.argv.includes("--no-memories")) db.exec("DELETE FROM memories");
  db.prepare("INSERT INTO settings(key,value,updated_at) VALUES('browser_backend','aurora',?) ON CONFLICT(key) DO UPDATE SET value='aurora'").run(new Date().toISOString());
  const { runAgentEval, summarizeEval } = await import("./agentEval.js");
  const { resolveLocalModel } = await import("./ollamaSetup.js");
  const results = await runAgentEval({ onProgress: (progress) => emit({ progress }) });
  emit({ done: { model: await resolveLocalModel(process.env), results, summary: summarizeEval(results) } });
  process.exit(0);
} catch (error) {
  emit({ error: error.message });
  process.exit(1);
}
