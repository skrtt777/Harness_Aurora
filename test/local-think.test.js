import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const { thinkOption } = await import("../app/local.js");

test("reasoning is turned off (or down to low for gpt-oss) only for models that reason", async () => {
  let shows = 0;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      shows += 1;
      const { model } = JSON.parse(body);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ capabilities: model.startsWith("gemma4") ? ["completion", "tools", "thinking"] : ["completion", "tools"] }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.deepEqual(await thinkOption(base, "qwen3.5:4b", {}), { think: false });
    assert.deepEqual(await thinkOption(base, "qwen3.6:35b", { LOCAL_THINK: "true" }), { think: true });
    assert.deepEqual(await thinkOption(base, "gpt-oss:20b", {}), { think: "low" }, "gpt-oss can't turn reasoning off");
    assert.deepEqual(await thinkOption(base, "gemma4:e4b", {}), { think: false }, "asked to Ollama");
    assert.deepEqual(await thinkOption(base, "llama3.2:3b", {}), {}, "a model without reasoning gets no flag");
    await thinkOption(base, "gemma4:e4b", {});
    assert.equal(shows, 2, "capabilities are asked once per model");
    assert.deepEqual(await thinkOption("http://127.0.0.1:1", "outro:1b", {}), {}, "Ollama offline: no flag");
  } finally { server.close(); }
});

test("agent turns run on llama-server: tool calls get ids and come back in the agent's format", async () => {
  const { toOpenAiMessages } = await import("../app/localLlama.js");
  const { runLocalChat } = await import("../app/local.js");
  const converted = toOpenAiMessages([
    { role: "system", content: "s" },
    { role: "user", content: "leia a.txt" },
    { role: "assistant", content: "", tool_calls: [{ function: { name: "read_file", arguments: { path: "a.txt" } } }] },
    { role: "tool", tool_name: "read_file", content: "conteúdo" },
  ]);
  assert.deepEqual(converted[2].tool_calls, [{ id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a.txt"}' } }]);
  assert.deepEqual(converted[3], { role: "tool", tool_call_id: "call_1", content: "conteúdo" });

  let seen = null;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      seen = JSON.parse(body);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ finish_reason: "tool_calls", message: { content: "", tool_calls: [{ id: "x", type: "function", function: { name: "grep", arguments: '{"pattern":"ola"}' } }] } }], usage: { prompt_tokens: 10, completion_tokens: 5 }, timings: { predicted_per_second: 42 } }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const env = { LOCAL_ENGINE: "llama.cpp", LOCAL_BASE_URL: `http://127.0.0.1:${server.address().port}`, LOCAL_MODEL: "qwen3.6:35b" };
    const tools = [{ type: "function", function: { name: "grep", parameters: { type: "object", properties: {} } } }];
    const result = await runLocalChat([{ role: "user", content: "ache ola" }], tools, env);
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(result.toolCalls, [{ name: "grep", arguments: { pattern: "ola" } }]);
    assert.equal(result.metrics.outputTokensPerSecond, 42);
    assert.equal(seen.tools.length, 1);
    assert.deepEqual(seen.chat_template_kwargs, { enable_thinking: false });
  } finally { server.close(); }
});

test("plain generation and agent chat use the same context size (no model reload between them)", async () => {
  const { runLocal, runLocalChat, ollamaContextTokens } = await import("../app/local.js");
  const contexts = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/show") return res.end("{}");
      contexts.push(JSON.parse(body).options.num_ctx);
      res.end(JSON.stringify(req.url === "/api/chat" ? { message: { content: "ok" }, done: true } : { response: "ok", done: true }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const env = { LOCAL_BASE_URL: `http://127.0.0.1:${server.address().port}`, LOCAL_MODEL: "qwen3.6:35b", LOCAL_CONTEXT_TOKENS: "8192" };
    await runLocal("ficha do documento", env);
    await runLocalChat([{ role: "user", content: "oi" }], [], env);
    assert.deepEqual(contexts, [12288, 12288]);
    assert.equal(ollamaContextTokens({ LOCAL_CONTEXT_TOKENS: "20480" }), 20480, "a larger setting is kept");
  } finally { server.close(); }
});
