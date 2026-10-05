// Avaliação do orquestrador (fase E de docs/AGENTES_ROTEIRO.md) sobre a empresa fictícia.
//   node scripts/orchestrator-eval.mjs [--scenario fechamento|dependencia] [--db <banco.db>] [--runs 2] [--label nome]
// fechamento: "feche o mês" para RH, Financeiro e Controladoria; confere o plano (uma tarefa para
//   cada agente), cada arquivo contra o gabarito da fase B e o resumo.
// dependencia: o Financeiro gera a planilha dos títulos com mais de 30 dias e DEPOIS a Controladoria
//   faz o relatório por cliente usando essa planilha; confere a dependência no plano e as duas entregas.
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const runs = Math.max(1, Number(arg("runs", 1)) || 1);
const scenario = arg("scenario", "fechamento");
const label = arg("label", `orquestrador-${scenario}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`);
const base = mkdtempSync(join(tmpdir(), "aurora-equipe-"));
process.env.HARNESS_DB_FILE = arg("db") || join(base, "harness.db");
process.env.HARNESS_NOW ||= "2026-10-04T12:00:00-03:00";
process.env.AGENT_APPROVAL_TIMEOUT_MS ||= "1000";
setInterval(() => {}, 60_000);

const { AGENT_TASKS, COMPANY_ROOT, scoreAgentTask, sheetRows } = await import("../app/agentTaskBattery.js");
const { extractText } = await import("../app/docText.js");
const store = await import("../app/store.js");
const knowledge = await import("../app/knowledge.js");
const agents = await import("../app/agents.js");
const { planRequest, startOrchestration, getOrchestration } = await import("../app/orchestrator.js");
const { handleChatTurn } = await import("../app/server.js");
await store.setSetting("teacher_mode", "off");

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const SCENARIOS = {
  fechamento: {
    request: "Feche o mês de setembro para a diretoria: preciso da planilha de quem começa as férias em outubro, da planilha dos títulos em atraso há mais de 30 dias para a cobrança e de um relatório em Word com as áreas que gastaram mais de 5% acima do orçado até setembro.",
    team: { RH: "rh-ferias-outubro", Financeiro: "fin-inadimplentes-30", Controladoria: "ctrl-desvios-5" },
    async check(plan, result) {
      const checks = [{ name: "plano com uma tarefa para cada agente", ok: Object.keys(this.team).every((d) => plan.tasks.some((t) => t.agentName === `Agente ${d}`)) }];
      for (const [department, taskId] of Object.entries(this.team)) checks.push(...(await deliveryChecks(department, taskId, result)));
      return checks;
    },
  },
  dependencia: {
    request: "Primeiro o Financeiro gera a planilha dos títulos em atraso há mais de 30 dias. Depois, usando essa planilha do Financeiro, a Controladoria faz um relatório em Word com o valor total em atraso de cada cliente.",
    team: { Financeiro: "fin-inadimplentes-30", Controladoria: null },
    async check(plan, result) {
      const fin = plan.tasks.find((t) => t.agentName === "Agente Financeiro");
      const ctrl = plan.tasks.find((t) => t.agentName === "Agente Controladoria");
      const checks = [{ name: "plano: a Controladoria depende do Financeiro", ok: Boolean(fin && ctrl && ctrl.dependsOn?.includes(fin.agentId) && plan.tasks.indexOf(fin) < plan.tasks.indexOf(ctrl)) }];
      checks.push(...(await deliveryChecks("Financeiro", "fin-inadimplentes-30", result)));
      // The clients of the titles more than 30 days late must be in the report.
      const rows = sheetRows(await extractText(join(COMPANY_ROOT, "Financeiro/Contas a Receber e Inadimplência - Set 2026.xlsx")));
      const clients = [...new Set(rows.filter((r) => Number(r["Dias em atraso (em 04/10/2026)"]) > 30).map((r) => r.Cliente))];
      const report = (result.results.find((r) => r.agentName === "Agente Controladoria")?.files || []).find((f) => f.toLowerCase().endsWith(".docx"));
      const text = report && existsSync(report) ? fold(await extractText(report)) : "";
      const missing = clients.filter((c) => !text.includes(fold(c)));
      if (missing.length) console.log(`  Controladoria: faltaram os clientes ${missing.join(", ")}`);
      checks.push({ name: "Controladoria: relatório em Word", ok: Boolean(report) }, { name: `Controladoria: os ${clients.length} clientes com mais de 30 dias`, ok: Boolean(report) && missing.length === 0 });
      return checks;
    },
  },
};
const chosen = SCENARIOS[scenario];
if (!chosen) { console.error(`Cenário desconhecido: ${scenario}`); process.exit(2); }

