import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "aurora-retry-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.EMBEDDINGS_ENABLED = "false";
const store = await import("../app/store.js");
const { handleChatTurn } = await import("../app/server.js");

test("a turn whose llama-server connection drops is run once more instead of failing", async () => {
  await store.setSetting("teacher_mode", "off");
  let requests = 0;
  const stub = http.createServer((req, res) => {
    requests += 1;
    if (requests === 1) { req.socket.destroy(); return; } // the connection drops: "fetch failed"
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const stream = JSON.parse(body).stream;
      if (stream) {
        res.setHeader("content-type", "text/event-stream");
        res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "Tudo certo." }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
      } else {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ choices: [{ message: { content: "Tudo certo." }, finish_reason: "stop" }] }));
      }
    });
  });
  await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
  try {
    const conversation = await store.createConversation({ provider: "local" });
    const url = `http://127.0.0.1:${stub.address().port}`;
    const result = await handleChatTurn({ conversationId: conversation.id, message: "oi, tudo bem?", env: { ...process.env, LOCAL_CHAT_BASE_URL: url, LOCAL_BASE_URL: "http://127.0.0.1:1", LOCAL_MODEL: "qwen3.5:4b" } });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.message.content, "Tudo certo.");
    assert.equal(requests, 2, "one dropped connection, one retry");
  } finally {
    await new Promise((resolve) => stub.close(resolve));
  }
});

test("warming the local model is the desktop app's: elsewhere the route answers and starts nothing", async () => {
  const { createServer } = await import("../app/server.js");
  const { llamaServerInfo } = await import("../app/llamaServer.js");
  const server = createServer({ allowDev: false });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/local/warm`, { method: "POST", headers: { "x-harness-token": server.apiToken } });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { warming: false });
    assert.equal(llamaServerInfo(), null, "no llama-server was started");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("the video card's name and memory are read from llama-server's device list", async () => {
  const { parseDevice } = await import("../app/llamaServer.js");
  assert.deepEqual(parseDevice("Available devices:\n  CUDA0: NVIDIA GeForce RTX 4090 (23027 MiB, 21510 MiB free)\n"), { name: "NVIDIA GeForce RTX 4090", memoryGb: 22, freeGb: 21 });
  assert.deepEqual(parseDevice("Available devices:\n  Vulkan0: AMD Radeon RX 7600 (8176 MiB, 7900 MiB free)"), { name: "AMD Radeon RX 7600", memoryGb: 8, freeGb: 8 });
  assert.equal(parseDevice("Available devices:\n  (none)"), null);
});

test("removing every folder the Aurora may change keeps the list empty (it does not come back)", async () => {
  const { agentSettingsPayload } = await import("../app/chatTurn.js");
  await store.setSetting("agent_allowed_roots", JSON.stringify([]));
  assert.deepEqual((await agentSettingsPayload()).agentAllowedRoots, []);
  await store.setSetting("agent_allowed_roots", "");
  assert.ok((await agentSettingsPayload()).agentAllowedRoots.length >= 1, "never set: the usual folders");
});
