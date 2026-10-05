// Quanto do prompt o llama-server reaproveita do cache numa tarefa longa do agente (A4 de
// docs/REVISAO_2026-09-27.md): compactar resultados antigos a cada passo ("always") contra só
// perto do limite (padrão).   node scripts/prompt-cache-eval.mjs [--runs 3]
// Em CPU, cada token reprocessado custa ~10-30 ms num modelo de 4B: é isso que se mede aqui.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const runs = Math.max(1, Number(arg("runs", 2)) || 2);
const base = mkdtempSync(join(tmpdir(), "aurora-cache-"));
process.env.HARNESS_DB_FILE = join(base, "harness.db");
process.env.AGENT_APPROVAL_TIMEOUT_MS ||= "1000";
setInterval(() => {}, 60_000);

const { PERSONAL_TASKS, prepareTask } = await import("../app/personalTaskBattery.js");
const store = await import("../app/store.js");
const agents = await import("../app/agents.js");
const { handleChatTurn } = await import("../app/server.js");
await store.setSetting("teacher_mode", "off");
const task = PERSONAL_TASKS.find((t) => t.id === "organizar-pasta");

for (const mode of ["always", "near-limit"]) {
  const totals = { input: 0, cached: 0, promptMs: 0, calls: 0, ok: 0 };
  for (let run = 1; run <= runs; run += 1) {
    const dir = prepareTask(task, base, `${mode}-${run}`);
    const agent = await agents.createAgent({ name: `Cache ${mode} ${run}`, kind: "pessoal", mission: "Organizar arquivos.", workDir: dir });
    const env = { ...process.env, AGENT_COMPACT: mode === "always" ? "always" : "" };
    const result = await agents.runAgent(agent.id, { request: task.request, handleChatTurn, env });
    const conversation = await store.getConversationWithMessages(result.conversationId);
    const calls = conversation.messages.at(-1)?.execution?.calls || [];
    for (const c of calls) {
      totals.input += c.usage?.input_tokens || 0;
      totals.cached += c.metrics?.cachedInputTokens || 0;
      totals.promptMs += c.metrics?.promptMs || 0;
      totals.calls += 1;
    }
    if ((await task.check(dir)).every((c) => c.ok)) totals.ok += 1;
  }
  const fresh = totals.input - totals.cached;
  console.log(`${mode}: ${totals.calls} chamadas, ${totals.input} tokens de prompt, ${totals.cached} do cache (${Math.round((totals.cached / Math.max(1, totals.input)) * 100)}%), ${fresh} reprocessados, ${Math.round(totals.promptMs)} ms de prompt na GPU; tarefa certa em ${totals.ok}/${runs}`);
  console.log(`  em CPU (~20 ms por token reprocessado): ~${Math.round((fresh * 20) / 1000 / runs)} s de prompt por tarefa`);
}
process.exit(0);
