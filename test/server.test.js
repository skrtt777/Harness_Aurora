import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";

// A dedicated, throwaway SQLite file per test run keeps this suite isolated
// from whatever conversations/memories a real local user has accumulated.
// This must run before app/db.js is imported anywhere in the chain, so the
// server (and everything it pulls in) is loaded with a dynamic import below
// instead of a static one, which Node would hoist above this assignment.
process.env.HARNESS_DB_FILE = join(mkdtempSync(join(tmpdir(), "harness-test-")), "test.db");
process.env.CODEX_BIN = "codex-binary-not-installed-in-tests";
process.env.CLAUDE_BIN = "claude-binary-not-installed-in-tests";
// Port 1 is a privileged/unassigned port nothing will ever be listening on,
// so runLocal fails fast with a connection error instead of the test
// accidentally hitting a real Ollama server that happens to be running on
// the developer's machine.
process.env.LOCAL_BASE_URL = "http://127.0.0.1:1";

const { createServer, buildPrompt } = await import("../app/server.js");
const { buildProviderConfig, parseCodexOutput, extractCodexError } = await import("../app/codex.js");
const { parseClaudeOutput } = await import("../app/claude.js");
const { parseMemoryCandidates, buildExtractionPrompt } = await import("../app/memoryExtractor.js");
const { buildCorrectionPrompt, parseCorrectionResponse } = await import("../app/correction.js");
const { checkJsModuleSyntax, findConstReassignments, refineLocalAnswer } = await import("../app/localRefine.js");
const { runCodeInSandbox } = await import("../app/jsSandbox.js");
const { createRelation, createConversation, addMessage, getSavingsStats, setSetting } = await import("../app/store.js");
const { fetchCommunityManifest, fetchCommunityBundle, resolveCommunityManifestUrl, DEFAULT_MANIFEST_URL } = await import(
  "../app/community.js"
);

