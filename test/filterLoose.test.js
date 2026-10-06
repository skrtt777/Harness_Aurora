import test from "node:test";
import assert from "node:assert/strict";
import { filterRows } from "../app/agentTools/files.js";

test("a column name that lost its accents on the way still finds the column", () => {
  const sheet = ["## Chamados", "Chamado | Abertura | Situação", "CH-1 | 01/09/2026 | Aberto", "CH-2 | 02/09/2026 | Resolvido"];
  for (const filter of ["Situa o=Aberto", "Situa??o=Aberto", "Situacao=Aberto", "Situação=Aberto"]) {
    const out = filterRows(sheet, filter);
    assert.match(out, /CH-1/, filter);
    assert.doesNotMatch(out, /CH-2/, filter);
  }
});
