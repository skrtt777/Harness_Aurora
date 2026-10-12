import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { design, parseNumber, plural, profile, readSources } from "../app/powerbiDesign.js";
import { field, visual } from "../app/powerbiReport.js";
import { checkFilters, columnRef, groundedName, simpleDax } from "../app/agentTools/powerbi.js";

const csv = (text) => { const dir = mkdtempSync(join(tmpdir(), "pbi-")); const f = join(dir, "vendas_loja.csv"); writeFileSync(f, text); return f; };

test("numbers in Brazilian and plain forms", () => {
  assert.equal(parseNumber("1.234,56", true), 1234.56);
  assert.equal(parseNumber("R$ 10,5", true), 10.5);
  assert.equal(parseNumber("1234.56", false), 1234.56);
  assert.equal(parseNumber("15%", false), 0.15);
  assert.ok(Number.isNaN(parseNumber("Pão", true)));
  assert.equal(plural("pedido"), "pedidos");
  assert.equal(plural("nota fiscal"), "notas fiscais");
});

test("a Brazilian CSV is profiled: dates, money, ids, dimensions", () => {
  const f = csv("Pedido;Data;Loja;Produto;Quantidade;Preço unitário;Valor total\n1;01/01/2026;Centro;Pão;10;0,90;9,00\n2;15/02/2026;Savassi;Bolo;1;32,00;32,00\n3;03/03/2026;Centro;Pão;20;0,90;18,00\n");
  const [t] = readSources(f).map(profile);
  assert.equal(t.name, "Vendas loja");
  assert.equal(t.source.delimiter, ";");
  assert.ok(t.decimalComma);
  const roles = Object.fromEntries(t.columns.map((c) => [c.name, `${c.type}/${c.role}`]));
  assert.deepEqual(roles, { Pedido: "inteiro/id", Data: "data/date", Loja: "texto/dimension", Produto: "texto/dimension", Quantidade: "inteiro/quantity", "Preço unitário": "numero/unitPrice", "Valor total": "numero/money" });
});

