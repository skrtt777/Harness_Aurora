import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HARNESS_DB_FILE = join(mkdtempSync(join(tmpdir(), "aurora-isolation-")), "test.db");
process.env.OLLAMA_URL = "http://127.0.0.1:9"; // no embeddings: keyword retrieval only
const store = await import("../app/store.js");
const { updateCentralConfig } = await import("../app/centralMemory.js");

test("a client's debt learned in company X's project never shows up in company Y's project", async () => {
  const x = await store.createProject({ name: "Empresa X" });
  const y = await store.createProject({ name: "Empresa Y" });
  const chatX = await store.createConversation({ projectId: x.id, title: "Cobrança" });
  const chatY = await store.createConversation({ projectId: y.id, title: "Clientes" });
  // The Aurora asked to save it as global: it stays in X's project, marked sensitive.
  const debt = await store.createMemory({ scope: "global", projectId: x.id, conversationId: chatX.id, title: "Empório Central inadimplente", content: "O cliente Empório Central deve R$ 157.935,04 em duplicatas atrasadas.", kind: "extracted" });
  assert.equal(debt.scope, "project");
  assert.equal(debt.sensitive, true);
  // A general lesson may still be global.
  const tip = await store.createMemory({ scope: "global", title: "Planilhas", content: "Para contar linhas de uma planilha, use read_file com filter.", kind: "extracted" });
  assert.equal(tip.scope, "global");
  assert.equal(tip.sensitive, false);

  const inY = await store.selectRelevantMemories("quanto o Empório Central deve?", { projectId: y.id, conversationId: chatY.id });
  assert.ok(!inY.some((m) => m.id === debt.id), "not in company Y");
  const inX = await store.selectRelevantMemories("quanto o Empório Central deve?", { projectId: x.id, conversationId: chatX.id });
  assert.ok(inX.some((m) => m.id === debt.id), "still there for company X");
});

test("'my other chats' stays inside the project, and a sensitive chat memory stays in its chat", async () => {
  await updateCentralConfig({ crossChatEnabled: true });
  const x = await store.createProject({ name: "Cliente X" });
  const y = await store.createProject({ name: "Cliente Y" });
  const a = await store.createConversation({ projectId: x.id, title: "a" });
  const b = await store.createConversation({ projectId: x.id, title: "b" });
  const c = await store.createConversation({ projectId: y.id, title: "c" });
  const preference = await store.createMemory({ scope: "conversation", conversationId: a.id, title: "Formato de relatório", content: "Relatórios do cliente em tópicos curtos com o resumo no topo.", kind: "extracted" });
  const salary = await store.createMemory({ scope: "conversation", conversationId: a.id, title: "Salário", content: "Bruno Gomes Souza ganha R$ 2.518,03.", kind: "extracted" });
  const sameProject = await store.selectRelevantMemories("formato de relatório em tópicos", { projectId: x.id, conversationId: b.id });
  assert.ok(sameProject.some((m) => m.id === preference.id), "other chat of the same project");
  const otherProject = await store.selectRelevantMemories("formato de relatório em tópicos", { projectId: y.id, conversationId: c.id });
  assert.ok(!otherProject.some((m) => m.id === preference.id), "never another project's chat");
  const salaryAsked = await store.selectRelevantMemories("quanto ganha o Bruno Gomes Souza", { projectId: x.id, conversationId: b.id });
  assert.ok(!salaryAsked.some((m) => m.id === salary.id), "a sensitive chat memory stays in its chat");
  await updateCentralConfig({ crossChatEnabled: false });
});
