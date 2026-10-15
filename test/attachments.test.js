import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { extractText, isDocument } = await import("../app/docText.js");
const { zipStore } = await import("../app/sampleDocs.js");
const { mentionedFiles, fileMentions } = await import("../app/chatTurn.js");

const dir = mkdtempSync(join(tmpdir(), "anexos-"));
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
  assert.match(text, /## Relatório \(2 páginas\)\n### Visão geral\nVisuais: card "Faturamento", barChart\n### Por região/);
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
