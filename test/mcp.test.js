import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const temp = mkdtempSync(join(tmpdir(), "aurora-mcp-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.EMBEDDINGS_ENABLED = "false";
const { saveMcpServers, mcpAgentTools, mcpStatus, mcpToolName, stopMcpServers } = await import("../app/mcp.js");
const { executeTool } = await import("../app/agentTools/index.js");
const { runChatAgent } = await import("../app/chatAgent.js");
const { AGENT_TOOLS } = await import("../app/agentTools/index.js");

const fake = fileURLToPath(new URL("./fixtures/fake-mcp.mjs", import.meta.url));
const ctx = (mode, approve = async () => false) => ({ mode, approve, workspace: temp, workspaceRoots: [temp], env: process.env });

test("an MCP server's tools reach the agent; read-only ones run, the others ask (and Plan refuses them)", async (t) => {
  t.after(stopMcpServers);
  await saveMcpServers([{ name: "Agenda", command: process.execPath, args: [fake] }, { name: "Quebrado", command: "comando-que-nao-existe-xyz" }]);
  const tools = await mcpAgentTools();
  assert.deepEqual(tools.map((x) => x.name), ["mcp_agenda_ler_agenda", "mcp_agenda_criar_evento"], "the broken server is left out, not the turn");
  assert.equal(mcpToolName("Google Agenda", "list-events"), "mcp_google_agenda_list_events");
  const status = await mcpStatus();
  assert.deepEqual(status.map((s) => [s.name, s.status]), [["Agenda", "ativo"], ["Quebrado", "erro"]]);

  const read = await executeTool("mcp_agenda_ler_agenda", { dia: "06/10" }, ctx("auto"), tools);
  assert.equal(read.ok, true, read.result);
  assert.match(read.result, /Reunião com o Financeiro/);

  const asked = [];
  const denied = await executeTool("mcp_agenda_criar_evento", { titulo: "Almoço" }, ctx("auto", async (r) => { asked.push(r); return false; }), tools);
  assert.equal(denied.denied, true);
  assert.match(asked[0].summary, /Agenda → criar_evento/);
  const done = await executeTool("mcp_agenda_criar_evento", { titulo: "Almoço" }, ctx("auto", async () => true), tools);
  assert.equal(done.result, 'Criei "Almoço".');
  const failed = await executeTool("mcp_agenda_criar_evento", {}, ctx("auto", async () => true), tools);
  assert.equal(failed.ok, false);
  assert.match(failed.result, /Falta o título/);
  assert.equal((await executeTool("mcp_agenda_criar_evento", { titulo: "x" }, ctx("plan", async () => true), tools)).denied, true);
});

test("after reading through an extension, a command asks first (an e-mail can carry instructions)", async (t) => {
  t.after(stopMcpServers);
  await saveMcpServers([{ name: "Agenda", command: process.execPath, args: [fake] }]);
  const tools = [...AGENT_TOOLS, ...(await mcpAgentTools())];
  const run = async (first) => {
    const replies = [
      ...(first ? [{ ok: true, text: "", toolCalls: [{ name: "mcp_agenda_ler_agenda", arguments: { dia: "06/10" } }] }] : []),
      { ok: true, text: "", toolCalls: [{ name: "run_command", arguments: { command: "echo oi" } }] },
      { ok: true, text: "Pronto." },
    ];
    const result = await runChatAgent({ system: "s", input: "veja minha agenda", tools, toolContext: ctx("auto"), callModel: async () => replies.shift() });
    return result.steps.find((s) => s.tool === "run_command");
  };
  assert.equal((await run(false)).denied, undefined, "without the extension the command runs in the project");
  assert.equal((await run(true)).denied, true);
});
