import { resolveLocalModel, isServerUp, isModelPulled } from "./ollamaSetup.js";
import {llamaReady,runLlama} from './localLlama.js';

// Shared with app/server.js (Settings) and app/localRefine.js — the single
// source of truth for what "unconfigured" means for these two knobs.
export const LOCAL_SETTINGS_DEFAULTS = { contextTokens: 8192, maxFixAttempts: 2 };
export const LOCAL_CONTEXT_TOKENS_RANGE = { min: 2048, max: 32768 };
export const LOCAL_MAX_FIX_ATTEMPTS_RANGE = { min: 0, max: 5 };

// Ollama unloads an idle model after 5 min by default; the next message then
// pays a multi-second load. A personal assistant is used in bursts, so keep it
// warm longer (LOCAL_KEEP_ALIVE accepts Ollama durations: "10m", "-1", "0").
export function keepAlive(env = process.env) {
  return env.LOCAL_KEEP_ALIVE || "30m";
}

export async function buildProviderConfig(env = process.env) {
  if(env.LOCAL_ENGINE==='llama.cpp')return {id:'local',name:'Local (Quest)',mode:'http',command:env.LOCAL_MODEL,model:env.LOCAL_MODEL,configured:await llamaReady(env)};
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
// Reasoning ("thinking") models answer an agent step much slower and the
// agent loop doesn't use the trace: it is turned off unless LOCAL_THINK=true.
// gpt-oss can't turn it off, only down to "low". Which models think is asked
// to Ollama once (/api/show capabilities) instead of guessed by name.
const thinkingModels = new Map();
export async function thinkOption(baseUrl, model, env = process.env) {
  const name = model.split('/').at(-1);
  const on = env.LOCAL_THINK === 'true';
  if (/^gpt-oss(?:[.:-]|$)/i.test(name)) return { think: on ? 'medium' : 'low' };
  if (/^qwen3(?:[.:-]|$)/i.test(name)) return { think: on };
  const key = `${baseUrl}|${model}`;
  if (!thinkingModels.has(key)) {
    thinkingModels.set(key, fetch(`${baseUrl}/api/show`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model }), signal: AbortSignal.timeout(5000) })
      .then((r) => (r.ok ? r.json() : null)).then((d) => Array.isArray(d?.capabilities) && d.capabilities.includes('thinking')).catch(() => false));
  }
  return (await thinkingModels.get(key)) ? { think: on } : {};
}

