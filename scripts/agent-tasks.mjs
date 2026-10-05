// Avaliação dos agentes de setor (fase B de docs/AGENTES_ROTEIRO.md) sobre a empresa fictícia.
//   node scripts/agent-tasks.mjs [--db <copia.db>] [--only rh-ferias-outubro] [--runs 2] [--teacher] [--label nome]
// Indexa só os setores das tarefas, cria os agentes de setor numa pasta temporária, roda cada
// tarefa e confere o ARQUIVO entregue contra o gabarito tirado das planilhas da empresa.
// Com --db, a cópia guarda o índice: a segunda rodada é rápida. Relatório em reports/agentes/.
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const only = arg("only")?.split(",");
const runs = Math.max(1, Number(arg("runs", 1)) || 1);
const label = arg("label", `agentes-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`);
const base = mkdtempSync(join(tmpdir(), "aurora-agentes-"));
const db = arg("db") || join(base, "harness.db");
process.env.HARNESS_DB_FILE = db;
process.env.HARNESS_NOW ||= "2026-10-04T12:00:00-03:00";
// Nobody approves: anything outside the agent's folder or its sector counts as denied after 1 s.
process.env.AGENT_APPROVAL_TIMEOUT_MS ||= "1000";
setInterval(() => {}, 60_000);

const { AGENT_TASKS, COMPANY_ROOT, scoreAgentTask } = await import("../app/agentTaskBattery.js");
const store = await import("../app/store.js");
const knowledge = await import("../app/knowledge.js");
const agents = await import("../app/agents.js");
const { handleChatTurn } = await import("../app/server.js");
const { resolveLocalModel } = await import("../app/ollamaSetup.js");
if (!process.argv.includes("--teacher")) await store.setSetting("teacher_mode", "off");
const model = await resolveLocalModel(process.env);
const tasks = AGENT_TASKS.filter((t) => !only || only.includes(t.id) || only.includes(t.department));
console.log(`modelo ${model}, ${tasks.length} tarefa(s), ${runs} rodada(s), professor ${process.argv.includes("--teacher") ? "ligado" : "desligado"}`);

// Only the sectors the tasks use are indexed (the user's own sources stay out of this database).
const departments = [...new Set(tasks.map((t) => t.department))];
for (const department of departments) {
  const path = join(COMPANY_ROOT, department);
  const source = (await knowledge.listSources()).find((s) => s.path.toLowerCase() === path.toLowerCase()) || await knowledge.createSource({ name: `${department} (EmpresaIA)`, path, department });
  const started = Date.now();
  await knowledge.indexSource(source.id, {});
  console.log(`índice ${department}: ${Math.round((Date.now() - started) / 1000)} s`);
}

const results = [];
for (let run = 1; run <= runs; run += 1) {
  for (const task of tasks) {
    const workDir = join(base, `${task.id}-${run}`);
    mkdirSync(workDir, { recursive: true });
    const agent = await agents.createAgent({ name: `Agente ${task.department} ${run}`, kind: "setor", mission: agents.SECTOR_TEMPLATES[task.department], department: task.department, workDir });
    const started = Date.now();
    const result = await agents.runAgent(agent.id, { request: task.request, handleChatTurn });
    const truth = await task.truth(COMPANY_ROOT);
    const score = await scoreAgentTask(task, result, truth);
    const conversation = result.conversationId ? await store.getConversationWithMessages(result.conversationId) : null;
    const steps = conversation?.messages.at(-1)?.execution?.toolSteps || [];
    results.push({ id: task.id, run, ms: Date.now() - started, status: result.status, answer: result.answer, files: readdirSync(workDir), delivered: score.delivered, missing: score.missing, extra: score.extra, steps: steps.map((s) => `${s.tool}:${s.ok ? "ok" : `falhou (${String(s.summary || "").slice(0, 100)})`}`), checks: score.checks });
    console.log(`\n## ${task.id} (rodada ${run}, ${((Date.now() - started) / 1000).toFixed(0)} s) ${score.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}`).join(" | ")}`);
    if (score.missing.length) console.log(`  faltaram: ${score.missing.join(", ")}`);
    if (score.extra.length) console.log(`  sobraram: ${score.extra.join(", ")}`);
  }
}

const checks = results.flatMap((r) => r.checks);
const passed = checks.filter((c) => c.ok).length;
const summary = { passed, total: checks.length, score: checks.length ? Math.round((passed / checks.length) * 1000) / 10 : 0, delivered: results.filter((r) => r.checks.every((c) => c.ok)).length, runs: results.length };
const outDir = join(process.cwd(), "reports", "agentes");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${label}.json`), JSON.stringify({ model, label, date: new Date().toISOString(), summary, results }, null, 2));
console.log(`\nNota: ${passed}/${checks.length} (${summary.score}%); tarefas perfeitas: ${summary.delivered}/${summary.runs}`);
process.exit(0);
