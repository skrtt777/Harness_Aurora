import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "aurora-audit-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.EMBEDDINGS_ENABLED = "false";
const store = await import("../app/store.js");
const { createServer } = await import("../app/server.js");

test("the audit trail lists what the agent did in any conversation, not what it only read", async () => {
  const c = await store.createConversation({ provider: "local", title: "Organizar; Downloads" });
  await store.addMessage({ conversationId: c.id, role: "user", content: "organize" });
  await store.addMessage({ conversationId: c.id, role: "assistant", provider: "Local", content: "Pronto.", execution: { toolSteps: [
    { tool: "read_file", ok: true, summary: "Li nota.pdf" },
    { tool: "move_file", ok: true, summary: "Movi C:/D/nota.pdf para C:/D/Documentos/nota.pdf." },
    { tool: "run_command", ok: false, denied: true, summary: "Remove-Item x" },
    { tool: "write_document", ok: false, summary: "ERRO: disco cheio" },
  ] } });
  const server = createServer({ allowDev: false });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/audit.csv`, { headers: { "x-harness-token": server.apiToken } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-disposition"), /aurora-acoes-\d{4}-\d{2}-\d{2}\.csv/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], "BOM: Excel reads the accents");
    const lines = bytes.subarray(3).toString("utf8").trim().split("\r\n");
    assert.equal(lines[0], "Quando;Conversa;Ferramenta;O que fez;Resultado");
    assert.equal(lines.length, 4, "three actions; the read is not one");
    assert.match(lines[1], /;"Organizar; Downloads";move_file;Movi C:\/D\/nota\.pdf .*;feito$/);
    assert.match(lines[2], /;run_command;Remove-Item x;negado$/);
    assert.match(lines[3], /;write_document;ERRO: disco cheio;falhou$/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
