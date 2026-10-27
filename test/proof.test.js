import { test } from "node:test";
import assert from "node:assert/strict";
import { claimsOf, factsOf, proveAnswer } from "../app/proof.js";

// A sheet as read_file prints it: line numbers, "## Aba", the header, then the rows.
const SALES = {
  tool: "read_file",
  args: { path: "C:\\Users\\x\\Documents\\vendas_2026.xlsx" },
  result: [
    "    1  ## Outubro",
    "    2  Vendedor | Região | Meta | Vendido | % da meta",
    "    3  Ana Souza | Sul | R$ 120.000,00 | R$ 98.400,00 | 82%",
    "    4  Bruno Lima | Norte | R$ 90.000,00 | R$ 101.250,00 | 112,5%",
    "    5  Carla Dias | Sudeste | R$ 150.000,00 | R$ 87.000,00 | 58%",
  ].join("\n"),
};

test("the numbers an answer states: money, %, dates, scaled; not paths, list numbering, years or small words", () => {
  const claims = claimsOf("1. Bruno vendeu R$ 101.250,00 (112,5% da meta) até 31/10/2026, em `vendas_2026.xlsx`; os 3 juntos somam 286,65 mil em 2026.");
  assert.deepEqual(claims.map((c) => c.raw), ["R$ 101.250,00", "112,5%", "31/10/2026", "286,65 mil"]);
  assert.equal(claims.at(-1).value, 286650);
  assert.deepEqual(claimsOf("Salvei em C:\\Users\\x\\Documents\\relatorio_2026_10.xlsx").map((c) => c.raw), []);
});

test("a cell is found by value, with the tab, the column and the Excel address", () => {
  const facts = factsOf(SALES);
  const bruno = facts.find((f) => f.value === 101250);
  assert.equal(bruno.sheet, "Outubro");
  assert.equal(bruno.column, "Vendido");
  assert.equal(bruno.cell, "D3");
  assert.deepEqual(bruno.row.slice(0, 2), ["Bruno Lima", "Norte"]);
  // The header's own words are not data.
  assert.ok(!facts.some((f) => f.text?.startsWith("Vendedor")));
});

test("each number gets its proof: a cell, a column sum, an operation between proven numbers, the person's words, or none", () => {
  const proof = proveAnswer(
    "Bruno Lima bateu a meta: vendeu R$ 101.250,00, ou 112,5%. A equipe vendeu R$ 286.650,00 no total, R$ 73.350,00 abaixo da meta de R$ 360.000,00. Você pediu acima de R$ 95.000. Carla ficou com R$ 12.345,00 de comissão.",
    { sources: [SALES], asked: ["quem vendeu acima de R$ 95.000?"] },
  );
  const by = Object.fromEntries(proof.claims.map((c) => [c.raw, c]));
  assert.equal(by["R$ 101.250,00"].status, "fonte");
  assert.equal(by["R$ 101.250,00"].source.cell, "D3");
  assert.equal(by["112,5%"].status, "fonte");
  assert.equal(by["R$ 286.650,00"].status, "conta");
  assert.match(by["R$ 286.650,00"].formula, /soma de Vendido \(3 linhas\)/);
  assert.equal(by["R$ 360.000,00"].status, "conta");
  assert.equal(by["R$ 73.350,00"].status, "conta");
  assert.equal(by["R$ 95.000"].status, "pedido");
  assert.equal(by["R$ 12.345,00"].status, "sem-prova");
  assert.equal(proof.seal, "parcial");
  assert.equal(proof.total, 6);
  assert.equal(proof.proven, 5);
});

test("a rounded number still matches its cell; an answer with no sources or no numbers has no proof", () => {
  const proof = proveAnswer("A Ana fez 82% e vendeu cerca de 98,4 mil.", { sources: [SALES] });
  assert.equal(proof.seal, "comprovado");
  assert.equal(proveAnswer("Bom dia! Como posso ajudar?", { sources: [SALES] }), null);
  assert.equal(proveAnswer("Custa R$ 50,00.", { sources: [] }), null);
});

test("a filtered read (no line numbers) still points at the row; the tool's own count proves 'quantos'", () => {
  const filtered = { tool: "read_file", args: { path: "contas.xlsx", filter: "Situação=A pagar" }, result: "## Contas\nFornecedor | Valor | Situação\nLuz | R$ 312,40 | A pagar\nÁgua | R$ 98,10 | A pagar\n2 linha(s) com \"Situação=A pagar\".\nSoma de Valor: R$ 410,50" };
  const proof = proveAnswer("São 2 contas a pagar, somando R$ 410,50: a de luz é R$ 312,40.", { sources: [filtered] });
  const by = Object.fromEntries(proof.claims.map((c) => [c.raw, c]));
  assert.equal(by["R$ 312,40"].source.cell, null);
  assert.deepEqual(by["R$ 312,40"].source.row, ["Luz", "R$ 312,40", "A pagar"]);
  assert.equal(by["R$ 410,50"].status, "fonte");
  assert.equal(proof.seal, "comprovado");
});