async function withServer(run) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const api = (path, options) =>
    fetch(`${base}${path}`, {
      headers: { "content-type": "application/json", "x-harness-token": server.apiToken },
      ...options,
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
  try {
    await run(api, base);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test("provider config uses the authenticated Codex CLI", () => {
  const config = buildProviderConfig({});
  assert.equal(config.id, "codex");
  assert.equal(config.mode, "cli");
  assert.equal(typeof config.configured, "boolean");
  assert.equal(config.authentication, "unverified");
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

test("extractCodexError surfaces a usage-limit error from the JSON stream instead of raw stderr noise", () => {
  const stdout = [
    JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
    JSON.stringify({ type: "turn.started" }),
    JSON.stringify({ type: "error", message: "You've hit your usage limit. Try again later." }),
    JSON.stringify({
      type: "turn.failed",
      error: { message: "You've hit your usage limit. Try again later." },
    }),
  ].join("\n");
  assert.equal(extractCodexError(stdout), "You've hit your usage limit. Try again later.");
});

test("extractCodexError returns null when the stream has no error event", () => {
  const stdout = JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "ok" } });
  assert.equal(extractCodexError(stdout), null);
});

test("parser extracts the result from a Claude Code CLI JSON response", () => {
  const output = JSON.stringify({
    result: "Resposta final",
    session_id: "session-1",
    usage: { input_tokens: 10, output_tokens: 4 },
    is_error: false,
  });
  assert.deepEqual(parseClaudeOutput(output), {
    text: "Resposta final",
    threadId: "session-1",
    usage: { input_tokens: 10, output_tokens: 4 },
  });
});

test("parser tolerates malformed Claude output instead of throwing", () => {
  assert.deepEqual(parseClaudeOutput("não é json"), { text: "", threadId: null, usage: null });
});

test("prompt builder includes project instructions and relevant memories, and caps size", () => {
  const prompt = buildPrompt({
    input: "a".repeat(5000),
    memories: [{ title: "Preferência", content: "Respostas curtas" }],
    instructions: "Responda sempre em português.",
    limit: 2000,
  });
  assert.equal(prompt.length, 2000);
  assert.match(prompt, /^Tarefa atual:/); // Current task has priority when it alone exceeds the budget.
});

test("prompt builder works with no memories and no instructions", () => {
  const prompt = buildPrompt({ input: "olá" });
  assert.equal(prompt, "Tarefa atual:\nolá");
});

test("prompt builder renders template memories as code to adapt, separate from plain facts", () => {
  const prompt = buildPrompt({
    input: "crie um jogo",
    memories: [
      { title: "Preferência", content: "Respostas curtas", tags: ["geral"] },
      { title: "Template: jogo base", content: "const scene = new THREE.Scene();", tags: ["threejs", "template"] },
    ],
  });
  assert.match(prompt, /Memórias relevantes/);
  assert.match(prompt, /Preferência: Respostas curtas/);
  assert.match(prompt, /Esqueleto\(s\) de código para adaptar/);
  assert.match(prompt, /const scene = new THREE\.Scene\(\);/);
  // The template's own content must not leak into the plain-facts section.
  const factsSection = prompt.split("Esqueleto(s) de código")[0];
  assert.doesNotMatch(factsSection, /const scene = new THREE\.Scene\(\);/);
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

test("extraction prompt lists candidate memories for relatesTo", () => {
  const prompt = buildExtractionPrompt("oi", "olá", [{ id: "mem-1", title: "Projeto X" }]);
  assert.match(prompt, /mem-1: Projeto X/);
});

test("relatesTo only accepts a known id and a valid relation type", () => {
  const raw = JSON.stringify([
    { title: "A", content: "conteúdo A", relatesTo: [{ id: "mem-1", type: "thematic" }] },
    { title: "B", content: "conteúdo B", relatesTo: [{ id: "id-inventado", type: "thematic" }] },
    { title: "C", content: "conteúdo C", relatesTo: [{ id: "mem-1", type: "tipo-invalido" }] },
  ]);
  const [a, b, c] = parseMemoryCandidates(raw, ["mem-1"]);
  assert.deepEqual(a.relatesTo, [{ id: "mem-1", type: "thematic" }]);
  assert.deepEqual(b.relatesTo, []);
  assert.deepEqual(c.relatesTo, []);
});

test("correction prompt embeds the question, the wrong answer and the user's note", () => {
  const prompt = buildCorrectionPrompt("Como somo dois números em Python?", "print(1, 2)", "isso só imprime, não soma");
  assert.match(prompt, /Como somo dois números em Python\?/);
  assert.match(prompt, /print\(1, 2\)/);
  assert.match(prompt, /isso só imprime, não soma/);
});

test("correction response parser extracts the answer and teaching memories", () => {
  const raw = JSON.stringify({
    answer: "Use return a + b dentro da função.",
    memories: [{ title: "Soma em Python", content: "Uma função só retorna algo com 'return'.", tags: ["python"] }],
    template: null,
  });
  const parsed = parseCorrectionResponse(raw);
  assert.equal(parsed.answer, "Use return a + b dentro da função.");
  assert.equal(parsed.memories.length, 1);
  assert.equal(parsed.memories[0].title, "Soma em Python");
  assert.equal(parsed.template, null);
});

test("correction response parser extracts an optional reusable template", () => {
  const raw = JSON.stringify({
    answer: "Aqui está o jogo corrigido.",
    memories: [],
    template: { title: "Esqueleto Three.js", content: "const scene = new THREE.Scene();", tags: ["threejs"] },
  });
  const parsed = parseCorrectionResponse(raw);
  assert.equal(parsed.template.title, "Esqueleto Three.js");
  assert.equal(parsed.template.content, "const scene = new THREE.Scene();");
  assert.deepEqual(parsed.template.tags, ["threejs"]);
});

test("correction response parser tolerates malformed output instead of throwing", () => {
  assert.deepEqual(parseCorrectionResponse("não é json"), { answer: "", memories: [], template: null });
});

test("checkJsModuleSyntax flags a real syntax error in the generated code", async () => {
  const html = "```html\n<script type=\"module\">\nconst x = (1, 2;\n</script>\n```";
  const result = await checkJsModuleSyntax(html);
  assert.equal(result.checked, true);
  assert.equal(result.valid, false);
  assert.ok(result.error.length > 0);
});

test("checkJsModuleSyntax passes valid code and skips answers with no script block", async () => {
  const validHtml = "```html\n<script type=\"module\">\nconst x = 1 + 2;\nconsole.log(x);\n</script>\n```";
  assert.deepEqual(await checkJsModuleSyntax(validHtml), { checked: true, valid: true, error: null });
  assert.deepEqual(await checkJsModuleSyntax("Só uma resposta de texto, sem código."), {
    checked: false,
    valid: true,
    error: null,
  });
});

test("findConstReassignments catches the exact pattern seen in real local-model output (const score = 0; ...; score++)", () => {
  const js = "const score = 0;\nfunction animate() {\n  score++;\n}\n";
  assert.deepEqual(findConstReassignments(js), ["score"]);
});

test("findConstReassignments ignores const variables that are never reassigned", () => {
  const js = "const speed = 5;\nconst scene = new THREE.Scene();\nmesh.position.x += speed;\n";
  assert.deepEqual(findConstReassignments(js), []);
});

test("runCodeInSandbox catches a real use-before-declaration bug that node --check cannot see (the exact 'cube' bug found in testing)", () => {
  const js = [
    "const cubes = [];",
    "function animate() {",
    "  cube.position.y -= 0.05;", // `cube` (singular) was never declared anywhere
    "}",
    "animate();",
  ].join("\n");
  const result = runCodeInSandbox(js);
  assert.equal(result.checked, true);
  assert.equal(result.crashed, true);
  assert.match(result.error, /ReferenceError/);
});

test("runCodeInSandbox catches const reassignment and TDZ without executing generated code", () => {
  const constBug = runCodeInSandbox("const score = 0;\nfunction animate() { score++; }\nanimate();");
  assert.equal(constBug.crashed, true);

  const tdzBug = runCodeInSandbox("function animate() { return keys['w']; }\nanimate();\nconst keys = {};");
  assert.equal(tdzBug.crashed, true);
});

test("runCodeInSandbox catches THREE.OrbitControls used without importing the addon (the most repeated bug seen in testing)", () => {
  const js = "const camera = new THREE.PerspectiveCamera();\nconst controls = new THREE.OrbitControls(camera, {});\n";
  const sourceWithoutImport = `<script type="module">\nimport * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';\n${js}\n</script>`;
  const result = runCodeInSandbox(js, sourceWithoutImport);
  assert.equal(result.crashed, true);
  assert.match(result.error, /OrbitControls/);
});

test("static review respects actual named import bindings for Three.js addons", () => {
  const js = "import { OrbitControls } from 'https://example.test/OrbitControls.js'; const controls = new OrbitControls({}, {});";
  assert.equal(runCodeInSandbox(js).crashed, false);
});

test("runCodeInSandbox does not false-positive on a realistic, correct Three.js game using many APIs", () => {
  const js = [
    "const scene = new THREE.Scene();",
    "const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);",
    "camera.position.set(0, 5, 10);",
    "camera.lookAt(0, 0, 0);",
    "const renderer = new THREE.WebGLRenderer();",
    "renderer.setSize(window.innerWidth, window.innerHeight);",
    "document.body.appendChild(renderer.domElement);",
    "scene.add(new THREE.AmbientLight(0xffffff, 0.5));",
    "const light = new THREE.DirectionalLight(0xffffff, 1);",
    "light.position.set(1, 1, 1);",
    "scene.add(light);",
    "const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x0000ff }));",
    "scene.add(cube);",
    "const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 16), new THREE.MeshStandardMaterial({ color: 0xffff00 }));",
    "scene.add(sphere);",
    "let score = 0;",
    "const scoreEl = document.getElementById('score');",
    "const keys = {};",
    "window.addEventListener('keydown', (e) => { keys[e.key] = true; });",
    "window.addEventListener('keyup', (e) => { keys[e.key] = false; });",
    "const clock = new THREE.Clock();",
    "function animate() {",
    "  requestAnimationFrame(animate);",
    "  const delta = clock.getDelta();",
    "  if (keys.w) cube.position.z -= delta;",
    "  if (cube.position.distanceTo(sphere.position) < 1) { score += 10; scoreEl.textContent = String(score); }",
    "  renderer.render(scene, camera);",
    "}",
    "animate();",
    "window.addEventListener('resize', () => {",
    "  camera.aspect = window.innerWidth / window.innerHeight;",
    "  camera.updateProjectionMatrix();",
    "  renderer.setSize(window.innerWidth, window.innerHeight);",
    "});",
  ].join("\n");
  const result = runCodeInSandbox(js);
  assert.deepEqual(result, { checked: true, crashed: false, error: null });
});

test("refineLocalAnswer retries once on a syntax error and keeps the corrected version", async () => {
  const stub = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const { prompt } = JSON.parse(body);
      const isRetry = prompt.includes("Erro de sintaxe");
      const answer = isRetry
        ? "```html\n<script type=\"module\">\nconst x = 1 + 2;\n</script>\n```"
        : "não deveria chegar aqui";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ response: answer }));
    });
  });
  await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
  try {
    const broken = { ok: true, status: 200, text: "```html\n<script type=\"module\">\nconst x = (1, 2;\n</script>\n```" };
    const refined = await refineLocalAnswer({
      task: "crie um jogo",
      result: broken,
      memories: [],
      env: { LOCAL_BASE_URL: `http://127.0.0.1:${stub.address().port}` },
    });
    assert.match(refined.text, /const x = 1 \+ 2;/);
  } finally {
    await new Promise((resolve) => stub.close(resolve));
  }
});

