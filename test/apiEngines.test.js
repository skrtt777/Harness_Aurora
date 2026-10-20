import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "harness-api-engines-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.EMBEDDINGS_ENABLED = "false";

const { inside, runTool, runApiEngine, saveApiEngine, listApiEngines, publicEngine, deleteApiEngine } = await import("../app/apiEngines.js");
const { ENGINES, refreshApiEngines, escalate, engineStatus, engineOrder, OUT_OF_LIMIT } = await import("../app/engine.js");
const hasPython = (() => { for (const py of ["python", "py"]) { try { execFileSync(py, ["--version"], { stdio: "ignore" }); return true; } catch { /* next */ } } return false; })();

test("the tools never leave the folder they work in", async () => {
  const root = mkdtempSync(join(tmpdir(), "api-root-"));
  assert.equal(inside(root, "../fora.txt"), null);
  assert.equal(inside(root, "C:\\Windows\\win.ini"), null);
  assert.ok(inside(root, "sub/a.txt"));
  assert.match(await runTool("write_file", { path: "../x.txt", content: "x" }, { root }), /^ERRO/);
  assert.match(await runTool("write_file", { path: "sub/a.txt", content: "olá" }, { root }), /Gravado: sub[\\/]a\.txt/);
  assert.equal(await runTool("read_file", { path: "sub/a.txt" }, { root }), "olá");
  assert.match(await runTool("list_files", {}, { root }), /sub[\\/]a\.txt \(4 bytes\)/);
  assert.match(await runTool("run_python", { script: "../../evil.py" }, { root }), /^ERRO/);
  assert.match(await runTool("apagar_tudo", {}, { root }), /desconhecida/);
});

test("Anthropic: the official SDK loop runs the tools until end_turn, with the server-side fallback", async () => {
  const root = mkdtempSync(join(tmpdir(), "api-anthropic-"));
  const requests = [];
  const replies = [
    { stop_reason: "tool_use", content: [{ type: "text", text: "Vou gravar." }, { type: "tool_use", id: "t1", name: "write_file", input: { path: "ok.txt", content: "OK" } }], usage: { input_tokens: 10, output_tokens: 5 } },
    { stop_reason: "end_turn", content: [{ type: "text", text: "pronto" }], usage: { input_tokens: 20, output_tokens: 2 } },
  ];
  const client = { beta: { messages: { create: async (body) => { requests.push(JSON.parse(JSON.stringify(body))); return replies.shift(); } } } };
  const out = await runApiEngine({ kind: "anthropic", apiKey: "sk-test", model: "claude-opus-5-5" }, "grave ok.txt", { cwd: root, client });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.text, "pronto");
  assert.equal(readFileSync(join(root, "ok.txt"), "utf8"), "OK");
  assert.equal(requests[0].model, "claude-opus-5-5");
  assert.deepEqual([requests[0].fallbacks, requests[0].betas], ["default", ["server-side-fallback-2026-07-01"]]);
  assert.deepEqual(requests[0].tools.map((t) => t.name), ["list_files", "read_file", "write_file", "run_python"]);
  const results = requests[1].messages.at(-1);
  assert.equal(results.role, "user");
  assert.deepEqual([results.content[0].type, results.content[0].tool_use_id], ["tool_result", "t1"]);
  assert.deepEqual(out.usage, { input: 30, output: 7 });

  const refused = await runApiEngine({ kind: "anthropic", apiKey: "k" }, "x", { cwd: root, client: { beta: { messages: { create: async () => ({ stop_reason: "refusal", content: [] }) } } } });
  assert.deepEqual([refused.ok, refused.error], [false, "o modelo recusou a tarefa"]);
});