test("names, times, ranges and days in words are not quantities", () => {
  const raws = claimsOf("O Moto G84 tem câmera de 50MP e carrega a 68W; às 08:30, dia 13 de outubro, custa ~1100-1300 reais ou R$900.").map((c) => c.raw);
  assert.deepEqual(raws, ["1100", "1300", "R$900"]);
  assert.equal(claimsOf("Saldo: -R$ 50,00 e 900-1100").find((c) => c.raw === "1100").value, 1100);
});

test("a total of the numbers written next to it, and totals built on the person's own numbers", () => {
  const stock = { tool: "read_file", args: { path: "estoque.xlsx" }, result: "## Estoque\nItem | Falta\nFarinha | 460\nAçúcar | 1.073\nCafé | 690\nArroz | 743\nFeijão | 12" };
  const proof = proveAnswer("O total de falta (460 + 1.073 + 690 + 743) é 2.966 caixas.", { sources: [stock] });
  const total = proof.claims.find((c) => c.raw === "2.966");
  assert.equal(total.status, "conta");
  assert.match(total.formula, /460 \+ 1\.073 \+ 690 \+ 743/);
  // "luz 230, água 90": 320 is a total of the person's numbers; 320,45 is not (made-up cents).
  const bills = { tool: "bills_table", args: { path: "Downloads" }, result: "Nenhuma conta encontrada em Downloads." };
  const right = proveAnswer("Luz R$ 230,00 e água R$ 90,00: total R$ 320,00.", { sources: [bills], asked: ["faz uma planilha das minhas contas fixas: luz 230, agua 90"] });
  assert.equal(right.seal, "comprovado");
  const wrong = proveAnswer("O total das contas é de R$ 320,45.", { sources: [bills], asked: ["faz uma planilha das minhas contas fixas: luz 230, agua 90"] });
  assert.equal(wrong.claims[0].status, "sem-prova");
});

test("a glued scale (38,19M, 5k) and a discount in % are read and proven", () => {
  assert.equal(claimsOf("Realizado: R$ 38,19M de R$ 55,96 mi; 5k clientes; cabo de 50m.").map((c) => c.value).join(" "), "38190000 55960000 5000");
  const sheet = { tool: "read_file", args: { path: "precos.xlsx" }, result: "## Preços\nProduto | Caixas | Preço\nFarinha | 50 | R$ 7,90\nCafé | 20 | R$ 29,90" };
  const proof = proveAnswer("Farinha: R$ 395,00; café: R$ 598,00; total R$ 993,00, ou R$ 963,21 com 3% de desconto.", { sources: [sheet], asked: ["monta uma proposta com 3% de desconto"] });
  assert.equal(proof.seal, "comprovado", JSON.stringify(proof.claims.map((c) => [c.raw, c.status])));
});

test("the proof in one line for the phone", async () => {
  const { proofSummary } = await import("../app/proof.js");
  const ok = proveAnswer("Bruno vendeu R$ 101.250,00.", { sources: [SALES] });
  assert.equal(proofSummary(ok), "✓ Comprovado: 1 de 1 número, de vendas_2026.xlsx.");
  const bad = proveAnswer("Bruno vendeu R$ 101.250,00 e ganhou R$ 5.062,50.", { sources: [SALES] });
  assert.match(proofSummary(bad), /^⚠ Sem fonte: R\$ 5\.062,50 \(confira antes de usar\)\. 1 de 2 com prova/);
  assert.equal(proofSummary(null), "");
});

test("a share of the person's own total: 'para 2 pessoas', 'em 2x'", () => {
  const calc = { tool: "calculate", args: {}, result: "media de 1 número(s) (443,47) = 443,47" };
  assert.equal(proveAnswer("Cada um paga R$ 221,74.", { sources: [calc], asked: ["a conta do restaurante deu r$ 443,47 para 2 pessoas, quanto cada um paga"] }).seal, "comprovado");
  assert.equal(proveAnswer("Cada parcela fica em R$ 1.795,00.", { sources: [calc], asked: ["uma geladeira de r$ 3590 em 2x sem juros"] }).seal, "comprovado");
  assert.equal(proveAnswer("Cada parcela fica em R$ 1.800,00.", { sources: [calc], asked: ["uma geladeira de r$ 3590 em 2x sem juros"] }).seal, "sem-prova");
});

test("a later turn sums what an earlier answer proved; a flagged number never becomes a source", async () => {
  const { priorProofSources } = await import("../app/proof.js");
  const first = proveAnswer("Luz R$ 287,41 e gás R$ 76,07; o cartão R$ 999,99.", { sources: [{ tool: "bills_table", args: { path: "Downloads" }, result: "Conta | Valor\nLuz | R$ 287,41\nGás | R$ 76,07" }] });
  const sources = priorProofSources([{ role: "assistant", execution: { proof: first } }]);
  assert.equal(proveAnswer("Luz R$ 287,41 + gás R$ 76,07 + taxa R$ 10,00 = R$ 373,48.", { sources, asked: ["e a taxa de 10,00?"] }).seal, "comprovado");
  assert.equal(proveAnswer("O cartão é R$ 999,99.", { sources }).seal, "sem-prova");
});