test("refineLocalAnswer retries once when the code reassigns a const variable (syntax-valid but crashes at runtime)", async () => {
  const stub = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const { prompt } = JSON.parse(body);
      const isRetry = prompt.includes("Assignment to constant variable");
      const answer = isRetry
        ? "```html\n<script type=\"module\">\nlet score = 0;\nscore++;\n</script>\n```"
        : "não deveria chegar aqui";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ response: answer }));
    });
  });
  await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
  try {
    const broken = {
      ok: true,
      status: 200,
      text: "```html\n<script type=\"module\">\nconst score = 0;\nscore++;\n</script>\n```",
    };
    const refined = await refineLocalAnswer({
      task: "crie um jogo",
      result: broken,
      memories: [],
      env: { LOCAL_BASE_URL: `http://127.0.0.1:${stub.address().port}` },
    });
    assert.match(refined.text, /let score = 0;/);
  } finally {
    await new Promise((resolve) => stub.close(resolve));
  }
});

test("refineLocalAnswer retries once when the sandbox catches a use-before-declaration crash (syntax and const checks both miss it)", async () => {
  const stub = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const { prompt } = JSON.parse(body);
      const isRetry = prompt.includes("análise estática");
      const answer = isRetry
        ? "```html\n<script type=\"module\">\nconst cube = {};\nfunction animate() { cube.x = 1; }\nanimate();\n</script>\n```"
        : "não deveria chegar aqui";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ response: answer }));
    });
  });
  await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
  try {
    const broken = {
      ok: true,
      status: 200,
      text: "```html\n<script type=\"module\">\nfunction animate() { cube.x = 1; }\nanimate();\n</script>\n```",
    };
    const refined = await refineLocalAnswer({
      task: "crie um jogo",
      result: broken,
      memories: [],
      env: { LOCAL_BASE_URL: `http://127.0.0.1:${stub.address().port}` },
    });
    assert.match(refined.text, /const cube = \{\};/);
  } finally {
    await new Promise((resolve) => stub.close(resolve));
  }
});

test("refineLocalAnswer loops up to MAX_FIX_ATTEMPTS when the first retry still has a problem, and keeps the eventually-clean version", async () => {
  let retryCalls = 0;
  const stub = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      retryCalls += 1;
      // First retry is broken in the SAME way (const reassigned); only the
      // second retry actually fixes it.
      const answer =
        retryCalls === 1
          ? "```html\n<script type=\"module\">\nconst score = 0;\nscore++;\n</script>\n```"
          : "```html\n<script type=\"module\">\nlet score = 0;\nscore++;\n</script>\n```";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ response: answer }));
    });
  });
  await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
  try {
    const broken = { ok: true, status: 200, text: "```html\n<script type=\"module\">\nconst score = 0;\nscore++;\n</script>\n```" };
    const refined = await refineLocalAnswer({
      task: "crie um jogo",
      result: broken,
      memories: [],
      env: { LOCAL_BASE_URL: `http://127.0.0.1:${stub.address().port}` },
    });
    assert.equal(retryCalls, 2);
    assert.match(refined.text, /let score = 0;/);
  } finally {
    await new Promise((resolve) => stub.close(resolve));
  }
});

