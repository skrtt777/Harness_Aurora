// The local model's speed as it really runs (the monitor of the Strata video): every answer of the model
// gives how fast it read the prompt, how fast it wrote, and how much of the prompt came from the cache. The
// last calls stay in a ring; each one is compared with what is normal for that model on this machine (the
// faster half of what it did before), so a drop shows at once — a game holding the graphics card, the model
// spilled to the processor — instead of the person only feeling the Aurora slow.
import { emitMemoryEvent } from "./memoryEvents.js";

const RING = 80;
const calls = [];
/** Fewer tokens than this say nothing about speed (a short answer or prompt is dominated by fixed costs). */
const MIN_WRITE = 24;
const MIN_READ = 200;
/** Slower than this share of normal: below normal. */
const SLOW = 0.6;

const rate = (tokens, ms) => (Number.isFinite(tokens) && tokens > 0 && Number.isFinite(ms) && ms > 0 ? (tokens * 1000) / ms : null);

/** One call's speed from the engine's own numbers (llama.cpp timings, or Ollama's durations in ns). */
export function speedSample(metrics = {}, usage = null, now = Date.now()) {
  const inTokens = usage?.input_tokens ?? null, outTokens = usage?.output_tokens ?? null;
  const cached = Number.isFinite(metrics.cachedInputTokens) ? metrics.cachedInputTokens : null;
  const llama = metrics.engine === "llama.cpp";
  const readTps = llama ? metrics.promptTokensPerSecond ?? null : rate(inTokens != null && cached != null ? inTokens - cached : inTokens, metrics.prompt_eval_duration / 1e6);
  const writeTps = llama ? metrics.outputTokensPerSecond ?? null : rate(outTokens, metrics.eval_duration / 1e6);
  return {
    at: now, model: metrics.model || "local", engine: llama ? "llama.cpp" : "ollama",
    readTps: Number.isFinite(readTps) ? Math.round(readTps) : null, writeTps: Number.isFinite(writeTps) ? Math.round(writeTps * 10) / 10 : null,
    inTokens, outTokens, cachedTokens: cached, cacheShare: inTokens && cached != null ? Math.min(1, cached / inTokens) : null,
    wallMs: Number.isFinite(metrics.wallMs) ? Math.round(metrics.wallMs) : null,
  };
}

/** What is normal for a model: the median of the faster half of its measurable calls (null under 5 of them). */
export function normalSpeed(samples, model, engine, key = "writeTps") {
  const min = key === "writeTps" ? MIN_WRITE : MIN_READ;
  const v = samples.filter((s) => s.model === model && s.engine === engine && s[key] != null && (key === "writeTps" ? s.outTokens >= min : (s.inTokens || 0) - (s.cachedTokens || 0) >= min)).map((s) => s[key]).sort((a, b) => b - a);
  if (v.length < 5) return null;
  const fast = v.slice(0, Math.ceil(v.length / 2));
  return fast[Math.floor(fast.length / 2)];
}

/** Records a call (never throws) and streams it as a "speed" event: { ...sample, normal, slow }. */
export function recordModelSpeed(metrics, usage) {
  try {
    if (!metrics) return null;
    const s = speedSample(metrics, usage);
    if (s.writeTps == null && s.readTps == null) return null;
    const normal = normalSpeed(calls, s.model, s.engine);
    calls.push(s);
    if (calls.length > RING) calls.splice(0, calls.length - RING);
    const slow = Boolean(normal && s.writeTps != null && (s.outTokens || 0) >= MIN_WRITE && s.writeTps < normal * SLOW);
    const event = { ...s, normal, slow };
    emitMemoryEvent("speed", event, { keep: false });
    return event;
  } catch { return null; }
}

/** The ring as the app shows it: the latest calls (newest last) and what is normal for the latest model. */
export function modelSpeedState() {
  const last = calls[calls.length - 1] || null;
  return {
    calls: calls.slice(-40),
    normal: last ? { writeTps: normalSpeed(calls, last.model, last.engine), readTps: normalSpeed(calls, last.model, last.engine, "readTps") } : null,
  };
}

/** For tests. */
export function resetModelSpeed() { calls.length = 0; }
