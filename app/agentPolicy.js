import { isAbsolute, relative, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import { isSensitivePath } from "./fileAccess.js";

/**
 * Permission modes, decided once per tool call instead of inside each tool:
 * - manual: reads inside the workspace and browsing run freely; every write,
 *   command and app launch asks first.
 * - auto: inside the workspace everything runs, except deleting, installing,
 *   network transfers and system-level commands, which still ask; anything
 *   outside the workspace asks.
 * - plan: read-only — look, search and propose; nothing is changed.
 * Heuristics, not a sandbox: Auto trusts commands that look local and
 * harmless, which is why the dangerous families below always ask.
 */
export const AGENT_MODES = ["manual", "auto", "plan"];
export const DEFAULT_AGENT_MODE = "auto";

const DANGEROUS = [
  [/\b(remove-item|rm|rmdir|rd|del|erase|clear-content|clear-recyclebin)\b/i, "apaga arquivos"],
  [/(^|[;&|]\s*)format(\.com)?\s+[a-z]:|\b(format-volume|clear-disk|diskpart|cipher\s+\/w|bcdedit|mkfs)\b/i, "mexe em discos"],
  [/\b(winget|choco|scoop|msiexec|apt(-get)?|brew|install-module|install-package)\b|\b(npm|pnpm|yarn)\s+(i|install|add)\b.*\s-g\b|\bpip3?\s+install\b|\bnpm\s+(i|install)\s+-g\b/i, "instala software"],
  [/\b(invoke-webrequest|iwr|invoke-restmethod|irm|curl|wget|start-bitstransfer|ssh|scp|sftp|ftp|nc|ncat)\b|\bgit\s+(push|clone|pull|fetch)\b/i, "usa a rede"],
  [/\b(shutdown|restart-computer|stop-computer|logoff|reg(\.exe)?\s+(add|delete|import)|set-itemproperty\s+.*hk(lm|cu)|set-executionpolicy|takeown|icacls|net\s+(user|localgroup)|sc(\.exe)?\s+(stop|delete|config|create)|schtasks|new-service|stop-process|taskkill|kill)\b/i, "altera o sistema"],
  [/\b(runas|sudo)\b|-verb\s+runas|\b(invoke-expression|iex)\b|-enc(odedcommand)?\b/i, "eleva privilégio ou executa código oculto"],
  [/\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s|push\s+.*--force)\b/i, "descarta trabalho no git"],
];

export function dangerousReason(command) {
  const text = String(command || "");
  for (const [pattern, reason] of DANGEROUS) if (pattern.test(text)) return reason;
  return null;
}

