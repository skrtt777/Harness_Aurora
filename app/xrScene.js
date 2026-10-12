// Scenes of Aurora XR asked of the Aurora's own local model with the answer held to a JSON schema
// (only zones that exist, only types of the object library, sensible counts): a small model writing a
// long JSON as free text stopped in the middle or wandered off (12/10/2026, qwen3.5:4b on the Quest
// test). The model is the one the desktop already runs (its llama-server, LLAMA_SERVER_PORT, 18181):
// no second copy in memory. Without it, the app asks in the conversation as before.
import { runLlama } from './localLlama.js';

const MAX_PROMPT = 60000, MAX_SCHEMA = 60000;

/** The model the desktop's llama-server serves, or null when it is not running. */
async function served(base, fetchImpl) {
  try {
    const r = await fetchImpl(`${base}/v1/models`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return null;
    const data = await r.json();
    return data.data?.[0]?.id || data.models?.[0]?.name || null;
  } catch { return null; }
}

/**
 * scene({ system, prompt, schema }) -> { text } (the JSON answer). Throws 503 when the local model is
 * not running, 502 when it fails.
 */
export function createSceneModel({ env = process.env, run = runLlama, fetchImpl = globalThis.fetch } = {}) {
  const base = env.AURORA_XR_SCENE_URL || `http://127.0.0.1:${Number(env.LLAMA_SERVER_PORT) || 18181}`;
  const scene = async ({ system, prompt, schema }) => {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_PROMPT) throw Object.assign(new Error('Pedido de cenário inválido.'), { status: 400 });
    if (system != null && (typeof system !== 'string' || system.length > MAX_PROMPT)) throw Object.assign(new Error('Instrução inválida.'), { status: 400 });
    const schemaText = JSON.stringify(schema ?? null);
    if (!schema || typeof schema !== 'object' || schemaText.length > MAX_SCHEMA) throw Object.assign(new Error('Formato de cenário inválido.'), { status: 400 });
    const model = await served(base, fetchImpl);
    if (!model) throw Object.assign(new Error('O modelo local da Aurora não está ligado.'), { status: 503 });
    const messages = [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }];
    const r = await run(messages, { ...env, LOCAL_ENGINE: 'llama.cpp', LOCAL_BASE_URL: base, LOCAL_MODEL: model, LOCAL_OUTPUT_SCHEMA: schemaText,
      LOCAL_MAX_OUTPUT_TOKENS: '1800', LOCAL_CONTEXT_TOKENS: env.LOCAL_CONTEXT_TOKENS || '16384', LOCAL_TEMPERATURE: '0.7', LOCAL_TIMEOUT_MS: '150000' });
    if (!r.ok) throw Object.assign(new Error(r.error || 'O modelo local não respondeu.'), { status: 502 });
    return { text: r.text, model, usage: r.usage || null, truncated: !!r.truncated };
  };
  scene.available = async () => !!(await served(base, fetchImpl));
  return scene;
}