test("refineLocalAnswer rejects a self-review revision that reintroduces a problem the retries already fixed", async () => {
  const stub = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      // Self-review "fixes" it by breaking it again.
      res.end(JSON.stringify({ response: "```html\n<script type=\"module\">\nconst score = 0;\nscore++;\n</script>\n```" }));
    });
  });
  await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
  try {
    const clean = { ok: true, status: 200, text: "```html\n<script type=\"module\">\nlet score = 0;\nscore++;\n</script>\n```" };
    const refined = await refineLocalAnswer({
      task: "crie um jogo",
      result: clean,
      memories: [{ title: "Regra", content: "Seja conciso.", tags: [] }],
      env: { LOCAL_BASE_URL: `http://127.0.0.1:${stub.address().port}` },
    });
    assert.equal(refined.text, clean.text);
  } finally {
    await new Promise((resolve) => stub.close(resolve));
  }
});

test("refineLocalAnswer runs a self-review pass against relevant memories and adopts the revision", async () => {
  const stub = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const { prompt } = JSON.parse(body);
      const isReview = prompt.includes("Revise sua propria resposta");
      const answer = isReview
        ? "```html\n<script type=\"module\">\nconst cor = 0x0000ff;\n</script>\n```"
        : "não deveria chegar aqui";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ response: answer }));
    });
  });
  await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
  try {
    const initial = {
      ok: true,
      status: 200,
      text: "```html\n<script type=\"module\">\nconst cor = 0xff0000;\n</script>\n```",
    };
    const refined = await refineLocalAnswer({
      task: "crie um cubo azul",
      result: initial,
      memories: [{ title: "Cor pedida", content: "Use exatamente a cor pedida pelo usuário.", tags: [] }],
      env: { LOCAL_BASE_URL: `http://127.0.0.1:${stub.address().port}` },
    });
    assert.match(refined.text, /0x0000ff/);
  } finally {
    await new Promise((resolve) => stub.close(resolve));
  }
});

test("refineLocalAnswer discards a self-review reply that dropped the code (keeps the last answer that still has code)", async () => {
  const stub = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      // A weak model's degenerate self-review reply: prose confirming the
      // rules were followed, with no code block at all.
      res.end(JSON.stringify({ response: "Verifiquei e todas as regras foram seguidas corretamente." }));
    });
  });
  await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
  try {
    const initial = {
      ok: true,
      status: 200,
      text: "```html\n<script type=\"module\">\nconst x = 1;\n</script>\n```",
    };
    const refined = await refineLocalAnswer({
      task: "crie um jogo",
      result: initial,
      memories: [{ title: "Regra", content: "Seja conciso.", tags: [] }],
      env: { LOCAL_BASE_URL: `http://127.0.0.1:${stub.address().port}` },
    });
    assert.equal(refined.text, initial.text);
  } finally {
    await new Promise((resolve) => stub.close(resolve));
  }
});

test("refineLocalAnswer gives a persistent problem one more free self-review chance even with zero memories (the exact gap found in live testing)", async () => {
  // Both retries stay broken (same const-reassignment mistake each time) —
  // exhausting MAX_FIX_ATTEMPTS without ever producing clean code. Without
  // the post-loop recheck, this would ship broken code silently since
  // memories is empty and self-review used to be skipped entirely.
  let calls = 0;
  const stub = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      calls += 1;
      const { prompt } = JSON.parse(body);
      const isSelfReview = prompt.includes("Revise sua propria resposta");
      const answer = isSelfReview
        ? "```html\n<script type=\"module\">\nlet score = 0;\nscore++;\n</script>\n```"
        : "```html\n<script type=\"module\">\nconst score = 0;\nscore++;\n</script>\n```";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ response: answer }));
    });
  });
  await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
  try {
    const broken = { ok: true, status: 200, text: "```html\n<script type=\"module\">\nconst score = 0;\nscore++;\n</script>\n```" };
    const refined = await refineLocalAnswer({
      task: "crie um jogo",
      result: broken,
      memories: [],
      env: { LOCAL_BASE_URL: `http://127.0.0.1:${stub.address().port}` },
    });
    assert.ok(calls >= 3, `expected at least 2 retries + 1 self-review, got ${calls} calls`);
    assert.match(refined.text, /let score = 0;/);
  } finally {
    await new Promise((resolve) => stub.close(resolve));
  }
});

test("refineLocalAnswer leaves plain non-code answers untouched", async () => {
  const plain = { ok: true, status: 200, text: "Um closure é uma função que lembra do seu escopo externo." };
  const refined = await refineLocalAnswer({
    task: "o que é um closure?",
    result: plain,
    memories: [{ title: "Regra", content: "Seja conciso.", tags: [] }],
    env: process.env,
  });
  assert.equal(refined, plain);
});

test("local server exposes a health endpoint", async () => {
  await withServer(async (api) => {
    const { status, body } = await api("/api/health");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.provider.id, "codex");
  });
});

test("GET /api/providers lists Codex, Claude and Local", async () => {
  await withServer(async (api) => {
    const { status, body } = await api("/api/providers");
    assert.equal(status, 200);
    assert.deepEqual(body.providers.map((p) => p.id).sort(), ["claude", "codex", "local"]);
  });
});

// ---------- Settings (Central de Configurações) ----------

test("GET /api/settings returns sane defaults before anything is ever saved", async () => {
  await withServer(async (api) => {
    const { status, body } = await api("/api/settings");
    assert.equal(status, 200);
    assert.equal(body.defaultProvider, "codex");
    assert.equal(body.defaultTeacher, "codex");
    assert.equal(body.communityManifestUrlIsDefault, true);
    assert.match(body.communityManifestUrl, /^https:\/\//);
  });
});

test("PUT /api/settings persists the default provider/teacher and rejects unknown ones", async () => {
  await withServer(async (api) => {
    const ok = await api("/api/settings", { method: "PUT", body: JSON.stringify({ defaultProvider: "local", defaultTeacher: "claude" }) });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.defaultProvider, "local");
    assert.equal(ok.body.defaultTeacher, "claude");

    const refetched = await api("/api/settings");
    assert.equal(refetched.body.defaultProvider, "local");
    assert.equal(refetched.body.defaultTeacher, "claude");

    const bad = await api("/api/settings", { method: "PUT", body: JSON.stringify({ defaultProvider: "gemini" }) });
    assert.equal(bad.status, 400);

    // Reset so later tests in this file (and their own boot behavior
    // assumptions) aren't affected by state a previous test left behind.
    await api("/api/settings", { method: "PUT", body: JSON.stringify({ defaultProvider: "codex", defaultTeacher: "codex" }) });
  });
});

