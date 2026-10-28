// One Ctrl+I case of scripts/code-bench-cases.mjs, step by step: the selection as the extension widens it,
// what the model answered on each try and what cleanEdit kept. node scripts/edit-debug.mjs js-for-para-reduce
import "./evalSandbox.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { EDITS } from "./code-bench-cases.mjs";

process.env.HARNESS_DB_FILE = join(mkdtempSync(join(tmpdir(), "aurora-edit-debug-")), "harness.db");
process.env.LLAMA_SERVER_PORT ||= "18193";
const require = createRequire(import.meta.url);
const { widenToBlock } = require("../vscode/aurora/lib/blocks.js");
const { editCode, editPrompt } = await import("../app/codeAssist.js");
const { runLocal } = await import("../app/local.js");
const { resolveLocalModel } = await import("../app/ollamaSetup.js");
const { ensureLlamaServer, stopLlamaServer } = await import("../app/llamaServer.js");
await ensureLlamaServer({ model: await resolveLocalModel(), contextTokens: 16384 });
for (const id of (process.argv[2] || "").split(",")) {
  const c = EDITS.find((x) => x.id === id);
  if (!c) continue;
  const lines = c.code.split("\n");
  const hasSel = c.sel[1] > c.sel[0];
  const [s, e] = hasSel ? widenToBlock(lines, c.sel[0], c.sel[1], { language: c.lang }) : [c.cursor, c.cursor];
  const input = { instruction: c.ask, selection: hasSel ? lines.slice(s, e).join("\n") : "", before: lines.slice(0, s).join("\n") + (s ? "\n" : ""), after: lines.slice(e).join("\n"), language: c.lang, file: c.file };
  console.log(`\n=== ${id} (linhas ${s}-${e})${process.argv.includes("--prompt") ? `\n${editPrompt(input)}` : ""}`);
  const run = async (prompt, env, signal) => { const r = await runLocal(prompt, env, signal); console.log(`--- resposta crua:\n${r.text}`); return r; };
  const r = await editCode(input, { run });
  console.log(`--- final (${r.attempts} tentativa(s)${r.problem ? `, problema: ${r.problem}` : ""}):\n${r.code}`);
}
stopLlamaServer();
process.exit(0);
