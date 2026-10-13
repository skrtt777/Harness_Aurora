// The VS Code extension's flow end to end on a test Harness (temporary database, the local model, the
// teacher off): /corrigir with a Problems entry on a broken file, the answer's changes (edited with
// the copy from before, created), then "Desfazer". node scripts/vscode-e2e.mjs
import "./evalSandbox.mjs";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

process.env.HARNESS_DB_FILE = join(mkdtempSync(join(tmpdir(), "aurora-vscode-e2e-")), "harness.db");
process.env.LLAMA_SERVER_PORT ||= "18191";
const store = await import("../app/store.js");
const { createServer } = await import("../app/server.js");
const { stopLlamaServer } = await import("../app/llamaServer.js");
await store.setSetting("teacher_mode", "off");
await store.setSetting("onboarding_completed", "true");
await store.setSetting("agent_mode", "auto");
const server = createServer({ allowDev: false }); await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { createClient, composeMessage, commandPrompt } = createRequire(import.meta.url)("../vscode/aurora/lib/client.js");
const client = createClient({ base: `http://127.0.0.1:${server.address().port}`, pollMs: 800 });

const folder = mkdtempSync(join(tmpdir(), "aurora-vscode-proj-"));
const broken = join(folder, "soma.js");
writeFileSync(broken, "function soma(a, b) {\n  return a + b\n}\n\nconsole.log(soma(2, 3);\n");
const project = await client.projectFor(folder, "VS Code: e2e");
const conversation = await client.newConversation({ projectId: project.id, title: "VS Code: e2e" });
const checks = [];
const check = (name, ok, detail = "") => { checks.push(ok); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

const message = composeMessage(commandPrompt("corrigir", ""), { file: broken, problems: [{ file: "soma.js", line: 5, severity: "erro", message: "')' expected.", source: "ts" }] });
let partialSeen = false;
const started = Date.now();
const r = await client.send(conversation.id, message, { onProgress: async (p) => { if (p.partial) partialSeen = true; if (p.approval) await client.approve(conversation.id, p.approval.id, /node/.test(String(p.approval.detail || p.approval.summary))); } });
console.log(`${Math.round((Date.now() - started) / 1000)} s | passos: ${r.steps.map((s) => `${s.tool}${s.ok ? "" : "✗"}`).join(", ")}`);
console.log(`resposta: ${r.content.replace(/\s+/g, " ").slice(0, 400)}`);
const fixed = readFileSync(broken, "utf8");
check("o arquivo foi corrigido", /console\.log\(soma\(2, 3\)\);?/.test(fixed), JSON.stringify(fixed.split("\n")[4]));
check("a resposta traz o arquivo editado com a cópia de antes", r.changes.some((c) => c.file.toLowerCase() === broken.toLowerCase() && c.backup && existsSync(c.backup)), JSON.stringify(r.changes));
check("e o id da mensagem para desfazer", Boolean(r.messageId));
check("o texto apareceu enquanto ela escrevia (partial)", partialSeen);
if (r.messageId && r.changes.length) {
  const undone = await client.undo(r.messageId);
  check("Desfazer devolve o arquivo como estava", readFileSync(broken, "utf8").includes("soma(2, 3);\n") && readFileSync(broken, "utf8").includes("console.log(soma(2, 3);"), JSON.stringify(undone));
}
console.log(`\nNota: ${checks.filter(Boolean).length}/${checks.length}`);
server.close(); stopLlamaServer();
process.exit(0);