test("PUT /api/settings validates and persists a custom community manifest URL, and an empty string resets it", async () => {
  await withServer(async (api) => {
    const bad = await api("/api/settings", { method: "PUT", body: JSON.stringify({ communityManifestUrl: "not a url" }) });
    assert.equal(bad.status, 400);

    const ok = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ communityManifestUrl: "https://example.com/manifest.json" }),
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.communityManifestUrl, "https://example.com/manifest.json");

    const reset = await api("/api/settings", { method: "PUT", body: JSON.stringify({ communityManifestUrl: "" }) });
    assert.equal(reset.status, 200);
    assert.match(reset.body.communityManifestUrl, /skrtt777\/Harness_Aurora/);
  });
});

test("PUT /api/settings validates and persists the sandbox execution folder", async () => {
  await withServer(async (api) => {
    const bad = await api("/api/settings", { method: "PUT", body: JSON.stringify({ sandboxDir: "not-an-absolute-path" }) });
    assert.equal(bad.status, 400);

    const ok = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ sandboxDir: "C:\\Users\\alguem\\Documents\\Harness\\Sandbox" }),
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.sandboxDir, "C:\\Users\\alguem\\Documents\\Harness\\Sandbox");

    const refetched = await api("/api/settings");
    assert.equal(refetched.body.sandboxDir, "C:\\Users\\alguem\\Documents\\Harness\\Sandbox");

    // Reset so later tests aren't affected by state this test left behind.
    await api("/api/settings", { method: "PUT", body: JSON.stringify({ sandboxDir: "" }) });
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

test("a conversation created with provider claude persists the user message even when Claude is unavailable", async () => {
  await withServer(async (api) => {
    const conversation = await api("/api/conversations", { method: "POST", body: JSON.stringify({ provider: "claude" }) });
    assert.equal(conversation.body.provider, "claude");

    const turn = await api(`/api/conversations/${conversation.body.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "Olá, tudo bem?" }),
    });
    assert.equal(turn.status, 503);

    const fetched = await api(`/api/conversations/${conversation.body.id}`);
    assert.equal(fetched.body.messages[0].content, "Olá, tudo bem?");
    assert.equal(fetched.body.messages[1].provider, "Sistema");
  });
});

test("a conversation created with provider local persists the user message even when Ollama is unavailable", async () => {
  await withServer(async (api) => {
    const conversation = await api("/api/conversations", { method: "POST", body: JSON.stringify({ provider: "local" }) });
    assert.equal(conversation.body.provider, "local");
    assert.equal(conversation.body.teacherProvider, "codex");

    const turn = await api(`/api/conversations/${conversation.body.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "Como somo dois números em Python?" }),
    });
    assert.equal(turn.status, 502);

    const fetched = await api(`/api/conversations/${conversation.body.id}`);
    assert.equal(fetched.body.messages[0].content, "Como somo dois números em Python?");
    assert.equal(fetched.body.messages[1].provider, "Sistema");
  });
});

