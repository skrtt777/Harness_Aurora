// How right the Aurora is inside the code editor, measured by running what she writes: each Ctrl+I case
// (scripts/code-bench-cases.mjs) goes the way the extension sends it (the selection widened to whole
// blocks, before/after, app/codeAssist.js editCode) and each gray suggestion the way the editor asks
// (completeCode); the file that results is run with its check (node / python / tsc). The local model as
// the Harness uses it (its llama-server on a test port); a temporary database.
//   node scripts/code-bench.mjs [--so edits|completions] [--casos id,id] [--vezes 2] [--json saida.json]
import "./evalSandbox.mjs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
// --casos-arquivo holdout: the held-out cases (code-bench-holdout.mjs), never used to tune the pipeline.
const { EDITS, COMPLETIONS } = await import(arg("casos-arquivo") === "holdout" ? "./code-bench-holdout.mjs" : "./code-bench-cases.mjs");
process.env.HARNESS_DB_FILE = join(mkdtempSync(join(tmpdir(), "aurora-code-bench-")), "harness.db");
process.env.LLAMA_SERVER_PORT ||= "18193";
const require = createRequire(import.meta.url);
const { widenToBlock } = require("../vscode/aurora/lib/blocks.js");
const { completeCode, editCode } = await import("../app/codeAssist.js");
const { resolveLocalModel } = await import("../app/ollamaSetup.js");
const { ensureLlamaServer, stopLlamaServer } = await import("../app/llamaServer.js");
const ts = require("../frontend/node_modules/typescript/lib/typescript.js");

const only = arg("so", "");
const ids = arg("casos", "") ? new Set(arg("casos").split(",")) : null;
const times = Number(arg("vezes", 1));
const model = await resolveLocalModel();
const server = await ensureLlamaServer({ model, contextTokens: 16384 }).catch(() => null);
// The code model of the gray suggestion (app/codeModel.js), when AURORA_CODE_MODEL points to it.
const { ensureCodeServer, stopCodeServer, codeModelPath } = await import("../app/codeModel.js");
const codeServer = codeModelPath() ? await ensureCodeServer().catch(() => null) : null;
console.log(`modelo ${model} · ${server ? `llama-server ${server}` : "Ollama"} · autocompletar: ${codeServer ? codeModelPath() : "modelo do chat"}`);
const work = mkdtempSync(join(tmpdir(), "aurora-code-bench-files-"));
// --pensar: Ctrl+I with the model's thinking on (the same llama-server), to weigh quality against time.
const think = process.argv.includes("--pensar");
async function thinking(prompt, env, signal) {
  const started = Date.now();
  try {
    const r = await fetch(`${server}/v1/chat/completions`, { method: "POST", signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: prompt }], max_tokens: Number(arg("tokens", 6000)), temperature: 0.3, cache_prompt: true, chat_template_kwargs: { enable_thinking: true } }) });
    const d = await r.json();
    const msg = d.choices?.[0]?.message || {};
    return { ok: true, text: String(msg.content || "").replace(/<think>[\s\S]*?<\/think>/g, ""), metrics: { wallMs: Date.now() - started, model } };
  } catch (e) { return { ok: false, error: e.message }; }
}

/** Runs the check of a case against the file: { ok, why }. */
function check(c, file, text) {
  try {
    if (c.check === "TS") {
      const out = ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: { strict: true } });
      const program = ts.createProgram([file], { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, skipLibCheck: true, types: [] });
      const diags = ts.getPreEmitDiagnostics(program).filter((d) => d.category === ts.DiagnosticCategory.Error);
      void out;
      return diags.length ? { ok: false, why: ts.flattenDiagnosticMessageText(diags[0].messageText, " ") } : { ok: true };
    }
    if (String(c.check).startsWith("TS:")) {
      const js = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
      const jsFile = file.replace(/\.ts$/, ".cjs");
      writeFileSync(jsFile, js);
      execFileSync(process.execPath, ["-e", `const m = require(${JSON.stringify(jsFile)}); with (m) { if (!(${c.check.slice(3)})) { console.error('falso'); process.exit(1); } }`], { stdio: "pipe", timeout: 20000 });
      return { ok: true };
    }
    if (c.lang === "python") {
      const script = `import importlib.util, sys\nFILE = ${JSON.stringify(file)}\nspec = importlib.util.spec_from_file_location('m', FILE)\nm = importlib.util.module_from_spec(spec)\nspec.loader.exec_module(m)\n${c.check}\n`;
      execFileSync("python", ["-c", script], { stdio: "pipe", timeout: 20000, cwd: work });
      return { ok: true };
    }
    const script = `const assert = require('node:assert/strict'); const FILE = ${JSON.stringify(file)}; const m = require(FILE); Promise.resolve((() => { ${c.check} })()).catch((e) => { console.error(e.message); process.exit(1); });`;
    execFileSync(process.execPath, ["-e", script], { stdio: "pipe", timeout: 20000, cwd: work });
    return { ok: true };
  } catch (e) { return { ok: false, why: String(e.stderr || e.message).replace(/\s+/g, " ").trim().slice(-220) }; }
}

