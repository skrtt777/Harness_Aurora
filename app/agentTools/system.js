import { execFile } from "node:child_process";
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
    const full = expandPath(text, ctx.knownFolders);
    if (existsSync(full)) return { target: full, kind: statSync(full).isDirectory() || SAFE_TO_OPEN.test(full) ? "path" : "executable" };
  }
  const shortcut = IS_WINDOWS ? matchShortcut(text, await startMenuShortcuts(ctx.env)) : null;
  if (shortcut) return { target: shortcut, kind: "app" };
  throw new Error(`Não encontrei um app, arquivo ou site chamado "${text}". Se for um programa, diga o nome como aparece no Menu Iniciar.`);
}

export const systemTools = [
  {
    name: "open",
    description: "Abre no computador do usuário: um programa pelo nome (ex.: \"Spotify\", \"bloco de notas\", \"calculadora\"), um arquivo ou pasta (caminho ou Desktop/Documentos/Downloads) ou um link no navegador padrão. Para CONTROLAR um site (clicar, digitar, ler), use as ferramentas browser_*.",
    parameters: { type: "object", properties: { target: { type: "string" } }, required: ["target"] },
    risk: "safe",
    stage: (a) => `Abrindo ${a.target}…`,
    async run({ target }, ctx) {
      const resolved = await resolveOpenTarget(target, ctx);
      if (resolved.kind === "link") assertAllowedUrl(resolved.target);
      if (resolved.kind === "executable" && !(await ctx.approve({ tool: "open", summary: `Abrir ${resolved.target} (pode executar um programa)` }))) throw new Error("O usuário não autorizou executar esse programa.");
      await launch(resolved.target);
      return `Abri ${resolved.target}.`;
    },
  },
  {
    name: "run_command",
    description: "Executa um comando do PowerShell no computador do usuário e devolve a saída. SEMPRE pede autorização ao usuário antes. Use só quando nenhuma outra ferramenta resolve.",
    parameters: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string", description: "pasta onde rodar (opcional)" } }, required: ["command"] },
    risk: "exec",
    stage: (a) => `Rodando ${String(a.command).slice(0, 50)}…`,
    async run({ command, cwd }, ctx) {
      const text = String(command || "").trim();
      if (!text) throw new Error("Informe o comando.");
      const dir = cwd ? expandPath(cwd, ctx.knownFolders) : homedir();
      if (!(await ctx.approve({ tool: "run_command", summary: text, detail: `Pasta: ${dir}` }))) throw new Error("O usuário não autorizou esse comando.");
      ctx.onStage?.(`Rodando ${text.slice(0, 50)}…`);
      return new Promise((resolve) => {
        const [cmd, args] = IS_WINDOWS ? ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", text]] : ["/bin/sh", ["-c", text]];
        execFile(cmd, args, { cwd: dir, windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024, signal: ctx.signal }, (error, stdout, stderr) => {
          const out = [String(stdout || "").trim(), String(stderr || "").trim() && `stderr:\n${String(stderr).trim()}`].filter(Boolean).join("\n\n");
          const status = error ? (error.killed ? "interrompido (tempo esgotado)" : `código ${error.code ?? "?"}`) : "código 0";
          resolve(`Comando terminou com ${status}.\n${out.slice(0, 6000) || "(sem saída)"}`);
        });
      });
    },
  },
];
