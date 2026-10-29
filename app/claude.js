import { resolveCli, executeCli } from "./cliRuntime.js";
import {remoteTeacher} from './remoteXR.js';


export function buildProviderConfig(env = process.env) {
  if(env.HARNESS_PLATFORM==='quest')return {id:'claude',name:'Claude (professor remoto)',mode:'relay',configured:!!env.HARNESS_REMOTE_CONFIG,authentication:'unverified'};
  return {
    id: "claude",
    name: "Claude",
    mode: "cli",
    command: env.CLAUDE_BIN || "claude",
    model: env.CLAUDE_MODEL || "configured in Claude Code CLI",
    configured: resolveCli("claude", env).installed,
    authentication: "unverified",
  };
}

export function parseClaudeOutput(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    if (parsed.is_error || typeof parsed.result !== "string") return { text: "", threadId: null, usage: null };
    return { text: parsed.result || "", threadId: parsed.session_id || null, usage: parsed.usage || null };
  } catch {
    return { text: "", threadId: null, usage: null };
  }
}

/**
 * Why the CLI failed, in its own words: with the account's limit reached it exits 1 with nothing on stderr and
 * the reason only in the JSON on stdout; the person saw "Command failed: C:\…\claude.exe -p …" (29/10).
 */
export function claudeError(stdout) {
  try {
    const parsed = JSON.parse(String(stdout || "").trim().split(/\r?\n/).pop());
    const why = String(parsed.result || parsed.error || "").trim();
    if (!why) return "";
    return /limit|usage|quota|rate/i.test(why) ? `O Claude atingiu o limite de uso da sua conta: ${why}. Use a IA local ou o Codex até o limite voltar.` : `O Claude respondeu com erro: ${why}`;
  } catch { return ""; }
}

/**
 * Claude Code doing a task for real (app/engine.js): it edits files only inside `cwd` (acceptEdits keeps
 * its edits there) and its terminal runs only python/py/pip/node, to build what the local model could not
 * (a chart, a converted file, a script). Same result shape as runClaude.
 */
export const CLAUDE_EXECUTOR_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "Bash(python:*)", "Bash(py:*)", "Bash(pip:*)", "Bash(pip3:*)", "Bash(node:*)"];
export async function runClaudeAgent(prompt, { cwd, env = process.env, signal, timeoutMs } = {}) {
  try {
    const args = ["-p", "--output-format", "json", "--no-session-persistence", "--permission-mode", "acceptEdits", "--allowedTools", ...CLAUDE_EXECUTOR_TOOLS];
    if (env.CLAUDE_MODEL) args.push("--model", env.CLAUDE_MODEL);
    const cli = resolveCli("claude", env);
    const result = await executeCli(cli.command, [...cli.prefix, ...args], {
      cwd, windowsHide: true, signal,
      env: { ...process.env, ...env, ...(cli.runAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
      maxBuffer: 16 * 1024 * 1024, input: prompt,
      timeout: timeoutMs || Number(env.CLAUDE_AGENT_TIMEOUT_MS || 600_000),
    });
    let parsed = null; try { parsed = JSON.parse(result.stdout); } catch { /* not JSON */ }
    if (parsed?.is_error) return { ok: false, status: 502, error: String(parsed.result || "Claude terminou com erro.") };
    const text = String(parsed?.result || "").trim();
    if (!text) return { ok: false, status: 502, error: "Claude retornou uma resposta vazia." };
    return { ok: true, status: 200, text, usage: parsed?.usage || null };
  } catch (error) {
    let fromJson = null; try { const p = JSON.parse(error.stdout || ""); if (p?.result) fromJson = String(p.result); } catch { /* not JSON */ }
    const detail = error.code === "ENOENT" ? "Claude Code CLI não encontrado." : fromJson || (error.killed ? "O Claude demorou demais e foi interrompido." : error.stderr?.trim() || error.message || "Falha ao executar o Claude Code CLI.");
    return { ok: false, status: error.code === "ENOENT" ? 503 : 502, error: detail };
  }
}

/**
 * Runs one non-interactive Claude Code CLI turn and returns its final
 * response. Mirrors app/codex.js's runCodex exactly (same error handling,
 * same stdin-close safeguard) so both providers are interchangeable from
 * the caller's point of view.
 */
// One text turn may take minutes: a big prompt (the agent's rules, a document) on a slow connection. At
// 120 s every request of a Power BI at work was killed and looked cancelled (28/10).
export const CLAUDE_TIMEOUT_MS = 300_000;

export async function runClaude(prompt, env = process.env, signal) {
  if(env.HARNESS_PLATFORM==='quest')return remoteTeacher('claude',prompt,env,signal);
  const timeoutMs = Number(env.CLAUDE_TIMEOUT_MS || CLAUDE_TIMEOUT_MS);
  // Text only: the Harness runs the tools (app/chatAgent.js), so Claude Code's own are off (--tools ""),
  // or it walks the Harness folder on its own and spends the time. An old CLI without --tools: once without.
  // --permission-mode: the person's own Claude Code may default to Plan ("defaultMode": "plan" in
  // ~/.claude/settings.json), and claude -p inherits it: every answer was "esta sessão está em modo de
  // planejamento, não posso criar arquivos" (28/10). The Harness asks for nothing to run here, so any
  // mode that is not Plan will do; acceptEdits exists in every CLI version.
  const attempt = async (noTools) => {
    const args = ["-p", "--output-format", "json", "--no-session-persistence", "--permission-mode", "acceptEdits", ...(noTools ? ["--tools", ""] : [])];
    if (env.CLAUDE_MODEL) args.push("--model", env.CLAUDE_MODEL);
    const cli = resolveCli("claude", env);
    return executeCli(cli.command, [...cli.prefix, ...args], {
      cwd: env.CLAUDE_CWD || process.cwd(),
      windowsHide: true,
      signal,
      env: { ...process.env, ...env, ...(cli.runAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
      maxBuffer: 8 * 1024 * 1024,
      input: prompt,
      timeout: timeoutMs,
    });
  };
  try {
    const result = await attempt(true).catch((error) => (/unknown option|--tools/i.test(String(error.stderr || "")) ? attempt(false) : Promise.reject(error)));
    const parsed = parseClaudeOutput(result.stdout);
    if (!parsed.text.trim()) throw new Error("Claude retornou uma resposta vazia ou um erro.");
    return { ok: true, status: 200, ...parsed };
  } catch (error) {
    const detail = error.code === "ENOENT"
      ? "Claude Code CLI não encontrado. Instale o Claude Code e confirme que o comando claude está no PATH."
      : signal?.aborted
        ? "Mensagem cancelada."
        : error.killed
          ? `O Claude não respondeu em ${Math.round(timeoutMs / 60_000)} minutos e foi interrompido (não foi você que cancelou). Tente de novo; se repetir, a conexão com o Claude pode estar lenta.`
          : claudeError(error.stdout) || error.stderr?.trim() || error.message || "Falha ao executar o Claude Code CLI.";
    return { ok: false, status: error.code === "ENOENT" ? 503 : 502, error: detail };
  }
}
