// Testes de uso (app/usageScenarios.js): pedidos como as pessoas escrevem, por nível.
//   node scripts/usage-tests.mjs --db <cópia com F:\EmpresaIA indexada> [--runs 2] [--nivel N1,N2] [--only oi,boleto] [--label nome]
// Sem --grupo roda os dois grupos (pessoal num banco novo, empresa numa cópia de --db), cada um num
// processo, e junta o resultado. Relatório em reports/uso/<label>.json e .md.
import "./evalSandbox.mjs";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const runs = Math.max(1, Number(arg("runs", 1)) || 1);
const label = arg("label", `uso-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`);
const group = arg("grupo");
mkdirSync("reports/uso", { recursive: true });

if (!group) {
  // Both groups, each in its own process (the database is fixed at first use).
  const passArgs = process.argv.slice(2).filter((a, i, all) => a !== "--label" && all[i - 1] !== "--label");
  for (const g of ["pessoal", "empresa"]) {
    if (g === "empresa" && !arg("db")) { console.log("(grupo empresa pulado: falta --db com a empresa indexada)"); continue; }
    spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...passArgs, "--grupo", g, "--label", `${label}-${g}`], { stdio: "inherit" });
  }
  const parts = ["pessoal", "empresa"].map((g) => { try { return JSON.parse(readFileSync(`reports/uso/${label}-${g}.json`, "utf8")); } catch { return null; } }).filter(Boolean);
  const results = parts.flatMap((p) => p.results);
  writeReport(label, results, parts[0]?.model);
  process.exit(0);
}

const base = mkdtempSync(join(tmpdir(), "aurora-uso-"));
if (group === "empresa") copyFileSync(arg("db"), join(base, "harness.db"));
process.env.HARNESS_DB_FILE = join(base, "harness.db");
process.env.AGENT_APPROVAL_TIMEOUT_MS ||= "1000";
setInterval(() => {}, 60_000);

const { USAGE_SCENARIOS, USAGE_TODAY, writePersonalFixtures } = await import("../app/usageScenarios.js");
process.env.HARNESS_NOW ||= USAGE_TODAY;
const store = await import("../app/store.js");
const agents = await import("../app/agents.js");
const { handleChatTurn } = await import("../app/server.js");
const { resolveLocalModel } = await import("../app/ollamaSetup.js");
await store.setSetting("teacher_mode", "off");
if (group === "empresa") {
  // The copied database has agents from other evaluations: only the three sector agents stay on.
  for (const a of await agents.listAgents()) await agents.updateAgent(a.id, { enabled: ["Agente RH", "Agente Financeiro", "Agente Controladoria"].includes(a.name) });
}
const model = await resolveLocalModel(process.env);
const levels = arg("nivel")?.split(",");
const only = arg("only")?.split(",");
const chosen = USAGE_SCENARIOS.filter((s) => s.group === group && (!levels || levels.includes(s.level)) && (!only || only.includes(s.id)));
console.log(`grupo ${group}, modelo ${model}, ${chosen.length} cenário(s), ${runs} rodada(s)`);

