import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HARNESS_DB_FILE = join(mkdtempSync(join(tmpdir(), "aurora-privacy-")), "test.db");
process.env.OLLAMA_URL = "http://127.0.0.1:9";
const store = await import("../app/store.js");
const { getDb } = await import("../app/db.js");
const privacy = await import("../app/privacy.js");

test("everything kept about a client is found, exported and erased (LGPD art. 18)", async () => {
  const project = await store.createProject({ name: "Financeiro" });
  const chat = await store.createConversation({ projectId: project.id, title: "Cobrança Empório Central" });
  const db = await getDb();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO messages (id, conversation_id, role, content, created_at, execution) VALUES (?, ?, 'user', ?, ?, NULL)").run("m1", chat.id, "Quanto o Empório Central (CNPJ 12.345.678/0001-90) deve?", now);
  db.prepare("INSERT INTO messages (id, conversation_id, role, content, created_at, execution) VALUES (?, ?, 'assistant', ?, ?, ?)").run("m2", chat.id, "O Empório Central deve R$ 157.935,04.", now, JSON.stringify({ toolSteps: [{ tool: "read_file", args: { filter: "Cliente=Empório Central" }, summary: "Empório Central | 93185.88" }] }));
  db.prepare("INSERT INTO messages (id, conversation_id, role, content, created_at, execution) VALUES (?, ?, 'user', ?, ?, NULL)").run("m3", chat.id, "E o Hotel Litoral Norte?", now);
  await store.createMemory({ scope: "project", projectId: project.id, title: "Empório Central", content: "Empório Central atrasa sempre as duplicatas.", kind: "extracted" });
  const other = await store.createMemory({ scope: "project", projectId: project.id, title: "Hotel", content: "Hotel Litoral Norte paga em dia.", kind: "extracted" });

  const found = await privacy.searchSubject("emporio central"); // typed without accent
  assert.equal(found.memories.length, 1);
  assert.equal(found.conversations[0].messages, 2);
  // By CNPJ digits too.
  assert.equal((await privacy.searchSubject("12345678000190")).conversations.length, 1);

  const copy = await privacy.exportSubject("Empório Central");
  assert.equal(copy.format, "aurora-lgpd-export");
  assert.equal(copy.messages.length, 2);
  assert.equal(copy.messages[1].execution.toolSteps[0].tool, "read_file");

  await assert.rejects(privacy.eraseSubject("Empório Central"), /Confirme/);
  const erased = await privacy.eraseSubject("Empório Central", { confirm: true });
  assert.deepEqual([erased.memoriesDeleted, erased.messagesRedacted, erased.conversationsRenamed], [1, 2, 1]);
  const rest = db.prepare("SELECT content, execution FROM messages ORDER BY id").all();
  assert.ok(rest.every((m) => !/Empório/i.test(`${m.content}${m.execution || ""}`)), "no trace left in the text or the tool steps");
  assert.match(rest[1].content, /\[removido a pedido do titular\] deve R\$ 157\.935,04/);
  assert.match(rest[2].content, /Hotel Litoral Norte/, "the others stay");
  assert.ok((await store.selectRelevantMemories("Hotel Litoral Norte", { projectId: project.id })).some((m) => m.id === other.id));
  assert.equal((await privacy.searchSubject("Empório Central")).total, 0);
});