/** A tiny OpenAI-compatible server that plays a script of replies and records each request. */
async function fakeOpenAi(replies) {
  const bodies = [];
  const server = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    bodies.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(raw) });
    const next = replies.shift();
    res.writeHead(next?.status || 200, { "content-type": "application/json" });
    res.end(JSON.stringify(next?.body ?? next));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}/v1`, bodies, close: () => new Promise((r) => server.close(r)) };
}
const toolCall = (id, name, args) => ({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }], usage: { prompt_tokens: 5, completion_tokens: 3 } });
const say = (text) => ({ choices: [{ message: { role: "assistant", content: text } }], usage: { prompt_tokens: 5, completion_tokens: 3 } });

test("OpenAI-compatible: tool calls by function, results as role tool; a 429 reads as out of limit", async () => {
  const root = mkdtempSync(join(tmpdir(), "api-openai-"));
  const fake = await fakeOpenAi([toolCall("c1", "write_file", { path: "a.txt", content: "A" }), say("feito")]);
  try {
    const out = await runApiEngine({ kind: "openai", baseUrl: fake.url, model: "gpt-teste", apiKey: "sk-x" }, "grave a.txt", { cwd: root });
    assert.equal(out.ok, true, out.error);
    assert.equal(readFileSync(join(root, "a.txt"), "utf8"), "A");
    assert.equal(fake.bodies[0].url, "/v1/chat/completions");
    assert.equal(fake.bodies[0].auth, "Bearer sk-x");
    assert.equal(fake.bodies[0].body.tools[0].type, "function");
    const last = fake.bodies[1].body.messages.at(-1);
    assert.deepEqual([last.role, last.tool_call_id], ["tool", "c1"]);
  } finally { await fake.close(); }
  const limited = await fakeOpenAi([{ status: 429, body: { error: { message: "Rate limit reached for requests" } } }]);
  try {
    const out = await runApiEngine({ kind: "openai", baseUrl: limited.url, model: "m" }, "x", { cwd: root });
    assert.equal(out.ok, false);
    assert.ok(OUT_OF_LIMIT.test(out.error), out.error);
  } finally { await limited.close(); }
});

test("configured engines: the key never shows, and they join the engines everything else uses", async () => {
  const saved = await saveApiEngine({ preset: "openrouter", model: "anthropic/claude-sonnet-5.5", apiKey: "sk-or-segredo-1234" });
  assert.match(saved.id, /^api-openrouter-/);
  assert.equal(publicEngine(saved).keyHint, "…1234");
  assert.ok(!JSON.stringify(publicEngine(saved)).includes("segredo"));
  await assert.rejects(saveApiEngine({ preset: "custom", model: "x" }), /endereço/);
  await refreshApiEngines();
  assert.equal(ENGINES[saved.id].label, "OpenRouter");
  assert.ok(engineOrder().indexOf(saved.id) > engineOrder().indexOf("codex"), "after the CLIs");
  const status = await engineStatus();
  assert.equal(status[saved.id].installed, true);
  await deleteApiEngine(saved.id);
  await refreshApiEngines();
  assert.equal(ENGINES[saved.id], undefined);
  assert.equal((await listApiEngines()).length, 0);
});

test("an API engine works blind like the CLIs: the mirror, the script run here, nothing real in the requests", { skip: !hasPython && "sem Python" }, async () => {
  const ws = mkdtempSync(join(tmpdir(), "api-blind-"));
  writeFileSync(join(ws, "vendas.csv"), "cliente;cpf;regiao;vendas\nMaria Souza;123.456.789-09;Sul;120\nJoão Lima;987.654.321-00;Norte;95\nAna Prado;111.222.333-44;Sul;143\n", "utf8");
  const script = "import csv\nrows = list(csv.DictReader(open('vendas.csv', encoding='utf-8'), delimiter=';'))\nprint('Sul:', sum(int(r['vendas']) for r in rows if r['regiao'] == 'Sul'))\n";
  const fake = await fakeOpenAi([toolCall("c1", "list_files", {}), toolCall("c2", "write_file", { path: "aurora_tarefa.py", content: script }), toolCall("c3", "run_python", { script: "aurora_tarefa.py" }), say("O script soma as vendas do Sul.")]);
  try {
    const engine = await saveApiEngine({ preset: "custom", label: "Modelo da empresa", baseUrl: fake.url, model: "local-70b" });
    await refreshApiEngines();
    const out = await escalate({ task: "Quanto o Sul vendeu? A Maria Souza (CPF 123.456.789-09) pediu.", workspace: ws, order: [engine.id], privacy: "espelho" });
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(out.label, "Modelo da empresa");
    assert.match(out.text, /Sul: 263/, "computed here, on the real data");
    const sent = JSON.stringify(fake.bodies.map((b) => b.body.messages));
    for (const s of ["Maria", "João", "Ana Prado", "123.456.789-09"]) assert.ok(!sent.includes(s), `${s} reached the API`);
    assert.match(sent, /Sul: \d+/, "it ran the script on the mirror (fake values) when it tested");
  } finally { await fake.close(); }
});
