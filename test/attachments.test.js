import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { extractText, isDocument } = await import("../app/docText.js");
const { zipStore } = await import("../app/sampleDocs.js");
const { mentionedFiles, fileMentions } = await import("../app/chatTurn.js");

const dir = mkdtempSync(join(tmpdir(), "anexos-"));
// The .pbix model reader (app/pbixModel.js) would set up Python here: off, its text is tested below.
process.env.AURORA_PBIX_READER = "off";
// Power BI writes Report/Layout and DataModelSchema as UTF-16 with a BOM.
const utf16 = (value) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(JSON.stringify(value), "utf16le")]);
const layout = utf16({ sections: [
  { name: "s1", displayName: "Visão geral", visualContainers: [
    { config: JSON.stringify({ singleVisual: { visualType: "card", vcObjects: { title: [{ properties: { text: { expr: { Literal: { Value: "'Faturamento'" } } } } }] } } }) },
    { config: JSON.stringify({ singleVisual: { visualType: "barChart" } }) },
  ] },
  { name: "s2", displayName: "Por região", visualContainers: [] },
] });
const schema = utf16({ model: {
  tables: [
    { name: "Vendas", columns: [{ name: "RowNumber-1", type: "rowNumber" }, { name: "Valor" }, { name: "Região" }], measures: [{ name: "Faturamento", expression: "SUM(Vendas[Valor])" }] },
    { name: "LocalDateTable_abc", columns: [{ name: "Date" }] },
  ],
  relationships: [{ fromTable: "Vendas", fromColumn: "Região", toTable: "Regiões", toColumn: "Região" }],
} });

