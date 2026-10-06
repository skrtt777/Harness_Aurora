import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "aurora-scheduler-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
const { DAILY_LIMIT, newFilesFor, patternTest, scheduleDue, schedulerTick } = await import("../app/agentScheduler.js");

// Monday 05/10/2026 08:30 local time.
const at = (h, m, day = 5) => new Date(2026, 9, day, h, m);

test("'at HH:MM on weekdays' runs once a day from that time on", () => {
  const trigger = { type: "schedule", at: "08:00", weekdays: [1, 2, 3, 4, 5] };
  assert.equal(scheduleDue(trigger, null, at(7, 59)), false, "before the time");
  assert.equal(scheduleDue(trigger, null, at(8, 30)), true);
  assert.equal(scheduleDue(trigger, at(8, 0, 5).toISOString(), at(9, 0)), false, "already ran today");
  assert.equal(scheduleDue(trigger, at(8, 0, 2).toISOString(), at(8, 1)), true, "last run was Friday");
  assert.equal(scheduleDue(trigger, null, at(9, 0, 4)), false, "Sunday is not a weekday here");
});

test("'every N minutes' waits N minutes since the last scheduled run", () => {
  const trigger = { type: "schedule", everyMinutes: 30 };
  assert.equal(scheduleDue(trigger, null, at(8, 0)), true);
  assert.equal(scheduleDue(trigger, at(8, 0).toISOString(), at(8, 29)), false);
  assert.equal(scheduleDue(trigger, at(8, 0).toISOString(), at(8, 30)), true);
  assert.equal(scheduleDue({ type: "manual" }, null, at(8, 0)), false);
});

test("file patterns", () => {
  const pdf = patternTest("*.pdf; nota*");
  assert.equal(pdf("Fatura Outubro.PDF"), true);
  assert.equal(pdf("nota fiscal 12.xml"), true);
  assert.equal(pdf("planilha.xlsx"), false);
  assert.equal(patternTest("*")("x"), true);
});

test("a watched folder ignores its backlog and fires on files that arrive (or are saved again)", async () => {
  const folder = mkdtempSync(join(temp, "entrada-"));
  writeFileSync(join(folder, "antigo.pdf"), "x");
  const agent = { id: "agent-files", trigger: { type: "file", folder, pattern: "*.pdf" } };
  assert.deepEqual(await newFilesFor(agent), [], "the first look only records what is there");
  assert.deepEqual(await newFilesFor(agent), []);
  writeFileSync(join(folder, "novo.pdf"), "y");
  writeFileSync(join(folder, "ignorado.txt"), "z");
  assert.deepEqual(await newFilesFor(agent), [join(folder, "novo.pdf")]);
  assert.deepEqual(await newFilesFor(agent), [], "fires once");
  utimesSync(join(folder, "antigo.pdf"), new Date(), new Date(Date.now() + 60_000));
  assert.deepEqual(await newFilesFor(agent), [join(folder, "antigo.pdf")], "saved again");

  const empty = { id: "agent-empty", trigger: { type: "file", folder: mkdtempSync(join(temp, "vazia-")), pattern: "*" } };
  assert.deepEqual(await newFilesFor(empty), []);
  writeFileSync(join(empty.trigger.folder, "primeiro.csv"), "a");
  assert.deepEqual(await newFilesFor(empty), [join(empty.trigger.folder, "primeiro.csv")], "an empty folder has no backlog");
});

test("a tick starts due agents only: enabled, not running, under the daily limit", async () => {
  const agents = [
    { id: "a", name: "A", enabled: true, mission: "m", trigger: { type: "schedule", everyMinutes: 30, request: "relatório" } },
    { id: "b", name: "B", enabled: false, mission: "m", trigger: { type: "schedule", everyMinutes: 30 } },
    { id: "c", name: "C", enabled: true, mission: "missão C", trigger: { type: "schedule", everyMinutes: 30 } },
    { id: "d", name: "D", enabled: true, mission: "m", trigger: { type: "schedule", everyMinutes: 30 } },
    { id: "e", name: "E", enabled: true, mission: "m", trigger: { type: "manual" } },
  ];
  const runs = [];
  const started = await schedulerTick({
    listAgents: async () => agents,
    runAgent: async (id, opts) => { runs.push([id, opts.request, opts.trigger]); return { status: "done" }; },
    isAgentRunning: (id) => id === "d",
    lastRunStart: async () => null,
    runsToday: async (id) => (id === "c" ? DAILY_LIMIT : 0),
    now: () => at(8, 0),
  });
  assert.deepEqual(started, ["a"]);
  assert.deepEqual(runs, [["a", "relatório", "schedule"]]);
});

