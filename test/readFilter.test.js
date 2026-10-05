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

test("read_file sorts (\"Término\", \"-Valor\") and adds up the numeric columns of the rows it shows", async () => {
  const { filterRows, parseSort } = await import("../app/agentTools/files.js");
  const sheet = ["## Contas", "Documento | Fornecedor | Vencimento | Valor | Situação", "NF 1 | A | 25/10/2026 | 100,50 | A pagar", "NF 2 | B | 09/10/2026 | 300 | A pagar", "NF 3 | C | 01/10/2026 | 50 | Pago"];
  const docs = (out) => out.split("\n").filter((l) => /^\s+\d+\s+NF/.test(l)).map((l) => l.trim().split(/\s+/).slice(1, 3).join(" "));
  assert.deepEqual(docs(filterRows(sheet, "", { sort: "Vencimento" })), ["NF 3", "NF 2", "NF 1"], "dates sort as dates");
  assert.deepEqual(docs(filterRows(sheet, "Situação=A pagar", { sort: "-Valor" })), ["NF 2", "NF 1"]);
  assert.match(filterRows(sheet, "Situação=A pagar"), /Soma das 2 linhas acima: Valor = 400,50/);
  assert.doesNotMatch(filterRows(sheet, "Situação=A pagar"), /Documento =|Vencimento =/, "codes and dates are never summed");
  assert.deepEqual(parseSort("-Total Jan-Set"), { col: "total jan-set", desc: true });
  assert.deepEqual(parseSort("Término crescente"), { col: "termino", desc: false });
});

test("a date filter written with '=' follows the person's words: até, a partir de, antes de, depois de", async () => {
  const { dateIntent, filterRows } = await import("../app/agentTools/files.js");
  assert.equal(dateIntent("pedidos com entrega até 15/10/2026", "15/10/2026"), "<=");
  assert.equal(dateIntent("a partir de 15 de outubro", "15/10/2026"), ">=");
  assert.equal(dateIntent("antes do dia 15/10", "15/10/2026"), "<");
  assert.equal(dateIntent("depois de 15/10", "15/10/2026"), ">");
  assert.equal(dateIntent("o que vence dia 15/10?", "15/10/2026"), null, "a plain date stays equality");
  assert.equal(dateIntent("até 20/10", "15/10/2026"), null, "another date: no guess");
  const sheet = ["## Pedidos", "Pedido | Entrega prevista", "PC-1 | 10/10/2026", "PC-2 | 15/10/2026", "PC-3 | 22/10/2026"];
  const out = filterRows(sheet, "Entrega prevista=15/10/2026", { request: "pedidos com entrega até 15/10/2026" });
  assert.match(out, /PC-1[\s\S]*PC-2/);
  assert.doesNotMatch(out, /PC-3/);
  assert.match(out, /Usei Entrega prevista<=15\/10\/2026 porque o pedido diz "até"/);
  assert.doesNotMatch(filterRows(sheet, "Entrega prevista=15/10/2026", { request: "o que chega dia 15/10?" }), /PC-1/);
});
