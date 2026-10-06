import test from "node:test";
import assert from "node:assert/strict";
import { filterRows } from "../app/agentTools/files.js";

test("a filter that starts inside the month the request names gets the whole month", () => {
  const sheet = ["## Férias", "Funcionário | Início das férias", "Ana | 05/10/2026", "Bia | 13/10/2026", "Caio | 26/10/2026", "Davi | 03/11/2026"];
  const out = filterRows(sheet, "Início das férias>=13/10/2026; Início das férias<=31/10/2026", { request: "planilha de quem começa as férias em outubro de 2026" });
  assert.match(out, /Ana[\s\S]*Bia[\s\S]*Caio/);
  assert.doesNotMatch(out, /Davi/);
  assert.match(out, /Usei Início das férias>=01\/10\/2026 \(o pedido fala do mês inteiro\)/);
  // A date the person gave keeps its own rule: "a partir de 13/10" is not widened.
  const from13 = filterRows(sheet, "Início das férias>=13/10/2026", { request: "quem começa as férias a partir de 13/10/2026" });
  assert.doesNotMatch(from13, /Ana/);
});
