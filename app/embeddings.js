import { isModelPulled, isServerUp, pullModel } from "./ollamaSetup.js";

// nomic-embed-text is a small (~274 MB, far smaller than any chat model in
// CURATED_MODELS) embedding-only model that Ollama serves over the same
// /api/embeddings HTTP endpoint used everywhere else in this file — no new
// dependency, no new install path, just another model tag pulled through
// the machinery ollamaSetup.js already has (isModelPulled/pullModel are
// generic over baseUrl+model, not tied to the chat model).
export const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text";

function defaultBaseUrl(env) {
  return env.LOCAL_BASE_URL || "http://127.0.0.1:11434";
}

export function resolveEmbeddingModel(env = process.env) {
  return env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
}

// Vectors are stored as a BLOB (Float32Array bytes) instead of JSON text —
// a nomic-embed-text vector has 768 dimensions, ~3 KB as a BLOB versus
// ~10-15 KB as a JSON array of decimal strings, and this is written once
// per memory and read back for every relevance search.
export function encodeEmbedding(vector) {
  return Buffer.from(Float32Array.from(vector).buffer);
}

export function decodeEmbedding(blob) {
  if (!blob) return null;
  const buffer = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  if (buffer.byteLength === 0 || buffer.byteLength % 4 !== 0) return null;
  return Array.from(new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4));
}

/**
 * Cosine similarity in [-1, 1] (in practice [0, 1] for embedding vectors,
 * which nomic-embed-text and similar models produce non-negative-ish).
 * Returns 0 (neutral, not a penalty) for mismatched/empty input instead of
 * throwing — callers treat "no signal" the same as "not relevant".
 */
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Best-effort embedding of a piece of text via Ollama's /api/embeddings.
 * Returns null — never throws — whenever an embedding isn't available right
 * now: Ollama isn't running, the embedding model isn't pulled yet, or the
 * request itself fails. This is deliberate: embeddings are an enhancement
 * layered on top of the existing keyword search (ROADMAP_MELHORIAS.md,
 * Marco 3 — "comparar as duas em paralelo, não substituir de uma vez"), so
 * a memory must always save successfully and search must always return
 * something even when no embedding is available.
 *
 * Unlike runOllamaSetup(), this never installs Ollama or starts the server
 * — those are heavyweight, user-visible actions tied to opening a Local
 * conversation. This only acts when Ollama is already up, i.e. the user has
 * already opted into Local at some point. If the embedding model isn't
 * pulled yet, a pull is kicked off in the background (not awaited) so this
 * call — and whatever memory save or search triggered it — never blocks on
 * a ~274 MB download; that memory/search simply proceeds without a vector
 * this time, and later calls succeed once the pull finishes.
 */
export async function embedText(text, env = process.env, signal) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  const baseUrl = defaultBaseUrl(env);
  const model = resolveEmbeddingModel(env);
  try {
    if (!(await isServerUp(baseUrl, signal))) return null;
    if (!(await isModelPulled(baseUrl, model, signal))) {
      if (signal?.aborted) return null;
      pullModel(baseUrl, model).catch(() => {});
      return null;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let response;
    try {
      response = await fetch(`${baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, prompt: trimmed }),
        signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
      });
      if (!response.ok) return null;
      const data = await response.json();
      return Array.isArray(data.embedding) && data.embedding.length && data.embedding.every(Number.isFinite) ? data.embedding : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}
