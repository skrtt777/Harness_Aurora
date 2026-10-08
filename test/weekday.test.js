import test from "node:test";
import assert from "node:assert/strict";
import { weekdayObservation } from "../app/runtimeFacts.js";

test("a weekday of a holiday or a date is calculated, not guessed", () => {
  const now = new Date("2026-10-04T12:00:00-03:00");
  assert.match(weekdayObservation("o natal esse ano cai em q dia da semana", { now }).block, /25\/12\/2026 cai numa sexta-feira \(faltam 82 dia/);
  assert.match(weekdayObservation("7 de setembro de 2027 cai que dia", { now }).block, /07\/09\/2027 cai numa terça-feira/);
  assert.match(weekdayObservation("25/12 é que dia?", { now }).block, /sexta-feira/);
  assert.equal(weekdayObservation("qual dia vence o boleto?", { now }), null);
  assert.equal(weekdayObservation("me fala do natal", { now }), null);
});

test("a sum on an earlier sum: 'volta naquela multiplicação e divide por 2' uses 12 x 37, not the bill said in between", async () => {
  const { followUpMath, mathObservation } = await import("../app/runtimeFacts.js");
  const history = [{ role: "user", content: "qnto da 12 vezes 37" }, { role: "assistant", content: "444" }, { role: "user", content: "e a conta de luz deu quanto?" }, { role: "assistant", content: "R$ 230,45" }];
  assert.match(followUpMath("volta naquela multiplicação de antes e divide por 2", history).block, /12 \* 37 = 444[\s\S]*444 \/ 2 = 222/);
  assert.equal(followUpMath("divide por 2", history), null, "no reference back: not this");
  assert.equal(mathObservation("qnto da 12 vezes 37").local, "12 * 37 = 444", "typed short");
});
