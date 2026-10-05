import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "harness-agents-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.LOCAL_BASE_URL = "http://127.0.0.1:1";

const agents = await import("../app/agents.js");
const store = await import("../app/store.js");

test("an agent is a project: its folder is the workspace and its mission the instructions", async () => {
  const workDir = join(temp, "agente-rh");
  const agent = await agents.createAgent({ name: "Agente RH", kind: "setor", mission: "Relatórios de férias.", department: "RH", workDir });
  assert.ok(existsSync(workDir), "the folder is created");
  const project = await store.getProject(agent.projectId);
  assert.equal(project.workspaceDir, workDir);
  assert.match(project.instructions, /Agente RH[\s\S]*Setor: RH[\s\S]*Relatórios de férias/);
  assert.equal((await agents.agentForProject(agent.projectId)).id, agent.id);
  await assert.rejects(agents.createAgent({ name: "x", mission: "y", workDir: "relativo" }), /caminho completo/);
  await assert.rejects(agents.createAgent({ name: "x", mission: "y", workDir, trigger: { type: "schedule", at: "8h" } }), /HH:MM/);
});

test("a run works in Auto mode, searches only its department and uses only its tools", async () => {
  const agent = await agents.createAgent({ name: "Agente Financeiro", kind: "setor", mission: "Cobrança.", department: "Financeiro", workDir: join(temp, "fin"), tools: ["knowledge_search", "read_file", "write_file"] });
  const sources = [{ id: "s1", department: "Financeiro", path: "F:\\Empresa\\Financeiro" }, { id: "s2", department: "RH", path: "F:\\Empresa\\RH" }];
  const ctx = await agents.agentToolOverrides(agent, { listSources: async () => sources });
  assert.equal(ctx.mode, "auto");
  assert.deepEqual(ctx.knowledgeSourceIds, ["s1"]);
  assert.deepEqual(ctx.knowledgeRoots, ["F:\\Empresa\\Financeiro"]);
  assert.deepEqual(ctx.agentTools, ["knowledge_search", "read_file", "write_file"]);
  assert.deepEqual(ctx.watchedRoots, []);
  // A file-triggered agent reads the folder it watches without asking (nobody is there to answer).
  const inbox = join(temp, "entrada");
  const watcher = await agents.createAgent({ name: "Agente Notas", kind: "pessoal", mission: "Lançar notas.", workDir: join(temp, "notas"), trigger: { type: "file", folder: inbox, pattern: "*.pdf" } });
  assert.deepEqual((await agents.agentToolOverrides(watcher, { listSources: async () => sources })).watchedRoots, [inbox]);
});

test("a run is recorded with its delivery files, and one agent runs one task at a time", async () => {
  const agent = await agents.createAgent({ name: "Agente Controladoria", kind: "setor", mission: "Resumo do orçamento.", department: "Controladoria", workDir: join(temp, "ctrl") });
  let release;
  const gate = new Promise((r) => { release = r; });
  const handleChatTurn = async ({ conversationId, message }) => {
    assert.ok(conversationId);
    assert.equal(message, "Resuma o orçamento por área.");
    await gate;
    return { ok: true, message: { content: "Feito: resumo-orcamento.md", execution: { toolSteps: [{ tool: "knowledge_search", ok: true, args: {} }, { tool: "write_file", ok: true, args: { path: "resumo-orcamento.md" } }], checks: [] } } };
  };
  const pending = agents.runAgent(agent.id, { request: "Resuma o orçamento por área.", handleChatTurn });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(agents.isAgentRunning(agent.id), true);
  await assert.rejects(agents.runAgent(agent.id, { request: "outra", handleChatTurn }), /já está trabalhando/);
  assert.equal((await agents.listRuns({ agentId: agent.id }))[0].status, "running");
  release();
  const run = await pending;
  assert.equal(run.status, "done");
  assert.deepEqual(run.files, [join(temp, "ctrl", "resumo-orcamento.md")]);
  assert.equal(run.steps, 2);
  assert.equal(agents.isAgentRunning(agent.id), false);
});

test("a failed turn is recorded as failed, with the reason", async () => {
  const agent = await agents.createAgent({ name: "Agente TI", kind: "setor", mission: "Chamados.", department: "TI", workDir: join(temp, "ti") });
  const run = await agents.runAgent(agent.id, { request: "Liste os chamados abertos.", handleChatTurn: async () => ({ ok: false, error: "O modelo local não respondeu." }) });
  assert.equal(run.status, "failed");
  assert.match(run.error, /não respondeu/);
});

test("sector agents are created once per department of the company folders", async () => {
  const first = await agents.createSectorAgents({ baseDir: join(temp, "setores"), departments: ["RH", "Marketing"] });
  assert.deepEqual(first.map((a) => a.department), ["Marketing"], "RH already has an agent");
  assert.match(first[0].mission, /setor Marketing/);
  assert.deepEqual(await agents.createSectorAgents({ baseDir: join(temp, "setores"), departments: ["Marketing"] }), []);
});
