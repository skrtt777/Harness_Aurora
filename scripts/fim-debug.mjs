// One gray-suggestion case of scripts/code-bench-cases.mjs, step by step: what the model wrote on each
// try, what cleanCompletion kept and what the syntax check said. node scripts/fim-debug.mjs js-max,py-pares
import "./evalSandbox.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { COMPLETIONS } = await import(process.env.CASOS === "holdout2" ? "./code-bench-holdout2.mjs" : process.env.CASOS === "holdout3" ? "./code-bench-holdout3.mjs" : "./code-bench-cases.mjs");

process.env.HARNESS_DB_FILE = join(mkdtempSync(join(tmpdir(), "aurora-fim-debug-")), "harness.db");
process.env.LLAMA_SERVER_PORT ||= "18193";
const { completeCode, syntaxProblem } = await import("../app/codeAssist.js");
const { resolveLocalModel } = await import("../app/ollamaSetup.js");
const { ensureLlamaServer, stopLlamaServer } = await import("../app/llamaServer.js");
const model = await resolveLocalModel();
// The model the suggestion uses (the profile's code model when there is one), as in scripts/code-bench.mjs.
const { modelFor, ensureCodeServer, stopCodeServer } = await import("../app/codeModel.js");
const server = (await modelFor("fim")) ? await ensureCodeServer({ role: "fim" }) : await ensureLlamaServer({ model, contextTokens: 16384 });
process.on("exit", () => stopCodeServer());
console.log(`gerando em ${server}`);
for (const id of (process.argv[2] || "").split(",")) {
  const c = COMPLETIONS.find((x) => x.id === id);
  if (!c) continue;
  console.log(`\n=== ${id}`);
  const generate = async (prompt, o) => {
    const r = await fetch(`${server}/completion`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, n_predict: o.maxTokens, stop: o.stop, temperature: o.temperature, cache_prompt: true }) }).then((x) => x.json());
    console.log(`  cru (t=${o.temperature}): ${JSON.stringify(r.content)} ${r.stop_type || ""}`);
    return { text: r.content, truncated: r.stop_type === "limit", engine: "llama-server", model };
  };
  const check = async (lang, text, file) => { const e = await syntaxProblem(lang, text, file); console.log(`  checagem: ${e ? `${e.message} (linha ${e.line})` : "ok"}`); return e; };
  const r = await completeCode({ prefix: c.prefix, suffix: c.suffix, language: c.lang, file: c.file }, { generate, check });
  console.log(`  final: ${JSON.stringify(r.text)}`);
}
stopLlamaServer();
process.exit(0);
