import { pickConsensus } from "./consensus.js";

/**
 * Several copies of the local model on the same question (docs/AVALIACAO_EMPRESA_2026-10-04.md):
 * company questions went from 83% (one answer) to 90% with escalation 1→2→4→5 at 2.7 copies on
 * average, costing ~40% more time on a GPU with parallel slots. Only answers are voted on: the
 * extra copies run in read-only (plan) mode, so nothing is written or executed twice, and a turn
 * that took actions is never re-run.
 */

// Tools that only look; a turn using anything else (writing, commands, clicks, the web) is not voted.
const READ_ONLY = new Set(["list_dir", "search_files", "grep", "read_file", "knowledge_search", "knowledge_map", "memory_search", "update_plan"]);
export const AGREEMENT = 0.6;

/** A question worth more copies: company documents or an exact fact, answered without acting. */
export function shouldVote({ first, companyQuestion, factQuestion }) {
  if (!first?.ok || !String(first.text || "").trim()) return false;
  if (!(first.steps || []).every((s) => READ_ONLY.has(s.tool))) return false;
  return Boolean(companyQuestion || factQuestion);
}

/**
 * Escalation: one more copy; if the two agree, done (most questions stop here). Otherwise up
 * to 4, then to the maximum, and the answer the others agree with most wins. `disagree` marks
 * a split vote, which the paid teacher reviews.
 */
export async function escalateAnswer({ first, rerun, maxCopies, threshold = AGREEMENT, onStage = () => {} }) {
  const runs = [first];
  const sizes = [...new Set([2, 4, maxCopies])].filter((n) => n >= 2 && n <= maxCopies).sort((a, b) => a - b);
  let last = { index: 0, support: 1 };
  for (const size of sizes) {
    const need = size - runs.length;
    onStage(`Conferindo a resposta com ${size} cópias…`);
    // At the same time: with parallel slots the extra copies cost little wall time.
    const more = await Promise.all(Array.from({ length: need }, () => rerun().catch((error) => ({ ok: false, error: error.message }))));
    runs.push(...more);
    const ok = runs.filter((r) => r.ok && String(r.text || "").trim());
    if (ok.length < 2) continue;
    last = pickConsensus(ok.map((r) => r.text));
    if (last.support >= threshold || size === sizes.at(-1)) {
      const result = ok[last.index];
      return { result: { ...result, copies: { used: runs.length, support: round(last.support), chosen: runs.indexOf(result), disagree: last.support < threshold } } };
    }
  }
  return { result: { ...first, copies: { used: runs.length, support: 1, chosen: 0, disagree: false } } };
}

const round = (n) => Math.round(n * 100) / 100;

/**
 * How many copies this computer runs at once without making the answer much slower: one short
 * generation alone, then 4 at the same time. With Ollama's parallel slots on a GPU the 4 cost
 * little more than one; on a CPU (or without slots) they queue and cost ~4×, so the answer is 1.
 */
export async function probeParallelCopies({ baseUrl = "http://127.0.0.1:11434", model, engine = "ollama", fetchImpl = fetch, budget = 1.6, signal } = {}) {
  const prompt = "Escreva os números de 1 a 30 por extenso, separados por vírgula.";
  // Ollama's /api/generate or llama-server's /completion: the same short generation.
  const request = engine === "llama-server"
    ? { url: `${baseUrl}/completion`, body: { prompt: `<|im_start|>user
${prompt}<|im_end|>
<|im_start|>assistant
<think>

</think>

`, n_predict: 96, temperature: 0, cache_prompt: false } }
    : { url: `${baseUrl}/api/generate`, body: { model, prompt, stream: false, think: false, options: { num_predict: 96, temperature: 0 } } };
  const generate = async () => {
    const response = await fetchImpl(request.url, { method: "POST", headers: { "content-type": "application/json" }, signal, body: JSON.stringify(request.body) });
    if (!response.ok) throw new Error(`Ollama respondeu ${response.status}`);
    await response.json();
  };
  const timed = async (fn) => { const started = performance.now(); await fn(); return performance.now() - started; };
  await generate(); // loads the model; not timed
  const single = await timed(generate);
  const four = await timed(() => Promise.all([generate(), generate(), generate(), generate()]));
  const ratio = four / single;
  // Estimated wall time of n copies, linear between 1 (×1) and 4 (×ratio).
  const wall = (n) => 1 + ((ratio - 1) * (n - 1)) / 3;
  const max = [5, 4, 3, 2].find((n) => wall(n) <= budget) || 1;
  return { max, ratio: round(ratio), singleMs: Math.round(single), fourMs: Math.round(four), model, engine, probedAt: new Date().toISOString() };
}
