import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const temp = mkdtempSync(join(tmpdir(), "harness-regressions-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.LOCAL_BASE_URL = "http://127.0.0.1:1";
process.env.CODEX_BIN = join(temp, "missing-codex.exe");
process.env.CLAUDE_BIN = join(temp, "missing-claude.exe");
const { getDb } = await import("../app/db.js");
const { createServer, buildPrompt, handleChatTurn } = await import("../app/server.js");
const store = await import("../app/store.js");
const { importMemories } = await import("../app/memoryImport.js");
const { runCodeInSandbox, constReassignments } = await import("../app/jsSandbox.js");
const { refineLocalAnswer, checkJsModuleSyntax } = await import("../app/localRefine.js");
const { startTurn, endTurn, cancelTurn, getStage } = await import("../app/pendingTurns.js");
const { isModelPulled, pullModel, startOllamaServer } = await import("../app/ollamaSetup.js");
const { resolveCli } = await import("../app/cliRuntime.js");
const { mapOcrData } = await import("../app/ocr.js");
const { materializeSandboxFile, readSandboxFile } = await import("../app/sandboxCode.js");
const { createRun, finishRun, getActiveRun, resetAgentRunsForTests } = await import("../app/agentRuns.js");
const { decodeEmbedding } = await import("../app/embeddings.js");
const { runCodex } = await import("../app/codex.js");
const { runClaude } = await import("../app/claude.js");
const { recognizeImage, terminateOcr } = await import("../app/ocr.js");
const fakeCli = fileURLToPath(new URL("./fixtures/fake-cli.mjs", import.meta.url));

async function listen(server) {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
async function withServer(fn) {
  const server = createServer({ allowDev: false });
  const base = await listen(server);
  const api = (path, options = {}) => fetch(base + path, { ...options, headers: { "content-type": "application/json", "x-harness-token": server.apiToken, ...options.headers } });
  try { await fn(api, base, server); } finally { await close(server); }
}
async function readBody(req) { const chunks = []; for await (const chunk of req) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString() || "{}"); }
const json = (res, value) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value)); };

