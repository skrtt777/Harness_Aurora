import test from "node:test";
import assert from "node:assert/strict";
import { buildProviderConfig, createServer, limitContext, parseCodexOutput } from "../app/server.js";

test("provider config uses the authenticated Codex CLI", () => {
  const config = buildProviderConfig({});
  assert.equal(config.id, "codex");
  assert.equal(config.mode, "cli");
  assert.equal(config.configured, true);
  assert.equal(config.command, "codex");
});

test("provider config respects environment settings", () => {
  const config = buildProviderConfig({ CODEX_BIN: "codex-custom", CODEX_MODEL: "custom-model" });
  assert.equal(config.configured, true);
  assert.equal(config.model, "custom-model");
  assert.equal(config.command, "codex-custom");
});

test("parser extracts the final Codex agent message", () => {
  const output = [
    JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Resposta final" } }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 4 } })
  ].join("\n");
  assert.deepEqual(parseCodexOutput(output), {
    text: "Resposta final",
    threadId: "thread-1",
    usage: { input_tokens: 10, output_tokens: 4 }
  });
});

test("context limiter preserves the memory header and caps prompt size", () => {
  const prompt = limitContext("a".repeat(5000), { nodes: [{ label: "Preferência", content: "Respostas curtas" }] }, 2000);
  assert.equal(prompt.length, 2000);
  assert.match(prompt, /Memórias relevantes/);
});

test("local server exposes a health endpoint", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
  const body = await response.json();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.provider.id, "codex");
});
