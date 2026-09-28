import { execFile, spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { expandPath } from "./files.js";
import { assertAllowedUrl } from "./netGuard.js";

const IS_WINDOWS = process.platform === "win32";

// Built-in Windows apps people ask for by their Portuguese name.
const BUILTIN_APPS = {
  "bloco de notas": "notepad.exe", notepad: "notepad.exe", calculadora: "calc.exe", calculator: "calc.exe",
  paint: "mspaint.exe", "explorador de arquivos": "explorer.exe", explorer: "explorer.exe", explorador: "explorer.exe",
  "prompt de comando": "cmd.exe", cmd: "cmd.exe", terminal: "wt.exe", powershell: "powershell.exe",
  "gerenciador de tarefas": "taskmgr.exe", configurações: "ms-settings:", configuracoes: "ms-settings:", settings: "ms-settings:",
  "painel de controle": "control.exe", "ferramenta de captura": "snippingtool.exe",
};

// Files opened without asking: documents and media. Anything else — .exe,
// but also .lnk, .hta, .url, .reg, .cpl, scripts — can run code, so it asks.
const SAFE_TO_OPEN = /\.(txt|md|csv|tsv|json|xml|log|pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|png|jpe?g|gif|webp|bmp|svg|mp3|wav|ogg|flac|m4a|mp4|mkv|webm|avi|mov|zip|7z|rar|html?)$/i;

export const normalizeName = (text) => String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

async function walkShortcuts(dir, out, depth = 0) {
  if (depth > 3) return out;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walkShortcuts(full, out, depth + 1);
    else if (/\.(lnk|url)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

let shortcutCache = null;
export async function startMenuShortcuts(env = process.env) {
  if (shortcutCache) return shortcutCache;
  const roots = [
    join(env.ProgramData || env.PROGRAMDATA || "C:\\ProgramData", "Microsoft", "Windows", "Start Menu", "Programs"),
    join(env.APPDATA || join(homedir(), "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs"),
  ];
  const all = [];
  for (const root of roots) await walkShortcuts(root, all);
  shortcutCache = all;
  setTimeout(() => { shortcutCache = null; }, 5 * 60_000).unref?.();
  return all;
}

/** Best Start Menu shortcut for a spoken app name ("spotify", "word"). */
export function matchShortcut(name, shortcuts) {
  const wanted = normalizeName(name);
  if (!wanted) return null;
  let best = null;
  for (const path of shortcuts) {
    const label = normalizeName(basename(path, extname(path)));
    if (/uninstall|desinstal/.test(label)) continue;
    const score = label === wanted ? 100 : label.startsWith(wanted) ? 80 - (label.length - wanted.length) / 10 : label.split(/[^a-z0-9]+/).includes(wanted) ? 60 - label.length / 10 : label.includes(wanted) ? 40 - label.length / 10 : 0;
    if (score > (best?.score || 0)) best = { path, score, label };
  }
  return best?.path || null;
}

function launch(target) {
  return new Promise((resolve, reject) => {
    // The target travels in an env var, never interpolated into a command line.
    const [cmd, args] = IS_WINDOWS
      ? ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Start-Process -FilePath $env:AURORA_OPEN_TARGET"]]
      : [process.platform === "darwin" ? "open" : "xdg-open", [target]];
    execFile(cmd, args, { windowsHide: true, timeout: 20000, env: { ...process.env, AURORA_OPEN_TARGET: target } }, (error, _stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message).trim().split("\n")[0]));
      else resolve();
    });
  });
}

export async function resolveOpenTarget(target, ctx) {
  const text = String(target || "").trim();
  if (!text) throw new Error("Informe o que abrir.");
  if (/^(https?|mailto|ms-settings|spotify|steam|zoommtg|whatsapp):/i.test(text)) return { target: text, kind: "link" };
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(text) && !/\.(txt|md|pdf|docx?|xlsx?|pptx?|png|jpe?g|csv|json|exe|lnk)$/i.test(text)) return { target: `https://${text}`, kind: "link" };
  const builtin = BUILTIN_APPS[text.toLowerCase()] || BUILTIN_APPS[normalizeName(text)];
  if (builtin) return { target: builtin, kind: "app" };
  if (/[\\/]/.test(text) || /^[a-z]:/i.test(text) || /\.[a-z0-9]{1,5}$/i.test(text) || /^(desktop|documentos|downloads|~)/i.test(text)) {
    const full = expandPath(text, ctx.knownFolders, ctx.workspace);
    if (existsSync(full)) return { target: full, kind: statSync(full).isDirectory() || SAFE_TO_OPEN.test(full) ? "path" : "executable" };
  }
  const shortcut = IS_WINDOWS ? matchShortcut(text, await startMenuShortcuts(ctx.env)) : null;
  if (shortcut) return { target: shortcut, kind: "app" };
  throw new Error(`Não encontrei um app, arquivo ou site chamado "${text}". Se for um programa, diga o nome como aparece no Menu Iniciar.`);
}

// Background processes (dev servers, watchers) the agent started this session.
const processes = new Map();
const MAX_OUTPUT = 60_000;
let nextProcess = 1;

function shellFor(command) {
  return IS_WINDOWS ? ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command]] : ["/bin/sh", ["-c", command]];
}

function stopTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (IS_WINDOWS) execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
  else child.kill("SIGTERM");
}

