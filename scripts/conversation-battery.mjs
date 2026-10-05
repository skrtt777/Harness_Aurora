// Bateria de conversas reais (app/conversationBattery.js) contra o modelo local.
//   npm run battery -- [--only kit-midia,planilha] [--runs 2] [--teacher] [--db <copia.db>] [--label nome]
// Sem --db, usa um banco novo (sem memórias do usuário): o resultado depende só do código e do modelo.
// --teacher liga o professor pago (gasta chamadas). Relatório em reports/battery/<label>.json;
// sai com código 1 se a nota cair mais de 5 pontos em relação à rodada anterior.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const only = arg("only")?.split(",");
const runs = Math.max(1, Number(arg("runs", 1)) || 1);
const label = arg("label", `bateria-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`);
const base = mkdtempSync(join(tmpdir(), "aurora-bateria-"));
if (arg("db")) copyFileSync(arg("db"), join(base, "harness.db"));
process.env.HARNESS_DB_FILE = join(base, "harness.db");
// Nobody approves: anything outside the scenario folder counts as denied after 1 s.
process.env.AGENT_APPROVAL_TIMEOUT_MS ||= "1000";
setInterval(() => {}, 60_000);

const { BATTERY_TODAY, SCENARIOS, scoreTurn, summarizeBattery, writeBatteryFixtures } = await import("../app/conversationBattery.js");
process.env.HARNESS_NOW ||= BATTERY_TODAY;
const store = await import("../app/store.js");
const { handleChatTurn } = await import("../app/server.js");
const { resolveLocalModel } = await import("../app/ollamaSetup.js");
const { extractText } = await import("../app/docText.js");
if (!process.argv.includes("--teacher")) await store.setSetting("teacher_mode", "off");
const model = await resolveLocalModel(process.env);
console.log(`modelo ${model}, professor ${process.argv.includes("--teacher") ? "ligado" : "desligado"}, ${runs} rodada(s)`);

const results = [];
for (let run = 1; run <= runs; run += 1) {
  for (const scenario of SCENARIOS.filter((s) => !only || only.includes(s.id))) {
    const dir = join(base, `${scenario.id}-${run}`);
    mkdirSync(dir, { recursive: true });
    await writeBatteryFixtures(dir);
    const project = await store.createProject({ name: `Bateria ${scenario.id}`, workspaceDir: dir });
    const conversation = await store.createConversation({ provider: "local", projectId: project.id, teacherProvider: "claude" });
    const turns = [];
    console.log(`\n## ${scenario.id} (rodada ${run}): ${scenario.title}`);
    for (const spec of scenario.turns) {
      const started = Date.now();
      const reply = await handleChatTurn({ conversationId: conversation.id, message: spec.message });
      const execution = reply.message?.execution || {};
      const turn = { text: reply.message?.content || reply.error || "", steps: execution.toolSteps || [], execution };
      const checks = await scoreTurn(turn, spec.checks, { dir, turns, extract: (file) => extractText(file) });
      turns.push({ message: spec.message, ms: Date.now() - started, text: turn.text, steps: turn.steps.map((s) => `${s.tool}${s.redo ? "(refazer)" : ""}:${s.ok ? "ok" : `falhou (${String(s.summary || "").slice(0, 120)})`}`), fallback: execution.agentFallback || null, checks });
      console.log(`- "${spec.message}" (${((Date.now() - started) / 1000).toFixed(1)} s) ${checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}`).join(" | ")}`);
    }
    results.push({ id: scenario.id, run, files: readdirSync(dir), turns });
  }
}

const summary = summarizeBattery(results);
const outDir = join(process.cwd(), "reports", "battery");
mkdirSync(outDir, { recursive: true });
const previous = readdirSync(outDir).filter((f) => f.endsWith(".json")).map((f) => { try { return JSON.parse(readFileSync(join(outDir, f), "utf8")); } catch { return null; } }).filter((r) => r?.model === model).sort((a, b) => String(a.date).localeCompare(String(b.date))).at(-1);
writeFileSync(join(outDir, `${label}.json`), JSON.stringify({ model, label, date: new Date().toISOString(), summary, results }, null, 2));
console.log(`\nNota: ${summary.passed}/${summary.total} (${summary.score}%)${previous ? `; anterior ${previous.summary.score}% (${previous.label})` : ""}`);
for (const s of summary.scenarios) console.log(`  ${s.id}: ${s.passed}/${s.total}`);
process.exit(previous && summary.score < previous.summary.score - 5 ? 1 : 0);
