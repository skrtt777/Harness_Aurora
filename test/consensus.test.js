import test from "node:test";
import assert from "node:assert/strict";
import { agreement, answerFacts, escalate, pickConsensus } from "../app/consensus.js";

test("facts of an answer ignore wording and number formatting", () => {
  const a = answerFacts("O orçamento é de R$ 23.350.000,00 e o Marcos entra em 05/10/2026.");
  const b = answerFacts("Marcos: férias a partir de 05/10/2026; budget total 23350000.");
  assert.ok(a.has("23350000") && a.has("marcos") && a.has("05/10/2026"));
  assert.equal(agreement(a, b), 1);
});

test("the answer the others agree with wins; one wrong number stands out", () => {
  const answers = [
    "São 7 funcionários entrando de férias em outubro.",
    "Em outubro, 9 funcionários entram de férias: Marcos, Vinícius e Larissa, entre outros.",
    "Nove não: 9 funcionários (Marcos, Vinícius, Larissa...) começam férias em outubro.",
    "9 pessoas entram de férias neste mês, entre elas Marcos e Larissa.",
  ];
  const { index } = pickConsensus(answers);
  assert.notEqual(index, 0);
  assert.match(answers[index], /\b9\b/);
});

test("escalation stops early when the first two agree and goes further when they do not", () => {
  const same = ["O ramal do suporte é 2800.", "Suporte de TI: ramal 2800.", "x", "y", "z"];
  assert.equal(escalate(same).used, 2);
  const split = ["O ramal é 2800.", "O ramal é 2204.", "Ramal 2800.", "Ramal 2800 (Suporte).", "2800"];
  const r = escalate(split);
  assert.ok(r.used >= 4);
  assert.match(split[r.index], /2800/);
});
