import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commonPrefix, learnPrefix, noteCacheUse, restoreSnapshot, snapshotKey, _state } from "../app/llamaCache.js";

// A fake llama-server: renders "[tools]" + system + messages, tokenizes one token per character.
function fakeServer() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      calls.push({ url: req.url, body });
      const send = (data) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(data)); };
      if (req.url === "/apply-template") return send({ prompt: `<tools>${JSON.stringify(body.tools)}</tools>${body.messages.map((m) => `<${m.role}>${m.content}`).join("")}` });
      if (req.url === "/tokenize") return send({ tokens: [...body.content].map((c) => c.charCodeAt(0)) });
      // Busy at first, idle on the next look: the start is read only when nothing is running.
      if (req.url === "/slots") return send([{ id: 0, is_processing: calls.filter((c) => c.url === "/slots").length === 1 }, { id: 1, is_processing: false }]);
      if (req.url === "/completion") return send({ timings: { prompt_n: body.prompt.length } });
      if (req.url.startsWith("/slots/")) return send({ n_restored: 5000, n_saved: 5000 });
      res.statusCode = 404; res.end("{}");
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, calls, url: `http://127.0.0.1:${server.address().port}` })));
}

test("the fixed start (tools + rules) is learned from an agent request, cut at the end of the rules, and saved", async () => {
  const { server, calls, url } = await fakeServer();
  const env = { LLAMA_CACHE_DIR: mkdtempSync(join(tmpdir(), "aurora-llama-cache-")) };
  const rules = "REGRAS ".repeat(400);
  const body = { tools: [{ type: "function", function: { name: "read_file" } }], messages: [{ role: "system", content: `${rules}\n\nAmbiente: agora é 12:00` }, { role: "user", content: "oi" }] };
  try {
    assert.equal(await learnPrefix(url, { ...body, tools: [] }, { key: "k1", env, rules, idleCheckMs: 5 }), null, "no tools: not the agent");
    const kept = await learnPrefix(url, body, { key: "k1", env, rules, idleCheckMs: 5 });
    const warm = calls.find((c) => c.url === "/completion");
    const text = String.fromCharCode(...warm.body.prompt);
    assert.ok(text.endsWith(rules.trim()), "cut exactly at the end of the rules");
    assert.doesNotMatch(text, /Ambiente|<user>/, "nothing that changes per turn");
    assert.equal(warm.body.n_predict, 0);
    assert.equal(warm.body.id_slot, 1, "an idle slot");
    assert.equal(calls.filter((c) => c.url === "/slots").length, 2, "waited until nothing was running");
    assert.ok(calls.some((c) => c.url === "/slots/1?action=save"));
    assert.equal(JSON.parse(readFileSync(join(env.LLAMA_CACHE_DIR, "k1.json"), "utf8")).tokens, kept);
    // Saved once: the next request does not learn again.
    const before = calls.length;
    assert.equal(await learnPrefix(url, body, { key: "k1", env, rules, idleCheckMs: 5 }), null);
    assert.equal(calls.length, before);
  } finally { server.close(); _state.clear(); }
});

test("at start every slot gets the saved start; a first answer that barely used it marks it stale", async () => {
  const { server, calls, url } = await fakeServer();
  const env = { LLAMA_CACHE_DIR: mkdtempSync(join(tmpdir(), "aurora-llama-cache-")) };
  try {
    assert.equal(await restoreSnapshot(url, { key: "nada", slots: 4, env }), 0, "nothing saved yet");
    const rules = "R".repeat(3000);
    assert.ok(await learnPrefix(url, { tools: [{}], messages: [{ role: "system", content: `${rules} fim` }] }, { key: "k2", env, rules, idleCheckMs: 5 }), "learned");
    writeFileSync(join(env.LLAMA_CACHE_DIR, "k2.bin"), "estado"); // the real server writes it
    _state.clear();
    assert.equal(await restoreSnapshot(url, { key: "k2", slots: 4, env }), 5000);
    assert.equal(calls.filter((c) => /action=restore/.test(c.url)).length, 4);
    noteCacheUse(url, 600); // the rules changed: the restored start did not match
    assert.equal(_state.get(url).stale, true);
  } finally { server.close(); _state.clear(); }
});

test("helpers: common prefix, and a key that changes with the model file", () => {
  assert.equal(commonPrefix([1, 2, 3, 4], [1, 2, 9]), 2);
  const dir = mkdtempSync(join(tmpdir(), "aurora-key-"));
  assert.notEqual(snapshotKey("qwen3.5:4b", join(dir, "a"), join(dir, "b")), snapshotKey("qwen3.5:9b", join(dir, "a"), join(dir, "b")));
  assert.ok(!existsSync(join(dir, "a")));
});
