// How the comprovante (app/proof.js) did on the answers of a database copy: how many answers carry a
// proof, their seals, and every number left without a source (to tell a real slip of the model from a
// number the proof failed to find).
//   node scripts/proof-report.mjs --db <copia.db> [--since 2026-10-27T00:00] [--all]
import { DatabaseSync } from "node:sqlite";

const arg = (name, fallback = null) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const db = new DatabaseSync(arg("db"), { readOnly: true });
const since = arg("since", "1970-01-01");
const rows = db.prepare("SELECT id, content, execution, created_at FROM messages WHERE role = 'assistant' AND created_at >= ? ORDER BY created_at").all(since);
let answers = 0, withProof = 0, claims = 0, proven = 0;
const seals = {}, status = {}, missing = [];
for (const row of rows) {
  answers += 1;
  let execution = null;
  try { execution = JSON.parse(row.execution || "null"); } catch { /* old row */ }
  const proof = execution?.proof;
  if (!proof) continue;
  withProof += 1;
  seals[proof.seal] = (seals[proof.seal] || 0) + 1;
  claims += proof.total; proven += proof.proven;
  for (const c of proof.claims) {
    status[c.status] = (status[c.status] || 0) + 1;
    if (c.status === "sem-prova") missing.push({ raw: c.raw, around: row.content.slice(Math.max(0, c.start - 70), c.end + 50).replace(/\s+/g, " "), sources: proof.sources.join(", ") });
  }
}
console.log(`Respostas: ${answers}; com comprovante: ${withProof}; números: ${claims}; com prova: ${proven} (${claims ? ((100 * proven) / claims).toFixed(1) : 0}%)`);
console.log("Selos:", seals);
console.log("Por status:", status);
console.log(`\nSem fonte (${missing.length}):`);
for (const m of missing.slice(0, process.argv.includes("--all") ? 1000 : 40)) console.log(`- ${m.raw}  …${m.around}…  [${m.sources}]`);
