import { resolveCli, executeCli } from "./cliRuntime.js";


export function buildProviderConfig(env = process.env) {
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
 * Runs one non-interactive Claude Code CLI turn and returns its final
 * response. Mirrors app/codex.js's runCodex exactly (same error handling,
 * same stdin-close safeguard) so both providers are interchangeable from
 * the caller's point of view.
 */
export async function runClaude(prompt, env = process.env, signal) {
  try {
    const args = ["-p", prompt, "--output-format", "json", "--no-session-persistence"];
    if (env.CLAUDE_MODEL) args.push("--model", env.CLAUDE_MODEL);
    const cli = resolveCli("claude", env);
    const result = await executeCli(cli.command, [...cli.prefix, ...args], {
      cwd: env.CLAUDE_CWD || process.cwd(),
      windowsHide: true,
      signal,
      env: { ...process.env, ...env, ...(cli.runAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
      maxBuffer: 8 * 1024 * 1024,
      timeout: Number(env.CLAUDE_TIMEOUT_MS || 120_000),
    });
    const parsed = parseClaudeOutput(result.stdout);
    if (!parsed.text.trim()) throw new Error("Claude retornou uma resposta vazia ou um erro.");
    return { ok: true, status: 200, ...parsed };
  } catch (error) {
    const detail = error.code === "ENOENT"
      ? "Claude Code CLI não encontrado. Instale o Claude Code e confirme que o comando claude está no PATH."
      : error.killed
        ? "O Claude Code CLI demorou demais para responder e foi interrompido. Isso é comum na primeira execução (ex.: o Windows pode levar um tempo verificando o programa na primeira vez) — tente enviar a mensagem de novo."
        : error.stderr?.trim() || error.message || "Falha ao executar o Claude Code CLI.";
    return { ok: false, status: error.code === "ENOENT" ? 503 : 502, error: detail };
  }
}