export async function runLocal(prompt, env = process.env, externalSignal, {onText}={}) {
  if(env.LOCAL_ENGINE==='llama.cpp')return runLlama(prompt,env,externalSignal,{onText});
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
      body: JSON.stringify({ model, prompt, stream: false, keep_alive: keepAlive(env),
        ...(await thinkOption(baseUrl, model, env)),
        ...(env.LOCAL_OUTPUT_SCHEMA ? { format:JSON.parse(env.LOCAL_OUTPUT_SCHEMA) } : env.LOCAL_OUTPUT_FORMAT === 'json' ? { format:'json' } : {}), options: {
        num_ctx: Math.min(LOCAL_CONTEXT_TOKENS_RANGE.max, Math.max(LOCAL_CONTEXT_TOKENS_RANGE.min, Number(env.LOCAL_CONTEXT_TOKENS) || LOCAL_SETTINGS_DEFAULTS.contextTokens)),
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
    const detail = localErrorDetail(error, externalSignal);
    return { ok: false, status: 502, error: detail, cancelled: Boolean(externalSignal?.aborted),metrics:{model,wallMs:performance.now()-started} };
  } finally {
    clearTimeout(timer);
  }
}

function localErrorDetail(error, externalSignal) {
  return error.name === "AbortError"
    ? externalSignal?.aborted
      ? "Cancelado pelo usuário."
      : "O modelo local demorou demais para responder. Modelos locais podem ser lentos sem GPU dedicada — tente de novo ou use um modelo menor."
    : error.cause?.code === "ECONNREFUSED" || String(error.message || "").includes("fetch failed")
      ? "Não foi possível conectar ao Ollama em 127.0.0.1:11434. Abra a aba \"Local\" para preparar o modelo automaticamente."
      : error.message || "Falha ao executar o modelo local.";
}

/**
 * One turn of the chat agent against Ollama's /api/chat with native tool
 * calling (Qwen3.x emits real `tool_calls`). Unlike runLocal this takes a
 * role-tagged message list, so tool results go back as `tool` messages the
 * model was trained on instead of being pasted into one flat prompt.
 * Returns {ok, text, toolCalls:[{name, arguments}]}.
 */
export async function runLocalChat(messages, tools = [], env = process.env, externalSignal) {
  const started=performance.now();
  const baseUrl = env.LOCAL_BASE_URL || "http://127.0.0.1:11434";
  const model = await resolveLocalModel(env);
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), Number(env.LOCAL_TIMEOUT_MS || 120_000));
  const signal = externalSignal ? AbortSignal.any([timeoutController.signal, externalSignal]) : timeoutController.signal;
  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false, keep_alive: keepAlive(env),
        ...(tools.length ? { tools } : {}),
        ...(await thinkOption(baseUrl, model, env)),
        options: {
          num_ctx: Math.min(LOCAL_CONTEXT_TOKENS_RANGE.max, Math.max(LOCAL_CONTEXT_TOKENS_RANGE.min, Number(env.LOCAL_CONTEXT_TOKENS) || LOCAL_SETTINGS_DEFAULTS.contextTokens)),
          num_predict: Math.min(8192, Math.max(128, Number(env.LOCAL_MAX_OUTPUT_TOKENS) || 2048)),
          ...(env.LOCAL_SEED !== undefined && Number.isInteger(Number(env.LOCAL_SEED)) ? {seed:Number(env.LOCAL_SEED)} : {}),
          ...(env.LOCAL_TEMPERATURE !== undefined && Number.isFinite(Number(env.LOCAL_TEMPERATURE)) ? {temperature:Math.min(2,Math.max(0,Number(env.LOCAL_TEMPERATURE)))} : {}),
        } }),
      signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      // Custom/fine-tuned models without a tools template (and servers
      // without /api/chat) can't run the agent: the caller falls back to
      // the plain-text pipeline instead of failing the turn.
      const unsupported = response.status === 404 || /does not support tools/i.test(text);
      return { ok: false, status: 502, unsupported, error: text.trim() || `O Ollama respondeu com erro ${response.status}.`, metrics:{wallMs:performance.now()-started,model} };
    }
    const data = await response.json();
    const usage = Number.isFinite(data.prompt_eval_count) && Number.isFinite(data.eval_count)
      ? { input_tokens: data.prompt_eval_count, output_tokens: data.eval_count } : null;
    const metrics={model,wallMs:performance.now()-started,cachedInputTokens:Number.isFinite(data.prompt_eval_cached_count)?data.prompt_eval_cached_count:null,...Object.fromEntries(['total_duration','load_duration','prompt_eval_duration','eval_duration'].map(k=>[k,Number.isFinite(data[k])?data[k]:null]))};
    if (!data.message || typeof data.message !== 'object') return {ok:false,status:502,unsupported:true,error:'O servidor local não respondeu no formato de chat.',usage,metrics};
    const toolCalls = (data.message?.tool_calls || []).map(call => ({ name: call.function?.name, arguments: call.function?.arguments || {} })).filter(call => call.name);
    const text = typeof data.message?.content === 'string' ? data.message.content : '';
    if (!toolCalls.length && !text.trim()) return {ok:false,status:502,error:'O modelo local retornou uma resposta vazia ou inválida.',usage,metrics};
    return { ok: true, status: 200, text, toolCalls, threadId: null, usage, metrics, truncated: data.done_reason === "length" };
  } catch (error) {
    return { ok: false, status: 502, error: localErrorDetail(error, externalSignal), cancelled: Boolean(externalSignal?.aborted),metrics:{model,wallMs:performance.now()-started} };
  } finally {
    clearTimeout(timer);
  }
}
