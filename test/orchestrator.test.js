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

test("dependencies: only on earlier tasks, the dependent waits and gets the files, and skips if they failed", async () => {
  const plan = parsePlan(JSON.stringify({ tasks: [
    { agent: "Agente Financeiro", request: "Planilha de inadimplentes acima de 30 dias.", formato: "planilha" },
    { agent: "Agente RH", request: "E-mail de cobrança para cada inadimplente da planilha.", formato: "texto", depende_de: ["Agente Financeiro", "Agente RH", "Agente Inventado"] },
  ] }), team);
  assert.deepEqual(plan.map((t) => t.dependsOn), [undefined, ["fin"]], "no self, unknown or later dependency");
  const firstOnly = parsePlan(JSON.stringify({ tasks: [{ agent: "Agente RH", request: "Algo que usa o financeiro.", formato: "texto", depende_de: ["Agente Financeiro"] }, { agent: "Agente Financeiro", request: "Planilha de inadimplentes.", formato: "planilha" }] }), team);
  assert.equal(firstOnly[0].dependsOn, undefined, "a dependency on a later task is dropped (no cycles)");

  const order = [];
  const requests = {};
  const runAgent = async (id, { request }) => { order.push(`start ${id}`); requests[id] = request; await new Promise((r) => setTimeout(r, 20)); order.push(`end ${id}`); return { status: "done", files: [`C:/${id}/entrega.xlsx`] }; };
  const results = await runPlan({ tasks: plan, runAgent, concurrency: 2 });
  assert.deepEqual(order, ["start fin", "end fin", "start rh", "end rh"], "the dependent waits even with two workers");
  assert.match(requests.rh, /Use o que a equipe já entregou:\n- Agente Financeiro: C:\/fin\/entrega\.xlsx/);
  assert.deepEqual(results.map((r) => r.status), ["done", "done"]);

  const failing = await runPlan({ tasks: plan, runAgent: async (id) => (id === "fin" ? { status: "failed", files: [], error: "sem planilha" } : { status: "done", files: ["x"] }), concurrency: 2 });
  assert.equal(failing[1].status, "failed");
  assert.match(failing[1].error, /Dependia de Agente Financeiro, que não entregou/);
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

test("a dependency the request never asked for is dropped; each agent gets only its own task", async () => {
  const { parsePlan, runPlan } = await import("../app/orchestrator.js");
  const team = [{ id: "rh", name: "Agente RH" }, { id: "fin", name: "Agente Financeiro" }, { id: "ctrl", name: "Agente Controladoria" }];
  const text = JSON.stringify({ tasks: [{ agent: "Agente RH", request: "Planilha de férias de outubro.", formato: "planilha" }, { agent: "Agente Controladoria", request: "Relatório de desvios acima de 5%.", formato: "relatório em Word", depende_de: ["Agente RH"] }] });
  const together = "Feche o mês: a planilha de férias de outubro e um relatório com as áreas mais de 5% acima do orçado.";
  assert.equal(parsePlan(text, team, together)[1].dependsOn, undefined, "nothing in the request makes the report wait");
  assert.deepEqual(parsePlan(text, team, "Primeiro o RH faz a planilha; depois, usando essa planilha, a Controladoria faz o relatório.")[1].dependsOn, ["rh"]);
  // Each agent gets only its own task: with the whole request along, they did each other's parts.
  const seen = [];
  await runPlan({ tasks: parsePlan(text, team, together), handleChatTurn: null, runAgent: async (id, { request }) => { seen.push(request); return { status: "done", files: [`${id}.xlsx`], answer: "ok" }; } });
  assert.ok(seen.every((r) => !r.includes(together)));
});

test("a plan never delivers .md text unless text was asked: lists become sheets, summaries Word", async () => {
  const { parsePlan } = await import("../app/orchestrator.js");
  const agents = [{ id: "f", name: "Agente Financeiro", department: "Financeiro", mission: "x" }, { id: "c", name: "Agente Controladoria", department: "Controladoria", mission: "y" }];
  const plan = JSON.stringify({ tasks: [{ agent: "Agente Financeiro", request: "Faça a lista dos títulos em atraso há mais de 30 dias.", formato: "texto" }, { agent: "Agente Controladoria", request: "Faça um resumo das áreas acima do orçamento.", formato: "texto" }] });
  const [fin, ctrl] = parsePlan(plan, agents, "feche o mês: inadimplentes acima de 30 dias e áreas acima do orçamento");
  assert.match(fin.request, /planilha Excel \(\.xlsx\)/);
  assert.match(ctrl.request, /relatório em Word \(\.docx\)/);
  assert.match(parsePlan(plan, agents, "quero tudo em texto")[0].request, /texto \(\.md\)/);
});