test("concurrent first database callers share one real SQLite connection", async () => {
  const values = await Promise.all(Array.from({ length: 12 }, () => getDb()));
  assert.ok(values.every(db => db === values[0]));
  assert.equal(values[0].prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
});

test("generated JavaScript cannot run host code, loops, imports or host constructors during review", () => {
  delete process.env.HARNESS_SANDBOX_PROBE;
  runCodeInSandbox(`console.log.constructor("return process")().env.HARNESS_SANDBOX_PROBE = "escaped"; while(true) {}`);
  assert.equal(process.env.HARNESS_SANDBOX_PROBE, undefined);
  assert.equal(runCodeInSandbox(`import { something } from "https://example.invalid/module.js"; something();`).crashed, false);
  assert.deepEqual(constReassignments("const x = 1; const object = {}; object.x = 2; function f() { let x = 2; x++; }"), []);
  assert.deepEqual(constReassignments("const x=1; x++;"), ["x"]);
});

test("syntax review ignores import maps and works without a Node child process", async () => {
  const result = await checkJsModuleSyntax('<script type="importmap">{"imports":{"three":"https://example.test/three.js"}}</script><script type="module">import * as THREE from "three"; const scene = new THREE.Scene();</script>');
  assert.equal(result.valid, true);
});

test("prompt budget bounds oversized instructions/memories and retains task and recent history", () => {
  const prompt = buildPrompt({ input: "TASK_SENTINEL", limit: 1000, instructions: "x".repeat(10000), memories: [{ title: "m", content: "y".repeat(10000) }], history: [{ role: "user", content: "Meu nome é Alice" }, { role: "assistant", content: "Olá, Alice" }] });
  assert.ok(prompt.length <= 1000);
  assert.match(prompt, /TASK_SENTINEL/);
  assert.match(prompt, /Meu nome é Alice/);
});

test("HTTP requires session token, loopback Host, same-origin and JSON objects before mutation", async () => withServer(async (api, base) => {
  assert.equal((await fetch(base + "/api/projects")).status, 401);
  assert.equal((await api("/api/projects", { method: "POST", headers: { origin: "https://evil.example" }, body: '{"name":"bad"}' })).status, 403);
  const badHost = await new Promise((resolve, reject) => {
    http.get(base + "/api/session", { headers: { host: "evil.example" } }, response => { response.resume(); resolve(response.statusCode); }).on("error", reject);
  });
  assert.equal(badHost, 403);
  assert.equal((await api("/api/session", { headers: { origin: "null" } })).status, 403);
  assert.equal((await api("/api/projects", { method: "POST", headers: { "content-type": "text/plain" }, body: '{"name":"bad"}' })).status, 415);
  for (const body of ["null", "[]", "{", '{"name":{}}']) assert.equal((await api("/api/projects", { method: "POST", body })).status, 400);
  const before = (await store.listMemories()).length;
  assert.equal((await api("/api/memories", { method: "POST", body: JSON.stringify({ title: "Bad", content: "Bad", tags: {} }) })).status, 400);
  assert.equal((await store.listMemories()).length, before);
  assert.equal((await api("/api/projects", { method: "POST", body: JSON.stringify({ name: "x".repeat(1000001) }) })).status, 413);
  assert.equal((await api("/api/local/setup")).status, 404);
}));

test("wrong chat HTTP method does not persist a message or execute a provider", async () => withServer(async api => {
  const conversation = await store.createConversation();
  assert.equal((await api(`/api/conversations/${conversation.id}/messages`, { method: "PUT", body: '{"message":"hello"}' })).status, 405);
  assert.equal((await store.listMessages(conversation.id)).length, 0);
}));

test("settings validation is atomic", async () => withServer(async api => {
  await store.setSetting("default_provider", "codex");
  const response = await api("/api/settings", { method: "PUT", body: JSON.stringify({ defaultProvider: "local", defaultTeacher: "invalid" }) });
  assert.equal(response.status, 400);
  assert.equal(await store.getSetting("default_provider"), "codex");
}));

test("preview stays opaque even when opened in an external browser; renaming preserves artifact", async () => withServer(async (api, base) => {
  const c = await store.createConversation({ title: "Before", provider: "local" });
  const m = await store.addMessage({ conversationId: c.id, role: "assistant", content: "```html\n<html><script>console.log(1)</script></html>\n```", provider: "Local" });
  await store.setSetting("sandbox_dir", join(temp, "sandbox"));
  const run = await (await api(`/api/conversations/${c.id}/messages/${m.id}/sandbox`, { method: "POST" })).json();
  await store.updateConversation(c.id, { title: "After" });
  const response = await fetch(base + run.previewUrl);
  assert.equal(response.status, 200);
  const csp = response.headers.get("content-security-policy");
  assert.match(csp, /sandbox allow-scripts/);
  assert.doesNotMatch(csp, /allow-same-origin|allow-top-navigation/);
  assert.match(await response.text(), /console.log/);
}));

test("local turns include persisted conversation history and cancellation rejects overlapping sends", async () => {
  const prompts = [];
  let slow = false;
  let started;
  const stub = http.createServer(async (req, res) => {
    if (req.url !== "/api/generate") { res.writeHead(404); res.end(); return; }
    const body = await readBody(req); prompts.push(body.prompt);
    if (slow) { started(); return; }
    json(res, { response: "Olá, Alice!" });
  });
  const base = await listen(stub);
  const env = { ...process.env, LOCAL_BASE_URL: base, LOCAL_MODEL: "test:latest" };
  try {
    const c = await store.createConversation({ provider: "local" });
    assert.equal((await handleChatTurn({ conversationId: c.id, message: "Meu nome é Alice", env })).ok, true);
    assert.equal((await handleChatTurn({ conversationId: c.id, message: "Qual é meu nome?", env })).ok, true);
    assert.match(prompts[1], /Meu nome é Alice/); assert.match(prompts[1], /Olá, Alice!/);
    slow = true;
    const waitStarted = new Promise(resolve => { started = resolve; });
    const pending = handleChatTurn({ conversationId: c.id, message: "slow", env });
    await waitStarted;
    assert.equal((await handleChatTurn({ conversationId: c.id, message: "duplicate", env })).status, 409);
    assert.ok(getStage(c.id));
    cancelTurn(c.id);
    assert.equal((await pending).cancelled, true);
    assert.equal(getStage(c.id), null);
    assert.equal((await store.listMessages(c.id)).filter(m => m.content === "duplicate").length, 0);
  } finally { await close(stub); }
});

test("cancelled refinement never becomes a successful answer; turn ownership cannot be overwritten", async () => {
  const controller = new AbortController(); controller.abort();
  const result = await refineLocalAnswer({ task: "x", result: { ok: true, text: "<script>1</script>" }, signal: controller.signal });
  assert.equal(result.ok, false); assert.equal(result.cancelled, true);
  const own = startTurn("regression-turn");
  assert.throws(() => startTurn("regression-turn"), /andamento/);
  endTurn("regression-turn", new AbortController());
  assert.ok(getStage("regression-turn")); endTurn("regression-turn", own);
});

test("memory import preserves owner-specific duplicates and relations to existing records atomically", async () => {
  const p1 = await store.createProject({ name: "One" }), p2 = await store.createProject({ name: "Two" });
  const entry = (id, projectId) => ({ id, scope: "project", projectId, title: "Same", content: "Same content", tags: [] });
  const first = await store.createMemory({ ...entry("unused", p1.id) });
  const a = entry("a", p1.id), b = { ...entry("b", p2.id), relations: ["a"], relationTypes: { a: "thematic" } };
  const envelope = { format: "harness-aurora-memories", version: 1, memories: [a, b] };
  assert.deepEqual(await importMemories(envelope), { imported: 1, skipped: 1, relationsCreated: 1 });
  const saved = await store.listMemories({ projectId: p2.id });
  assert.deepEqual(saved[0].relations, [first.id]);
  assert.deepEqual(await importMemories(envelope), { imported: 0, skipped: 2, relationsCreated: 0 });
  const before = (await store.listMemories()).length;
  await assert.rejects(importMemories({ ...envelope, memories: [{ ...a, id: "new", content: "new" }, { ...b, projectId: "missing" }] }));
  assert.equal((await store.listMemories()).length, before);
});

test("editing while Ollama is offline clears obsolete embeddings", async () => {
  const db = await getDb();
  const m = await store.createMemory({ title: "Before", content: "before" });
  db.prepare("UPDATE memories SET embedding = ?, embedding_model = 'old' WHERE id = ?").run(Buffer.from(new Float32Array([1, 0]).buffer), m.id);
  await store.updateMemory(m.id, { content: "after" });
  const row = db.prepare("SELECT embedding,embedding_model FROM memories WHERE id=?").get(m.id);
  assert.equal(row.embedding, null); assert.equal(row.embedding_model, null);
});

test("an older embedding response cannot overwrite a newer edit", async () => {
  let release, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const stub = http.createServer(async (req, res) => {
    if (req.url === "/api/version") return json(res, { version: "test" });
    if (req.url === "/api/tags") return json(res, { models: [{ name: "nomic-embed-text:latest" }] });
    const body = await readBody(req);
    if (body.prompt.includes("first edit")) { started(); await new Promise(resolve => { release = resolve; }); }
    json(res, { embedding: body.prompt.includes("second edit") ? [0, 1] : [1, 0] });
  });
  const base = await listen(stub);
  try {
    const m = await store.createMemory({ title: "Revision", content: "before" });
    const env = { LOCAL_BASE_URL: base };
    const first = store.updateMemory(m.id, { content: "first edit" }, env);
    await waiting;
    await store.updateMemory(m.id, { content: "second edit" }, env);
    release(); await first;
    const row = (await getDb()).prepare("SELECT embedding,content FROM memories WHERE id=?").get(m.id);
    assert.equal(row.content, "second edit"); assert.deepEqual(decodeEmbedding(row.embedding), [0, 1]);
  } finally { await close(stub); }
});

test("Ollama tags match exactly, pulls flush trailing data and require explicit success", async () => {
  let mode = "success";
  const stub = http.createServer((req, res) => {
    if (req.url === "/api/tags") return json(res, { models: [{ name: "qwen:7b" }] });
    res.end(JSON.stringify({ status: mode }));
  });
  const base = await listen(stub);
  try {
    assert.equal(await isModelPulled(base, "qwen"), false);
    assert.equal(await isModelPulled(base, "qwen:latest"), false);
    assert.equal(await isModelPulled(base, "qwen:7b"), true);
    assert.equal((await pullModel(base, "test")).ok, true);
    mode = "downloading";
    assert.equal((await pullModel(base, "test")).ok, false);
  } finally { await close(stub); }
});

test("missing Ollama executable rejects without an unhandled process error", async () => {
  await assert.rejects(startOllamaServer({ OLLAMA_BIN: join(temp, "no-ollama.exe") }));
});

test("Tesseract 7 block output maps real word boxes", () => {
  const word = { text: "Salvar", confidence: 98, bbox: { x0: 10, y0: 20, x1: 50, y1: 40 } };
  const mapped = mapOcrData({ text: "Salvar", blocks: [{ paragraphs: [{ lines: [{ words: [word] }] }] }] });
  assert.deepEqual(mapped.words[0], { text: "Salvar", confidence: 98, x0: 10, y0: 20, x1: 50, y1: 40 });
});

test("an explicit missing CLI never falls back to an authenticated default", () => {
  for (const provider of ["codex", "claude"]) {
    const name = `missing-${provider}-test`;
    const resolved = resolveCli(provider, { ...process.env, [`${provider.toUpperCase()}_BIN`]: name });
    assert.equal(resolved.command, name); assert.equal(resolved.installed, false);
  }
});

test("only one browser agent can own the shared page", () => {
  resetAgentRunsForTests();
  const run = createRun(); assert.equal(getActiveRun().id, run.id);
  assert.throws(() => createRun(), /execução/);
  finishRun(run.id, { ok: true }); assert.equal(getActiveRun(), null);
  finishRun(createRun().id, { ok: true });
});

test("sandbox artifacts stay accessible after a rename and reject path traversal IDs", async () => {
  const args = { conversationId: "conv", conversationTitle: "old", messageId: "msg" };
  await materializeSandboxFile(join(temp, "artifacts"), { ...args, html: "<html>ok</html>" });
  assert.equal(await readSandboxFile(join(temp, "artifacts"), { ...args, conversationTitle: "new" }), "<html>ok</html>");
  await assert.rejects(materializeSandboxFile(temp, { ...args, messageId: "../../escape", html: "x" }));
});

test("CLI wrappers honor model selection, reject empty/error output and abort subprocesses", async () => {
  const codex = await runCodex("pergunta", { CODEX_BIN: fakeCli, CODEX_MODEL: "test-model" });
  assert.equal(codex.ok, true);
  assert.deepEqual(JSON.parse(codex.text).args.slice(-3), ["--model", "test-model", "pergunta"]);
  assert.equal((await runCodex("x", { CODEX_BIN: fakeCli, FAKE_CLI_INVALID: "1" })).ok, false);
  assert.equal((await runClaude("x", { CLAUDE_BIN: fakeCli, FAKE_CLI_ERROR: "1" })).ok, false);
  const controller = new AbortController();
  const pending = runClaude("x", { CLAUDE_BIN: fakeCli, FAKE_CLI_DELAY_MS: "30000" }, controller.signal);
  controller.abort(); assert.equal((await pending).ok, false);
});

test("assistant answer is persisted and returned before background memory extraction completes", async () => {
  const conversation = await store.createConversation({ provider: "codex" });
  const result = await handleChatTurn({ conversationId: conversation.id, message: "Meu nome é Alice", env: { ...process.env, CODEX_BIN: fakeCli, FAKE_EXTRACTION_DELAY_MS: "300" } });
  assert.equal(result.ok, true);
  let message = await store.getMessage(result.message.id);
  assert.equal(message.memoryStatus, "pending");
  assert.equal(message.memoryCreated.length, 0);
  for (let i = 0; i < 100 && message.memoryStatus === "pending"; i++) {
    await new Promise(resolve => setTimeout(resolve, 20));
    message = await store.getMessage(result.message.id);
  }
  assert.equal(message.memoryStatus, "complete"); assert.equal(message.memoryCreated.length, 1);
});

test("OCR initialization timeout terminates the supervised worker and allows retry", async () => {
  await assert.rejects(recognizeImage(fileURLToPath(new URL("./fixtures/ocr-sample.png", import.meta.url)), { OCR_START_TIMEOUT_MS: "1", OCR_CACHE_PATH: join(temp, "ocr-timeout") }), /esgotado/);
  await terminateOcr();
});

test("correction only accepts local assistant answers and is idempotent", async () => withServer(async api => {
  const c = await store.createConversation({ provider: "local", teacherProvider: "codex" });
  await store.addMessage({ conversationId: c.id, role: "user", content: "Pergunta" });
  const system = await store.addMessage({ conversationId: c.id, role: "assistant", provider: "Sistema", content: "Falha" });
  assert.equal((await api(`/api/conversations/${c.id}/messages/${system.id}/correct`, { method: "POST", body: "{}" })).status, 400);
  const answer = await store.addMessage({ conversationId: c.id, role: "assistant", provider: "Local", content: "Resposta ruim" });
  const previous = process.env.CODEX_BIN; process.env.CODEX_BIN = fakeCli;
  try {
    const path = `/api/conversations/${c.id}/messages/${answer.id}/correct`;
    const response = await api(path, { method: "POST", body: "{}" });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).message.correctionOf, answer.id);
    assert.equal((await api(path, { method: "POST", body: "{}" })).status, 409);
  } finally { process.env.CODEX_BIN = previous; }
}));