// Absolute paths a command mentions (C:\..., \\server\..., /home/...).
export function commandPaths(command) {
  return [...String(command || "").matchAll(/(?:^|[\s"'=(])((?:[a-z]:[\\/]|\\\\)[^\s"'|;&<>]*)/gi)].map((m) => m[1]);
}

async function realish(path) {
  try { return await realpath(path); } catch { return resolve(path); }
}

export async function insideWorkspace(path, roots = []) {
  const target = (await realish(resolve(path))).toLowerCase();
  for (const root of roots) {
    const base = (await realish(resolve(root))).toLowerCase();
    const rel = relative(base, target);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return true;
  }
  return false;
}

/** "npm test", "git status": the part of a command an "always allow" rule matches. */
export function commandRule(command) {
  const words = String(command || "").trim().split(/\s+/);
  const head = words.slice(0, words[1] && /^[a-z][\w:-]*$/i.test(words[1]) ? 2 : 1).join(" ");
  return head.toLowerCase();
}

export function matchesAlwaysAllow(rules = [], tool, command) {
  const text = String(command || "").trim().toLowerCase();
  return rules.some((rule) => rule.tool === tool && (text === rule.prefix || text.startsWith(`${rule.prefix} `)));
}

/**
 * access: what the call touches, from the tool's own describe():
 * { kind: "browse" | "interact" | "meta" | "read" | "write" | "exec" | "open" | "import",
 *   paths?, command?, cwd?, target?, launch? }
 * Returns { action: "allow" | "ask" | "deny", reason, rule? }.
 */
export async function decide(access, ctx) {
  const mode = AGENT_MODES.includes(ctx.mode) ? ctx.mode : DEFAULT_AGENT_MODE;
  const roots = ctx.workspaceRoots || [];
  const inside = async (paths = []) => {
    for (const path of paths) if (!(await insideWorkspace(path, roots))) return false;
    return true;
  };
  switch (access.kind) {
    case "browse":
    case "meta":
      return { action: "allow" };
    case "interact":
      return mode === "plan" ? { action: "deny", reason: "No modo Plano a Aurora só observa páginas; não clica nem digita." } : { action: "allow" };
    case "share":
      return { action: "ask", reason: "Enviar trechos de documentos internos para a IA paga" };
    // A tool of an MCP server the person plugged in (e-mail, calendar…). One that only reads, by
    // the server's own annotation, runs like browsing; anything else asks, or is refused in Plan.
    case "external":
      if (access.readOnly) return { action: "allow" };
      if (mode === "plan") return { action: "deny", reason: "No modo Plano nenhuma extensão faz alterações; proponha ao usuário." };
      if (matchesAlwaysAllow(ctx.alwaysAllow, access.tool, access.tool)) return { action: "allow" };
      return { action: "ask", reason: "Ação de uma extensão (MCP) fora do computador", rule: access.tool };
    case "import":
      return mode === "plan" ? { action: "deny", reason: "No modo Plano nada é instalado." } : { action: "ask", reason: "Usar instruções de uma skill de terceiros" };
    case "configure":
      return mode === "plan" ? { action: "deny", reason: "No modo Plano a configuração não muda; proponha ao usuário." } : { action: "ask", reason: "Mudar as pastas que a Aurora conhece" };
    case "read": {
      if (await inside(access.paths)) return { action: "allow" };
      // "Full computer access" (personal use): any drive, except secrets and the system.
      if (access.paths?.length && ctx.readRoots?.length && access.paths.every((p) => !isSensitivePath(p))) {
        let all = true;
        for (const path of access.paths) if (!(await insideWorkspace(path, ctx.readRoots))) { all = false; break; }
        if (all) return { action: "allow" };
      }
      // Company knowledge folders the person registered are read like the
      // project (the indexer already reads them); paid chats still ask (share).
      const knowledge = ctx.knowledgeRoots || [];
      if (access.paths?.length && knowledge.length) {
        let all = true;
        for (const path of access.paths) if (!(await insideWorkspace(path, knowledge))) { all = false; break; }
        if (all) return { action: "allow" };
      }
      return { action: "ask", reason: "Ler fora da pasta do projeto" };
    }
    case "write":
      if (mode === "plan") return { action: "deny", reason: "No modo Plano nada é alterado; proponha a mudança ao usuário." };
      if (mode === "manual") return { action: "ask", reason: "Modo Manual: toda alteração pede autorização" };
      return (await inside(access.paths)) ? { action: "allow" } : { action: "ask", reason: "Alterar fora da pasta do projeto" };
    case "open":
      if (access.launch === "document") return { action: "allow" };
      if (mode === "plan") return { action: "deny", reason: "No modo Plano nada é aberto ou executado." };
      if (access.launch === "executable") return { action: "ask", reason: "Pode executar um programa" };
      return mode === "manual" ? { action: "ask", reason: "Modo Manual: abrir programas pede autorização" } : { action: "allow" };
    case "exec": {
      if (mode === "plan") return { action: "deny", reason: "No modo Plano nenhum comando é executado." };
      const danger = dangerousReason(access.command);
      const rule = danger ? undefined : commandRule(access.command);
      if (danger) return { action: "ask", reason: `Comando que ${danger}` };
      if (matchesAlwaysAllow(ctx.alwaysAllow, "run_command", access.command)) return { action: "allow" };
      if (mode === "manual") return { action: "ask", reason: "Modo Manual: todo comando pede autorização", rule };
      // A page can carry hidden instructions ("rode este comando"): after reading the
      // web in this turn, even a command inside the project folder asks first.
      if (ctx.untrustedSeen) return { action: "ask", reason: "Comando depois de ler conteúdo da internet nesta conversa", rule };
      if (!(await inside([access.cwd, ...commandPaths(access.command)].filter(Boolean)))) return { action: "ask", reason: "Comando fora da pasta do projeto", rule };
      return { action: "allow" };
    }
    default:
      return { action: "ask", reason: "Ação desconhecida" };
  }
}