test("a chat turn on a local conversation never creates memory automatically (no teacher call on normal turns)", async () => {
  const stub = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ response: "Resposta do modelo local." }));
    });
  });
  await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const stubUrl = `http://127.0.0.1:${stub.address().port}`;
  const previousBaseUrl = process.env.LOCAL_BASE_URL;
  process.env.LOCAL_BASE_URL = stubUrl;
  try {
    await withServer(async (api) => {
      const conversation = await api("/api/conversations", { method: "POST", body: JSON.stringify({ provider: "local" }) });
      const turn = await api(`/api/conversations/${conversation.body.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ message: "Como somo dois números em Python?" }),
      });
      assert.equal(turn.status, 200);
      assert.equal(turn.body.message.content, "Resposta do modelo local.");
      assert.deepEqual(turn.body.memoryCreated, []);
    });
  } finally {
    process.env.LOCAL_BASE_URL = previousBaseUrl;
    await new Promise((resolve) => stub.close(resolve));
  }
});

test("GET /api/conversations/:id/pending reports a stage while a local turn is in flight, then clears", async () => {
  const stub = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ response: "Resposta do modelo local." }));
      }, 300);
    });
  });
  await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const previousBaseUrl = process.env.LOCAL_BASE_URL;
  process.env.LOCAL_BASE_URL = `http://127.0.0.1:${stub.address().port}`;
  try {
    await withServer(async (api) => {
      const conversation = await api("/api/conversations", { method: "POST", body: JSON.stringify({ provider: "local" }) });
      const cid = conversation.body.id;

      const idleBefore = await api(`/api/conversations/${cid}/pending`);
      assert.equal(idleBefore.body.stage, null);

      const turnPromise = api(`/api/conversations/${cid}/messages`, {
        method: "POST",
        body: JSON.stringify({ message: "oi" }),
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const midFlight = await api(`/api/conversations/${cid}/pending`);
      assert.equal(midFlight.body.stage, "Gerando resposta…");

      await turnPromise;
      const idleAfter = await api(`/api/conversations/${cid}/pending`);
      assert.equal(idleAfter.body.stage, null);
    });
  } finally {
    process.env.LOCAL_BASE_URL = previousBaseUrl;
    await new Promise((resolve) => stub.close(resolve));
  }
});

test("POST /api/conversations/:id/cancel aborts an in-flight local turn", async () => {
  const stub = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      // Never actually responds within the test's lifetime — only a cancel
      // (not the stub) should end this turn.
      const timer = setTimeout(() => res.end(JSON.stringify({ response: "não deveria chegar aqui" })), 30000);
      res.on("close", () => clearTimeout(timer));
    });
  });
  await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const previousBaseUrl = process.env.LOCAL_BASE_URL;
  process.env.LOCAL_BASE_URL = `http://127.0.0.1:${stub.address().port}`;
  try {
    await withServer(async (api) => {
      const conversation = await api("/api/conversations", { method: "POST", body: JSON.stringify({ provider: "local" }) });
      const cid = conversation.body.id;

      const turnPromise = api(`/api/conversations/${cid}/messages`, {
        method: "POST",
        body: JSON.stringify({ message: "oi" }),
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const cancelResult = await api(`/api/conversations/${cid}/cancel`, { method: "POST" });
      assert.equal(cancelResult.body.cancelled, true);

      const turn = await turnPromise;
      assert.equal(turn.status, 499);
      assert.equal(turn.body.cancelled, true);
      assert.equal(turn.body.message.content, "Mensagem cancelada.");
    });
  } finally {
    process.env.LOCAL_BASE_URL = previousBaseUrl;
    await new Promise((resolve) => stub.close(resolve));
  }
});

test("POST /correct fails gracefully when the teacher provider is unavailable", async () => {
  await withServer(async (api) => {
    const conversation = await api("/api/conversations", { method: "POST", body: JSON.stringify({ provider: "local" }) });
    await api(`/api/conversations/${conversation.body.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "Como somo dois números em Python?" }),
    });
    const fetched = await api(`/api/conversations/${conversation.body.id}`);
    const wrongMessage = await addMessage({ conversationId: conversation.body.id, role: "assistant", content: "print(1, 2)", provider: "Local" });

    const corrected = await api(`/api/conversations/${conversation.body.id}/messages/${wrongMessage.id}/correct`, {
      method: "POST",
      body: JSON.stringify({ note: "print não é o mesmo que somar" }),
    });
    assert.equal(corrected.status, 502);
    // The frontend (ChatView.tsx's correction box) surfaces this string
    // directly to the user instead of leaving "Corrigindo…" up forever with
    // no explanation — so a non-empty, human-readable message here is load-bearing.
    assert.equal(typeof corrected.body.error, "string");
    assert.ok(corrected.body.error.length > 0);
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

test("a relation shows up on the declaring memory's side in GET /api/memories", async () => {
  await withServer(async (api) => {
    const first = await api("/api/memories", {
      method: "POST",
      body: JSON.stringify({ scope: "global", title: "Projeto X", content: "Projeto X usa SQLite." }),
    });
    const second = await api("/api/memories", {
      method: "POST",
      body: JSON.stringify({ scope: "global", title: "Decisão", content: "Time decidiu não usar ORM." }),
    });

    await createRelation({ fromId: second.body.id, toId: first.body.id, type: "derivation" });

    const list = await api("/api/memories?scope=global");
    const firstFromList = list.body.memories.find((m) => m.id === first.body.id);
    const secondFromList = list.body.memories.find((m) => m.id === second.body.id);

    // Only the declaring ("from") side lists the relation — matches the
    // frontend's graph model, which derives the reverse direction itself.
    assert.deepEqual(firstFromList.relations, []);
    assert.deepEqual(secondFromList.relations, [first.body.id]);
    assert.equal(secondFromList.relationTypes[first.body.id], "derivation");
  });
});

test("POST /api/memories/:id/relations creates a relation via HTTP", async () => {
  await withServer(async (api) => {
    const first = await api("/api/memories", {
      method: "POST",
      body: JSON.stringify({ scope: "global", title: "A", content: "Memória A." }),
    });
    const second = await api("/api/memories", {
      method: "POST",
      body: JSON.stringify({ scope: "global", title: "B", content: "Memória B." }),
    });

    const created = await api(`/api/memories/${second.body.id}/relations`, {
      method: "POST",
      body: JSON.stringify({ toId: first.body.id, type: "thematic" }),
    });
    assert.equal(created.status, 201);

    const list = await api("/api/memories?scope=global");
    const secondFromList = list.body.memories.find((m) => m.id === second.body.id);
    assert.deepEqual(secondFromList.relations, [first.body.id]);

    const invalid = await api(`/api/memories/${second.body.id}/relations`, {
      method: "POST",
      body: JSON.stringify({ toId: first.body.id, type: "tipo-invalido" }),
    });
    assert.equal(invalid.status, 400);
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

test("resolveCommunityManifestUrl: env override > saved setting > built-in default, in that priority", async () => {
  assert.equal(await resolveCommunityManifestUrl({}), DEFAULT_MANIFEST_URL);

  await setSetting("community_manifest_url", "https://example.com/mine.json");
  assert.equal(await resolveCommunityManifestUrl({}), "https://example.com/mine.json");

  assert.equal(
    await resolveCommunityManifestUrl({ COMMUNITY_MANIFEST_URL: "https://example.com/env.json" }),
    "https://example.com/env.json",
  );

  await setSetting("community_manifest_url", "");
});

test("fetchCommunityManifest fetches and validates the manifest format", async () => {
  const stub = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ format: "harness-aurora-community-manifest", version: 1, bundles: [{ id: "x", file: "x.json" }] }));
  });
  await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
  try {
    const bundles = await fetchCommunityManifest({ COMMUNITY_MANIFEST_URL: `http://127.0.0.1:${stub.address().port}/manifest.json` });
    assert.deepEqual(bundles, [{ id: "x", file: "x.json" }]);
  } finally {
    await new Promise((resolve) => stub.close(resolve));
  }
});

test("fetchCommunityManifest rejects a response with the wrong format instead of trusting it blindly", async () => {
  const stub = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ hello: "not a manifest" }));
  });
  await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
  try {
    await assert.rejects(() =>
      fetchCommunityManifest({ COMMUNITY_MANIFEST_URL: `http://127.0.0.1:${stub.address().port}/manifest.json` }),
    );
  } finally {
    await new Promise((resolve) => stub.close(resolve));
  }
});

