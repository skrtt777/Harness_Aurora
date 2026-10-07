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
