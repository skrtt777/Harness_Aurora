// A/B test: does the candidate KERNEL.md (kernel-candidate.mjs) beat the
// current one on engine-tasks.mjs's 12 frozen tasks, running the real
// production pipeline (createWorkflow/runWorkflow -> compactContext, which
// is the only place KERNEL.md is actually injected into a local-model
// prompt — see app/economy.js). knowledgeMode is fixed to 'none' in both
// arms so memory/skills selection can't confound the KERNEL variable being
// tested.
//
// Usage: node scripts/benchmark/kernel-ab.mjs <baseline|candidate>
// Each arm is its own process invocation (not a single script looping both)
// so economy.js's top-level readFileSync of KERNEL.md — cached per ESM
// module instance — always reflects the arm actually being measured,
// without relying on cache-busting import tricks. The real file is restored
// in a finally block either way, so a crash mid-run can't leave the repo
// pointed at the candidate.
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { engineTasks } from "./engine-tasks.mjs";
import { CANDIDATE_KERNEL } from "./kernel-candidate.mjs";

const arm = process.argv[2];
if (!["baseline", "candidate"].includes(arm)) throw new Error("Usage: node kernel-ab.mjs <baseline|candidate>");

const kernelPath = resolve("app/runtime-policy/KERNEL.md");
const originalKernel = await readFile(kernelPath, "utf8");
if (arm === "candidate") await writeFile(kernelPath, CANDIDATE_KERNEL);

const id = process.env.KERNEL_AB_ID || "kernel-ab-2026-09-25";
const out = resolve("reports", id);
await mkdir(join(out, "runs"), { recursive: true });
await mkdir(resolve("app/data/benchmarks", id), { recursive: true });

process.env.HARNESS_DB_FILE = resolve("app/data/benchmarks", id, `${arm}.db`);
process.env.LOCAL_MODEL = process.env.KERNEL_AB_MODEL || "llama3.2:3b";
process.env.LOCAL_TEMPERATURE = "0.2";
process.env.LOCAL_TIMEOUT_MS = "120000";
process.env.EMBEDDINGS_ENABLED = "false";
process.env.HARNESS_EVIDENCE_ENGINE = "false";

try {
  const { createConversation, createProject } = await import("../../app/store.js");
  const { createWorkflow, runWorkflow } = await import("../../app/workflows.js");
  const { runLocal } = await import("../../app/local.js");

  const budget = { maxCalls: 4, maxTokens: 22000, maxAttempts: 2, maxInputChars: 12000, maxOutputTokens: 1536, maxDurationMs: 180000 };
  const seeds = [17, 41];
  const project = await createProject({ name: `Kernel A/B ${arm}` });
  const records = [];
  for (const t of engineTasks) {
    for (const seed of seeds) {
      const c = await createConversation({ provider: "local", projectId: project.id, title: `${t.id}/${seed}/${arm}` });
      const env = { ...process.env, LOCAL_SEED: String(seed) };
      let job = await createWorkflow({
        conversationId: c.id, goal: t.goal, functionalContracts: [{ step: 0, contract: t.contract }],
        budget, knowledgeMode: "none", env,
      });
      // The single-step heuristic in runWorkflow (goal explicitly says "uma
      // etapa" + names the format, which task() in engine-tasks.mjs always
      // does) resolves planning without a model call — this call should
      // never actually invoke `call`.
      await runWorkflow(job.id, { env, call: () => { throw new Error("Unexpected plan call"); } });
      const trace = [];
      job = await runWorkflow(job.id, { env, call: async (prompt, settings, signal) => { const r = await runLocal(prompt, settings, signal); trace.push({ promptChars: prompt.length }); return r; } });
      const record = {
        id: t.id, domain: t.domain, seed, arm,
        passed: job.steps[0]?.validation?.status === "passed",
        status: job.status,
        tokens: (job.stats.inputTokens || 0) + (job.stats.outputTokens || 0),
        calls: trace.length,
        elapsedMs: job.stats.elapsedMs,
      };
      records.push(record);
      await writeFile(join(out, "runs", `${t.id}-${seed}-${arm}.json`), JSON.stringify({ record, job }, null, 2));
      console.log(JSON.stringify(record));
    }
  }
  await writeFile(join(out, `${arm}-results.json`), JSON.stringify(records, null, 2));
  const passed = records.filter((r) => r.passed).length;
  console.log(`\n${arm}: ${passed}/${records.length} passed`);
} finally {
  if (arm === "candidate") await writeFile(kernelPath, originalKernel);
}