test("fetchCommunityBundle fetches a bundle relative to the manifest URL and validates its format", async () => {
  const stub = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ format: "harness-aurora-memories", version: 1, memories: [{ id: "m1", title: "t" }] }));
  });
  await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
  try {
    const bundle = await fetchCommunityBundle("threejs.json", {
      COMMUNITY_MANIFEST_URL: `http://127.0.0.1:${stub.address().port}/manifest.json`,
    });
    assert.equal(bundle.memories.length, 1);
  } finally {
    await new Promise((resolve) => stub.close(resolve));
  }
});

test("fetchCommunityBundle rejects a filename that isn't a plain name.json (no path traversal)", async () => {
  await assert.rejects(() => fetchCommunityBundle("../../etc/passwd", { COMMUNITY_MANIFEST_URL: "http://127.0.0.1:1/manifest.json" }));
});

test("GET /api/community/manifest and /api/community/bundles/:file proxy the community repo", async () => {
  const stub = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url.endsWith("manifest.json")) {
      res.end(JSON.stringify({ format: "harness-aurora-community-manifest", version: 1, bundles: [{ id: "threejs", file: "threejs.json" }] }));
    } else {
      res.end(JSON.stringify({ format: "harness-aurora-memories", version: 1, memories: [{ id: "m1", title: "t" }] }));
    }
  });
  await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const previous = process.env.COMMUNITY_MANIFEST_URL;
  process.env.COMMUNITY_MANIFEST_URL = `http://127.0.0.1:${stub.address().port}/manifest.json`;
  try {
    await withServer(async (api) => {
      const manifest = await api("/api/community/manifest");
      assert.equal(manifest.status, 200);
      assert.equal(manifest.body.bundles[0].id, "threejs");

      const bundle = await api("/api/community/bundles/threejs.json");
      assert.equal(bundle.status, 200);
      assert.equal(bundle.body.memories.length, 1);
    });
  } finally {
    process.env.COMMUNITY_MANIFEST_URL = previous;
    await new Promise((resolve) => stub.close(resolve));
  }
});

test("GET /api/community/manifest returns a graceful error when the upstream is unreachable", async () => {
  const previous = process.env.COMMUNITY_MANIFEST_URL;
  process.env.COMMUNITY_MANIFEST_URL = "http://127.0.0.1:1/manifest.json";
  try {
    await withServer(async (api) => {
      const response = await api("/api/community/manifest");
      assert.equal(response.status, 502);
      assert.ok(response.body.error);
    });
  } finally {
    process.env.COMMUNITY_MANIFEST_URL = previous;
  }
});

test("getSavingsStats computes token savings from existing message rows, no separate counter", async () => {
  const before = await getSavingsStats();
  const conversation = await createConversation({ provider: "local", teacherProvider: "claude" });

  // Three successful local turns that never needed a correction: each one
  // avoided the 2 paid calls (answer + auto-extraction) a Codex/Claude turn
  // would have cost, so the baseline compares against localTurns * 2.
  await addMessage({ conversationId: conversation.id, role: "assistant", content: "ok 1", provider: "Local" });
  await addMessage({ conversationId: conversation.id, role: "assistant", content: "ok 2", provider: "Local" });
  await addMessage({ conversationId: conversation.id, role: "assistant", content: "ok 3", provider: "Local" });
  // A fourth local turn that DID need a correction: one paid call (the
  // correction folds extraction in, so it never costs 2).
  await addMessage({ conversationId: conversation.id, role: "assistant", content: "ok 4 (errado)", provider: "Local" });
  await addMessage({ conversationId: conversation.id, role: "assistant", content: "corrigido", provider: "Claude (corrigindo)" });

  const after = await getSavingsStats();
  assert.equal(after.localTurns - before.localTurns, 4);
  assert.equal(after.corrections - before.corrections, 1);
  assert.equal(after.baselineCalls - before.baselineCalls, 8);
  assert.equal(after.actualCalls - before.actualCalls, 1);
  assert.equal(after.savedCalls - before.savedCalls, 7);
});

test("GET /api/savings exposes the same numbers over HTTP as the store function", async () => {
  await withServer(async (api) => {
    const conversation = await api("/api/conversations", { method: "POST", body: JSON.stringify({ provider: "local" }) });
    await addMessage({ conversationId: conversation.body.id, role: "assistant", content: "ok", provider: "Local" });

    const [response, direct] = await Promise.all([api("/api/savings"), getSavingsStats()]);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, direct);
    assert.ok(response.body.localTurns >= 1);
  });
});

// ---------- Browser agent routes ----------
//
// A full end-to-end run (real Chromium + real Tesseract) isn't exercised
// here: it would hit the same network-restricted OCR language download
// documented in test/ocr.test.js, and could try to download Chromium itself
// in an environment where it isn't already installed. These tests only
// cover the HTTP contract the frontend will rely on — that starting a run
// returns promptly with an id instead of blocking on the (potentially slow
// or network-bound) agent loop, and that status/cancel behave sanely for an
// unknown run id. The agent loop itself is already covered thoroughly by
// test/browserAgent.test.js.

test("POST /api/browser-agent/start rejects an empty goal", async () => {
  await withServer(async (api) => {
    const response = await api("/api/browser-agent/start", { method: "POST", body: JSON.stringify({ goal: "   " }) });
    assert.equal(response.status, 400);
    assert.match(response.body.error, /tarefa/);
  });
});

