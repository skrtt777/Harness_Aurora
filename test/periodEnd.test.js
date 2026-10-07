import test from "node:test";
import assert from "node:assert/strict";
import { dateFilterHint, filterRows, periodEnd } from "../app/agentTools/files.js";

test("'até o fim do ano' is 31/12, in the ready filter and when the model wrote another month's end", () => {
  const now = new Date(2026, 9, 4);
  assert.equal(periodEnd("quais contratos terminam ate o fim do ano?", now), "31/12/2026");
  assert.equal(periodEnd("o que vence até o final do mês", now), "31/10/2026");
  assert.equal(periodEnd("contratos vigentes", now), null);
  const sheet = ["## Contratos", "Contratado | Término", "Alfa | 31/10/2026", "Beta | 30/11/2026", "Gama | 31/12/2026", "Delta | 31/03/2027"];
  const hint = dateFilterHint(sheet, "quais contratos terminam ate o fim do ano?", now);
  assert.match(hint, /Término<=31\/12\/2026/);
  const fixed = filterRows(sheet, "Término>=01/10/2026; Término<=31/10/2026", { request: "quais contratos terminam ate o fim do ano?" });
  assert.match(fixed, /Alfa[\s\S]*Beta[\s\S]*Gama/);
  assert.doesNotMatch(fixed, /Delta/);
});
