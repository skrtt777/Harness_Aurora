import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function buildProviderConfig(env = process.env) {
  return {
    id: "codex",
    name: "Codex",
    mode: "cli",
    command: env.CODEX_BIN || "codex",
    model: env.CODEX_MODEL || "configured in Codex CLI",
    configured: true,
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
 * Runs one ephemeral Codex CLI turn and returns its final agent message.
 * Shared by chat responses and by the memory extractor, so both paths use
 * the exact same authentication and error handling.
 */
export async function runCodex(prompt, env = process.env) {
  try {
    const args = ["exec", "--ephemeral", "--json", "--skip-git-repo-check", prompt];
    const result = await execFileAsync(env.CODEX_BIN || "codex", args, {
      cwd: env.CODEX_CWD || process.cwd(),
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      timeout: Number(env.CODEX_TIMEOUT_MS || 120_000),
    });
    return { ok: true, status: 200, ...parseCodexOutput(result.stdout) };
  } catch (error) {
    const detail = error.code === "ENOENT"
      ? "Codex CLI não encontrado. Instale o Codex e confirme que o comando codex está no PATH."
      : error.stderr?.trim() || error.message || "Falha ao executar o Codex CLI.";
    return { ok: false, status: error.code === "ENOENT" ? 503 : 502, error: detail };
  }
}
