// Avaliação do orquestrador (fase E de docs/AGENTES_ROTEIRO.md) sobre a empresa fictícia.
//   node scripts/orchestrator-eval.mjs [--db <banco.db>] [--runs 2] [--label nome]
// Um pedido só ("feche o mês") para a equipe de RH, Financeiro e Controladoria: confere o plano
// (uma tarefa certa para cada agente), cada arquivo entregue contra o gabarito da fase B e o resumo.
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const runs = Math.max(1, Number(arg("runs", 1)) || 1);
const label = arg("label", `orquestrador-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`);
const base = mkdtempSync(join(tmpdir(), "aurora-equipe-"));
process.env.HARNESS_DB_FILE = arg("db") || join(base, "harness.db");
process.env.HARNESS_NOW ||= "2026-10-04T12:00:00-03:00";
process.env.AGENT_APPROVAL_TIMEOUT_MS ||= "1000";
setInterval(() => {}, 60_000);

const { AGENT_TASKS, COMPANY_ROOT, scoreAgentTask } = await import("../app/agentTaskBattery.js");
const store = await import("../app/store.js");
const knowledge = await import("../app/knowledge.js");
const agents = await import("../app/agents.js");
const { planRequest, startOrchestration, getOrchestration } = await import("../app/orchestrator.js");
const { handleChatTurn } = await import("../app/server.js");
await store.setSetting("teacher_mode", "off");

const REQUEST = "Feche o mês de setembro para a diretoria: preciso da planilha de quem começa as férias em outubro, da planilha dos títulos em atraso há mais de 30 dias para a cobrança e de um relatório em Word com as áreas que gastaram mais de 5% acima do orçado até setembro.";
const byDepartment = { RH: "rh-ferias-outubro", Financeiro: "fin-inadimplentes-30", Controladoria: "ctrl-desvios-5" };
for (const department of Object.keys(byDepartment)) {
  const path = join(COMPANY_ROOT, department);
  const source = (await knowledge.listSources()).find((s) => s.path.toLowerCase() === path.toLowerCase()) || await knowledge.createSource({ name: `${department} (EmpresaIA)`, path, department });
  await knowledge.indexSource(source.id, {});
}

const report = [];
for (let run = 1; run <= runs; run += 1) {
  // A fresh team each round (and the sector agents of other rounds turned off).
  for (const old of await agents.listAgents()) await agents.updateAgent(old.id, { enabled: false });
  const team = [];
  for (const department of Object.keys(byDepartment)) team.push(await agents.createAgent({ name: `Agente ${department}`, kind: "setor", department, mission: agents.SECTOR_TEMPLATES[department], workDir: join(base, `${department}-${run}`) }));
  const started = Date.now();
  const plan = await planRequest({ request: REQUEST, agents: await agents.listAgents() });
  const planOk = Object.keys(byDepartment).every((d) => plan.tasks.some((t) => t.agentName === `Agente ${d}`));
  console.log(`\n## rodada ${run}: plano (${plan.planner}) com ${plan.tasks.length} tarefa(s)${planOk ? "" : " ✗ faltou agente"}`);
  for (const t of plan.tasks) console.log(`  - ${t.agentName}: ${t.request.slice(0, 160)}`);
  const { id, done } = await startOrchestration({ request: REQUEST, tasks: plan.tasks, dir: join(base, `resumo-${run}`), runAgent: agents.runAgent, handleChatTurn });
  await done;
  const result = await getOrchestration(id);
  const checks = [{ name: "plano com uma tarefa para cada agente", ok: planOk }, { name: "resumo gerado", ok: Boolean(result.summaryFile && existsSync(result.summaryFile)) }];
  for (const [department, taskId] of Object.entries(byDepartment)) {
    const task = AGENT_TASKS.find((t) => t.id === taskId);
    const delivered = result.results.find((r) => r.agentName === `Agente ${department}`) || { files: [], answer: "" };
    const score = await scoreAgentTask(task, delivered, await task.truth(COMPANY_ROOT));
    checks.push(...score.checks.slice(0, 3).map((c) => ({ name: `${department}: ${c.name}`, ok: c.ok })));
    if (score.missing.length || score.extra.length) console.log(`  ${department}: faltaram ${score.missing.length}, sobraram ${score.extra.length} · ${delivered.status} · arquivos: ${(delivered.files || []).map((f) => f.split(/[\\/]/).pop()).join(", ") || "nenhum"} · ${String(delivered.error || delivered.answer || "").replace(/\s+/g, " ").slice(0, 160)}`);
  }
  console.log(`  ${((Date.now() - started) / 1000).toFixed(0)} s · ${checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}`).join(" | ")}`);
  report.push({ run, plan, status: result.status, summaryFile: result.summaryFile, checks });
}

const all = report.flatMap((r) => r.checks);
const passed = all.filter((c) => c.ok).length;
mkdirSync(join(process.cwd(), "reports", "agentes"), { recursive: true });
writeFileSync(join(process.cwd(), "reports", "agentes", `${label}.json`), JSON.stringify({ label, date: new Date().toISOString(), passed, total: all.length, report }, null, 2));
console.log(`\nNota: ${passed}/${all.length} (${Math.round((passed / all.length) * 1000) / 10}%)`);
process.exit(0);
