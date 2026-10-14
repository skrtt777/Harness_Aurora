// A weak machine, simulated: only the processor (no video card), few threads, the RAM of a cheap
// laptop. Runs scenarios of the new battery and measures the time of each request and the peak memory
// of the Aurora (the model's server + the agent), against what is left on that machine.
//   node scripts/low-end-bench.mjs [--threads 4] [--ram 8] [--only a,b] [--label nome]
// What is left: 8 GB minus Windows and a browser (~4.5 GB) = ~3.5 GB for the Aurora.
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const threads = arg("threads", "4");
const ram = Number(arg("ram", "8"));
const only = arg("only", "novo-soma-exata,novo-contagem,novo-ficticio,novo-filtro-data,novo-email,novo-nao-consta,novo-word,novo-corrige-pedido,novo-ordenar");
const label = arg("label", `fraca-${Date.now()}`);
const budget = Math.max(1, ram - 4.5);
const env = { ...process.env, BATTERY_PAUSE_MS: process.env.BATTERY_PAUSE_MS || "25000", LLAMA_FORCE_CPU: "1", HARNESS_RAM_GB: String(ram), LLAMA_SERVER_EXTRA_ARGS: `${process.env.LLAMA_SERVER_EXTRA_ARGS || ""} -t ${threads}`.trim() };

const started = Date.now();
const child = spawn(process.execPath, ["scripts/conversation-battery.mjs", "--set", "novos", "--only", only, "--label", label], { env, stdio: ["ignore", "pipe", "pipe"] });
let peak = { server: 0, agent: 0, both: 0 };
const sample = () => {
  try {
    const ps = `$s = (Get-CimInstance Win32_Process -Filter "Name='llama-server.exe'" | Where-Object { $_.CommandLine -match '--alias' } | ForEach-Object { (Get-Process -Id $_.ProcessId).WorkingSet64 } | Measure-Object -Sum).Sum; $a = (Get-Process -Id ${child.pid}).WorkingSet64; "$s $a"`;
    const [s, a] = execFileSync("powershell", ["-NoProfile", "-Command", ps], { windowsHide: true }).toString().trim().split(/\s+/).map(Number);
    peak = { server: Math.max(peak.server, s || 0), agent: Math.max(peak.agent, a || 0), both: Math.max(peak.both, (s || 0) + (a || 0)) };
  } catch { /* not yet */ }
};
const timer = setInterval(sample, 3000);
const times = [];
child.stdout.on("data", (d) => {
  for (const line of String(d).split("\n")) {
    const t = /^- "(.+?)" \((\d+(?:\.\d+)?) s\) (.*)$/.exec(line);
    if (t) { times.push(Number(t[2])); console.log(`${t[2].padStart(6)} s  ${t[1].slice(0, 70)}  ${t[3].replace(/[^✓✗]/g, "")}`); }
    else if (/^Nota/.test(line)) console.log(line);
  }
});
child.stderr.on("data", () => {});
child.on("close", () => {
  clearInterval(timer);
  const gb = (b) => (b / 1024 ** 3).toFixed(1);
  const sorted = [...times].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  console.log(`\nMáquina simulada: ${ram} GB, ${threads} threads, só processador`);
  console.log(`Tempo total ${Math.round((Date.now() - started) / 1000)} s | por pedido: mediana ${median} s, pior ${sorted.at(-1) || 0} s`);
  console.log(`Memória de pico: modelo ${gb(peak.server)} GB + Aurora ${gb(peak.agent)} GB = ${gb(peak.both)} GB (sobra numa máquina de ${ram} GB: ~${budget.toFixed(1)} GB) ${peak.both / 1024 ** 3 <= budget ? "CABE" : "NÃO CABE"}`);
  try { const r = JSON.parse(readFileSync(`reports/battery/${label}.json`, "utf8")); console.log(JSON.stringify(r.summary.scenarios)); } catch {}
});
