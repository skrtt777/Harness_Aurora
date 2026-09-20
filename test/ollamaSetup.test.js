import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";

// Same isolation trick as test/server.test.js: a throwaway DB file, set
// before anything pulls in app/db.js, so setSetting/getSetting ("qual
// modelo o usuário escolheu") don't touch a real user's database.
process.env.HARNESS_DB_FILE = join(mkdtempSync(join(tmpdir(), "harness-ollama-test-")), "test.db");

const {
  DEFAULT_LOCAL_MODEL,
  CURATED_MODELS,
  resolveLocalModel,
  setLocalModel,
  isServerUp,
  isModelPulled,
  pullModel,
  getLocalStatus,
  runOllamaSetup,
} = await import("../app/ollamaSetup.js");
const { createServer } = await import("../app/server.js");

// A minimal stand-in for Ollama's HTTP API: /api/version to answer "am I
// up", /api/tags to answer "which models are pulled", /api/pull to stream
// NDJSON progress like the real thing does. Lets the setup/status logic be
// exercised without a real Ollama install or network access to ollama.com,
// neither of which this sandbox has.
function startOllamaStub({ tags = [] } = {}) {
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
        res.write(`${JSON.stringify({ status: "pulling manifest" })}\n`);
        res.write(`${JSON.stringify({ status: "downloading", digest: "sha256:abc", total: 100, completed: 50 })}\n`);
        res.write(`${JSON.stringify({ status: "downloading", digest: "sha256:abc", total: 100, completed: 100 })}\n`);
        res.write(`${JSON.stringify({ status: "success" })}\n`);
        res.end();
        tags.push(model);
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function withStub(options, run) {
  const stub = await startOllamaStub(options);
  const baseUrl = `http://127.0.0.1:${stub.address().port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve) => stub.close(resolve));
  }
}

test("resolveLocalModel falls back default -> saved setting -> env override, in that priority", async () => {
  assert.equal(await resolveLocalModel({}), DEFAULT_LOCAL_MODEL);

  await setLocalModel("llama3.2:3b");
  assert.equal(await resolveLocalModel({}), "llama3.2:3b");

  // An explicit LOCAL_MODEL env var (dev/packaging override) still wins over
  // whatever the user picked in the UI.
  assert.equal(await resolveLocalModel({ LOCAL_MODEL: "custom:tag" }), "custom:tag");

  await setLocalModel(DEFAULT_LOCAL_MODEL);
});

test("setLocalModel rejects an empty model name", async () => {
  await assert.rejects(() => setLocalModel("   "));
});

test("CURATED_MODELS is a non-empty, UI-ready list", () => {
  assert.ok(CURATED_MODELS.length >= 3);
  for (const entry of CURATED_MODELS) {
    assert.ok(entry.id && entry.label && entry.size);
  }
});

test("isServerUp is false when nothing is listening", async () => {
  assert.equal(await isServerUp("http://127.0.0.1:1"), false);
});

test("isServerUp is true against a running stub", async () => {
  await withStub({}, async (baseUrl) => {
    assert.equal(await isServerUp(baseUrl), true);
  });
});

test("isModelPulled matches exact tags and bare-name/:latest equivalence", async () => {
  await withStub({ tags: ["qwen2.5-coder:1.5b", "llama3.2:latest"] }, async (baseUrl) => {
    assert.equal(await isModelPulled(baseUrl, "qwen2.5-coder:1.5b"), true);
    assert.equal(await isModelPulled(baseUrl, "llama3.2"), true);
    assert.equal(await isModelPulled(baseUrl, "llama3.2:latest"), true);
    assert.equal(await isModelPulled(baseUrl, "mistral:7b"), false);
  });
});

test("pullModel streams NDJSON progress and resolves ok on a final success event", async () => {
  await withStub({}, async (baseUrl) => {
    const events = [];
    const result = await pullModel(baseUrl, "qwen2.5-coder:1.5b", (event) => events.push(event));
    assert.equal(result.ok, true);
    assert.ok(events.some((e) => e.status === "downloading" && e.completed === 50));
    assert.ok(events.some((e) => e.status === "success"));
  });
});

test("getLocalStatus reports everything false/not-ready when Ollama isn't installed or running", async () => {
  // On win32, isOllamaInstalled() also falls back to checking Ollama's
  // default per-user install path under LOCALAPPDATA, independent of
  // OLLAMA_BIN — on a machine where Ollama is genuinely installed there,
  // faking "not installed" requires overriding both, not just OLLAMA_BIN.
  const fakeLocalAppData = mkdtempSync(join(tmpdir(), "harness-no-ollama-"));
  const status = await getLocalStatus({
    LOCAL_BASE_URL: "http://127.0.0.1:1",
    OLLAMA_BIN: "ollama-binary-not-installed-in-tests",
    LOCALAPPDATA: fakeLocalAppData,
  });
  assert.equal(status.running, false);
  assert.equal(status.installed, false);
  assert.equal(status.modelReady, false);
  assert.equal(status.ready, false);
});

test("getLocalStatus reports ready once the server is up and the model is pulled", async () => {
  await withStub({ tags: [DEFAULT_LOCAL_MODEL] }, async (baseUrl) => {
    const status = await getLocalStatus({ LOCAL_BASE_URL: baseUrl });
    assert.equal(status.running, true);
    assert.equal(status.modelReady, true);
    assert.equal(status.ready, true);
    assert.equal(status.model, DEFAULT_LOCAL_MODEL);
  });
});

test("runOllamaSetup skips install/start and goes straight to ready when server+model are already there", async () => {
  await withStub({ tags: [DEFAULT_LOCAL_MODEL] }, async (baseUrl) => {
    const stages = [];
    const result = await runOllamaSetup({ LOCAL_BASE_URL: baseUrl }, (event) => stages.push(event.stage));
    assert.equal(result.ok, true);
    assert.deepEqual(stages, ["checking", "server-ready", "ready"]);
  });
});

test("runOllamaSetup pulls the model when the server is up but the model is missing, without reinstalling", async () => {
  await withStub({ tags: [] }, async (baseUrl) => {
    const stages = [];
    const result = await runOllamaSetup({ LOCAL_BASE_URL: baseUrl }, (event) => stages.push(event.stage));
    assert.equal(result.ok, true);
    assert.deepEqual(stages, ["checking", "server-ready", "pulling", "pulling", "pulling", "pulling", "pulling", "ready"]);
  });
});

async function withServer(run) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const api = (path, options) =>
    fetch(`${base}${path}`, { headers: { "content-type": "application/json", "x-harness-token": server.apiToken }, ...options }).then(async (response) => ({
      status: response.status,
      body: await response.json(),
    }));
  try {
    await run(base, api);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test("GET /api/local/status and /api/local/models expose the setup state and curated model list over HTTP", async () => {
  await withServer(async (_base, api) => {
    const status = await api("/api/local/status");
    assert.equal(status.status, 200);
    assert.ok("ready" in status.body);

    const models = await api("/api/local/models");
    assert.equal(models.status, 200);
    assert.ok(models.body.models.length >= 3);
  });
});

test("PUT /api/local/model updates the stored choice, and rejects an empty model", async () => {
  await withServer(async (_base, api) => {
    const ok = await api("/api/local/model", { method: "PUT", body: JSON.stringify({ model: "llama3.1:8b" }) });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.model, "llama3.1:8b");
    assert.equal(await resolveLocalModel({}), "llama3.1:8b");

    const bad = await api("/api/local/model", { method: "PUT", body: JSON.stringify({ model: "" }) });
    assert.equal(bad.status, 400);

    await setLocalModel(DEFAULT_LOCAL_MODEL);
  });
});

test("POST /api/local/setup streams SSE progress ending in a final stage", async () => {
  await withStub({ tags: [DEFAULT_LOCAL_MODEL] }, async (baseUrl) => {
    const previous = process.env.LOCAL_BASE_URL;
    process.env.LOCAL_BASE_URL = baseUrl;
    try {
      await withServer(async (base) => {
        const response = await fetch(`${base}/api/local/setup`, { method: "POST", headers: { "content-type": "application/json", "x-harness-token": (await (await fetch(`${base}/api/session`)).json()).token }, body: "{}" });
        assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
        const text = await response.text();
        const lines = text
          .split("\n\n")
          .map((chunk) => chunk.replace(/^data: /, "").trim())
          .filter(Boolean)
          .map((chunk) => JSON.parse(chunk));
        assert.ok(lines.some((e) => e.stage === "ready"));
        assert.ok(lines.some((e) => e.stage === "done"));
      });
    } finally {
      process.env.LOCAL_BASE_URL = previous;
    }
  });
});
