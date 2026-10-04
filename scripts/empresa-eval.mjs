// Avaliação por setor sobre a empresa fictícia (app/empresaIaQuestions.json, F:\EmpresaIA).
//   node scripts/empresa-eval.mjs --db <copia.db> [--only rh-1,ti-2] [--label nome] [--samples 5]
// --samples N: cada pergunta N vezes ao mesmo tempo (várias cópias do modelo) e o consenso entre elas.
// A cópia do banco guarda o índice: a segunda rodada na mesma cópia só confere as datas dos arquivos.
// Relatório em reports/empresa/<label>.json e .md.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const db = arg("db");
if (!db) { console.error("Uso: --db <copia.db> [--only ids] [--label nome]"); process.exit(2); }
const spec = JSON.parse(readFileSync(new URL("../app/empresaIaQuestions.json", import.meta.url), "utf8"));
const only = arg("only")?.split(",");
const questions = spec.perguntas.filter((q) => !only || only.includes(q.id) || only.includes(q.setor));
const samples = Math.max(1, Number(arg("samples", 1)) || 1);
const label = arg("label", `empresa-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`);

process.env.HARNESS_DB_FILE = db;
// The sample company is dated: "esse mês" is October 2026 whatever day this runs.
process.env.HARNESS_NOW ||= `${spec.hoje}T12:00:00-03:00`;
// No one is there to approve: a request for permission (searching Documents, say) counts as
// unanswered after 1 s. The approval timer is unref'd, so something must keep the process
// alive meanwhile, or Node exits mid-question ("unsettled top-level await").
process.env.AGENT_APPROVAL_TIMEOUT_MS ||= "1000";
setInterval(() => {}, 60_000);
const { getDb } = await import("../app/db.js");
await getDb();
const { prepareCompanySources, runCompanyEval, summarizeCompanyEval } = await import("../app/companyEval.js");
const { resolveLocalModel } = await import("../app/ollamaSetup.js");
const model = await resolveLocalModel(process.env);

const outDir = join(process.cwd(), "reports", "empresa");
mkdirSync(outDir, { recursive: true });
console.log(`modelo ${model}, ${questions.length} perguntas, hoje = ${process.env.HARNESS_NOW}`);
const started = Date.now();
const { timings } = await prepareCompanySources(spec.pasta, { onProgress: ({ indexed, ms }) => console.log(`índice ${indexed}: ${Math.round(ms / 1000)} s`) });
const indexMs = Date.now() - started;
const results = await runCompanyEval({
  questions, root: spec.pasta, samples, workDir: mkdtempSync(join(tmpdir(), "aurora-empresa-")),
  onProgress: ({ index, total, id, passed, ms, extra }) => { if (passed !== undefined) console.log(`${index + 1}/${total} ${id} ${passed ? "ok" : "ERRO"} ${Math.round(ms / 1000)} s ${extra || ""}`); },
});
const summary = summarizeCompanyEval(results);
writeFileSync(join(outDir, `${label}.json`), JSON.stringify({ model, hoje: process.env.HARNESS_NOW, indexMs, timings, summary, results }, null, 2));

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const md = [
  `# Avaliação por setor — ${label}`, "",
  `Modelo **${model}**, ${new Date().toLocaleString("pt-BR")}. Índice: ${Math.round(indexMs / 1000)} s.`, "",
  `**Respostas certas: ${summary.passed}/${summary.total} (${pct(summary.passed, summary.total)})** · documentos do setor certo: ${summary.rightSector}/${summary.located} · tempo médio ${Math.round(summary.ms / results.length / 1000)} s`, "",
  ...(summary.samples ? [`**Várias cópias (${summary.samples} ao mesmo tempo):** 1 resposta ${summary.single}/${summary.total} · consenso de 3 ${summary.consensus3}/${summary.total} · consenso de ${summary.samples} ${summary.consensusN}/${summary.total} · escalada 1→2→4→${summary.samples} ${summary.escalated}/${summary.total} com ${summary.escalatedCost} cópias em média · alguma certa ${summary.anyPassed}/${summary.total}`, ""] : []),
  ...(summary.appCopies ? [`**Escalada do app:** ${summary.appCopies.questions} perguntas conferidas com cópias, ${summary.appCopies.average} cópias em média, ${summary.appCopies.disagree} sem acordo (vão para o professor).`, ""] : []),
  "| Setor | Certas | Setor certo | Tempo médio |", "|---|---|---|---|",
  ...Object.entries(summary.bySector).map(([s, v]) => `| ${s} | ${v.passed}/${v.total} | ${v.located ? `${v.rightSector}/${v.located}` : "—"} | ${Math.round(v.ms / v.total / 1000)} s |`),
  "", "## Erros", "",
  ...results.filter((r) => !r.passed).flatMap((r) => [`### ${r.id} — ${r.prompt}`, `Documentos: ${r.docs.join(", ") || "nenhum"} (setores: ${r.docSectors.join(", ") || "—"})${r.error ? ` · erro: ${r.error}` : ""}`, "", `> ${r.answer.replace(/\n+/g, " ").slice(0, 400)}`, ""]),
].join("\n");
writeFileSync(join(outDir, `${label}.md`), md);
console.log(`certas ${summary.passed}/${summary.total}, setor certo ${summary.rightSector}/${summary.located}`, summary.samples ? JSON.stringify({ consenso3: summary.consensus3, consensoN: summary.consensusN, escalada: summary.escalated, custo: summary.escalatedCost, alguma: summary.anyPassed }) : "");
console.log(`relatório: ${join(outDir, `${label}.md`)}`);
process.exit(0);