test("a .pbit shows the model (tables, measures, relationships) and the report's pages and visuals", async () => {
  const file = join(dir, "Vendas.pbit");
  writeFileSync(file, zipStore({ "Report/Layout": layout, DataModelSchema: schema }));
  assert.ok(isDocument(file), "Power BI files are documents (the knowledge base indexes them too)");
  const text = await extractText(file);
  assert.match(text, /## Modelo de dados \(1 tabelas\)/, "Power BI's automatic date tables are left out");
  assert.match(text, /### Vendas\nColunas: Valor, Região/);
  assert.match(text, /Medida \[Faturamento\] = SUM\(Vendas\[Valor\]\)/);
  assert.match(text, /Vendas\[Região\] → Regiões\[Região\]/);
  assert.match(text, /## Relatório \(2 páginas\)\n### Visão geral\n- card "Faturamento"\n- barChart\n### Por região/);
});

test("a .pbix in the enhanced format (PBIR): pages in order, each visual with its title and fields", async () => {
  const json = (value) => Buffer.from(`\uFEFF${JSON.stringify(value)}`, "utf8");
  const field = (kind, entity, property) => ({ field: { [kind]: { Expression: { SourceRef: { Entity: entity } }, Property: property } } });
  const visual = (type, title, ...projections) => json({ visual: { visualType: type, query: { queryState: { Values: { projections } } },
    ...(title ? { visualContainerObjects: { title: [{ properties: { text: { expr: { Literal: { Value: `'${title}'` } } } } }] } } : {}) } });
  const file = join(dir, "Novo.pbix");
  writeFileSync(file, zipStore({
    "Report/definition/pages/pages.json": json({ pageOrder: ["p2", "p1"] }),
    "Report/definition/pages/p1/page.json": json({ name: "p1", displayName: "Detalhe" }),
    "Report/definition/pages/p2/page.json": json({ name: "p2", displayName: "Resumo" }),
    "Report/definition/pages/p2/visuals/a/visual.json": visual("cardVisual", "Receita", field("Measure", "Calc", "Receita Total")),
    "Report/definition/pages/p2/visuals/b/visual.json": visual("barChart", null, field("Column", "Produtos", "Categoria"), { field: { Aggregation: { Expression: { Column: { Expression: { SourceRef: { Entity: "Vendas" } }, Property: "Valor" } }, Function: 0 } } }),
    "Report/definition/pages/p2/visuals/c/visual.json": visual("image", "Logo"),
    "Report/definition/pages/p1/visuals/d/visual.json": visual("tableEx", "Pedidos", field("Column", "Vendas", "Pedido")),
    DataModel: Buffer.from([1, 2, 3]),
  }));
  const text = await extractText(file);
  assert.match(text, /## Relatório \(2 páginas\)\n### Resumo\n- cardVisual "Receita": Calc\[Receita Total\]\n- barChart: Produtos\[Categoria\], Soma de Vendas\[Valor\]\n### Detalhe\n- tableEx "Pedidos": Vendas\[Pedido\]/);
  assert.doesNotMatch(text, /Logo/, "decoration is left out");
});

test("the model of a .pbix read without Power BI: tables with their CSV, measures, relationships", async () => {
  const { pbixModelText } = await import("../app/pbixModel.js");
  const text = pbixModelText({
    tables: [{ name: "Vendas", rows: 20000, columns: ["Região", "Valor"], csv: "C:\\cache\\Vendas.csv", preview: [["Sul", "10"]] }],
    measures: [{ table: "Calc", name: "Receita", expression: "SUM(Vendas[Valor])", description: "Soma das vendas" }],
    relationships: [{ from: "Vendas[Produto]", to: "Produtos[Produto]", cardinality: "M:1", active: true }],
    errors: [],
  });
  assert.match(text, /## Modelo de dados \(1 tabelas, lido direto do arquivo, sem o Power BI\)/);
  assert.match(text, /### Vendas \(20\.000 linhas\)\nDados: read_file "Vendas\.csv"\nColunas: Região, Valor/, "the CSV by its name: a small model miscopied the long path");
  assert.ok(text.indexOf("## Medidas") > text.indexOf("Colunas: Região"), "the tables and their data come first (an attachment is cut)");
  assert.match(text, /read_file no CSV com filter/);
  assert.match(text, /Medida Calc\[Receita\] = SUM\(Vendas\[Valor\]\)\n  \(Soma das vendas\)/);
  assert.match(text, /Vendas\[Produto\] → Produtos\[Produto\] \(M:1\)/);
});

test("a .pbix: the pages, and how to reach the model (it is compressed inside)", async () => {
  const file = join(dir, "Painel.pbix");
  writeFileSync(file, zipStore({ "Report/Layout": layout, DataModel: Buffer.from([1, 2, 3]) }));
  const text = await extractText(file);
  assert.match(text, /powerbi \(action=open\)/);
  assert.match(text, /### Visão geral/);
});

test("attached files: code is read, any other format becomes a card instead of vanishing", async () => {
  writeFileSync(join(dir, "consulta.sql"), "SELECT regiao, SUM(valor) FROM vendas GROUP BY regiao;");
  writeFileSync(join(dir, "backup.zip"), zipStore({ "a.txt": "x" }));
  writeFileSync(join(dir, "Vendas.pbix"), zipStore({ "Report/Layout": layout }));
  const ctx = { workspace: dir, workspaceRoots: [dir], allowedRoots: [dir] };
  const read = async (message) => (await mentionedFiles(message, ctx)).map((f) => f.text).join("\n");
  assert.match(await read(`veja "${join(dir, "consulta.sql")}"`), /SUM\(valor\)/);
  const card = await read(`o que tem em "${join(dir, "backup.zip")}"?`);
  assert.match(card, /Arquivo anexado: backup\.zip \(\.zip, 1 KB/);
  assert.match(card, /não invente o que há dentro/);
  assert.match(await read("analise o Vendas.pbix"), /### Visão geral/, "a bare .pbix name is found too");
  assert.deepEqual(fileMentions("abra o relatorio.pbix e o dados.xlsm"), ["relatorio.pbix", "dados.xlsm"]);
});
