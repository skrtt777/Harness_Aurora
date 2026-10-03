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
