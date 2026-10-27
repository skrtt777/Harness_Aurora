// How right the resposta viva (app/proofLive.js) is on real answers: the answers with a comprovante in the
// usage batteries' databases (copies, in %TEMP%\aurora-uso-*), checked again against their real files.
// 1. Nothing changed, every file read again anyway: any "mudou" or "sumiu" is a false alarm.
// 2. One cell changed (in memory, the file is never written): the number that came from it must be caught.
//   node scripts/live-accuracy.mjs [--dbs 12] [--verbose]
import { readdirSync, statSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { DatabaseSync } from "node:sqlite";
// Never the person's database: the company folders come from each battery's own copy.
process.env.HARNESS_DB_FILE = join(mkdtempSync(join(tmpdir(), "aurora-live-acc-")), "harness.db");
const { liveIo, recheckAnswer } = await import("../app/proofLive.js");

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const verbose = process.argv.includes("--verbose");
const dirs = readdirSync(tmpdir()).filter((d) => d.startsWith("aurora-uso-")).map((d) => join(tmpdir(), d))
  .filter((d) => existsSync(join(d, "harness.db"))).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs).slice(0, Number(arg("dbs", 12)));

const totals = { answers: 0, claims: 0, rechecked: 0, filesGone: 0, falseAlarms: 0, mutated: 0, caught: 0, rightValue: 0 };
const alarms = [], misses = [];
for (const dir of dirs) {
  const db = new DatabaseSync(join(dir, "harness.db"), { readOnly: true });
  const rows = db.prepare("SELECT m.*, c.project_id FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.role = 'assistant' AND m.execution LIKE '%\"proof\":{%' ORDER BY m.created_at").all();
  for (const row of rows) {
    const execution = JSON.parse(row.execution);
    const workspace = row.project_id ? db.prepare("SELECT workspace_dir FROM projects WHERE id = ?").get(row.project_id)?.workspace_dir || "" : "";
    const request = db.prepare("SELECT content FROM messages WHERE conversation_id = ? AND role = 'user' AND created_at <= ? ORDER BY created_at DESC LIMIT 1").get(row.conversation_id, row.created_at)?.content || "";
    const message = { content: row.content, createdAt: row.created_at, execution };
    const roots = db.prepare("SELECT path FROM knowledge_sources").all().map((x) => x.path);
    const raw = await liveIo({ workspace, request, roots });
    // Each file read once per answer (a PDF may go through OCR; every mutation reads them all again).
    const cache = new Map();
    const once = (key, fn) => { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); };
    const real = { ...raw, readWhole: (p) => once(`w|${p}`, () => raw.readWhole(p)), replay: (step, p) => once(`r|${p}|${JSON.stringify(step.args)}`, () => raw.replay(step, p)) };
    // Every file counts as changed: read again and compared.
    const forced = { ...real, stat: async (p) => { const s = await real.stat(p); return s && { ...s, mtimeMs: Date.now() + 86_400_000 }; } };
    const live = await recheckAnswer(message, forced).catch((e) => ({ error: e.message }));
    if (!live || live.error) continue;
    totals.answers += 1;
    totals.claims += live.claims.length;
    totals.rechecked += live.claims.filter((c) => !["mantido", "sem-prova"].includes(c.status)).length;
    for (const c of live.claims.filter((x) => x.status === "mudou" || x.status === "sumiu")) {
      // The battery's temporary folders are gone: "o arquivo não está mais" is then the truth.
      if (/^o arquivo não está mais|^a conta usa um número/.test(c.why || "") && live.files.some((f) => f.missing)) { totals.filesGone += 1; continue; }
      totals.falseAlarms += 1;
      alarms.push({ db: basename(dir), raw: c.raw, status: c.status, now: c.now, why: c.why, where: c.where, file: c.file, source: execution.proof.claims[c.i]?.source?.text || execution.proof.claims[c.i]?.formula });
    }
    // 2. Each number that came from a cell of a file: that cell changed by 10%, the rest as it is.
    for (const [i, claim] of execution.proof.claims.entries()) {
      const s = claim.source;
      if (claim.status !== "fonte" || !s?.row || !s.header || !s.column || claim.kind === "data") continue;
      const col = s.header.indexOf(s.column);
      // A value cell, not a name or a code ("CC-500", "Duplicata 2132"): those are what a row is found by.
      if (col <= 0 || /\p{L}/u.test(String(s.row[col]).replace(/^R\$/, ""))) continue;
      const before = s.row.join(" | ");
      const after = s.row.map((cell, j) => (j === col ? cell.replace(/\d[\d.,]*/, (n) => { const v = Number(n.replace(/\./g, "").replace(",", ".")) || Number(n); return String(Math.round(v * 1.1 * 100) / 100).replace(".", ","); }) : cell)).join(" | ");
      if (after === before) continue;
      const mutate = (text) => (text && text.includes(before) ? text.split(before).join(after) : text);
      const io = { ...forced, readWhole: async (p) => mutate(await real.readWhole(p)), replay: async (step, p) => mutate(await real.replay(step, p)) };
      const check = await recheckAnswer(message, io).catch(() => null);
      const got = check?.claims.find((x) => x.i === i);
      // A file the battery already deleted: nothing to compare with.
      if (!got || /^o arquivo não está mais/.test(got.why || "")) continue;
      totals.mutated += 1;
      if (got.status === "mudou") { totals.caught += 1; if (got.now) totals.rightValue += 1; }
      else misses.push({ db: basename(dir), raw: claim.raw, status: got.status, why: got.why, row: before.slice(0, 120) });
    }
  }
  db.close();
}
console.log(JSON.stringify(totals, null, 1));
console.log(`Alarmes falsos: ${totals.falseAlarms} em ${totals.rechecked} números reconferidos (${totals.answers} respostas, ${dirs.length} bancos).`);
console.log(`Célula mudada: ${totals.caught} de ${totals.mutated} pegas (${totals.mutated ? Math.round((100 * totals.caught) / totals.mutated) : 0}%).`);
if (alarms.length) console.log("\nAlarmes falsos:\n" + alarms.slice(0, verbose ? 200 : 15).map((a) => JSON.stringify(a)).join("\n"));
if (misses.length) console.log("\nNão pegou:\n" + misses.slice(0, verbose ? 200 : 15).map((a) => JSON.stringify(a)).join("\n"));
