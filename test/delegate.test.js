import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "aurora-delegate-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");

test("the chat hands a job to an agent by name and gets its answer and files; agents don't delegate", async () => {
  const { executeTool } = await import("../app/agentTools/index.js");
  const { findAgent } = await import("../app/agentTools/delegate.js");
  const agents = await import("../app/agents.js");
  const ctx = (extra = {}) => ({ mode: "auto", approve: async () => true, env: process.env, ...extra });
  assert.match((await executeTool("agent_delegate", {}, ctx())).result, /ainda não tem agentes/);
  const fin = await agents.createAgent({ name: "Agente Financeiro", kind: "setor", department: "Financeiro", mission: "Cobrança", workDir: join(temp, "fin") });
  await agents.createAgent({ name: "Resumo da manhã", mission: "Ver o que chegou", workDir: join(temp, "resumo") });
  assert.equal(findAgent(await agents.listAgents(), "o agente financeiro").id, fin.id);
  assert.equal(findAgent(await agents.listAgents(), "financeiro").id, fin.id);
  assert.equal(findAgent(await agents.listAgents(), "resumo").name, "Resumo da manhã");
  const asked = [];
  const handleChatTurn = async ({ conversationId, message }) => {
    asked.push(message);
    return { ok: true, message: { conversationId, content: "Lista pronta com 16 títulos.", execution: { toolSteps: [{ tool: "write_document", ok: true, summary: `Criei ${join(temp, "fin", "cobranca.xlsx")} (XLSX, 10 bytes).` }] } } };
  };
  const out = await executeTool("agent_delegate", { agent: "financeiro", request: "gere a lista de cobrança" }, ctx({ handleChatTurn }));
  assert.equal(out.ok, true, out.result);
  assert.deepEqual(asked, ["gere a lista de cobrança"]);
  assert.match(out.result, /Agente Financeiro terminou:\nLista pronta com 16 títulos\.[\s\S]*cobranca\.xlsx/);
  assert.match((await executeTool("agent_delegate", { agent: "jurídico" }, ctx({ handleChatTurn }))).result, /Não há agente chamado "jurídico"/);
  const loop = await executeTool("agent_delegate", { agent: "financeiro", request: "x" }, ctx({ handleChatTurn, env: { ...process.env, AGENT_RUN_TRIGGER: "schedule" } }));
  assert.equal(loop.ok, false);
  assert.match(loop.result, /não passa trabalho para outro/);
});

test("a request for the team is planned among the agents, run, and answered with each delivery and the summary", async () => {
  process.env.HARNESS_KNOWN_FOLDERS = JSON.stringify({ desktop: join(temp, "Desktop"), documents: join(temp, "Documents"), downloads: join(temp, "Downloads"), home: temp });
  const { executeTool } = await import("../app/agentTools/index.js");
  const agents = await import("../app/agents.js");
  const list = await agents.listAgents();
  const fin = list.find((a) => a.name === "Agente Financeiro");
  const handleChatTurn = async ({ conversationId }) => ({ ok: true, message: { conversationId, content: "Feito.", execution: { toolSteps: [{ tool: "write_document", ok: true, summary: `Criei ${join(temp, "fin", "inadimplentes.xlsx")} (XLSX, 10 bytes).` }] } } });
  const planTeam = async () => ({ tasks: [{ agentId: fin.id, agentName: fin.name, request: "Planilha dos inadimplentes acima de 30 dias." }], planner: "teste" });
  const out = await executeTool("team_request", { request: "feche o mês: inadimplentes acima de 30 dias" }, { mode: "auto", approve: async () => true, env: process.env, handleChatTurn, planTeam });
  assert.equal(out.ok, true, out.result);
  assert.match(out.result, /Pedi à equipe \(1 agente\):\n- Agente Financeiro: entregou inadimplentes\.xlsx/);
  assert.match(out.result, /Resumo da equipe em Word: .*Aurora[\\/]Equipe[\\/]Resumo da equipe/);
  delete process.env.HARNESS_KNOWN_FOLDERS;
});

test("after a job was handed to an agent, the chat writes no file of its own in that turn", async () => {
  const { executeTool } = await import("../app/agentTools/index.js");
  const c = { mode: "auto", approve: async () => true, env: process.env, workspace: temp, workspaceRoots: [temp], delegatedTo: "Agente Financeiro" };
  const out = await executeTool("write_document", { path: "copia.md", content: "# x" }, c);
  assert.equal(out.ok, false);
  assert.match(out.result, /Agente Financeiro já fez e entregou/);
});
