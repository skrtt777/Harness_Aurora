import { resolveLocalModel, isServerUp, isModelPulled } from "./ollamaSetup.js";

export async function buildProviderConfig(env = process.env) {
  const model = await resolveLocalModel(env);
  const baseUrl = env.LOCAL_BASE_URL || "http://127.0.0.1:11434";
  const ready = await isServerUp(baseUrl) && await isModelPulled(baseUrl, model);
  return {
    id: "local",
    name: "Local (Ollama)",
    mode: "http",
    command: model,
    model,
    configured: ready,
  };
}

/**
 * Talks to a local Ollama server over plain HTTP instead of spawning a CLI
 * subprocess like runCodex/runClaude do — Ollama already exposes a simple
 * REST API on 127.0.0.1, so there's no process/stdin management needed here.
 *
 * `externalSignal` (optional) lets a caller cancel an in-flight call — e.g.
 * the user hitting "Cancelar" on a slow local turn — independent of the
 * timeout below, which still applies on its own.
 */
export async function runLocal(prompt, env = process.env, externalSignal) {
  const baseUrl = env.LOCAL_BASE_URL || "http://127.0.0.1:11434";
  const model = await resolveLocalModel(env);
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), Number(env.LOCAL_TIMEOUT_MS || 60_000));
  const signal = externalSignal ? AbortSignal.any([timeoutController.signal, externalSignal]) : timeoutController.signal;
  try {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { ok: false, status: 502, error: text.trim() || `O Ollama respondeu com erro ${response.status}.` };
    }
    const data = await response.json();
    if (typeof data.response !== "string" || !data.response.trim()) return { ok: false, status: 502, error: "O modelo local retornou uma resposta vazia ou inválida." };
    return { ok: true, status: 200, text: data.response || "", threadId: null, usage: null };
  } catch (error) {
    const detail =
      error.name === "AbortError"
        ? externalSignal?.aborted
          ? "Cancelado pelo usuário."
          : "O modelo local demorou demais para responder. Modelos locais podem ser lentos sem GPU dedicada — tente de novo ou use um modelo menor."
        : error.cause?.code === "ECONNREFUSED" || String(error.message || "").includes("fetch failed")
          ? "Não foi possível conectar ao Ollama em 127.0.0.1:11434. Abra a aba \"Local\" para preparar o modelo automaticamente."
          : error.message || "Falha ao executar o modelo local.";
    return { ok: false, status: 502, error: detail, cancelled: Boolean(externalSignal?.aborted) };
  } finally {
    clearTimeout(timer);
  }
}
