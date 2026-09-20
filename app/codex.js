import { resolveCli, executeCli } from "./cliRuntime.js";


export function buildProviderConfig(env = process.env) {
  return {
    id: "codex",
    name: "Codex",
    mode: "cli",
    command: env.CODEX_BIN || "codex",
    model: env.CODEX_MODEL || "configured in Codex CLI",
    configured: resolveCli("codex", env).installed,
    authentication: "unverified",
  };
}

export function parseCodexOutput(stdout) {
  const messages = [];
  let threadId = null;
  let usage = null;

  for (const line of String(stdout).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "thread.started") threadId = event.thread_id || null;
      if (event.type === "turn.completed") usage = event.usage || null;
      if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text) {
        messages.push(event.item.text);
      }
    } catch {
      // Ignore non-JSON diagnostic lines; --json should keep the final output machine-readable.
    }
  }

  return { text: messages.at(-1) || "", threadId, usage };
}

/**
 * When `codex exec` fails (non-zero exit), the real reason is a JSON event on
 * stdout (e.g. a usage-limit or auth error), not the generic stderr noise
 * ("Reading additional input from stdin..."). Extract it when present so the
 * user sees the actual cause instead of that misleading line.
 */
export function extractCodexError(stdout) {
  for (const line of String(stdout).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "error" && event.message) return event.message;
      if (event.type === "turn.failed" && event.error?.message) return event.error.message;
    } catch {
      // Ignore non-JSON diagnostic lines.
    }
  }
  return null;
}

/**
 * Runs one ephemeral Codex CLI turn and returns its final agent message.
 * Shared by chat responses and by the memory extractor, so both paths use
 * the exact same authentication and error handling.
 */
export async function runCodex(prompt, env = process.env, signal) {
  try {
    const args = ["exec", "--ephemeral", "--json", "--skip-git-repo-check", prompt];
    if (env.CODEX_MODEL) args.splice(args.length - 1, 0, "--model", env.CODEX_MODEL);
    const cli = resolveCli("codex", env);
    const result = await executeCli(cli.command, [...cli.prefix, ...args], {
      cwd: env.CODEX_CWD || process.cwd(),
      windowsHide: true,
      signal,
      env: { ...process.env, ...env, ...(cli.runAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
      maxBuffer: 8 * 1024 * 1024,
      timeout: Number(env.CODEX_TIMEOUT_MS || 120_000),
    });
    const parsed = parseCodexOutput(result.stdout);
    if (!parsed.text.trim() || extractCodexError(result.stdout)) throw new Error(extractCodexError(result.stdout) || "Codex retornou uma resposta vazia ou inválida.");
    return { ok: true, status: 200, ...parsed };
  } catch (error) {
    const jsonError = extractCodexError(error.stdout);
    const detail = error.code === "ENOENT"
      ? "Codex CLI não encontrado. Instale o Codex e confirme que o comando codex está no PATH."
      : jsonError
        ? jsonError
        : error.killed
          ? "O Codex CLI demorou demais para responder e foi interrompido. Isso é comum na primeira execução (ex.: o Windows pode levar um tempo verificando o programa na primeira vez) — tente enviar a mensagem de novo."
          : error.stderr?.trim() || error.message || "Falha ao executar o Codex CLI.";
    return { ok: false, status: error.code === "ENOENT" ? 503 : 502, error: detail };
  }
}
