// Compares local models on the agent battery (docs/ESTUDO_IA_LEVE_2026-10-03.md, passo 1).
//   node scripts/compare-models.mjs --db <copia.db> --models qwen3.5:4b,gpt-oss:20b [--rounds 3] [--label gpu-24gb] [--round-timeout 90]
// Per model: decode speed on a fixed prompt, then N full battery rounds, each on a
// fresh copy of the database, plus the memory Ollama reports (RAM vs VRAM).
// Results: reports/model-compare/<label>.json and .md (appended per model).
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const db = arg("db");
const models = String(arg("models", "")).split(",").filter(Boolean);
const rounds = Number(arg("rounds", 3));
const label = arg("label", "padrao");
// A round that runs past this is stopped and recorded as too slow (minutes; 0 = no limit).
const roundTimeoutMin = Number(arg("round-timeout", 0));
const base = process.env.LOCAL_BASE_URL || "http://127.0.0.1:11434";
if (!db || !existsSync(db) || !models.length) { console.error("Uso: --db <copia.db> --models a,b [--rounds 3] [--label x]"); process.exit(2); }

const outDir = join(process.cwd(), "reports", "model-compare");
mkdirSync(outDir, { recursive: true });
const jsonFile = join(outDir, `${label}.json`);
const report = existsSync(jsonFile) ? JSON.parse(readFileSync(jsonFile, "utf8")) : { label, startedAt: new Date().toISOString(), models: {} };
const save = () => writeFileSync(jsonFile, JSON.stringify(report, null, 2));

async function speed(model) {
  const { thinkOption } = await import("../app/local.js");
  const body = { model, prompt: "Explique em um parágrafo o que é uma planilha de controle de férias.", stream: false, keep_alive: "30m", ...(await thinkOption(base, model, process.env)), options: { num_predict: 200, num_ctx: 12288, temperature: 0 } };
  const started = Date.now();
  const r = await (await fetch(`${base}/api/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(600000) })).json();
  const ps = await (await fetch(`${base}/api/ps`)).json();
  const loaded = (ps.models || []).find((m) => m.name === model || m.model === model) || {};
  return {
    loadS: Math.round((r.load_duration || 0) / 1e8) / 10,
    promptTokS: r.prompt_eval_duration ? Math.round(r.prompt_eval_count / (r.prompt_eval_duration / 1e9)) : null,
    decodeTokS: r.eval_duration ? Math.round((r.eval_count / (r.eval_duration / 1e9)) * 10) / 10 : null,
    wallS: Math.round((Date.now() - started) / 100) / 10,
    sizeGB: loaded.size ? Math.round(loaded.size / 1e8) / 10 : null,
    vramGB: loaded.size_vram !== undefined ? Math.round(loaded.size_vram / 1e8) / 10 : null,
  };
}

function battery(model, copy) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["app/agentEvalRunner.mjs"], { env: { ...process.env, HARNESS_DB_FILE: copy, LOCAL_MODEL: model }, windowsHide: true });
    let out = "";
    let err = "";
    let timedOut = false;
    const timer = roundTimeoutMin > 0 ? setTimeout(() => { timedOut = true; child.kill(); }, roundTimeoutMin * 60000) : null;
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { err = (err + c).slice(-1500); });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) return resolve({ failure: `passou de ${roundTimeoutMin} min (lento demais)` });
      const events = out.trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const done = events.find((e) => e.done)?.done;
      // Keep why a round produced nothing (runner error, crash, last stderr lines).
      const stderr = err.split("\n").filter((l) => l.trim() && !/ExperimentalWarning|trace-warnings/.test(l)).join("\n").slice(-600);
      resolve(done || { failure: events.find((e) => e.error)?.error || `saída ${code}: ${stderr || "sem mensagem"}` });
    });
  });
}

for (const model of models) {
  console.log(`== ${model}`);
  const entry = report.models[model] = { speed: await speed(model).catch((e) => ({ error: e.message })), rounds: [] };
  console.log("velocidade", JSON.stringify(entry.speed));
  save();
  for (let i = 0; i < rounds; i += 1) {
    // One name per model and round, and the SQLite sidecars go too: a stale -wal left by an
    // earlier round gets replayed onto the fresh copy ("database disk image is malformed").
    const copy = join(tmpdir(), `aurora-compare-${process.pid}-${models.indexOf(model)}-${i}.db`);
    const removeCopy = () => ["", "-wal", "-shm", "-journal"].forEach((s) => rmSync(copy + s, { force: true }));
    removeCopy();
    copyFileSync(db, copy);
    const done = await battery(model, copy);
    removeCopy();
    const s = done?.summary;
    entry.rounds.push(s ? { passed: s.passed, total: s.total, turns: s.turns, byArea: s.byArea, ms: s.ms, failed: done.results.filter((r) => !r.passed).map((r) => r.id), errors: done.results.filter((r) => r.error).map((r) => `${r.id}: ${r.error}`.slice(0, 200)) } : { error: done?.failure || "sem resultado" });
    console.log(`rodada ${i + 1}`, s ? `${s.passed}/${s.total} turnos ${s.turns?.passed}/${s.turns?.total} ${Math.round(s.ms / 1000)}s` : `sem resultado: ${done?.failure}`);
    save();
  }
}

// Markdown summary of everything measured under this label.
const rows = Object.entries(report.models).map(([model, e]) => {
  const ok = e.rounds.filter((r) => !r.error);
  const sum = (f) => ok.reduce((n, r) => n + f(r), 0);
  return `| ${model} | ${sum((r) => r.passed)}/${sum((r) => r.total)} | ${sum((r) => r.turns?.passed || 0)}/${sum((r) => r.turns?.total || 0)} | ${sum((r) => r.byArea?.conhecimento?.passed || 0)}/${sum((r) => r.byArea?.conhecimento?.total || 0)} | ${ok.length ? Math.round(sum((r) => r.ms) / ok.length / 1000) : "—"} s | ${e.speed?.decodeTokS ?? "—"} | ${e.speed?.sizeGB ?? "—"} / ${e.speed?.vramGB ?? "—"} GB | ${e.speed?.loadS ?? "—"} s |`;
});
writeFileSync(join(outDir, `${label}.md`), [`# Comparação de modelos — ${label}`, "", `${rounds} rodadas da bateria por modelo (${new Date().toLocaleString("pt-BR")}).`, "", "| Modelo | Tarefas | Turnos (conversas) | RH | Tempo médio da rodada | Geração (tok/s) | Memória total / na GPU | Carga |", "|---|---|---|---|---|---|---|---|", ...rows, ""].join("\n"));
console.log(`relatório: ${join(outDir, `${label}.md`)}`);
