import test from "node:test";
import assert from "node:assert/strict";
import { filterRows } from "../app/agentTools/files.js";

const sheet = [
  "## Férias 2026",
  "Matrícula | Funcionário | Início das férias | Fim das férias | Status",
  "1 | Ana Lima | 14/09/2026 | 13/10/2026 | Em gozo",
  "2 | Bruno Dias | 05/10/2026 | 03/11/2026 | Aprovada",
  "3 | Carla Moura | 19/10/2026 | 07/11/2026 | Aprovada",
  "4 | Diego Rocha | 06/12/2026 | 20/12/2026 | Programada",
  "## Legenda",
  "Status | Significado",
  "Em gozo | Funcionário de férias agora",
];

test("a column filter counts only the rows whose column matches, with the header", () => {
  const out = filterRows(sheet, "Início das férias=/10/2026");
  assert.match(out, /Matrícula \| Funcionário/);
  assert.match(out, /Bruno Dias/);
  assert.match(out, /Carla Moura/);
  assert.doesNotMatch(out, /Ana Lima/, "ends in October but started in September");
  assert.match(out, /2 linha\(s\)/);
});

test("accents and case do not matter; a missing column falls back to the whole line", () => {
  assert.match(filterRows(sheet, "inicio DAS ferias=/12/"), /Diego Rocha[\s\S]*1 linha/);
  assert.match(filterRows(sheet, "Setor=Bruno"), /Bruno Dias[\s\S]*n[ãa]o existe/);
  assert.match(filterRows(sheet, "nada disso"), /Nenhuma linha[\s\S]*Colunas: Matrícula/);
  assert.match(filterRows(["linha um", "outra linha", "fim"], "linha"), /2 linha\(s\)/, "plain text works too");
});
