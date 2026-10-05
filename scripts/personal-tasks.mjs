// Avaliação dos agentes pessoais (fase F de docs/AGENTES_ROTEIRO.md).
//   node scripts/personal-tasks.mjs [--only organizar-pasta] [--runs 3] [--online] [--label nome]
// Cada tarefa ganha uma pasta gerada na hora; o agente trabalha nela e o resultado é conferido no
// disco (arquivos no lugar, testes rodando). --online inclui a pesquisa na web.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const only = arg("only")?.split(",");
const runs = Math.max(1, Number(arg("runs", 1)) || 1);
const label = arg("label", `pessoais-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`);
const base = mkdtempSync(join(tmpdir(), "aurora-pessoais-"));
process.env.HARNESS_DB_FILE = join(base, "harness.db");
process.env.AGENT_APPROVAL_TIMEOUT_MS ||= "1000";
setInterval(() => {}, 60_000);

const { PERSONAL_TASKS, prepareTask } = await import("../app/personalTaskBattery.js");
const store = await import("../app/store.js");
const agents = await import("../app/agents.js");
const { handleChatTurn } = await import("../app/server.js");
const { resolveLocalModel } = await import("../app/ollamaSetup.js");
await store.setSetting("teacher_mode", "off");
const tasks = PERSONAL_TASKS.filter((t) => (!only || only.includes(t.id)) && (!t.online || process.argv.includes("--online") || only?.includes(t.id)));
console.log(`modelo ${await resolveLocalModel(process.env)}, ${tasks.length} tarefa(s), ${runs} rodada(s)`);

const results = [];
for (let run = 1; run <= runs; run += 1) {
  for (const task of tasks) {
    const dir = prepareTask(task, base, run);
    const agent = await agents.createAgent({ name: `Assistente ${task.id} ${run}`, kind: "pessoal", mission: "Ajudar no dia a dia: organizar arquivos, programar e testar, pesquisar e resumir. Trabalhe na sua pasta e entregue o resultado nela.", workDir: dir });
    const started = Date.now();
    const result = await agents.runAgent(agent.id, { request: task.request, handleChatTurn });
    const conversation = result.conversationId ? await store.getConversationWithMessages(result.conversationId) : null;
    const steps = (conversation?.messages.at(-1)?.execution?.toolSteps || []).map((s) => `${s.tool}:${s.ok ? "ok" : "falhou"}`);
    const checks = await task.check(dir, { ...result, steps });
    results.push({ id: task.id, run, ms: Date.now() - started, answer: result.answer, steps, checks });
    console.log(`\n## ${task.id} (rodada ${run}, ${((Date.now() - started) / 1000).toFixed(0)} s) ${checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}${!c.ok && c.detail ? ` [${String(c.detail).replace(/\s+/g, " ").slice(0, 160)}]` : ""}`).join(" | ")}`);
    if (checks.some((c) => !c.ok)) console.log(`  passos: ${steps.join(" ") || "nenhum"}\n  resposta: ${String(result.answer || result.error || "").replace(/\s+/g, " ").slice(0, 200)}`);
  }
}

const all = results.flatMap((r) => r.checks);
const passed = all.filter((c) => c.ok).length;
mkdirSync(join(process.cwd(), "reports", "agentes"), { recursive: true });
writeFileSync(join(process.cwd(), "reports", "agentes", `${label}.json`), JSON.stringify({ label, date: new Date().toISOString(), passed, total: all.length, results }, null, 2));
console.log(`\nNota: ${passed}/${all.length} (${Math.round((passed / all.length) * 1000) / 10}%); tarefas perfeitas: ${results.filter((r) => r.checks.every((c) => c.ok)).length}/${results.length}`);
process.exit(0);
