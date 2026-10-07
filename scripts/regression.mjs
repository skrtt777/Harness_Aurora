// npm run regressao -- --db <cópia do banco com os documentos da empresa> [--runs 2] [--rapido]
// Every measurement in one go, compared with the last run (reports/regressao/latest.json): the
// release rule (no measurement down more than 5 points) checked by the machine, not by memory.
import "./evalSandbox.mjs";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const arg = (name, fallback = null) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const db = arg("db");
const runs = arg("runs", "2");
const quick = process.argv.includes("--rapido");
if (!db || !existsSync(db)) { console.error("Use: npm run regressao -- --db <cópia do banco com os documentos da empresa>"); process.exit(2); }

const label = `regressao-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`;
const node = process.execPath;
const steps = [
  { id: "testes", name: "Testes automáticos", cmd: ["npm", "test"], shell: true, score: (out) => { const pass = Number(/ℹ pass (\d+)/.exec(out)?.[1] || 0); const fail = Number(/ℹ fail (\d+)/.exec(out)?.[1] || 0); return pass + fail ? (100 * pass) / (pass + fail) : null; }, detail: (out) => `${/ℹ pass (\d+)/.exec(out)?.[1] || "?"} passaram, ${/ℹ fail (\d+)/.exec(out)?.[1] || "?"} falharam` },
  { id: "conversas", name: "Conversas reais", cmd: [node, "scripts/conversation-battery.mjs", "--runs", runs, "--label", label] },
  { id: "agentes", name: "Agentes de setor", cmd: [node, "scripts/agent-tasks.mjs", "--db", db, "--runs", runs, "--label", label] },
  { id: "empresa", name: "Empresa (49 perguntas)", cmd: [node, "scripts/empresa-eval.mjs", "--db", db, "--label", label], score: () => { try { return Number(/Respostas certas: \d+\/\d+ \((\d+(?:[.,]\d+)?)%\)/.exec(readFileSync(`reports/empresa/${label}.md`, "utf8"))?.[1]?.replace(",", ".")); } catch { return null; } } },
  ...(quick ? [] : [1, 2, 3, 4].map((b) => ({ id: `uso-${b}`, name: `Testes de uso, bateria ${b}`, cmd: [node, "scripts/usage-tests.mjs", "--db", db, "--bateria", String(b), "--runs", b === 4 ? runs : "1", "--label", `${label}-b${b}`] }))),
];
const nota = (out) => { const m = /^Nota: (\d+)\/(\d+) \((\d+(?:\.\d+)?)%\)/m.exec(out); return m ? Number(m[3]) : null; };

const previous = (() => { try { return JSON.parse(readFileSync("reports/regressao/latest.json", "utf8")); } catch { return null; } })();
const results = [];
for (const step of steps) {
  const started = Date.now();
  console.log(`\n▶ ${step.name}…`);
  // The unit tests run outside the evaluations' fake folders (with them, a test waited forever on
  // its fake server, 11 hours, 07/10); every step has a time limit.
  const env = step.id === "testes" ? Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "HARNESS_KNOWN_FOLDERS")) : process.env;
  const run = spawnSync(step.cmd[0], step.cmd.slice(1), { encoding: "utf8", shell: step.shell || false, env, timeout: (step.id === "testes" ? 15 : 120) * 60 * 1000, maxBuffer: 256 * 1024 * 1024 });
  if (run.error?.code === "ETIMEDOUT") console.log("  passou do tempo-limite e foi encerrado");
  const out = `${run.stdout || ""}\n${run.stderr || ""}`;
  const score = step.score ? step.score(out) : nota(out);
  const before = previous?.results?.find((r) => r.id === step.id)?.score ?? null;
  const delta = score != null && before != null ? score - before : null;
  results.push({ id: step.id, name: step.name, score, before, delta, minutes: Math.round((Date.now() - started) / 6000) / 10, detail: step.detail ? step.detail(out) : (/^Nota: .*$/m.exec(out)?.[0] || "") });
  console.log(`  ${score == null ? "sem nota (veja a saída)" : `${score.toFixed(1)}%`}${delta != null ? ` (${delta >= 0 ? "+" : ""}${delta.toFixed(1)})` : ""}`);
}

const fell = results.filter((r) => r.delta != null && r.delta < -5);
const table = [
  `# Regressão ${label}`, "",
  `Modelo local, ${runs} rodada(s)${quick ? ", sem os testes de uso" : ""}. Comparado com ${previous?.label || "nada (primeira rodada)"}.`, "",
  "| Medição | Agora | Antes | Diferença | Minutos |", "|---|---|---|---|---|",
  ...results.map((r) => `| ${r.name} | ${r.score == null ? "—" : `${r.score.toFixed(1)}%`} | ${r.before == null ? "—" : `${r.before.toFixed(1)}%`} | ${r.delta == null ? "—" : `${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(1)}${r.delta < -5 ? " ⚠" : ""}`} | ${r.minutes} |`),
  "", fell.length ? `**Não publicar:** ${fell.map((r) => r.name).join(", ")} caiu mais de 5 pontos.` : "**Pode publicar:** nenhuma medição caiu mais de 5 pontos.",
].join("\n");
mkdirSync("reports/regressao", { recursive: true });
writeFileSync(`reports/regressao/${label}.md`, `${table}\n`);
const summary = { label, runs, quick, at: new Date().toISOString(), results };
writeFileSync(`reports/regressao/${label}.json`, JSON.stringify(summary, null, 2));
// Only a complete run becomes the reference for the next one.
if (!quick && results.every((r) => r.score != null)) writeFileSync("reports/regressao/latest.json", JSON.stringify(summary, null, 2));
console.log(`\n${table}`);
process.exit(fell.length ? 1 : 0);
