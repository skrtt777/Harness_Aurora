import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "harness-memgraph-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.EMBEDDINGS_ENABLED = "false";

const store = await import("../app/store.js");
const { memoryGraphSnapshot } = await import("../app/memoryGraph.js");
const { memoryEvents, recentMemoryEvents } = await import("../app/memoryEvents.js");

test("the snapshot is what is stored: memories, explicit relations, projects, conversations; archived ones out", async () => {
  const events = [];
  const listen = (e) => events.push(e);
  memoryEvents.on("event", listen);
  const project = await store.createProject({ name: "Vendas" });
  const conversation = await store.createConversation({ provider: "local", projectId: project.id, title: "Metas de outubro" });
  const general = await store.createMemory({ scope: "global", title: "A pessoa prefere respostas curtas", content: "Prefere respostas curtas e diretas.", tags: ["preferência"], env: { EMBEDDINGS_ENABLED: "false" } });
  const inProject = await store.createMemory({ scope: "project", projectId: project.id, title: "Meta de vendas do Sul", content: "A meta do Sul em outubro é 263 mil.", env: { EMBEDDINGS_ENABLED: "false" } });
  const inConversation = await store.createMemory({ scope: "conversation", conversationId: conversation.id, title: "Combinado: relatório na sexta", content: "Relatório de metas toda sexta.", env: { EMBEDDINGS_ENABLED: "false" } });
  const gone = await store.createMemory({ scope: "global", title: "Velha", content: "Uma memória arquivada.", env: { EMBEDDINGS_ENABLED: "false" } });
  await store.createRelation({ fromId: inConversation.id, toId: inProject.id, type: "derivation" });
  await store.setMemoryStatus(gone.id, "archived");
  memoryEvents.off("event", listen);

  const snap = await memoryGraphSnapshot();
  assert.deepEqual(snap.memories.map((m) => m.title).sort(), ["A pessoa prefere respostas curtas", "Combinado: relatório na sexta", "Meta de vendas do Sul"].sort());
  const p = snap.memories.find((m) => m.id === inProject.id);
  assert.deepEqual([p.scope, p.projectId, p.snippet], ["project", project.id, "A meta do Sul em outubro é 263 mil."]);
  assert.equal(snap.memories.find((m) => m.id === inConversation.id).conversationId, conversation.id);
  assert.deepEqual(snap.relations, [{ from: inConversation.id, to: inProject.id, type: "derivation" }]);
  assert.ok(snap.projects.some((x) => x.id === project.id && x.name === "Vendas"));
  assert.ok(snap.conversations.some((c) => c.id === conversation.id && c.projectId === project.id));
  assert.ok(!snap.memories.some((m) => m.id === gone.id), "an archived memory is not on the map");
  assert.ok(Array.isArray(snap.recalls));

  // Real events, emitted by the code that did each thing.
  assert.deepEqual(events.map((e) => e.type), ["created", "created", "created", "created", "archived"]);
  assert.equal(events[1].projectId, project.id);
  assert.ok(recentMemoryEvents({ limit: 3 })[0].type === "archived");
  assert.ok(general.id);
});

test("a chat turn emits its real steps in order: turn-start, scanned (with scores), recalled, answered, turn-end", async () => {
  const { handleChatTurn } = await import("../app/server.js");
  const project = await store.createProject({ name: "Metas" });
  const memory = await store.createMemory({ scope: "project", projectId: project.id, title: "Meta de vendas do Sul", content: "A meta de vendas do Sul em outubro é 263 mil reais.", tags: ["vendas", "meta"], env: { EMBEDDINGS_ENABLED: "false" } });
  const conversation = await store.createConversation({ provider: "local", projectId: project.id });
  const stub = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ message: { role: "assistant", content: "A meta de vendas do Sul é 263 mil." }, prompt_eval_count: 5, eval_count: 5 }));
  });
  await new Promise((r) => stub.listen(0, "127.0.0.1", r));
  const seen = [];
  const listen = (e) => { if (!e.conversationId || e.conversationId === conversation.id) seen.push(e); };
  memoryEvents.on("event", listen);
  try {
    const out = await handleChatTurn({ conversationId: conversation.id, message: "qual é a meta de vendas do Sul?", env: { ...process.env, LOCAL_BASE_URL: `http://127.0.0.1:${stub.address().port}`, LOCAL_MODEL: "qwen3.5:4b" } });
    assert.equal(out.ok, true, out.error);
  } finally { memoryEvents.off("event", listen); await new Promise((r) => stub.close(r)); }
  const types = seen.map((e) => e.type);
  for (const step of ["turn-start", "scanned", "answered", "turn-end"]) assert.ok(types.includes(step), `${step} in ${types.join(",")}`);
  assert.ok(types.indexOf("turn-start") < types.indexOf("scanned") && types.indexOf("scanned") < types.indexOf("answered") && types.indexOf("answered") < types.indexOf("turn-end"), types.join(","));
  const scanned = seen.find((e) => e.type === "scanned");
  assert.equal(scanned.candidates[0].id, memory.id);
  assert.ok(scanned.candidates[0].score > 0);
  assert.equal(seen.find((e) => e.type === "turn-start").message, "qual é a meta de vendas do Sul?");
  const answered = seen.find((e) => e.type === "answered");
  assert.ok(Array.isArray(answered.used) && Array.isArray(answered.created));
  if (types.includes("recalled")) assert.ok(types.indexOf("recalled") < types.indexOf("answered"));
});

test("/api/memories/live streams each real memory event as it happens", async () => {
  const { createServer } = await import("../app/server.js");
  const server = createServer({ centralSync: false, agentScheduler: false, warmLocal: false });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const port = server.address().port;
    const got = await new Promise((resolve, reject) => {
      const req = http.get({ host: "127.0.0.1", port, path: "/api/memories/live", headers: { "x-harness-token": server.apiToken } }, (res) => {
        let buffer = "";
        res.on("data", async (chunk) => {
          buffer += chunk;
          if (buffer.includes('"hello"') && !buffer.includes('"created"')) await store.createMemory({ scope: "global", title: "Ao vivo", content: "Criada durante a escuta.", env: { EMBEDDINGS_ENABLED: "false" } });
          if (buffer.includes('"created"')) { req.destroy(); resolve(buffer); }
        });
      });
      req.on("error", (e) => (/aborted|socket hang up/.test(e.message) ? null : reject(e)));
      setTimeout(() => reject(new Error("sem evento")), 5000);
    });
    assert.match(got, /"type":"created".*"title":"Ao vivo"/);
  } finally { await new Promise((r) => server.close(r)); }
});
