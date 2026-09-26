// Teste de fechamento reutilizável para uma rodada de destilação proativa:
// reexecuta as tarefas que falharam localmente com knowledgeMode:'memory'
// (memórias do projeto criado por proactive-distillation.mjs) e mede quantas
// passam a funcionar. Sem chamada nova ao professor -- só modelo local.
import { engineTasks } from "./engine-tasks.mjs";

const distillId = process.argv[2];
if (!distillId) throw new Error("Usage: distillation-closure-check.mjs <DISTILL_ID>");

process.env.HARNESS_DB_FILE = new URL(`../../app/data/benchmarks/${distillId}/distill.db`, import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:");
process.env.LOCAL_TEMPERATURE = "0.2";
process.env.LOCAL_TIMEOUT_MS = "120000";
process.env.EMBEDDINGS_ENABLED = "false";
process.env.HARNESS_EVIDENCE_ENGINE = "false";

const { listProjects, createConversation } = await import("../../app/store.js");
const { createWorkflow, runWorkflow } = await import("../../app/workflows.js");
const { runLocal } = await import("../../app/local.js");

const projects = await listProjects();
const project = projects.find((p) => p.name === `Destilação proativa ${distillId}`);
if (!project) throw new Error("Project not found for " + distillId);

const failedIds = JSON.parse(process.argv[3] || "[]");
const budget = { maxCalls: 4, maxTokens: 22000, maxAttempts: 2, maxInputChars: 12000, maxOutputTokens: 1536, maxDurationMs: 180000 };
const results = [];
for (const t of engineTasks.filter((t) => failedIds.includes(t.id))) {
  const c = await createConversation({ provider: "local", projectId: project.id, title: "closure-" + t.id });
  let job = await createWorkflow({ conversationId: c.id, goal: t.goal, functionalContracts: [{ step: 0, contract: t.contract }], budget, knowledgeMode: "memory" });
  await runWorkflow(job.id, { call: () => { throw new Error("Unexpected plan call"); } });
  job = await runWorkflow(job.id, { call: (prompt, settings, signal) => runLocal(prompt, settings, signal) });
  const passed = job.steps[0]?.validation?.status === "passed";
  results.push({ id: t.id, passedWithMemory: passed });
  console.log(JSON.stringify({ id: t.id, passedWithMemory: passed }));
}
console.log(`\n${results.filter((r) => r.passedWithMemory).length}/${results.length} recuperadas com memória.`);