const commandDir = (cwd, ctx) => (cwd ? expandPath(cwd, ctx.knownFolders, ctx.workspace) : ctx.workspace || homedir());

export function stopAllBackgroundProcesses() {
  for (const entry of processes.values()) stopTree(entry.child);
}

export const systemTools = [
  {
    name: "open",
    description: "Abre no computador do usuário: um programa pelo nome (ex.: \"Spotify\", \"bloco de notas\", \"calculadora\"), um arquivo ou pasta (caminho ou Desktop/Documentos/Downloads) ou um link no navegador padrão. Para CONTROLAR um site (clicar, digitar, ler), use as ferramentas browser_*.",
    parameters: { type: "object", properties: { target: { type: "string" } }, required: ["target"] },
    stage: (a) => `Abrindo ${a.target}…`,
    async describe({ target }, ctx) {
      const resolved = await resolveOpenTarget(target, ctx);
      if (resolved.kind === "link") assertAllowedUrl(resolved.target);
      const launch = resolved.kind === "executable" ? "executable" : resolved.kind === "app" ? "app" : "document";
      return { kind: "open", launch, summary: `Abrir ${resolved.target}` };
    },
    async run({ target }, ctx) {
      const resolved = await resolveOpenTarget(target, ctx);
      await launch(resolved.target);
      return `Abri ${resolved.target}.`;
    },
  },
  {
    name: "run_command",
    description: "Executa um comando do PowerShell na pasta do projeto e devolve a saída (até 2 min). Para servidores e processos longos use background=true e acompanhe com command_output. Comandos que apagam, instalam, usam a rede ou mexem no sistema pedem autorização.",
    parameters: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string", description: "pasta onde rodar (padrão: pasta do projeto)" }, background: { type: "boolean" } }, required: ["command"] },
    stage: (a) => `Rodando ${String(a.command).slice(0, 50)}…`,
    describe: ({ command, cwd }, ctx) => ({ kind: "exec", command: String(command || ""), cwd: commandDir(cwd, ctx), summary: String(command || "") }),
    async run({ command, cwd, background }, ctx) {
      const text = String(command || "").trim();
      if (!text) throw new Error("Informe o comando.");
      const dir = commandDir(cwd, ctx);
      const [cmd, args] = shellFor(text);
      const child = spawn(cmd, args, { cwd: dir, windowsHide: true });
      let output = "";
      const append = (chunk) => {
        output = (output + chunk).slice(-MAX_OUTPUT);
        const last = output.trim().split(/\r?\n/).at(-1);
        if (last && !background) ctx.onStage?.(`${text.slice(0, 30)}: ${last.slice(0, 80)}`);
      };
      child.stdout.setEncoding("utf8").on("data", append);
      child.stderr.setEncoding("utf8").on("data", append);
      if (background) {
        const id = `p${nextProcess++}`;
        const entry = { id, command: text, cwd: dir, child, read: 0, get output() { return output; }, exit: null };
        child.on("close", (code) => { entry.exit = code; });
        child.on("error", (error) => { output += `\n${error.message}`; entry.exit = -1; });
        processes.set(id, entry);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        entry.read = output.length;
        return `Processo ${id} iniciado em segundo plano (${dir}).${entry.exit !== null ? ` Já terminou com código ${entry.exit}.` : ""}\nSaída inicial:\n${output.slice(-3000) || "(nada ainda)"}`;
      }
      return new Promise((resolve) => {
        const timer = setTimeout(() => stopTree(child), 120_000);
        const abort = () => stopTree(child);
        ctx.signal?.addEventListener("abort", abort, { once: true });
        child.on("error", (error) => { output += `\n${error.message}`; });
        child.on("close", (code, signal) => {
          clearTimeout(timer);
          ctx.signal?.removeEventListener("abort", abort);
          const status = signal || code === null ? "interrompido" : `código ${code}`;
          const tail = output.trim();
          resolve(`Comando terminou com ${status}.\n${tail.length > 6000 ? `… ${tail.slice(-6000)}` : tail || "(sem saída)"}`);
        });
      });
    },
  },
  {
    name: "command_output",
    description: "Mostra a saída nova de um processo em segundo plano (id como p1) e se ele ainda está rodando.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    stage: (a) => `Conferindo o processo ${a.id}…`,
    describe: () => ({ kind: "meta" }),
    async run({ id }) {
      const entry = processes.get(String(id));
      if (!entry) throw new Error(`Não existe processo ${id}. Em execução: ${[...processes.keys()].join(", ") || "nenhum"}.`);
      const fresh = entry.output.slice(entry.read);
      entry.read = entry.output.length;
      return `${entry.command} — ${entry.exit === null ? "rodando" : `terminou com código ${entry.exit}`}\n${fresh.trim().slice(-6000) || "(sem saída nova)"}`;
    },
  },
  {
    name: "command_stop",
    description: "Encerra um processo em segundo plano iniciado pela Aurora.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    stage: (a) => `Encerrando o processo ${a.id}…`,
    describe: () => ({ kind: "meta" }),
    async run({ id }) {
      const entry = processes.get(String(id));
      if (!entry) throw new Error(`Não existe processo ${id}.`);
      stopTree(entry.child);
      processes.delete(String(id));
      return `Encerrei ${entry.command}.`;
    },
  },
];
