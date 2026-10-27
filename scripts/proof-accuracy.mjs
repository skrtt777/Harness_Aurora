// How well the comprovante tells right from wrong on a usage-test run: each answer of the report
// (reports/uso/<label>.json, with its checks) joined to the proof saved with it in the run's database.
// A number check that failed is a wrong answer; was the seal "comprovado" anyway? And a right answer:
// was it proven, or flagged for nothing?
//   node scripts/proof-accuracy.mjs --report reports/uso/<label>.json --db <banco da rodada> [--db …]
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const report = JSON.parse(readFileSync(args[args.indexOf("--report") + 1], "utf8"));
const proofs = new Map();
args.forEach((a, i) => {
  if (a !== "--db") return;
  const db = new DatabaseSync(args[i + 1], { readOnly: true });
  for (const r of db.prepare("SELECT content, execution FROM messages WHERE role = 'assistant'").all()) {
    try { const p = JSON.parse(r.execution || "null")?.proof; proofs.set(r.content.trim().slice(0, 400), p || null); } catch { /* old row */ }
  }
});
// Checks about a number: their name carries the expected value in parentheses ("a conta certa (60)").
const numeric = (c) => /\(\s*[\d.,]+\s*\)|\d+[.,]\d{2}/.test(c.name);
const table = { "errada+comprovado": 0, "errada+com aviso": 0, "errada+sem selo": 0, "certa+comprovado": 0, "certa+com aviso": 0, "certa+sem selo": 0 };
const flagged = [];
for (const r of report.results) for (const t of r.turns) {
  const checks = (t.checks || []).filter(numeric);
  if (!checks.length || !t.text) continue;
  const proof = proofs.get(t.text.trim().slice(0, 400));
  if (proof === undefined) continue;
  const wrong = checks.some((c) => !c.ok);
  const seal = !proof ? "sem selo" : proof.seal === "comprovado" ? "comprovado" : "com aviso";
  table[`${wrong ? "errada" : "certa"}+${seal}`] += 1;
  if (seal === "com aviso") flagged.push({ id: r.id, wrong, missing: proof.claims.filter((c) => c.status === "sem-prova").map((c) => c.raw).join(", "), check: checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}`).join("; ") });
}
console.log(table);
const wrongs = table["errada+comprovado"] + table["errada+com aviso"];
const rights = table["certa+comprovado"] + table["certa+com aviso"];
console.log(`Respostas erradas com selo: ${wrongs}; o selo avisou em ${table["errada+com aviso"]} (${wrongs ? ((100 * table["errada+com aviso"]) / wrongs).toFixed(0) : 0}%).`);
console.log(`Respostas certas com selo: ${rights}; aviso à toa em ${table["certa+com aviso"]} (${rights ? ((100 * table["certa+com aviso"]) / rights).toFixed(0) : 0}%).`);
for (const f of flagged) console.log(`- ${f.wrong ? "ERRADA" : "certa "} ${f.id}: sem fonte ${f.missing} | ${f.check}`);