test("POST /api/browser-agent/start returns a run id promptly without waiting for the agent loop", async () => {
  const previous = process.env.CHROMIUM_EXECUTABLE_PATH;
  process.env.CHROMIUM_EXECUTABLE_PATH = process.execPath; // Exists, but isn't a browser: fail locally, never download.
  process.env.BROWSER_AGENT_PROFILE_DIR = mkdtempSync(join(tmpdir(), "harness-agent-test-"));
  try { await withServer(async (api) => {
    const start = Date.now();
    const response = await api("/api/browser-agent/start", {
      method: "POST",
      body: JSON.stringify({ goal: "abrir o site e clicar em salvar" }),
    });
    assert.equal(response.status, 200);
    assert.equal(typeof response.body.runId, "string");
    assert.ok(response.body.runId.length > 0);
    // The route kicks off browser/model work in the background instead of
    // awaiting it before responding — this should come back almost
    // instantly regardless of how long (or how it fails) that work takes.
    assert.ok(Date.now() - start < 2000, "starting a run should not block on the agent loop");
    for (let i = 0; i < 100; i++) {
      const state = await api(`/api/browser-agent/${response.body.runId}/status`);
      if (state.body.status !== "running") break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }); } finally { if (previous === undefined) delete process.env.CHROMIUM_EXECUTABLE_PATH; else process.env.CHROMIUM_EXECUTABLE_PATH = previous; }
});

test("GET /api/browser-agent/:id/status returns 404 for an unknown run", async () => {
  await withServer(async (api) => {
    const response = await api("/api/browser-agent/does-not-exist/status");
    assert.equal(response.status, 404);
  });
});

test("POST /api/browser-agent/:id/cancel reports cancelled:false for an unknown run", async () => {
  await withServer(async (api) => {
    const response = await api("/api/browser-agent/does-not-exist/cancel", { method: "POST" });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { cancelled: false });
  });
});

// ---------- Sandbox de execução (rodar código gerado pelo modelo local) ----------

test("POST .../sandbox requires a configured sandbox folder before it will run anything", async () => {
  await withServer(async (api) => {
    await api("/api/settings", { method: "PUT", body: JSON.stringify({ sandboxDir: "" }) });
    const conversation = await createConversation({ provider: "local", title: "Jogo de teste" });
    const message = await addMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "```html\n<!DOCTYPE html>\n<html><body>jogo</body></html>\n```",
      provider: "Local",
    });
    const response = await api(`/api/conversations/${conversation.id}/messages/${message.id}/sandbox`, { method: "POST" });
    assert.equal(response.status, 400);
    assert.match(response.body.error, /pasta/);
  });
});

test("POST .../sandbox rejects a message with no runnable code, even with a folder configured", async () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-sandbox-test-"));
  await withServer(async (api) => {
    await api("/api/settings", { method: "PUT", body: JSON.stringify({ sandboxDir: dir }) });
    const conversation = await createConversation({ provider: "local", title: "Conversa qualquer" });
    const message = await addMessage({ conversationId: conversation.id, role: "assistant", content: "Só uma explicação em texto.", provider: "Local" });
    const response = await api(`/api/conversations/${conversation.id}/messages/${message.id}/sandbox`, { method: "POST" });
    assert.equal(response.status, 400);
    assert.match(response.body.error, /código executável/);
    await api("/api/settings", { method: "PUT", body: JSON.stringify({ sandboxDir: "" }) });
  });
});

test("POST .../sandbox materializes the code to a real file, and GET .../preview serves it back", async () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-sandbox-test-"));
  await withServer(async (api, base) => {
    await api("/api/settings", { method: "PUT", body: JSON.stringify({ sandboxDir: dir }) });
    const conversation = await createConversation({ provider: "local", title: "Crie um jogo simples em Three.js" });
    const html = "<!DOCTYPE html>\n<html><body><h1>Meu Jogo</h1></body></html>";
    const message = await addMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: `Aqui está:\n\n\`\`\`html\n${html}\n\`\`\`\n\nTestei e funciona.`,
      provider: "Local",
    });

    const run = await api(`/api/conversations/${conversation.id}/messages/${message.id}/sandbox`, { method: "POST" });
    assert.equal(run.status, 200);
    assert.ok(run.body.filePath.includes(`conversation-${conversation.id}`));
    assert.equal(await readFile(run.body.filePath, "utf8"), html);
    assert.equal(run.body.previewUrl, `/api/conversations/${conversation.id}/messages/${message.id}/sandbox/preview`);

    // api() always parses the response as JSON, so the HTML preview route
    // (text/html, not JSON) is fetched directly instead of through it.
    const previewResponse = await fetch(`${base}${run.body.previewUrl}`);
    assert.equal(previewResponse.status, 200);
    assert.match(previewResponse.headers.get("content-type") || "", /text\/html/);
    assert.equal(await previewResponse.text(), html);

    await api("/api/settings", { method: "PUT", body: JSON.stringify({ sandboxDir: "" }) });
  });
});

test("GET .../sandbox/preview returns 404 before Executar has ever been clicked for that message", async () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-sandbox-test-"));
  await withServer(async (api, base) => {
    await api("/api/settings", { method: "PUT", body: JSON.stringify({ sandboxDir: dir }) });
    const conversation = await createConversation({ provider: "local", title: "Conversa sem execução ainda" });
    const message = await addMessage({ conversationId: conversation.id, role: "assistant", content: "```html\n<html></html>\n```", provider: "Local" });
    // api() always parses as JSON; this route can return plain HTML, so it's fetched directly.
    const response = await fetch(`${base}/api/conversations/${conversation.id}/messages/${message.id}/sandbox/preview`);
    assert.equal(response.status, 404);
    await api("/api/settings", { method: "PUT", body: JSON.stringify({ sandboxDir: "" }) });
  });
});