async function deliveryChecks(department, taskId, result) {
  const task = AGENT_TASKS.find((t) => t.id === taskId);
  const delivered = result.results.find((r) => r.agentName === `Agente ${department}`) || { files: [], answer: "" };
  const score = await scoreAgentTask(task, delivered, await task.truth(COMPANY_ROOT));
  if (score.missing.length || score.extra.length) console.log(`  ${department}: faltaram ${score.missing.length}, sobraram ${score.extra.length} · ${delivered.status} · ${(delivered.files || []).map((f) => f.split(/[\\/]/).pop()).join(", ") || "nenhum arquivo"} · ${String(delivered.error || delivered.answer || "").replace(/\s+/g, " ").slice(0, 140)}`);
  return score.checks.slice(0, 3).map((c) => ({ name: `${department}: ${c.name}`, ok: c.ok }));
}

for (const department of Object.keys(chosen.team)) {
  const path = join(COMPANY_ROOT, department);
  const source = (await knowledge.listSources()).find((s) => s.path.toLowerCase() === path.toLowerCase()) || await knowledge.createSource({ name: `${department} (EmpresaIA)`, path, department });
  await knowledge.indexSource(source.id, {});
}

const report = [];
for (let run = 1; run <= runs; run += 1) {
  // A fresh team each round (agents of other rounds turned off).
  for (const old of await agents.listAgents()) await agents.updateAgent(old.id, { enabled: false });
  for (const department of Object.keys(chosen.team)) await agents.createAgent({ name: `Agente ${department}`, kind: "setor", department, mission: agents.SECTOR_TEMPLATES[department], workDir: join(base, `${department}-${run}`) });
  const started = Date.now();
  const plan = await planRequest({ request: chosen.request, agents: await agents.listAgents() });
  console.log(`\n## rodada ${run}: plano (${plan.planner}) com ${plan.tasks.length} tarefa(s)`);
  for (const t of plan.tasks) console.log(`  - ${t.agentName}${t.dependsOn?.length ? " (depois de outra)" : ""}: ${t.request.slice(0, 150)}`);
  const { id, done } = await startOrchestration({ request: chosen.request, tasks: plan.tasks, dir: join(base, `resumo-${run}`), runAgent: agents.runAgent, handleChatTurn });
  await done;
  const result = await getOrchestration(id);
  const checks = [...(await chosen.check(plan, result)), { name: "resumo gerado", ok: Boolean(result.summaryFile && existsSync(result.summaryFile)) }];
  console.log(`  ${((Date.now() - started) / 1000).toFixed(0)} s · ${checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}`).join(" | ")}`);
  report.push({ run, plan, status: result.status, summaryFile: result.summaryFile, checks });
}

const all = report.flatMap((r) => r.checks);
const passed = all.filter((c) => c.ok).length;
mkdirSync(join(process.cwd(), "reports", "agentes"), { recursive: true });
writeFileSync(join(process.cwd(), "reports", "agentes", `${label.startsWith("orquestrador") ? label : `orquestrador-${label}`}.json`), JSON.stringify({ label, scenario, date: new Date().toISOString(), passed, total: all.length, report }, null, 2));
console.log(`\nNota: ${passed}/${all.length} (${Math.round((passed / all.length) * 1000) / 10}%)`);
process.exit(0);
