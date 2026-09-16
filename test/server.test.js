import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A dedicated, throwaway SQLite file per test run keeps this suite isolated
// from whatever conversations/memories a real local user has accumulated.
// This must run before app/db.js is imported anywhere in the chain, so the
// server (and everything it pulls in) is loaded with a dynamic import below
// instead of a static one, which Node would hoist above this assignment.
process.env.HARNESS_DB_FILE = join(mkdtempSync(join(tmpdir(), "harness-test-")), "test.db");
process.env.CODEX_BIN = "codex-binary-not-installed-in-tests";

const { createServer, buildPrompt } = await import("../app/server.js");
const { buildProviderConfig, parseCodexOutput } = await import("../app/codex.js");
const { parseMemoryCandidates, buildExtractionPrompt } = await import("../app/memoryExtractor.js");

async function withServer(run) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const api = (path, options) =>
    fetch(`${base}${path}`, {
      headers: { "content-type": "application/json" },
      ...options,
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
  try {
    await run(api);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test("provider config uses the authenticated Codex CLI", () => {
  const config = buildProviderConfig({});
  assert.equal(config.id, "codex");
  assert.equal(config.mode, "cli");
  assert.equal(config.configured, true);
  assert.equal(config.command, "codex");
});

test("provider config respects environment settings", () => {
  const config = buildProviderConfig({ CODEX_BIN: "codex-custom", CODEX_MODEL: "custom-model" });
  assert.equal(config.model, "custom-model");
  assert.equal(config.command, "codex-custom");
});

test("parser extracts the final Codex agent message", () => {
  const output = [
    JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Resposta final" } }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 4 } }),
  ].join("\n");
  assert.deepEqual(parseCodexOutput(output), {
    text: "Resposta final",
    threadId: "thread-1",
    usage: { input_tokens: 10, output_tokens: 4 },
  });
});

test("prompt builder includes project instructions and relevant memories, and caps size", () => {
  const prompt = buildPrompt({
    input: "a".repeat(5000),
    memories: [{ title: "Preferência", content: "Respostas curtas" }],
    instructions: "Responda sempre em português.",
    limit: 2000,
  });
  assert.equal(prompt.length, 2000);
  assert.match(prompt, /Memórias relevantes/);
  assert.match(prompt, /Instruções do projeto/);
});

test("prompt builder works with no memories and no instructions", () => {
  const prompt = buildPrompt({ input: "olá" });
  assert.equal(prompt, "Tarefa atual:\nolá");
});

test("memory extractor parses a clean JSON array", () => {
  const candidates = parseMemoryCandidates('[{"title":"Nome","content":"Usuário se chama Lucas","tags":["perfil"]}]');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].title, "Nome");
});

test("memory extractor tolerates prose around the JSON array", () => {
  const candidates = parseMemoryCandidates('Aqui está: [{"title":"Fato","content":"Usa SQLite"}] fim.');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].content, "Usa SQLite");
});

test("memory extractor returns nothing for an empty array or garbage", () => {
  assert.deepEqual(parseMemoryCandidates("[]"), []);
  assert.deepEqual(parseMemoryCandidates("não é json"), []);
});

test("extraction prompt embeds both sides of the exchange", () => {
  const prompt = buildExtractionPrompt("Meu nome é Lucas", "Prazer, Lucas!");
  assert.match(prompt, /Meu nome é Lucas/);
  assert.match(prompt, /Prazer, Lucas!/);
});

test("local server exposes a health endpoint", async () => {
  await withServer(async (api) => {
    const { status, body } = await api("/api/health");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.provider.id, "codex");
  });
});

test("projects and conversations can be created, listed and scoped", async () => {
  await withServer(async (api) => {
    const project = await api("/api/projects", { method: "POST", body: JSON.stringify({ name: "Projeto X", instructions: "Seja direto." }) });
    assert.equal(project.status, 201);

    const conversation = await api("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ projectId: project.body.id, title: "Nova conversa" }),
    });
    assert.equal(conversation.status, 201);
    assert.equal(conversation.body.projectId, project.body.id);

    const list = await api(`/api/conversations?projectId=${project.body.id}`);
    assert.equal(list.status, 200);
    assert.equal(list.body.conversations.length, 1);

    const fetched = await api(`/api/conversations/${conversation.body.id}`);
    assert.equal(fetched.status, 200);
    assert.deepEqual(fetched.body.messages, []);
  });
});

test("a missing conversation returns 404 instead of creating one implicitly", async () => {
  await withServer(async (api) => {
    const { status, body } = await api("/api/conversations/does-not-exist/messages", {
      method: "POST",
      body: JSON.stringify({ message: "oi" }),
    });
    assert.equal(status, 404);
    assert.match(body.error, /não encontrada/);
  });
});

test("a chat turn persists the user message even when Codex is unavailable", async () => {
  await withServer(async (api) => {
    const conversation = await api("/api/conversations", { method: "POST", body: JSON.stringify({}) });
    const turn = await api(`/api/conversations/${conversation.body.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "Olá, tudo bem?" }),
    });
    assert.equal(turn.status, 503);
    assert.equal(turn.body.ok, false);

    const fetched = await api(`/api/conversations/${conversation.body.id}`);
    assert.equal(fetched.body.messages.length, 2);
    assert.equal(fetched.body.messages[0].role, "user");
    assert.equal(fetched.body.messages[0].content, "Olá, tudo bem?");
    assert.equal(fetched.body.messages[1].role, "assistant");
    assert.equal(fetched.body.messages[1].provider, "Sistema");
  });
});

test("memories can be created manually, filtered by scope and deleted", async () => {
  await withServer(async (api) => {
    const created = await api("/api/memories", {
      method: "POST",
      body: JSON.stringify({ scope: "global", title: "Preferência", content: "Prefere respostas curtas." }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.kind, "manual");

    const list = await api("/api/memories?scope=global");
    assert.equal(list.status, 200);
    assert.ok(list.body.memories.some((m) => m.id === created.body.id));

    const removed = await api(`/api/memories/${created.body.id}`, { method: "DELETE" });
    assert.equal(removed.status, 200);

    const empty = await api(`/api/memories?scope=global&query=Preferência`);
    assert.ok(!empty.body.memories.some((m) => m.id === created.body.id));
  });
});

test("each conversation keeps its own memory, separate from other conversations", async () => {
  await withServer(async (api) => {
    const a = await api("/api/conversations", { method: "POST", body: JSON.stringify({}) });
    const b = await api("/api/conversations", { method: "POST", body: JSON.stringify({}) });

    await api("/api/memories", {
      method: "POST",
      body: JSON.stringify({ scope: "conversation", conversationId: a.body.id, title: "Segredo A", content: "Só pertence à conversa A." }),
    });

    const memoriesOfA = await api(`/api/memories?conversationId=${a.body.id}`);
    const memoriesOfB = await api(`/api/memories?conversationId=${b.body.id}`);
    assert.equal(memoriesOfA.body.memories.length, 1);
    assert.equal(memoriesOfB.body.memories.length, 0);
  });
});
