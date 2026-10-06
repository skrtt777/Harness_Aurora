import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "aurora-agentmem-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");

test("an agent run is told its own last deliveries", async () => {
  const agents = await import("../app/agents.js");
  const { previousWork } = await import("../app/chatTurn.js");
  const agent = await agents.createAgent({ name: "Cobrança", mission: "Lista de cobrança semanal", workDir: join(temp, "cobranca") });
  const seen = [];
  const turn = (files) => async ({ conversationId, env }) => {
    seen.push(env.AGENT_PREVIOUS_WORK || null);
    return { ok: true, message: { conversationId, content: "Feito.", execution: { toolSteps: files.map((f) => ({ tool: "write_document", ok: true, summary: `Criei ${f} (XLSX, 10 bytes).` })) } } };
  };
  await agents.runAgent(agent.id, { request: "Gere a lista", handleChatTurn: turn([join(temp, "cobranca", "cobranca_semana1.xlsx")]) });
  await agents.runAgent(agent.id, { request: "Atualize a lista", handleChatTurn: turn([]) });
  assert.equal(seen[0], null, "the first run has nothing before it");
  assert.match(seen[1], /cobranca_semana1\.xlsx/);
  const [block] = previousWork({ AGENT_PREVIOUS_WORK: seen[1] });
  assert.match(block, /Suas últimas entregas como este agente[\s\S]*cobranca_semana1\.xlsx/);
  assert.deepEqual(previousWork({}), []);
});