const results = [];
for (let run = 1; run <= runs; run += 1) {
  for (const scenario of chosen) {
    // Fresh personal folders for each scenario: "arrume meus downloads" changes them.
    const home = join(base, `pessoa-${scenario.id}-${run}`);
    const folders = { desktop: join(home, "Desktop"), documents: join(home, "Documents"), downloads: join(home, "Downloads"), home };
    for (const d of [folders.desktop, folders.documents, folders.downloads]) mkdirSync(d, { recursive: true });
    await writePersonalFixtures(home);
    process.env.HARNESS_KNOWN_FOLDERS = JSON.stringify(folders);
    const conversation = await store.createConversation({ provider: "local", title: `uso ${scenario.id}` });
    const turns = [];
    console.log(`\n## ${scenario.level} ${scenario.id} (rodada ${run}) — ${scenario.persona}`);
    for (const spec of scenario.turns) {
      const started = Date.now();
      const reply = await handleChatTurn({ conversationId: conversation.id, message: spec.message });
      const execution = reply.message?.execution || {};
      const turn = { text: reply.message?.content || reply.error || "", steps: execution.toolSteps || [] };
      const checks = [];
      for (const check of spec.checks) {
        let ok = false;
        try { ok = Boolean(await check.ok(turn, { folders, turns, run })); } catch { ok = false; }
        checks.push({ name: check.name, ok });
      }
      turns.push({ message: spec.message, ms: Date.now() - started, text: turn.text, stepsRaw: turn.steps, steps: turn.steps.map((s) => `${s.tool}${s.ok ? "" : "✗"}`), checks });
      console.log(`- "${spec.message}" (${((Date.now() - started) / 1000).toFixed(1)} s) ${checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}`).join(" | ")}`);
    }
    results.push({ id: scenario.id, level: scenario.level, group, run, turns: turns.map(({ stepsRaw, ...t }) => ({ ...t, detail: stepsRaw.map((s) => ({ tool: s.tool, ok: s.ok, args: JSON.stringify(s.args || {}).slice(0, 200), result: String(s.summary || "").slice(0, 200) })) })) });
  }
}
writeReport(label, results, model);
process.exit(0);

function writeReport(name, list, modelName) {
  const { LEVELS } = { LEVELS: { N1: "Pessoa comum — conversa", N2: "Pessoa comum — os próprios arquivos", N3: "Pessoa comum — vários passos, vago ou impossível", N4: "Funcionário — perguntas do dia a dia", N5: "Funcionário — entregas e agentes" } };
  const all = list.flatMap((r) => r.turns.flatMap((t) => t.checks));
  const rows = Object.entries(LEVELS).map(([lvl, title]) => {
    const scen = list.filter((r) => r.level === lvl);
    const c = scen.flatMap((r) => r.turns.flatMap((t) => t.checks));
    const perfect = scen.filter((r) => r.turns.every((t) => t.checks.every((x) => x.ok))).length;
    return { lvl, title, passed: c.filter((x) => x.ok).length, total: c.length, perfect, scenarios: scen.length };
  }).filter((r) => r.total);
  const passed = all.filter((c) => c.ok).length;
  const md = [`# Testes de uso — ${name}`, "", `Modelo **${modelName || "?"}**, ${new Date().toLocaleString("pt-BR")}.`, "", `**Verificações certas: ${passed}/${all.length} (${all.length ? Math.round((passed / all.length) * 1000) / 10 : 0}%)**`, "",
    "| Nível | O que é | Verificações | Cenários perfeitos |", "|---|---|---|---|",
    ...rows.map((r) => `| ${r.lvl} | ${r.title} | ${r.passed}/${r.total} | ${r.perfect}/${r.scenarios} |`), "", "## O que falhou", "",
    ...list.flatMap((r) => r.turns.filter((t) => t.checks.some((c) => !c.ok)).map((t) => `- **${r.level} ${r.id}** (rodada ${r.run}) "${t.message}": ${t.checks.filter((c) => !c.ok).map((c) => c.name).join("; ")} — passos: ${t.steps.join(", ") || "nenhum"} — resposta: ${String(t.text).slice(0, 220).replace(/\n/g, " ")}`))].join("\n");
  writeFileSync(`reports/uso/${name}.json`, JSON.stringify({ label: name, model: modelName, date: new Date().toISOString(), results: list }, null, 2));
  writeFileSync(`reports/uso/${name}.md`, md);
  console.log(`\nNota: ${passed}/${all.length} (${all.length ? Math.round((passed / all.length) * 1000) / 10 : 0}%)`);
  for (const r of rows) console.log(`  ${r.lvl} ${r.title}: ${r.passed}/${r.total}, ${r.perfect}/${r.scenarios} cenários perfeitos`);
}
