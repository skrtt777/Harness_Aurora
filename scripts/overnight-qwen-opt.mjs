// Overnight optimisation study of qwen3.5:4b (docs/COMPARACAO_MODELOS_2026-10-04.md, "Decisão").
//   node scripts/overnight-qwen-opt.mjs --db <copia.db>
// Runs a private Ollama on 127.0.0.1:11435 (models in F:\Modelos_Aurora\ollama), restarting it
// with each phase's settings, so the user's own Ollama on 11434 is never touched.
//  1. Quality on the GPU (fast, several rounds): flash attention + 8-bit KV cache, and the
//     smaller quantisations (Q3_K_M, Q2_K) against Q4_K_M (current) and Q8_0 (upper bound).
//  2. Real time on the CPU only (a PC without a graphics card): full battery rounds, capped.
// Results go to reports/model-compare/<label>.json/.md, progress to reports/model-compare/overnight.log.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const db = arg("db");
if (!db) { console.error("Uso: --db <copia.db>"); process.exit(2); }
const OLLAMA = "C:\\Users\\lucas\\AppData\\Local\\Programs\\Ollama\\ollama.exe";
const PORT = 11435;
const BASE = `http://127.0.0.1:${PORT}`;
const outDir = join(process.cwd(), "reports", "model-compare");
mkdirSync(outDir, { recursive: true });
const logFile = join(outDir, "overnight.log");
const log = (msg) => { const line = `[${new Date().toLocaleString("pt-BR")}] ${msg}`; console.log(line); appendFileSync(logFile, `${line}\n`); };

const FAQ8 = { OLLAMA_FLASH_ATTENTION: "1", OLLAMA_KV_CACHE_TYPE: "q8_0" };
const CPU = { CUDA_VISIBLE_DEVICES: "-1", OLLAMA_VULKAN: "0", GGML_VK_VISIBLE_DEVICES: "-1" };
const PHASES = [
  // Quality (GPU): numbers do not change with the device, only the time does.
  { label: "opt-gpu-base", env: {}, models: ["qwen3.5:4b"], rounds: 2, timeout: 20 },
  { label: "opt-gpu-fa-q8", env: FAQ8, models: ["qwen3.5:4b", "qwen3.5:4b-q3_k_m", "qwen3.5:4b-q2_k"], rounds: 3, timeout: 20 },
  { label: "opt-gpu-fa-q8", env: FAQ8, models: ["qwen3.5:4b-q8_0"], rounds: 2, timeout: 20 },
  // Time (CPU only): what someone without a graphics card would wait.
  { label: "opt-cpu", env: CPU, models: ["qwen3.5:4b"], rounds: 1, timeout: 90 },
  { label: "opt-cpu-fa-q8", env: { ...CPU, ...FAQ8 }, models: ["qwen3.5:4b", "qwen3.5:4b-q3_k_m", "qwen3.5:4b-8t"], rounds: 1, timeout: 90 },
];

function killServer() {
  // Only the test server: the process listening on our port.
  spawnSync("powershell", ["-NoProfile", "-Command", `Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { taskkill /PID $_.OwningProcess /T /F | Out-Null }`], { windowsHide: true });
}

async function startServer(env) {
  killServer();
  await new Promise((r) => setTimeout(r, 3000));
  const child = spawn(OLLAMA, ["serve"], {
    env: { ...process.env, OLLAMA_HOST: `127.0.0.1:${PORT}`, OLLAMA_MODELS: "F:\\Modelos_Aurora\\ollama", OLLAMA_KEEP_ALIVE: "30m", OLLAMA_FLASH_ATTENTION: "0", OLLAMA_KV_CACHE_TYPE: "", ...env },
    windowsHide: true,
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    try { if ((await fetch(`${BASE}/api/version`)).ok) return child; } catch {}
  }
  throw new Error("o Ollama de teste não subiu");
}

function compare(phase) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/compare-models.mjs", "--db", db, "--models", phase.models.join(","), "--rounds", String(phase.rounds), "--label", phase.label, "--round-timeout", String(phase.timeout)], {
      env: { ...process.env, LOCAL_BASE_URL: BASE },
      windowsHide: true,
    });
    child.stdout.on("data", (c) => String(c).split("\n").filter((l) => l.trim()).forEach((l) => log(`  ${l}`)));
    child.on("close", resolve);
  });
}

log(`início: ${PHASES.length} fases`);
for (const phase of PHASES) {
  log(`fase ${phase.label}: ${phase.models.join(", ")} × ${phase.rounds} (env ${JSON.stringify(phase.env)})`);
  try {
    await startServer(phase.env);
    await compare(phase);
  } catch (error) {
    log(`fase falhou: ${error.message}`);
  }
}
killServer();
// Speculative decoding (0.8b drafting for the 4b) on the CPU, with Ollama's own llama-server.
log("fase decodificação especulativa (CPU, 16 threads)");
const spec = spawnSync("python", ["F:/Modelos_Aurora/spec_bench.py", "16"], { encoding: "utf8", windowsHide: true, timeout: 90 * 60000 });
appendFileSync(join(outDir, "opt-especulativa.json"), spec.stdout || `erro: ${spec.error?.message || spec.stderr}`);
log(`especulativa: ${(spec.stdout || "sem saída").replace(/\s+/g, " ").slice(0, 300)}`);
log("fim");
