// The work laptop on this PC: the local model on the CPU only, with few threads, running real sector
// agent tasks; it prints each task's time and result and the model server's peak memory.
// node scripts/laptop-bench.mjs [--threads 4] [--only a,b] [--label nome]
import { spawn, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const threads = arg("--threads", "4");
const only = arg("--only", "rh-ferias-outubro,fin-inadimplentes-30,juridico-contratos-2026");
const label = arg("--label", `laptop-${Date.now()}`);
const env = { ...process.env, LLAMA_FORCE_CPU: "1", LLAMA_SERVER_EXTRA_ARGS: `${process.env.LLAMA_SERVER_EXTRA_ARGS || ""} -t ${threads}`.trim() };

let peak = 0;
const sample = () => {
  try {
    const out = execFileSync("powershell", ["-NoProfile", "-Command", "(Get-CimInstance Win32_Process -Filter \"Name='llama-server.exe'\" | Where-Object { $_.CommandLine -match '--alias' } | ForEach-Object { (Get-Process -Id $_.ProcessId).WorkingSet64 } | Measure-Object -Sum).Sum"], { windowsHide: true }).toString().trim();
    peak = Math.max(peak, Number(out) || 0);
  } catch { /* no server yet */ }
};
const timer = setInterval(sample, 3000);
const started = Date.now();
const child = spawn(process.execPath, ["scripts/agent-tasks.mjs", "--only", only, "--label", label], { env, stdio: ["ignore", "pipe", "pipe"] });
let out = "";
child.stdout.on("data", (d) => { out += d; process.stdout.write(String(d).split("\n").filter((l) => /^## |^Nota/.test(l)).map((l) => `${l.slice(0, 150)}\n`).join("")); });
child.stderr.on("data", () => {});
child.on("close", () => {
  clearInterval(timer);
  console.log(`\nTotal ${Math.round((Date.now() - started) / 1000)} s | memória de pico do servidor da Aurora: ${(peak / 1024 ** 3).toFixed(1)} GB | ${threads} threads, só CPU`);
  try { const r = JSON.parse(readFileSync(`reports/agentes/${label}.json`, "utf8")); console.log(JSON.stringify(r.summary)); } catch {}
});
