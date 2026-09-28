import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "harness-eval-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.LOCAL_BASE_URL = "http://127.0.0.1:1";
process.env.EMBEDDINGS_ENABLED = "false";

const { EVAL_TASKS, summarizeEval, startTestSite } = await import("../app/agentEval.js");
const { startEvalRun, listEvalRuns, evalStatus } = await import("../app/agentEvalRuns.js");
const store = await import("../app/store.js");

const task = (id) => EVAL_TASKS.find((t) => t.id === id);

test("the benchmark has stable ids, one prompt each and a check per task", () => {
  assert.equal(new Set(EVAL_TASKS.map((t) => t.id)).size, EVAL_TASKS.length);
  assert.ok(EVAL_TASKS.length >= 12);
  for (const t of EVAL_TASKS) { assert.equal(typeof t.check, "function", t.id); assert.ok(t.prompt, t.id); }
});

test("task checks accept a correct outcome and reject a wrong one", async () => {
  const dir = mkdtempSync(join(temp, "task-"));
  writeFileSync(join(dir, "config.json"), '{"nome":"api","porta":8080}');
  assert.equal(await task("editar-json").check({ dir }), true);
  writeFileSync(join(dir, "config.json"), '{"porta":8080}');
  assert.equal(await task("editar-json").check({ dir }), false, "the other field must survive");
  writeFileSync(join(dir, "media.js"), "const n=process.argv.slice(2).map(Number);console.log((n.reduce((a,b)=>a+b,0)/n.length).toFixed(2))");
  assert.equal(await task("script-media").check({ dir }), true, "5.00 is the right average");
  writeFileSync(join(dir, "media.js"), "console.log(15)");
  assert.equal(await task("script-media").check({ dir }), false);
  assert.equal(await task("site-busca").check({ answer: "O primeiro é o Teclado Mecânico RGB por R$ 289,90." }), true);
  assert.equal(await task("resposta-direta").check({ answer: "49", steps: [] }), false);
  assert.equal(await task("lembrar").check({ memories: [{ content: "O time do usuário é o Bahia." }] }), true);
  mkdirSync(join(dir, "docs"));
  writeFileSync(join(dir, "docs", "leiame.md"), "# Projeto Aurora\n");
  assert.equal(await task("pasta-leiame").check({ dir }), true);
});

test("the local test site answers searches and the contact page", async () => {
  const { server, url } = await startTestSite();
  try {
    assert.match(await (await fetch(`${url}/busca?q=teclado`)).text(), /Teclado Mecânico RGB<\/a> — <b>R\$ 289,90/);
    assert.match(await (await fetch(`${url}/contato`)).text(), /atendimento@loja-aurora\.test/);
  } finally { server.close(); }
});

test("summaries count by area", () => {
  const summary = summarizeEval([{ area: "código", passed: true, ms: 10 }, { area: "código", passed: false, ms: 5 }, { area: "navegador", passed: true, ms: 1 }]);
  assert.deepEqual(summary, { passed: 2, total: 3, rate: 2 / 3, ms: 16, byArea: { "código": { passed: 1, total: 2 }, navegador: { passed: 1, total: 1 } } });
});

test("a run happens on a database copy in a child process and its result is kept", async () => {
  await store.createMemory({ scope: "global", title: "M", content: "Memória que deve ir para a cópia.", kind: "manual", env: { EMBEDDINGS_ENABLED: "false" } });
  const runner = join(temp, "fake-runner.mjs");
  writeFileSync(runner, `
    const { DatabaseSync } = await import("node:sqlite");
    const copy = new DatabaseSync(process.env.HARNESS_DB_FILE);
    const memories = copy.prepare("SELECT count(*) n FROM memories").get().n;
    if (process.argv.includes("--no-memories")) copy.exec("DELETE FROM memories");
    console.log(JSON.stringify({ progress: { index: 0, total: 1, task: "x" } }));
    console.log(JSON.stringify({ done: { model: "fake:1b", summary: { passed: 1, total: 1, rate: 1, ms: 3, byArea: { teste: { passed: 1, total: 1 } } }, results: [{ id: "x", area: "teste", passed: true, ms: 3, memoriesSeen: memories }] } }));
  `);
  const { id } = await startEvalRun({ withMemories: true, runner });
  assert.equal(evalStatus().running, true);
  await assert.rejects(startEvalRun({ withMemories: true, runner }), /em andamento/);
  for (let i = 0; i < 100 && evalStatus().running; i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  const [run] = await listEvalRuns();
  assert.equal(run.id, id);
  assert.deepEqual([run.model, run.passed, run.total, run.withMemories], ["fake:1b", 1, 1, true]);
  assert.equal(run.results[0].memoriesSeen, 1, "the copy carries the learned memories");
  assert.equal(run.memoryCount, 1);
  assert.equal((await store.listMemories({})).length, 1, "the real database is untouched");
});
