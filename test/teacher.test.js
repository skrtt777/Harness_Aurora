import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const temp = mkdtempSync(join(tmpdir(), "harness-teacher-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.LOCAL_BASE_URL = "http://127.0.0.1:1";
process.env.EMBEDDINGS_ENABLED = "false";
process.env.CODEX_BIN = join(temp, "missing-codex.exe");
process.env.CLAUDE_BIN = join(temp, "missing-claude.exe");
const fakeCli = fileURLToPath(new URL("./fixtures/fake-cli.mjs", import.meta.url));

const { detectSignals, shouldReview, parseReview, buildReviewPrompt, redoMessage } = await import("../app/teacher.js");
const { runTeachingLoop, teacherSettings } = await import("../app/teachingLoop.js");
const store = await import("../app/store.js");

const step = (tool, ok = true, extra = {}) => ({ tool, args: {}, ok, summary: ok ? "ok" : "ERRO: falhou", result: ok ? "ok" : "ERRO: falhou", ...extra });

test("error signals come from failed actions, limits, giving up and the user's complaint", () => {
  assert.deepEqual(detectSignals({ userMessage: "crie x", result: { steps: [step("write_file")], text: "Pronto." } }), []);
  const codes = (input) => detectSignals(input).map((s) => s.code);
  assert.deepEqual(codes({ result: { steps: [step("run_command", false)], text: "ok" } }), ["failed_actions"]);
  assert.deepEqual(codes({ result: { steps: [step("run_command", false), step("run_command")], text: "ok" } }), [], "a failure fixed later isn't a signal");
  assert.deepEqual(codes({ result: { steps: [step("write_file", false, { denied: true })], text: "ok" } }), [], "a refusal by the user isn't an error");
  assert.deepEqual(codes({ result: { steps: [], text: "ok", forced: "limit" } }), ["step_limit"]);
  assert.deepEqual(codes({ result: { steps: [], text: "Infelizmente não consegui abrir o site." } }), ["gave_up"]);
  for (const complaint of ["não funcionou", "tá errado isso", "continua com erro", "de novo, por favor", "não abriu nada"]) assert.deepEqual(codes({ userMessage: complaint, result: { steps: [], text: "" } }), ["user_complaint"], complaint);
  assert.deepEqual(codes({ userMessage: "funcionou, obrigado", result: { steps: [], text: "" } }), []);
});

test("review happens on errors always, on deliveries that changed something only in 'actions' mode", () => {
  assert.equal(shouldReview({ mode: "actions", signals: [], steps: [step("browser_navigate"), step("read_file")] }), null, "looking around is not a delivery");
  assert.equal(shouldReview({ mode: "actions", signals: [], steps: [step("write_file")] }), "actions");
  assert.equal(shouldReview({ mode: "errors", signals: [], steps: [step("write_file")] }), null);
  assert.equal(shouldReview({ mode: "errors", signals: [{ code: "gave_up" }], steps: [] }), "errors");
  assert.equal(shouldReview({ mode: "off", signals: [{ code: "gave_up" }], steps: [step("write_file")] }), null);
});

test("the teacher's verdict is parsed strictly", () => {
  assert.equal(parseReview("nada de json"), null);
  assert.equal(parseReview('{"verdict":"talvez"}'), null);
  assert.deepEqual(parseReview('Segue: {"verdict":"ok","problems":[],"lessons":[]}'), { verdict: "ok", problems: [], guidance: "", lessons: [], skill: null });
  const fix = parseReview(JSON.stringify({ verdict: "fix", problems: ["p1"], guidance: "faça x", lessons: [{ title: "T", content: "Regra geral.", tags: ["A", 3] }, { content: "" }], skill: { name: "proc", description: "d", body: "# passos" } }));
  assert.equal(fix.verdict, "fix");
  assert.deepEqual(fix.lessons, [{ title: "T", content: "Regra geral.", tags: ["a"] }]);
  assert.equal(fix.skill.name, "proc");
  assert.equal(parseReview('{"verdict":"fix","problems":[],"lessons":[]}').verdict, "ok", "a 'fix' with nothing to fix is treated as ok");
  const prompt = buildReviewPrompt({ userMessage: "crie soma.js", steps: [{ ...step("write_file"), args: { path: "soma.js" } }], answer: "Pronto", signals: [{ code: "gave_up", detail: "x" }], workspace: "C:\\proj" });
  assert.match(prompt, /Você PODE ler os arquivos/);
  assert.match(prompt, /1\. write_file \{"path":"soma\.js"\}/);
  assert.match(prompt, /gave_up/);
  assert.match(redoMessage(fix), /Orientação:\nfaça x/);
});

test("a 'fix' saves lessons, the local model redoes with them, and memory stats follow the outcome", async () => {
  const conversation = await store.createConversation({ provider: "local" });
  const old = await store.createMemory({ scope: "global", title: "Velha", content: "Lição antiga que não evitou o erro.", kind: "extracted", env: { EMBEDDINGS_ENABLED: "false" } });
  const reviews = [];
  const call = async ({ prompt }) => { reviews.push(prompt); return { ok: true, text: JSON.stringify({ verdict: "fix", problems: ["Não imprime"], guidance: "Use console.log", lessons: [{ title: "Imprimir", content: "Scripts de linha de comando devem imprimir o resultado com console.log.", tags: ["node"] }] }) }; };
  const reruns = [];
  const rerun = async (history, input) => { reruns.push({ history, input }); return { ok: true, text: "Corrigido: agora imprime 42.", steps: [step("edit_file"), step("run_command")], calls: [{ usage: null }], messages: [] }; };
  const first = { ok: true, text: "Pronto", steps: [step("write_file")], calls: [{ usage: null }], messages: [{ role: "system", content: "s" }, { role: "user", content: "crie" }, { role: "assistant", content: "Pronto" }] };
  const { result, review } = await runTeachingLoop({ userMessage: "crie soma.js", history: [], first, teacherProvider: "codex", conversation, memoryIds: [old.id], rerun, call });
  assert.equal(review.verdict, "fix");
  assert.equal(review.redo, "ok");
  assert.equal(reviews.length, 1);
  assert.deepEqual(reruns[0].history.map((m) => m.role), ["user", "assistant"], "the redo sees the first attempt (minus the system prompt)");
  assert.match(reruns[0].input, /Use console\.log/);
  assert.equal(result.text, "Corrigido: agora imprime 42.");
  assert.deepEqual(result.steps.map((s) => [s.tool, !!s.redo]), [["write_file", false], ["edit_file", true], ["run_command", true]]);
  const memories = await store.listMemories({});
  const lesson = memories.find((m) => m.id === review.lessonIds[0]);
  assert.match(lesson.source, /Lição de Codex/);
  assert.deepEqual(lesson.stats, { uses: 1, helped: 1, failed: 0 });
  assert.deepEqual(memories.find((m) => m.id === old.id).stats, { uses: 1, helped: 0, failed: 1 });
  assert.equal((await teacherSettings()).usedToday, 1);
});

test("verdict ok credits the memories; plain turns, 'off', teacher failures and the daily limit never block the delivery", async () => {
  const conversation = await store.createConversation({ provider: "local" });
  const mem = await store.createMemory({ scope: "global", title: "Boa", content: "Uma lição que funciona bem para arquivos.", kind: "extracted", env: { EMBEDDINGS_ENABLED: "false" } });
  const first = { ok: true, text: "Pronto", steps: [step("write_file")], calls: [], messages: [] };
  const noRerun = async () => { throw new Error("não devia refazer"); };
  const ok = await runTeachingLoop({ userMessage: "x", history: [], first, teacherProvider: "codex", conversation, memoryIds: [mem.id], rerun: noRerun, call: async () => ({ ok: true, text: '{"verdict":"ok"}' }) });
  assert.equal(ok.review.verdict, "ok");
  assert.equal(ok.result, first);
  assert.equal((await store.listMemories({})).find((m) => m.id === mem.id).stats.helped, 1);

  const plain = await runTeachingLoop({ userMessage: "oi", history: [], first: { ...first, steps: [] }, teacherProvider: "codex", conversation, rerun: noRerun, call: async () => { throw new Error("não devia chamar"); } });
  assert.equal(plain.review, null);

  const failing = await runTeachingLoop({ userMessage: "x", history: [], first, teacherProvider: "codex", conversation, rerun: noRerun, call: async () => ({ ok: false, error: "Codex CLI não encontrado." }) });
  assert.equal(failing.result, first);
  assert.match(failing.review.error, /não encontrado/);

  await store.setSetting("teacher_mode", "off");
  assert.equal((await runTeachingLoop({ userMessage: "não funcionou", history: [], first, teacherProvider: "codex", conversation, rerun: noRerun, call: async () => { throw new Error("off"); } })).review, null);
  await store.setSetting("teacher_mode", "actions");
  await store.setSetting("teacher_daily_limit", "0");
  const limited = await runTeachingLoop({ userMessage: "x", history: [], first, teacherProvider: "codex", conversation, rerun: noRerun, call: async () => { throw new Error("limite"); } });
  assert.equal(limited.review.skipped, "daily_limit");
  await store.setSetting("teacher_daily_limit", "30");
});

test("a lesson that keeps failing without ever helping is archived and leaves the context", async () => {
  const env = { EMBEDDINGS_ENABLED: "false", LOCAL_BASE_URL: "http://127.0.0.1:1" };
  const bad = await store.createMemory({ scope: "global", title: "Planilha exportar", content: "Para exportar planilha use o formato errado xyz.", kind: "extracted", env });
  assert.ok((await store.selectRelevantMemories("exportar planilha", {}, 12, env)).some((m) => m.id === bad.id));
  for (let i = 0; i < 3; i += 1) await store.recordMemoryOutcome([bad.id], "failed");
  const after = (await store.listMemories({})).find((m) => m.id === bad.id);
  assert.equal(after.status, "archived");
  assert.equal((await store.selectRelevantMemories("exportar planilha", {}, 12, env)).some((m) => m.id === bad.id), false);
  const manual = await store.createMemory({ scope: "global", title: "Minha regra", content: "Sempre exportar planilha em PDF.", kind: "manual", env });
  for (let i = 0; i < 5; i += 1) await store.recordMemoryOutcome([manual.id], "failed");
  assert.equal((await store.listMemories({})).find((m) => m.id === manual.id).status, "active", "memories written by the user are never archived automatically");
});

test("end to end: local agent writes a file, the teacher (CLI) reviews in the project folder, the local model fixes it", async () => {
  const { handleChatTurn } = await import("../app/server.js");
  const workspace = join(temp, "calc");
  mkdirSync(workspace, { recursive: true });
  const project = await store.createProject({ name: "Calc", workspaceDir: workspace });
  const conversation = await store.createConversation({ provider: "local", projectId: project.id, teacherProvider: "codex" });
  let round = 0;
  const bodies = [];
  const stub = http.createServer(async (req, res) => {
    if (req.url !== "/api/chat") { res.writeHead(404); return res.end(); }
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); bodies.push(body);
    res.setHeader("content-type", "application/json");
    const call = (name, args) => ({ message: { role: "assistant", content: "", tool_calls: [{ function: { name, arguments: args } }] }, prompt_eval_count: 10, eval_count: 5 });
    const say = (content) => ({ message: { role: "assistant", content }, prompt_eval_count: 10, eval_count: 5 });
    round += 1;
    res.end(JSON.stringify([
      call("write_file", { path: "soma.js", content: "const r = 7 + 35;" }),
      say("Pronto, criei soma.js."),
      call("write_file", { path: "soma.js", content: "const r = 7 + 35;\nconsole.log(r);" }),
      say("Corrigi: agora soma.js imprime 42."),
    ][round - 1] || say("fim")));
  });
  await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const log = join(temp, "reviews.log");
  try {
    const result = await handleChatTurn({ conversationId: conversation.id, message: "crie soma.js que imprime 7+35", env: { ...process.env, LOCAL_BASE_URL: `http://127.0.0.1:${stub.address().port}`, LOCAL_MODEL: "qwen3.5:4b", CODEX_BIN: fakeCli, FAKE_REVIEW_LOG: log } });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.message.content, "Corrigi: agora soma.js imprime 42.");
    assert.equal(readFileSync(join(workspace, "soma.js"), "utf8"), "const r = 7 + 35;\nconsole.log(r);");
    const review = result.message.execution.review;
    assert.deepEqual([review.reason, review.verdict, review.redo, review.teacher], ["actions", "fix", "ok", "codex"]);
    assert.deepEqual(result.message.execution.toolSteps.map((s) => [s.tool, !!s.redo]), [["write_file", false], ["write_file", true]]);
    const reviewCall = JSON.parse(readFileSync(log, "utf8").trim().split("\n")[0]);
    assert.equal(reviewCall.cwd.toLowerCase(), workspace.toLowerCase(), "the teacher runs inside the project folder to check the files");
    assert.match(reviewCall.prompt, /write_file \{"path":"soma\.js"/);
    const redoRequest = bodies[2].messages;
    assert.match(redoRequest.at(-1).content, /Adicione console\.log\(resultado\)/);
    assert.ok(redoRequest.some((m) => m.role === "tool" && /Salvei/.test(m.content)), "the redo sees its own first attempt");
    const lesson = (await store.listMemories({ scope: "project", projectId: project.id })).find((m) => /rode-o e confira/.test(m.content));
    assert.ok(lesson, "the teacher's lesson became a project memory");
  } finally {
    await new Promise((resolve) => stub.close(resolve));
  }
});
