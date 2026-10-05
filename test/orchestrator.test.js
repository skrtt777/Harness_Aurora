import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "aurora-orchestrator-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
const { getOrchestration, listOrchestrations, parsePlan, planPrompt, planRequest, runPlan, startOrchestration, summaryMarkdown } = await import("../app/orchestrator.js");
const { extractText } = await import("../app/docText.js");

const team = [
  { id: "rh", name: "Agente RH", department: "RH", mission: "Férias e pessoal.", enabled: true },
  { id: "fin", name: "Agente Financeiro", department: "Financeiro", mission: "Cobrança.", enabled: true },
  { id: "off", name: "Agente TI", department: "TI", mission: "Chamados.", enabled: false },
];

test("the plan keeps known agents only, one task each, and adds the deliverable as its own field", () => {
  const text = JSON.stringify({ tasks: [
    { agent: "agente financeiro", request: "Produza a lista de títulos com mais de 30 dias.", formato: "planilha" },
    { agent: "Agente Financeiro", request: "Outra tarefa repetida para o mesmo agente.", formato: "PDF" },
    { agent: "Agente Inventado", request: "Algo que ninguém faz.", formato: "texto" },
    { agent: "Agente RH", request: "curta", formato: "planilha" },
  ] });
  assert.deepEqual(parsePlan(text, team), [{ agentId: "fin", agentName: "Agente Financeiro", request: "Produza a lista de títulos com mais de 30 dias. Entregue como planilha Excel (.xlsx)." }]);
  assert.deepEqual(parsePlan("não é json", team), []);
  assert.match(planPrompt("Feche o mês", team), /mesmas palavras[\s\S]*nunca troque por "lista"[\s\S]*Agente RH \(setor RH\)/);
});

test("planning uses the model with a schema of the enabled agents, and falls back to the sectors the request names", async () => {
  let seen;
  const ask = async (prompt, env) => { seen = JSON.parse(env.LOCAL_OUTPUT_SCHEMA); return { ok: true, text: JSON.stringify({ tasks: [{ agent: "Agente RH", request: "Gere a planilha de férias de outubro.", formato: "planilha" }] }) }; };
  const planned = await planRequest({ request: "Feche o mês", agents: team, ask });
  assert.equal(planned.planner, "modelo");
  assert.deepEqual(seen.properties.tasks.items.properties.agent.enum, ["Agente RH", "Agente Financeiro"], "a disabled agent is not offered");
  const fallback = await planRequest({ request: "Preciso de algo do Financeiro hoje", agents: team, ask: async () => ({ ok: false, error: "sem modelo" }) });
  assert.deepEqual(fallback, { tasks: [{ agentId: "fin", agentName: "Agente Financeiro", request: "Preciso de algo do Financeiro hoje" }], planner: "palavras do pedido" });
  await assert.rejects(planRequest({ request: "x", agents: [team[2]] }), /Crie ou ligue/);
});

test("tasks run at most two at a time; a failure doesn't stop the others", async () => {
  let active = 0, peak = 0;
  const runAgent = async (id) => { active += 1; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 20)); active -= 1; if (id === "bad") throw new Error("ocupado"); return { status: "done", files: [`C:/${id}.xlsx`], answer: "ok" }; };
  const tasks = ["a", "b", "bad", "c"].map((id) => ({ agentId: id, agentName: id, request: `tarefa ${id}` }));
  const results = await runPlan({ tasks, runAgent, concurrency: 2 });
  assert.equal(peak, 2);
  assert.deepEqual(results.map((r) => r.status), ["done", "done", "failed", "done"]);
  assert.equal(results[2].error, "ocupado");
});

test("an orchestration leaves a Word summary with each delivery and what is pending", async () => {
  const runAgent = async (id) => (id === "rh" ? { status: "done", files: ["C:/RH/ferias_outubro.xlsx"], answer: "Planilha com 9 pessoas." } : { status: "failed", files: [], answer: "", error: "Não encontrou a planilha." });
  const tasks = [{ agentId: "rh", agentName: "Agente RH", request: "Férias de outubro." }, { agentId: "fin", agentName: "Agente Financeiro", request: "Títulos com mais de 30 dias." }];
  const { id, done } = await startOrchestration({ request: "Feche o mês", tasks, dir: join(temp, "equipe"), runAgent });
  assert.equal((await getOrchestration(id)).status, "running");
  await done;
  const result = await getOrchestration(id);
  assert.equal(result.status, "partial");
  assert.ok(existsSync(result.summaryFile));
  const text = await extractText(result.summaryFile);
  assert.match(text, /1 de 2 tarefa\(s\) entregue\(s\)/);
  assert.match(text, /ferias_outubro\.xlsx/);
  assert.match(text, /Pendências[\s\S]*Agente Financeiro: Não encontrou a planilha/);
  assert.equal((await listOrchestrations())[0].id, id);
  await assert.rejects(startOrchestration({ request: "x", tasks: [], dir: temp, runAgent }), /plano está vazio/);
  assert.match(summaryMarkdown("Pedido", [{ agentName: "A", request: "a | b", status: "done", files: [], answer: "" }]), /\| A \| a \/ b \| Sem arquivo \| - \|/);
});
