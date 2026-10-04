import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "harness-atlas-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.EMBEDDINGS_ENABLED = "false";
process.env.LOCAL_BASE_URL = "http://127.0.0.1:1";

const store = await import("../app/store.js");
const { getDb } = await import("../app/db.js");
const { encodeEmbedding, resolveEmbeddingModel } = await import("../app/embeddings.js");
const { memoryAtlas } = await import("../app/memoryAtlas.js");

// Two topics in a 16-dim space: browser memories point one way, game memories another.
const vector = (topic, jitter) => Array.from({ length: 16 }, (_, i) => (topic === "web" ? (i < 8 ? 1 : 0) : (i >= 8 ? 1 : 0)) + Math.sin(i * 7 + jitter) * 0.08);

async function seed() {
  const db = await getDb();
  const make = async (title, topic, jitter, extra = {}) => {
    const m = await store.createMemory({ scope: "global", title, content: `${title}.`, tags: [topic === "web" ? "navegador" : "jogos"], kind: "manual", env: { EMBEDDINGS_ENABLED: "false" } });
    db.prepare("UPDATE memories SET embedding = ?, embedding_model = ?, uses = ?, helped = ?, failed = ? WHERE id = ?")
      .run(encodeEmbedding(vector(topic, jitter)), resolveEmbeddingModel(process.env), extra.uses || 0, extra.helped || 0, extra.failed || 0, m.id);
    return m;
  };
  const web = [];
  for (let i = 0; i < 6; i += 1) web.push(await make(`Abrir site no navegador ${i}`, "web", i));
  const games = [];
  for (let i = 0; i < 6; i += 1) games.push(await make(`Loop de jogo canvas ${i}`, "game", i + 20, i === 0 ? { uses: 9, helped: 6, failed: 1 } : {}));
  const twin = await make("Abrir site no navegador 0 (cópia)", "web", 0);
  const gone = await make("Arquivada", "web", 3);
  db.prepare("UPDATE memories SET status = 'archived' WHERE id = ?").run(gone.id);
  return { web, games, twin, gone };
}

test("memories are placed by meaning: same topic close, other topic far; duplicates and usage come along", async () => {
  const { web, games, twin, gone } = await seed();
  const atlas = await memoryAtlas();
  const byId = new Map(atlas.memories.map((m) => [m.id, m]));
  assert.equal(byId.has(gone.id), false, "archived memories stay off the map");
  const dist = (a, b) => Math.hypot(...[0, 1, 2].map((i) => byId.get(a.id).position[i] - byId.get(b.id).position[i]));
  const within = dist(web[0], web[1]) + dist(games[0], games[1]);
  const across = dist(web[0], games[0]) + dist(web[1], games[1]);
  assert.ok(across > within * 2, `topics apart: within ${within.toFixed(1)}, across ${across.toFixed(1)}`);
  assert.notEqual(byId.get(web[0].id).cluster, byId.get(games[0].id).cluster, "different topics, different clusters");
  assert.ok(byId.get(web[0].id).neighbors.every((n) => byId.get(n.id).cluster === byId.get(web[0].id).cluster));
  assert.ok(byId.get(web[0].id).duplicates.includes(twin.id), "a near-identical memory is flagged");
  assert.deepEqual(byId.get(games[0].id).stats, { uses: 9, helped: 6, failed: 1 });
  assert.ok(atlas.clusters.some((c) => /navegador|site/.test(c.label)), JSON.stringify(atlas.clusters));
  assert.ok(atlas.clusters.some((c) => /jogo|loop|canvas/.test(c.label)), JSON.stringify(atlas.clusters));
  assert.strictEqual(await memoryAtlas(), atlas, "cached until a memory changes");
});

test("HTTP: the atlas route and archiving a memory from it", async () => {
  const { createServer } = await import("../app/server.js");
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const api = (path, options = {}) => fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { headers: { "content-type": "application/json", "x-harness-token": server.apiToken }, ...options }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    const atlas = await api("/memories/atlas");
    assert.equal(atlas.status, 200);
    const target = atlas.body.memories[0].id;
    assert.equal((await api(`/memories/${target}`, { method: "PATCH", body: JSON.stringify({ status: "nada" }) })).status, 400);
    const archived = await api(`/memories/${target}`, { method: "PATCH", body: JSON.stringify({ status: "archived" }) });
    assert.equal(archived.body.status, "archived");
    assert.equal((await api("/memories/atlas")).body.memories.some((m) => m.id === target), false, "archived leaves the map");
    assert.equal((await api(`/memories/${target}`, { method: "PATCH", body: JSON.stringify({ status: "active" }) })).body.status, "active");
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("recall probe shows what the chat would remember, without counting it as use; recent recalls list what answers used", async () => {
  const { createServer } = await import("../app/server.js");
  const db = await getDb();
  const created = await store.createMemory({ scope: "global", title: "Pausar a partida com a tecla P", content: "Ao pressionar P, congele a simulação e mostre o menu de pausa.", tags: ["pausa"], kind: "manual", env: { EMBEDDINGS_ENABLED: "false" } });
  const loop = db.prepare("SELECT id, uses FROM memories WHERE id = ?").get(created.id);
  const conversation = await store.createConversation({ title: "Jogo de teste" });
  await store.addMessage({ conversationId: conversation.id, role: "user", content: "como fazer o loop do jogo?" });
  await store.addMessage({ conversationId: conversation.id, role: "assistant", content: "Use requestAnimationFrame.", memoryAccess: [loop.id] });
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const api = (path, options = {}) => fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { headers: { "content-type": "application/json", "x-harness-token": server.apiToken }, ...options }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    const probe = await api("/memories/recall", { method: "POST", body: JSON.stringify({ query: "como pausar a partida?" }) });
    assert.equal(probe.status, 200);
    assert.ok(probe.body.selected.length > 0, "something would be remembered");
    assert.equal(probe.body.selected[0].id, loop.id, "the on-topic memory comes first");
    assert.ok(probe.body.selected.every((s, i) => s.rank === i + 1), "ranked");
    assert.ok(probe.body.selected[0].score > 0, "says how strongly");
    assert.equal(db.prepare("SELECT uses FROM memories WHERE id = ?").get(loop.id).uses, loop.uses, "a probe is not a use");
    assert.deepEqual((await api("/memories/recall", { method: "POST", body: JSON.stringify({ query: "  " }) })).body.selected, []);

    const recent = await api("/memories/recent-recalls");
    const entry = recent.body.recalls.find((r) => r.conversationId === conversation.id);
    assert.ok(entry, "the answer is listed");
    assert.deepEqual(entry.used, [loop.id]);
    assert.equal(entry.prompt, "como fazer o loop do jogo?");
    assert.equal(entry.conversationTitle, "Jogo de teste");
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