test("the design: no measure named like a column, a calendar, the main numbers on the first page", () => {
  const f = csv("Pedido;Data;Loja;Produto;Quantidade;Preço unitário;Valor total;Custo\n1;01/01/2025;Centro;Pão;10;0,90;9,00;3,00\n2;15/02/2026;Savassi;Bolo;1;32,00;32,00;11,00\n3;03/03/2026;Centro;Pão;20;0,90;18,00;6,00\n");
  const plan = design(readSources(f).map(profile));
  const names = plan.measureList.map((m) => m.name);
  assert.ok(names.includes("Faturamento") && names.includes("Qtd. de pedidos") && names.includes("Ticket médio") && names.includes("Margem %"));
  assert.ok(!names.includes("Valor total"), "a measure cannot share the column's name");
  assert.ok(names.includes("Variação % anual"), "two years of data: year over year");
  const cal = plan.model.tables.find((t) => t.name === "Calendário");
  assert.match(cal.dax, /COALESCE\(MIN/);
  assert.match(cal.dax, /EOMONTH\(COALESCE\(MAX/);
  assert.deepEqual(plan.model.relationships, [{ from: "'Vendas loja'[Data]", to: "'Calendário'[Data]" }]);
  // No fixed pages: the automatic plan (no model here) opens on the results, with the main numbers.
  assert.equal(plan.plan.planner, "automático");
  assert.ok(plan.pages.length >= 1 && plan.pages.length <= 4);
  const cards = plan.pages[0].visuals.filter((v) => v.type === "card" || v.kpi).map((v) => v.from?.numero || v.title);
  assert.ok(cards.includes("Faturamento"));
  // Every field of every visual exists in the model.
  for (const page of plan.pages) for (const v of page.visuals) if (v.type !== "textbox" && v.type !== "image") assert.ok(visual(v, plan.measures).visual.query);
  // The KPI tiles: an image bound to its measure, which exists.
  for (const v of plan.pages[0].visuals.filter((x) => x.kpi)) assert.ok(plan.measureList.some((m) => `[${m.name}]` === v.url));
});

test("visual JSON: fields, sort, card without a second label", () => {
  const measures = { Faturamento: "Vendas" };
  assert.deepEqual(field("'Produtos'[Categoria]").json, { Column: { Expression: { SourceRef: { Entity: "Produtos" } }, Property: "Categoria" } });
  assert.throws(() => field("[Não existe]", measures), /Não conheço a medida/);
  const bar = visual({ type: "clusteredBarChart", x: 0, y: 0, w: 100, h: 100, category: "Vendas[Produto]", values: "[Faturamento]", sort: { by: "[Faturamento]" } }, measures);
  assert.deepEqual(Object.keys(bar.visual.query.queryState), ["Category", "Y"]);
  assert.equal(bar.visual.query.sortDefinition.sort[0].direction, "Descending");
  const card = visual({ type: "card", x: 0, y: 0, w: 100, h: 100, values: "[Faturamento]" }, measures);
  assert.equal(card.visual.objects.categoryLabels[0].properties.show.expr.Literal.Value, "false");
});

test("a simple question becomes DAX on the model's own columns", () => {
  const model = "Modelo semântico \"x\":\n\nTabela Vendas:\n  colunas: Produto (texto), Data (data, oculta)\n  medida [Faturamento] = SUM(Vendas[Valor])\n\nTabela Calendário (calculada):\n  colunas: Data (data), Ano (inteiro)\n";
  assert.equal(columnRef(model, "ano"), "'Calendário'[Ano]");
  assert.equal(simpleDax({ measure: "Faturamento", by: "Produto", top: 3, filter: "Ano=2026" }, model),
    "EVALUATE TOPN(3, SUMMARIZECOLUMNS('Vendas'[Produto], KEEPFILTERS(TREATAS({2026}, 'Calendário'[Ano])), \"Valor\", [Faturamento]), [Valor], DESC) ORDER BY [Valor] DESC");
  assert.equal(simpleDax({ measure: "Faturamento" }, model), "EVALUATE ROW(\"Faturamento\", [Faturamento])");
  assert.throws(() => columnRef(model, "Cliente"), /Não há coluna/);
});

test("a small model's measure is repaired: columns named as measures become sums", async () => {
  const { fixMeasureRefs } = await import("../app/agentTools/powerbi.js");
  const model = "Tabela Vendas:\n  colunas: Produto (texto), Valor total (número), Custo (número)\n  medida [Lucro] = [Faturamento] - [Custo total]  (formato \"R$\" #,0.00)\n  medida [Qtd. de pedidos] = DISTINCTCOUNT(Vendas[Pedido])  (formato #,0)\n";
  assert.equal(fixMeasureRefs("[Valor total] - [Custo]", model), "SUM('Vendas'[Valor total]) - SUM('Vendas'[Custo])");
  assert.equal(fixMeasureRefs("DIVIDE([Lucro], [Qtd. de pedidos])", model), "DIVIDE([Lucro], [Qtd. de pedidos])");
  assert.equal(fixMeasureRefs("SUM(Vendas[Custo])", model), "SUM(Vendas[Custo])");
});

test("a question's filter is checked against the column's real values", async () => {
  const model = "Tabela Embarques:\n  colunas: Status (texto), Transportadora (texto)\n  medida [Entregas atrasadas] = COUNTROWS(x)\n  medida [Atrasados agora] = y\n";
  const values = async (ref) => (/Status/.test(ref) ? ["Pedido recebido", "Carregando", "Em trânsito", "Entregue"] : ["TransRápido"]);
  assert.equal(await checkFilters("Status=em transito; Ano=2026", model, values), "Status=Em trânsito; Ano=2026");
  await assert.rejects(checkFilters("Status='Atrasado'", model, values), /Status não tem "Atrasado".*Em trânsito.*\[Entregas atrasadas\]/s);
  await assert.rejects(checkFilters("Transportadora=Rodonaves", model, values), /valores de Transportadora são: TransRápido\. Use um desses valores ou tire o filtro/);
});

test("the report's title keeps only words the person or the files said", () => {
  const said = "monta um power bi da operação do CD com a planilha operacao_cd.xlsx, quero ver o rastreamento";
  assert.equal(groundedName("Operação_CD_Permacultura", said), "Operação CD");
  assert.equal(groundedName("Rastreamento da operação", said), "Rastreamento da operação");
  assert.equal(groundedName("Permacultura", said), undefined);
  assert.equal(groundedName("", said), undefined);
});
