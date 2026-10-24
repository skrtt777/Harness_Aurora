// Installing Hermes Agent and OpenClaw from Configurações (one click each), with their official installers:
//   - Hermes:   https://hermes-agent.nousresearch.com/install.ps1 (-SkipSetup: the account comes later);
//   - OpenClaw: https://openclaw.ai/install.ps1 (-NoOnboard: the same).
// No admin rights; each goes to the person's own folders. The progress is kept as lines the app polls. Then
// "Configurar conta" opens their own setup wizard in a terminal window (choosing a model, signing in) — that
// part is theirs, interactive by design. Windows only (the Aurora's desktop app); elsewhere the command is shown.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

export const INSTALLERS = {
  hermes: { label: "Hermes", url: "https://hermes-agent.nousresearch.com/install.ps1", args: "-SkipSetup", setup: "hermes setup", docs: "https://hermes-agent.nousresearch.com/docs/user-guide/windows-native" },
  openclaw: { label: "OpenClaw", url: "https://openclaw.ai/install.ps1", args: "-NoOnboard", setup: "openclaw onboard", docs: "https://docs.openclaw.ai/install/installer" },
};

const jobs = new Map();
const MAX_LINES = 200;

/** The PowerShell line that runs an installer (a local script in INSTALL_SCRIPT_<ID> replaces the download: tests). */
export function installCommand(id, env = process.env) {
  const it = INSTALLERS[id];
  if (!it) return null;
  const local = env[`INSTALL_SCRIPT_${id.toUpperCase()}`];
  const source = local ? `(Get-Content -Raw '${local.replace(/'/g, "''")}')` : `(irm '${it.url}')`;
  return `& ([scriptblock]::Create(${source})) ${it.args}`;
}

/** Starts the installer in the background; returns the job to poll. */
export function startInstall(id, { env = process.env, platform = process.platform } = {}) {
  const it = INSTALLERS[id];
  if (!it) throw Object.assign(new Error("Instalador desconhecido."), { status: 400 });
  if (platform !== "win32") throw Object.assign(new Error(`Neste sistema, instale o ${it.label} pelo terminal: ${it.docs}`), { status: 400 });
  const running = [...jobs.values()].find((j) => j.id === id && j.state === "instalando");
  if (running) return publicJob(running);
  const job = { jobId: randomUUID(), id, label: it.label, state: "instalando", lines: [], startedAt: Date.now(), endedAt: null, code: null };
  jobs.set(job.jobId, job);
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", installCommand(id, env)], { windowsHide: true, env: { ...process.env, ...env } });
  const add = (chunk) => {
    for (const line of String(chunk).replace(/\u001b\[[0-9;]*m/g, "").split(/\r?\n/)) if (line.trim()) job.lines.push(line.trim().slice(0, 300));
    if (job.lines.length > MAX_LINES) job.lines.splice(0, job.lines.length - MAX_LINES);
  };
  child.stdout.on("data", add);
  child.stderr.on("data", add);
  child.on("error", (error) => { add(error.message); job.state = "falhou"; job.endedAt = Date.now(); });
  child.on("close", (code) => { job.code = code; job.state = code === 0 ? "instalado" : "falhou"; job.endedAt = Date.now(); });
  return publicJob(job);
}

const publicJob = (j) => ({ jobId: j.jobId, id: j.id, label: j.label, state: j.state, lines: j.lines.slice(-12), startedAt: j.startedAt, endedAt: j.endedAt, code: j.code });
export function installJob(jobId) {
  const job = jobs.get(jobId);
  return job ? publicJob(job) : null;
}

/** Their own setup wizard (model and account), in a terminal window the person sees and answers. */
export function openSetup(id, { platform = process.platform, launch = spawn } = {}) {
  const it = INSTALLERS[id];
  if (!it) throw Object.assign(new Error("Assistente desconhecido."), { status: 400 });
  if (platform !== "win32") throw Object.assign(new Error(`Abra um terminal e rode: ${it.setup}`), { status: 400 });
  const child = launch("cmd.exe", ["/d", "/c", "start", `Configurar ${it.label}`, "powershell.exe", "-NoExit", "-Command", it.setup], { detached: true, stdio: "ignore", windowsHide: false });
  child.unref?.();
  return { ok: true, command: it.setup };
}
