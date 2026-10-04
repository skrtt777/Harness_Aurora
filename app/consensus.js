/**
 * Self-consistency for the small local model: several answers to the same
 * question, and the one the others agree with most wins. Agreement is measured
 * on the facts that matter in a company answer (numbers, dates, money and
 * proper names), so two answers that say the same thing in different words
 * agree, and one that got a number wrong stands out.
 */

const fold = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "");
const STOP = new Set(["A", "O", "As", "Os", "Um", "Uma", "De", "Da", "Do", "Em", "No", "Na", "E", "Para", "Com", "Por", "Que", "Se", "Fonte", "Fontes", "Total", "Segundo", "Conforme", "Resumo", "Sim", "Nao"]);

/** Facts of an answer: normalized numbers ("23.350.000,00" → "23350000") and capitalized words. */
export function answerFacts(answer) {
  const text = fold(answer);
  const facts = new Set();
  for (const m of text.matchAll(/\d[\d.,/]*\d|\d/g)) {
    const raw = m[0];
    if (raw.includes("/")) { facts.add(raw); continue; }
    // Thousands with dots, decimals with comma (pt-BR); drop zero cents so 1.500 = 1.500,00.
    const n = Number(/,\d{1,2}$/.test(raw) ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/[.,](?=\d{3}\b)/g, "").replace(",", "."));
    if (Number.isFinite(n)) facts.add(String(n));
  }
  for (const m of text.matchAll(/\b[A-Z][a-zA-Z]{2,}\b/g)) if (!STOP.has(m[0])) facts.add(m[0].toLowerCase());
  return facts;
}

/** Share of the shorter answer's facts the other one also has: an extra detail is not a disagreement, a different number is. */
export function agreement(a, b) {
  if (!a.size || !b.size) return a.size === b.size ? 1 : 0;
  let common = 0;
  for (const f of a) if (b.has(f)) common += 1;
  return common / Math.min(a.size, b.size);
}

/** Index of the answer closest to all the others (the medoid), and how much they agree. */
export function pickConsensus(answers) {
  const facts = answers.map(answerFacts);
  if (answers.length < 2) return { index: 0, support: 1 };
  const scores = facts.map((f, i) => facts.reduce((n, g, j) => (i === j ? n : n + agreement(f, g)), 0) / (answers.length - 1));
  const index = scores.indexOf(Math.max(...scores));
  return { index, support: scores[index] };
}

/**
 * Escalation 1x → 2x → 4x → max: stop as soon as the answers agree enough.
 * `answers` are already generated (an offline replay of the experiment);
 * the live version would generate the next batch only when needed.
 */
export function escalate(answers, { steps = [1, 2, 4, answers.length], threshold = 0.6 } = {}) {
  let used = 1;
  for (const size of steps.filter((s) => s <= answers.length)) {
    used = size;
    if (size === 1) continue;
    const { index, support } = pickConsensus(answers.slice(0, size));
    if (support >= threshold || size === answers.length) return { index, used, support };
  }
  return { index: 0, used, support: 1 };
}
