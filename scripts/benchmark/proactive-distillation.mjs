// Proactive distillation: instead of waiting for the user to hit a real
// error and click "Revisar", run a batch of known tasks against the local
// model, and for every one it fails, ask the teacher (Codex/Claude) to
// correct it — same app/correction.js mechanism the real "Revisar" button
// uses, just applied to a whole batch up front instead of one at a time as
// errors happen live.
//
// Default is --dry-run: shows exactly how many teacher calls a real run
// would make (a real cost, since Codex/Claude are paid) without spending
// anything. Pass --live <codex|claude> to actually call the teacher and
// save the resulting memories into a dedicated, reviewable project.
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { engineTasks } from "./engine-tasks.mjs";

const live = process.argv.includes("--live");
const teacherProvider = ["codex", "claude"].includes(process.argv[process.argv.indexOf("--live") + 1])
  ? process.argv[process.argv.indexOf("--live") + 1]
  : "codex";

const id = process.env.DISTILL_ID || `proactive-distillation-${new Date().toISOString().slice(0, 10)}`;
const out = resolve("reports", id);
await mkdir(join(out, "runs"), { recursive: true });
await mkdir(resolve("app/data/benchmarks", id), { recursive: true });

process.env.HARNESS_DB_FILE = resolve("app/data/benchmarks", id, "distill.db");
process.env.LOCAL_TEMPERATURE = "0.2";
process.env.LOCAL_TIMEOUT_MS = "120000";
process.env.EMBEDDINGS_ENABLED = "false";
process.env.HARNESS_EVIDENCE_ENGINE = "false";

const { createConversation, createProject, createMemory } = await import("../../app/store.js");
const { createWorkflow, runWorkflow } = await import("../../app/workflows.js");
const { runLocal } = await import("../../app/local.js");
const { correctLocalAnswer } = await import("../../app/correction.js");

const budget = { maxCalls: 4, maxTokens: 22000, maxAttempts: 2, maxInputChars: 12000, maxOutputTokens: 1536, maxDurationMs: 180000 };
const project = await createProject({ name: `Destilação proativa ${id}` });

const summary = { id, live, teacherProvider: live ? teacherProvider : null, model: process.env.LOCAL_MODEL || "(padrão configurado)", tasks: [] };
let teacherCalls = 0;

for (const t of engineTasks) {
  const c = await createConversation({ provider: "local", projectId: project.id, title: t.id });
  let job = await createWorkflow({ conversationId: c.id, goal: t.goal, functionalContracts: [{ step: 0, contract: t.contract }], budget, knowledgeMode: "none" });
  await runWorkflow(job.id, { call: () => { throw new Error("Unexpected plan call"); } });
  job = await runWorkflow(job.id, { call: (prompt, settings, signal) => runLocal(prompt, settings, signal) });
  const passed = job.steps[0]?.validation?.status === "passed";
  const entry = { id: t.id, domain: t.domain, locallyPassed: passed };

  if (!passed) {
    entry.evidence = job.steps[0]?.validation?.evidence;
    if (!live) {
      entry.wouldCallTeacher = true;
    } else {
      teacherCalls++;
      const correction = await correctLocalAnswer({
        question: t.goal,
        wrongAnswer: job.steps[0].artifact,
        note: (job.steps[0].validation?.evidence || []).join(" "),
        teacherProvider,
      });
      entry.teacherOk = correction.ok;
      if (correction.ok) {
        entry.memoriesSaved = [];
        for (const m of correction.memories) {
          const saved = await createMemory({
            scope: "project", projectId: project.id, title: m.title, content: m.content, tags: [...m.tags, "destilacao-proativa"],
            kind: "extracted", source: `Destilação proativa — professor ${teacherProvider} corrigindo ${t.id}`,
          });
          entry.memoriesSaved.push(saved.id);
        }
        if (correction.template) {
          const saved = await createMemory({
            scope: "project", projectId: project.id, title: correction.template.title, content: correction.template.content,
            tags: [...correction.template.tags, "destilacao-proativa", "template"], kind: "extracted",
            source: `Destilação proativa — esqueleto do professor ${teacherProvider} para ${t.id}`,
          });
          entry.memoriesSaved.push(saved.id);
        }
      } else {
        entry.teacherError = correction.error;
      }
    }
  }
  summary.tasks.push(entry);
  await writeFile(join(out, "runs", `${t.id}.json`), JSON.stringify({ entry, job }, null, 2));
  console.log(JSON.stringify(entry));
}

const failedLocally = summary.tasks.filter((t) => !t.locallyPassed).length;
summary.failedLocally = failedLocally;
summary.teacherCallsMade = teacherCalls;
await writeFile(join(out, "summary.json"), JSON.stringify(summary, null, 2));

console.log(`\n${failedLocally}/${engineTasks.length} falharam localmente.`);
if (!live) {
  console.log(`DRY RUN — nenhuma chamada ao professor foi feita. Uma rodada --live gastaria até ${failedLocally} chamada(s) ao ${teacherProvider === "claude" ? "Claude" : "Codex"}.`);
} else {
  console.log(`${teacherCalls} chamada(s) reais ao professor (${teacherProvider}) feitas. Memórias salvas no projeto "${project.name}" para revisão antes de virarem globais.`);
}
