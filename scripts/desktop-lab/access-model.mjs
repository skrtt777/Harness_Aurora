// O modelo local mexendo num banco do Access a partir de pedidos em português comum, no banco de teste
// do laboratório (nunca nos arquivos da pessoa). node scripts/desktop-lab/access-model.mjs <AuroraTeste.accdb> [--runs 2]
import "../evalSandbox.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const db = process.argv[2];
const runs = Number(process.argv[process.argv.indexOf("--runs") + 1]) || 2;
process.env.HARNESS_DB_FILE = join(mkdtempSync(join(tmpdir(), "aurora-access-")), "harness.db");
const store = await import("../../app/store.js");
const { handleChatTurn } = await import("../../app/server.js");
const { desktopRequest, stopDesktop } = await import("../../app/desktop.js");
await store.setSetting("teacher_mode", "off");
const project = await store.createProject({ name: "Loja", workspaceDir: dirname(db) });
const file = basename(db);
const sql = async (q) => (await desktopRequest("db_query", { path: db, sql: q })).text || "";

const tasks = [
  { message: `no banco do Access ${file}, qual é o limite de crédito do Hotel Litoral Norte?`, ok: (t) => /8[.,]?000/.test(t) },
  { message: `quantos clientes VIP tem no ${file}?`, ok: (t) => /\b1\b|apenas um|só um|somente um|um cliente VIP|uma cliente VIP/i.test(t) && !/não (consegui|foi possível)/i.test(t) },
  { message: `cadastra no ${file} o cliente Empório Central, de Salvador, VIP, com limite de 12 mil`, ok: async () => /Empório Central \| Salvador \| True \| 12000/.test(await sql("SELECT Nome, Cidade, VIP, Limite FROM Clientes WHERE Nome LIKE 'Emp%'")) },
  { message: `aumenta o limite do Mercadinho São Jorge para 7500 no ${file}`, ok: async () => /7500/.test(await sql("SELECT Limite FROM Clientes WHERE Nome LIKE 'Mercadinho%'")) },
];

let ok = 0, total = 0;
for (let run = 1; run <= runs; run += 1) {
  for (const task of tasks) {
    const conversation = await store.createConversation({ provider: "local", projectId: project.id, title: "access" });
    const started = Date.now();
    const reply = await handleChatTurn({ conversationId: conversation.id, message: task.message });
    const text = reply.message?.content || reply.error || "";
    const steps = (reply.message?.execution?.toolSteps || []).map((s) => `${s.tool}${s.ok ? "" : "✗"}`);
    const passed = Boolean(await task.ok(text));
    total += 1; if (passed) ok += 1;
    console.log(`${passed ? "✓" : "✗"} (${((Date.now() - started) / 1000).toFixed(0)} s) ${task.message}\n   passos: ${steps.join(", ")}\n   resposta: ${text.slice(0, 160).replace(/\n/g, " ")}`);
  }
  // Back to the lab's starting rows for the next run.
  await desktopRequest("db_exec", { path: db, sql: "DELETE FROM Clientes WHERE Nome LIKE 'Emp%'" });
  await desktopRequest("db_exec", { path: db, sql: "UPDATE Clientes SET Limite = 5000 WHERE Nome LIKE 'Mercadinho%'" });
}
stopDesktop();
console.log(`\nNota: ${ok}/${total}`);
process.exit(0);