const results = [];
async function runEdit(c, round) {
  const lines = c.code.split("\n");
  const hasSel = c.sel[1] > c.sel[0];
  const [s, e] = hasSel ? widenToBlock(lines, c.sel[0], c.sel[1], { language: c.lang }) : [c.cursor, c.cursor];
  const started = Date.now();
  let r;
  try {
    r = await editCode({ instruction: c.ask, selection: hasSel ? lines.slice(s, e).join("\n") : "", before: lines.slice(0, s).join("\n") + (s ? "\n" : ""), after: lines.slice(e).join("\n"), language: c.lang, file: c.file }, think ? { run: thinking } : {});
  } catch (error) { return { kind: "edit", id: c.id, round, ok: false, why: `erro: ${error.message}`, ms: Date.now() - started }; }
  const text = [...lines.slice(0, s), ...r.code.split("\n"), ...lines.slice(e)].join("\n");
  const file = join(work, `${round}-${c.file}`);
  writeFileSync(file, text);
  return { kind: "edit", id: c.id, round, ms: Date.now() - started, ...check(c, file, text), text };
}
async function runCompletion(c, round) {
  const started = Date.now();
  let r;
  try { r = await completeCode({ prefix: c.prefix, suffix: c.suffix, language: c.lang, file: c.file }); } catch (error) { return { kind: "complete", id: c.id, round, ok: false, why: `erro: ${error.message}`, ms: Date.now() - started }; }
  const text = c.prefix + r.text + c.suffix;
  const file = join(work, `${round}-${c.file}`);
  writeFileSync(file, text);
  const res = r.text ? check(c, file, text) : { ok: false, why: "sem sugestão" };
  return { kind: "complete", id: c.id, round, ms: Date.now() - started, ...res, suggestion: r.text };
}

for (let round = 1; round <= times; round += 1) {
  if (only !== "completions") for (const c of EDITS) if (!ids || ids.has(c.id)) results.push(await runEdit(c, round));
  if (only !== "edits") for (const c of COMPLETIONS) if (!ids || ids.has(c.id)) results.push(await runCompletion(c, round));
}
stopLlamaServer(); stopCodeServer();

const sum = (kind) => { const r = results.filter((x) => x.kind === kind); return { ok: r.filter((x) => x.ok).length, n: r.length, ms: r.map((x) => x.ms).sort((a, b) => a - b)[Math.floor(r.length / 2)] || 0 }; };
const ed = sum("edit"), co = sum("complete");
for (const r of results.filter((x) => !x.ok)) console.log(`✗ ${r.kind} ${r.id}${times > 1 ? ` (#${r.round})` : ""}: ${r.why}${r.suggestion !== undefined ? ` · sugestão ${JSON.stringify(r.suggestion).slice(0, 120)}` : ""}`);
if (ed.n) console.log(`\nCtrl+I: ${ed.ok}/${ed.n} (${Math.round((100 * ed.ok) / ed.n)}%) · mediana ${ed.ms} ms`);
if (co.n) console.log(`Autocompletar: ${co.ok}/${co.n} (${Math.round((100 * co.ok) / co.n)}%) · mediana ${co.ms} ms`);
const all = results.filter((x) => x.ok).length;
console.log(`Total: ${all}/${results.length} (${((100 * all) / results.length).toFixed(1)}%) · arquivos em ${work}`);
if (arg("json")) writeFileSync(arg("json"), JSON.stringify(results, null, 1));
process.exit(0);
