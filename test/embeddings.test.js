import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";

// Same isolation trick as test/server.test.js and test/ollamaSetup.test.js:
// a throwaway DB file, set before anything pulls in app/db.js.
process.env.HARNESS_DB_FILE = join(mkdtempSync(join(tmpdir(), "harness-embeddings-test-")), "test.db");

const { cosineSimilarity, decodeEmbedding, embedText, encodeEmbedding, resolveEmbeddingModel, DEFAULT_EMBEDDING_MODEL } =
  await import("../app/embeddings.js");
const { createMemory, selectRelevantMemories } = await import("../app/store.js");

// A minimal stand-in for Ollama, same shape as test/ollamaSetup.test.js's
// stub, extended with /api/embeddings. Deterministic by design: instead of
// simulating real semantic understanding, the prompt carries an explicit
// "##vec:1,0,0##" marker and the stub just echoes that vector back — this
// lets tests assert exact ranking behavior without depending on whatever a
// real embedding model would actually produce for arbitrary text.
function startEmbeddingStub({ tags = [], embeddingsEnabled = true } = {}) {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/api/version") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ version: "0.1.0-stub" }));
    }
    if (req.method === "GET" && req.url === "/api/tags") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ models: tags.map((name) => ({ name })) }));
    }
    if (req.method === "POST" && req.url === "/api/pull") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const { model } = JSON.parse(body || "{}");
        res.writeHead(200, { "content-type": "application/x-ndjson" });
        res.write(`${JSON.stringify({ status: "success" })}\n`);
        res.end();
        tags.push(model);
      });
      return;
    }
    if (req.method === "POST" && req.url === "/api/embeddings") {
      if (!embeddingsEnabled) {
        res.writeHead(500);
        return res.end("embeddings disabled for this stub");
      }
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const { prompt } = JSON.parse(body || "{}");
        const match = /##vec:([-\d.,]+)##/.exec(prompt || "");
        const embedding = match ? match[1].split(",").map(Number) : [0, 0, 0];
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ embedding }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function withStub(options, run) {
  const stub = await startEmbeddingStub(options);
  const baseUrl = `http://127.0.0.1:${stub.address().port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve) => stub.close(resolve));
  }
}

test("resolveEmbeddingModel falls back to the built-in default, env overrides it", () => {
  assert.equal(resolveEmbeddingModel({}), DEFAULT_EMBEDDING_MODEL);
  assert.equal(resolveEmbeddingModel({ EMBEDDING_MODEL: "custom-embed" }), "custom-embed");
});

test("cosineSimilarity: identical vectors score 1, orthogonal vectors score 0, opposite vectors score -1", () => {
  assert.equal(cosineSimilarity([1, 0, 0], [1, 0, 0]), 1);
  assert.equal(cosineSimilarity([1, 0, 0], [0, 1, 0]), 0);
  assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
});

test("cosineSimilarity returns 0 (not a throw) for empty, mismatched-length, or all-zero input", () => {
  assert.equal(cosineSimilarity([], []), 0);
  assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), 0);
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
  assert.equal(cosineSimilarity(null, [1]), 0);
});

test("encodeEmbedding/decodeEmbedding round-trips a vector through the BLOB representation used in SQLite", () => {
  const vector = [0.5, -0.25, 1.75, 0];
  const decoded = decodeEmbedding(encodeEmbedding(vector));
  assert.equal(decoded.length, vector.length);
  for (let i = 0; i < vector.length; i += 1) assert.ok(Math.abs(decoded[i] - vector[i]) < 1e-6);
});

test("decodeEmbedding returns null for empty/missing input instead of throwing", () => {
  assert.equal(decodeEmbedding(null), null);
  assert.equal(decodeEmbedding(Buffer.alloc(0)), null);
});

test("embedText returns null when nothing is listening, without throwing", async () => {
  assert.equal(await embedText("qualquer coisa", { LOCAL_BASE_URL: "http://127.0.0.1:1" }), null);
});

test("embedText returns null and kicks off a background pull when the embedding model isn't pulled yet", async () => {
  await withStub({ tags: [] }, async (baseUrl) => {
    const result = await embedText("texto de teste", { LOCAL_BASE_URL: baseUrl });
    assert.equal(result, null);
    // The pull was fired in the background (not awaited by embedText) —
    // give it a tick to land against the in-process stub.
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(true); // no throw/hang is the real assertion here
  });
});

test("embedText returns the vector from /api/embeddings once the model is already pulled", async () => {
  await withStub({ tags: [DEFAULT_EMBEDDING_MODEL] }, async (baseUrl) => {
    const result = await embedText("pergunta sobre ##vec:1,2,3##", { LOCAL_BASE_URL: baseUrl });
    assert.deepEqual(result, [1, 2, 3]);
  });
});

test("embedText returns null for blank input without making a request", async () => {
  assert.equal(await embedText("   ", { LOCAL_BASE_URL: "http://127.0.0.1:1" }), null);
});

test("selectRelevantMemories falls back to keyword-only ranking when no embedding is available (no regression)", async () => {
  const conversationId = "conv-no-embeddings";
  await createMemory({
    scope: "global",
    title: "Fato sobre gatos",
    content: "Gatos são independentes e dormem bastante.",
    env: { LOCAL_BASE_URL: "http://127.0.0.1:1" },
  });
  const results = await selectRelevantMemories("me fale sobre gatos", {}, 12, { LOCAL_BASE_URL: "http://127.0.0.1:1" });
  assert.ok(results.some((m) => m.title === "Fato sobre gatos"));
});

test("selectRelevantMemories ranks a semantically similar memory (no shared words) above a merely word-matching one (unrelated topic)", async () => {
  await withStub({ tags: [DEFAULT_EMBEDDING_MODEL] }, async (baseUrl) => {
    const env = { LOCAL_BASE_URL: baseUrl };
    // Two clearly distinct "topic" vectors (no shared digit tokens between
    // them, so the marker itself can't accidentally inflate either side's
    // keyword-overlap score against the other).
    const transportTopic = "701,204,809";
    const toyTopic = "355,912,048";

    // Same topic vector as the query below, but shares no real words with
    // it ("bicicleta" vs "carro") — this is exactly the synonym/
    // reformulation gap ROADMAP_MELHORIAS.md's Marco 3 targets.
    const semanticMatch = await createMemory({
      scope: "global",
      title: `Preferência de transporte ##vec:${transportTopic}##`,
      content: "A pessoa prefere se deslocar de bicicleta no dia a dia.",
      env,
    });

    // Shares the literal word "carro" with the query, but its embedding
    // points at an unrelated topic (low cosine similarity to the query).
    const keywordOnlyMatch = await createMemory({
      scope: "global",
      title: `Nota sobre carro de brinquedo ##vec:${toyTopic}##`,
      content: "O carro de brinquedo favorito é vermelho.",
      env,
    });

    const results = await selectRelevantMemories(
      `Qual carro a pessoa usa pra se locomover no dia a dia? ##vec:${transportTopic}##`,
      {},
      12,
      env,
    );
    const ids = results.map((m) => m.id);
    assert.ok(ids.includes(semanticMatch.id), "semantically similar memory should be retrieved at all");
    const semanticRank = ids.indexOf(semanticMatch.id);
    const keywordRank = ids.indexOf(keywordOnlyMatch.id);
    assert.ok(
      semanticRank < keywordRank || keywordRank === -1,
      "the semantically similar memory should outrank the merely word-matching one",
    );
  });
});
