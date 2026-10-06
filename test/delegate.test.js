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

test("after a job was handed to an agent, the chat writes no file of its own in that turn", async () => {
  const { executeTool } = await import("../app/agentTools/index.js");
  const c = { mode: "auto", approve: async () => true, env: process.env, workspace: temp, workspaceRoots: [temp], delegatedTo: "Agente Financeiro" };
  const out = await executeTool("write_document", { path: "copia.md", content: "# x" }, c);
  assert.equal(out.ok, false);
  assert.match(out.result, /Agente Financeiro já fez e entregou/);
});
