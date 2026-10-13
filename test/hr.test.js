import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "aurora-hr-"));
process.env.HARNESS_DB_FILE = join(dir, "harness.db");
const { runPoints, scoreAgent, lessonsFrom, replacementName, hrReview, hrSnapshot, rehire } = await import("../app/hr.js");
const agents = await import("../app/agents.js");
const { getDb } = await import("../app/db.js");
const { getProject } = await import("../app/store.js");

const run = (status, extra = {}) => ({ status, request: "Cobrar atrasados", startedAt: new Date().toISOString(), checks: [], ...extra });

test("HR: the grade of a run and of an agent (recent runs weigh more)", () => {
  assert.equal(runPoints(run("done")), 100);
  assert.equal(runPoints(run("done", { review: { verdict: "fix" } })), 60);
  assert.equal(runPoints(run("done", { undoneAt: "x" })), 30);
  assert.equal(runPoints(run("failed")), 0);
  assert.equal(runPoints(run("running")), null);
  const improving = scoreAgent([run("done"), run("done"), run("failed"), run("failed")]);
  assert.equal(improving.runs, 4); assert.ok(improving.score > 50, String(improving.score)); assert.equal(improving.trend, 100);
  assert.equal(scoreAgent([]).score, null);
  const lessons = lessonsFrom([run("done", { review: { problems: ["A planilha não tinha a coluna Valor."] } }), run("failed", { error: "sem acesso à pasta" })]);
  assert.equal(lessons.length, 2); assert.match(lessons[0], /coluna Valor/);
  assert.equal(replacementName("Cobrança", new Set(["Cobrança · Bruna"])), "Cobrança · Caio");
});

// Runs written straight into the table, as the agents' runner leaves them.
async function addRuns(agentId, list, from = Date.now() - list.length * 60000) {
  const db = await getDb();
  let t = from;
  for (const r of list) {
    t += 60000;
    db.prepare("INSERT INTO agent_runs (id, agent_id, conversation_id, request, trigger, status, started_at, finished_at, review, error, checks) VALUES (?, ?, NULL, ?, 'manual', ?, ?, ?, ?, ?, '[]')")
      .run(`${agentId}-${t}-${Math.random()}`, agentId, r.request || "tarefa", r.status, new Date(t).toISOString(), new Date(t + 1000).toISOString(), r.review ? JSON.stringify(r.review) : null, r.error || null);
  }
}

test("HR: rewards the good, warns the weak with a plan, dismisses after the plan and hires a replacement (undoable)", async () => {
  const good = await agents.createAgent({ name: "Relatórios", mission: "Fazer o relatório semanal.", workDir: join(dir, "rel") });
  const weak = await agents.createAgent({ name: "Cobrança", mission: "Cobrar os clientes atrasados.", workDir: join(dir, "cob") });
  await addRuns(good.id, [{ status: "done" }, { status: "done" }, { status: "done" }, { status: "done" }]);
  await addRuns(weak.id, [{ status: "failed", error: "não achei a planilha de clientes" }, { status: "done", review: { verdict: "fix", problems: ["Faltou o valor em atraso de cada cliente."] } }, { status: "failed", error: "sem acesso à pasta" }]);

  const first = await hrReview();
  const kinds = first.decisions.map((d) => [d.agent_id, d.kind]);
  assert.deepEqual(kinds.sort(), [[good.id, "premio"], [weak.id, "advertencia"]].sort());
  // The plan went into the weak agent's instructions, and survives an edit of the agent.
  let project = await getProject(weak.projectId);
  assert.match(project.instructions, /Plano de melhoria do RH[\s\S]*valor em atraso/);
  await agents.updateAgent(weak.id, { mission: "Cobrar os clientes atrasados por e-mail." });
  project = await getProject(weak.projectId);
  assert.match(project.instructions, /por e-mail[\s\S]*Plano de melhoria do RH/);
  // A second review the same day: no new prize or warning.
  assert.equal((await hrReview()).decisions.length, 0);

  // Still failing after the plan: dismissed, and a replacement with the lessons.
  await addRuns(weak.id, [{ status: "failed", error: "falhou de novo" }, { status: "failed", error: "falhou outra vez" }], Date.now() + 1000);
  const second = await hrReview();
  assert.deepEqual(second.decisions.map((d) => d.kind), ["demissao"]);
  const all = await agents.listAgents();
  const old = all.find((a) => a.id === weak.id); const hire = all.find((a) => a.name.startsWith("Cobrança · "));
  assert.equal(old.enabled, false); assert.ok(hire?.enabled);
  assert.equal(hire.mission, old.mission);
  assert.match((await getProject(hire.projectId)).instructions, /Plano de melhoria do RH[\s\S]*valor em atraso/);
  const snap = await hrSnapshot();
  assert.deepEqual(snap.events.slice(0, 3).map((e) => e.kind).sort(), ["avaliacao", "contratacao", "demissao"]);
  assert.equal(snap.report[0].name, "Relatórios"); assert.equal(snap.report[0].stars, 1);

  // The person undoes it: the old one back, the replacement off.
  await rehire(weak.id);
  const after = await agents.listAgents();
  assert.equal(after.find((a) => a.id === weak.id).enabled, true);
  assert.equal(after.find((a) => a.id === hire.id).enabled, false);
});
