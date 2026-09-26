// One-off: re-validate every saved model-training run (v1 and v2) with the
// CURRENT validateArtifact/functionalTests.js (fixed since — see the
// innerText/inputValue bug fix earlier this project) against the exact
// artifact + contract already saved on disk. No model calls, no cost — this
// only answers "would the old verdict have been different with today's
// evaluator", using the frozen evidence from those experiments.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateArtifact } from "../../app/workflowValidation.js";

async function revalidateDir(dir, label) {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  const flips = [];
  let total = 0, oldPassed = 0, newPassed = 0;
  for (const file of files) {
    const raw = JSON.parse(await readFile(join(dir, file), "utf8"));
    const step = raw.workflow?.steps?.[0];
    if (!step?.artifact || !step?.tests) continue;
    total++;
    const oldStatus = step.validation?.status === "passed";
    const fresh = await validateArtifact(step.artifact, step.format, { contract: step.tests });
    const newStatus = fresh.status === "passed";
    if (oldStatus) oldPassed++;
    if (newStatus) newPassed++;
    if (oldStatus !== newStatus) {
      flips.push({ file, arm: raw.arm, id: raw.id, seed: raw.seed, oldStatus, newStatus, oldEvidence: step.validation?.evidence, newEvidence: fresh.evidence });
    }
  }
  return { label, dir, total, oldPassed, newPassed, flips };
}

const results = [
  await revalidateDir("reports/model-training-v1/runs", "v1"),
  await revalidateDir("reports/model-training-v2/final/runs", "v2-final"),
  await revalidateDir("reports/model-training-v2/dev/runs", "v2-dev"),
];

for (const r of results) {
  console.log(`\n=== ${r.label} (${r.dir}) ===`);
  console.log(`total=${r.total} oldPassed=${r.oldPassed} newPassed=${r.newPassed} flips=${r.flips.length}`);
  for (const f of r.flips) {
    console.log(`  FLIP ${f.file}: arm=${f.arm} id=${f.id} seed=${f.seed} ${f.oldStatus}->${f.newStatus}`);
  }
}

await writeFile(
  "reports/lora-revalidation-2026-09-25.json",
  JSON.stringify(results.map((r) => ({ label: r.label, total: r.total, oldPassed: r.oldPassed, newPassed: r.newPassed, flips: r.flips })), null, 2),
);
console.log("\nWrote reports/lora-revalidation-2026-09-25.json");
