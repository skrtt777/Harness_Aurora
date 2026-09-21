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
  const started=performance.now();
  const baseUrl = env.LOCAL_BASE_URL || "http://127.0.0.1:11434";
  const model = await resolveLocalModel(env);
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), Number(env.LOCAL_TIMEOUT_MS || 60_000));
  const signal = externalSignal ? AbortSignal.any([timeoutController.signal, externalSignal]) : timeoutController.signal;
  try {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false,
        ...(/^qwen3(?:[.:-]|$)/i.test(model.split('/').at(-1)) ? { think: env.LOCAL_THINK === 'true' } : {}),
        ...(env.LOCAL_OUTPUT_SCHEMA ? { format:JSON.parse(env.LOCAL_OUTPUT_SCHEMA) } : env.LOCAL_OUTPUT_FORMAT === 'json' ? { format:'json' } : {}), options: {
        num_ctx: Math.min(32768, Math.max(2048, Number(env.LOCAL_CONTEXT_TOKENS) || 8192)),
        num_predict: Math.min(8192, Math.max(128, Number(env.LOCAL_MAX_OUTPUT_TOKENS) || 2048)),
        ...(env.LOCAL_SEED !== undefined && Number.isInteger(Number(env.LOCAL_SEED)) ? {seed:Number(env.LOCAL_SEED)} : {}),
        ...(env.LOCAL_TEMPERATURE !== undefined && Number.isFinite(Number(env.LOCAL_TEMPERATURE)) ? {temperature:Math.min(2,Math.max(0,Number(env.LOCAL_TEMPERATURE)))} : {}),
      } }),
      signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { ok: false, status: 502, error: text.trim() || `O Ollama respondeu com erro ${response.status}.`, metrics:{wallMs:performance.now()-started,model} };
    }
    const data = await response.json();
    const usage = Number.isFinite(data.prompt_eval_count) && Number.isFinite(data.eval_count)
      ? { input_tokens: data.prompt_eval_count, output_tokens: data.eval_count } : null;
    const metrics={model,wallMs:performance.now()-started,cachedInputTokens:Number.isFinite(data.prompt_eval_cached_count)?data.prompt_eval_cached_count:null,...Object.fromEntries(['total_duration','load_duration','prompt_eval_duration','eval_duration'].map(k=>[k,Number.isFinite(data[k])?data[k]:null]))};
    if (typeof data.response !== 'string' || !data.response.trim()) return {ok:false,status:502,error:'O modelo local retornou uma resposta vazia ou inválida.',usage,metrics};
    return { ok: true, status: 200, text: data.response || "", threadId: null, usage, metrics, truncated: data.done_reason === "length" };
  } catch (error) {
    const detail =
      error.name === "AbortError"
        ? externalSignal?.aborted
          ? "Cancelado pelo usuário."
          : "O modelo local demorou demais para responder. Modelos locais podem ser lentos sem GPU dedicada — tente de novo ou use um modelo menor."
        : error.cause?.code === "ECONNREFUSED" || String(error.message || "").includes("fetch failed")
          ? "Não foi possível conectar ao Ollama em 127.0.0.1:11434. Abra a aba \"Local\" para preparar o modelo automaticamente."
          : error.message || "Falha ao executar o modelo local.";
    return { ok: false, status: 502, error: detail, cancelled: Boolean(externalSignal?.aborted),metrics:{model,wallMs:performance.now()-started} };
  } finally {
    clearTimeout(timer);
  }
}