test("a quiet check that finds nothing is recorded silently; one that finds something notifies", async () => {
  const sched = await import("../app/agentScheduler.js");
  const agent = { id: "vigia", enabled: true, mission: "Vigiar", trigger: { type: "schedule", everyMinutes: 30, quiet: true, request: "Veja se chegou boleto novo." } };
  for (const [answer, notified] of [["OK", false], ["**OK.**", false], ["Chegou o boleto da luz: R$ 230, vence dia 10.", true]]) {
    const seen = [], quiet = [];
    const stop = sched.onAutomaticRun((a, run) => seen.push(run.id));
    let request = "";
    await sched.schedulerTick({ listAgents: async () => [agent], isAgentRunning: () => false, lastRunStart: async () => null, runsToday: async () => 0, markQuiet: async (id) => quiet.push(id),
      runAgent: async (id, opts) => { request = opts.request; return { id: "r1", status: "done", answer }; } });
    await new Promise((r) => setTimeout(r, 10));
    stop();
    assert.match(request, /responda apenas OK/, "the agent is told how to say 'nothing new'");
    assert.equal(seen.length, notified ? 1 : 0, answer);
    assert.equal(quiet.length, notified ? 0 : 1, answer);
  }
  assert.equal(sched.nothingNew("OK, nada novo"), true);
  assert.equal(sched.nothingNew("Ok, encontrei 3 boletos novos que vencem esta semana e criei a planilha."), false, "a long answer that starts with ok is news");
});

test("a quiet check is told what it already announced today, and quiet runs don't count toward the daily limit", async () => {
  const sched = await import("../app/agentScheduler.js");
  const agents = await import("../app/agents.js");
  const agent = await agents.createAgent({ name: "Vigia", mission: "Vigiar boletos", workDir: join(temp, "vigia"), trigger: { type: "schedule", everyMinutes: 30, quiet: true, request: "Veja se chegou boleto." } });
  const fake = (answer) => async ({ conversationId }) => ({ ok: true, message: { conversationId, content: answer, execution: { toolSteps: [] } } });
  const quietRun = await agents.runAgent(agent.id, { request: "x", trigger: "schedule", handleChatTurn: fake("OK") });
  await agents.markRunQuiet(quietRun.id);
  await agents.runAgent(agent.id, { request: "x", trigger: "schedule", handleChatTurn: fake("Chegou o boleto da luz, vence dia 10.") });
  const stats = await sched.runStats();
  assert.equal(await stats.runsToday(agent.id), 1, "the quiet run is not counted");
  assert.deepEqual(await stats.announcedToday(agent.id), ["Chegou o boleto da luz, vence dia 10."]);
  let request = "";
  await sched.schedulerTick({ listAgents: async () => [await agents.getAgent(agent.id)], isAgentRunning: () => false, lastRunStart: async () => null, runsToday: async () => 0, announcedToday: stats.announcedToday,
    runAgent: async (id, opts) => { request = opts.request; return { id: "r", status: "done", answer: "OK" }; } });
  assert.match(request, /já avisou hoje[\s\S]*boleto da luz/);
});

test("an answer that only names files already announced today is not news", async () => {
  const { repeatsOnly } = await import("../app/agentScheduler.js");
  const told = ["Chegou o **boleto_energia_outubro.pdf** em Downloads."];
  assert.equal(repeatsOnly("Boletos: boleto_energia_outubro.pdf — Downloads.", told), true);
  assert.equal(repeatsOnly("Chegaram boleto_energia_outubro.pdf e nota_fiscal_123.pdf.", told), false, "a new file is news");
  assert.equal(repeatsOnly("O condomínio subiu 10%.", told), false, "no file named: not judged");
});

test("an agent created without a folder gets one of its own under Documentos\Aurora\Agentes", async () => {
  const agents = await import("../app/agents.js");
  const { mkdtempSync: mk } = await import("node:fs");
  const home = mk(join(tmpdir(), "aurora-home-"));
  const dir = agents.defaultAgentFolder("Resumo: da manhã?", { USERPROFILE: home });
  assert.match(dir, /Aurora[\\/]Agentes[\\/]Resumo da manhã$/);
});
