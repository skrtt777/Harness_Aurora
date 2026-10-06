// O "avisar só quando houver novidade" contra o modelo local: o agente "Resumo da manhã" roda
// duas vezes por rodada, uma sem nada novo no computador (deve responder só OK, sem notificação)
// e uma com um boleto que chegou hoje (deve avisar, citando o arquivo).
//   node scripts/heartbeat-eval.mjs [--runs 3]
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const runs = Math.max(1, Number(arg("runs", 3)) || 3);
const base = mkdtempSync(join(tmpdir(), "aurora-heartbeat-"));
process.env.HARNESS_DB_FILE = join(base, "harness.db");
process.env.AGENT_APPROVAL_TIMEOUT_MS ||= "1000";
setInterval(() => {}, 60_000);

const store = await import("../app/store.js");
const map = await import("../app/computerMap.js");
const agents = await import("../app/agents.js");
const { QUIET_NOTE, nothingNew } = await import("../app/agentScheduler.js");
const { handleChatTurn } = await import("../app/server.js");
await store.setSetting("teacher_mode", "off");
await store.setSetting("computer_map", "true");

const REQUEST = "Veja com computer_map (recent_days=1) o que chegou ou mudou desde ontem e diga, em até 5 linhas, o que merece atenção (boletos e vencimentos, notas, contratos, documentos novos), com o caminho de cada um.";
const old = (Date.now() - 20 * 86_400_000) / 1000;
const results = [];
for (let run = 1; run <= runs; run += 1) {
  for (const fresh of [false, true]) {
    const pc = join(base, `pc-${run}-${fresh ? "novo" : "nada"}`);
    const put = (rel, isNew = false) => { const f = join(pc, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, "x"); if (!isNew) utimesSync(f, old, old); };
    for (const f of ["Documentos/contrato_aluguel.pdf", "Documentos/relatorio.docx", "Fotos/IMG_0001.jpg"]) put(f);
    if (fresh) put("Downloads/boleto_energia_outubro.pdf", true);
    await map.clearComputerMap();
    await map.scanComputer({ roots: [pc], home: pc, pauseMs: 0 });
    const agent = await agents.createAgent({ name: `Resumo ${run}${fresh ? "b" : "a"}`, kind: "pessoal", mission: "Toda manhã, conferir o que chegou ou mudou no computador e só avisar o que merece atenção.", workDir: join(base, `agente-${run}-${fresh}`), trigger: { type: "schedule", at: "08:00", quiet: true, request: REQUEST } });
    const started = Date.now();
    const result = await agents.runAgent(agent.id, { request: `${REQUEST}${QUIET_NOTE}`, trigger: "schedule", handleChatTurn });
    const answer = String(result?.answer || "");
    const quiet = result?.status === "done" && nothingNew(answer);
    const ok = fresh ? !quiet && /boleto_energia/i.test(answer) : quiet;
    results.push({ run, fresh, ok, quiet, ms: Date.now() - started, answer: answer.slice(0, 300) });
    console.log(`${ok ? "✓" : "✗"} rodada ${run}, ${fresh ? "com boleto novo" : "sem novidade"} (${((Date.now() - started) / 1000).toFixed(1)} s): ${answer.slice(0, 160).replace(/\n/g, " | ")}`);
  }
}
const passed = results.filter((r) => r.ok).length;
console.log(`Nota: ${passed}/${results.length}`);
mkdirSync("reports/heartbeat", { recursive: true });
writeFileSync(join("reports/heartbeat", `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`), JSON.stringify(results, null, 2));
process.exit(0);
