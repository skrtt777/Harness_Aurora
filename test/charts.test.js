import test from "node:test";
import assert from "node:assert/strict";

const { renderDocument, parseBlocks } = await import("../app/documentWriter.js");
const { readZip, extractText } = await import("../app/docText.js");
const { chartMismatch } = await import("../app/agentTools/files.js");
const { wantsPowerBi } = await import("../app/toolRouter.js");
const { serviceOrder } = await import("../app/serviceOrder.js");

const deck = [
  "# Dashboard de outubro",
  "```indicadores",
  "| Vendas | R$ 1,2 mi | +12% |",
  "| Clientes | 340 | -3% |",
  "```",
  "```grafico barras: Vendas por mês",
  "| Mês | 2025 | 2026 |",
  "|---|---|---|",
  "| Ago | 100 | 120 |",
  "| Set | 90 | 130 |",
  "```",
  "```grafico rosca: Canais",
  "| Canal | Vendas |",
  "| Loja | 60 |",
  "| Site | 40 |",
  "```",
].join("\n");

test("```grafico and ```indicadores blocks are read as a chart and KPI cards", () => {
  const blocks = parseBlocks(deck);
  assert.deepEqual(blocks.map((b) => b.type), ["heading", "kpis", "chart", "chart"]);
  assert.equal(blocks[2].kind, "bar");
  assert.equal(blocks[2].title, "Vendas por mês");
  assert.deepEqual(blocks[2].rows, [["Mês", "2025", "2026"], ["Ago", "100", "120"], ["Set", "90", "130"]], "the --- line is not data");
  assert.equal(blocks[3].kind, "doughnut");
  assert.deepEqual(blocks[1].items[0], { label: "Vendas", value: "R$ 1,2 mi", note: "+12%" });
  assert.deepEqual(parseBlocks("```markdown\n# Título\n```").map((b) => b.type), ["heading"], "another fence only loses its ``` lines");
});

test("a .pptx with charts: native chart parts with their data, an embedded workbook, the cards on the slide", async () => {
  const zip = readZip(await renderDocument("pptx", deck));
  const names = [...zip.keys()];
  assert.deepEqual(names.filter((n) => /^ppt\/charts\/chart\d\.xml$/.test(n)), ["ppt/charts/chart1.xml", "ppt/charts/chart2.xml"]);
  assert.ok(names.includes("ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx"), "Editar dados in PowerPoint needs the workbook");
  const bar = zip.get("ppt/charts/chart1.xml")().toString("utf8");
  assert.match(bar, /<c:barChart><c:barDir val="col"\/>/);
  assert.match(bar, /<c:f>Plan1!\$C\$2:\$C\$3<\/c:f><c:numCache><c:formatCode>General<\/c:formatCode><c:ptCount val="2"\/><c:pt idx="0"><c:v>120<\/c:v><\/c:pt><c:pt idx="1"><c:v>130<\/c:v>/);
  assert.doesNotMatch(zip.get("ppt/charts/chart2.xml")().toString("utf8"), /dLblPos/, "a doughnut has no label position (PowerPoint refused the file with one)");
  const slide = zip.get("ppt/slides/slide1.xml")().toString("utf8");
  assert.equal((slide.match(/<c:chart /g) || []).length, 2);
  assert.match(slide, /R\$ 1,2 mi/);
  assert.match(zip.get("[Content_Types].xml")().toString("utf8"), /drawingml\.chart\+xml/);
  assert.match(await extractText(await (async () => { const { writeFileSync, mkdtempSync } = await import("node:fs"); const { join } = await import("node:path"); const { tmpdir } = await import("node:os"); const f = join(mkdtempSync(join(tmpdir(), "deck-")), "d.pptx"); writeFileSync(f, await renderDocument("pptx", deck)); return f; })()), /Dashboard de outubro/);
});

test("in Word the chart is a table (no charts there)", async () => {
  const docx = readZip(await renderDocument("docx", deck)).get("word/document.xml")().toString("utf8");
  assert.match(docx, /Ago/);
  assert.match(docx, /Clientes/);
});

test("a chart with numbers that are not the sheet's is refused with the right ones", () => {
  const departments = { header: ["Departamento", "Funcionários", "Orçamento"], rows: [["Tecnologia", "420", "2800000"], ["Vendas", "610", "1950000"], ["Marketing", "180", "1420000"], ["Jurídico", "60", "1100000"]] };
  const people = { header: ["Nome", "Departamento"], rows: [["Ana", "Tecnologia"], ["Bruno", "Vendas"], ["Carla", "Vendas"]] };
  const chart = (rows) => `\`\`\`grafico barras: Pessoas\n| Departamento | Funcionários |\n${rows.map(([a, b]) => `| ${a} | ${b} |`).join("\n")}\n\`\`\``;
  const wrong = chartMismatch(chart([["Tecnologia", 420], ["Vendas", 610], ["Marketing", 301], ["Jurídico", 301]]), [people, departments]);
  assert.match(wrong, /Marketing está 301, na planilha é 180; Jurídico está 301, na planilha é 60/);
  assert.match(wrong, /\{\{linhas: Departamento, Funcionários\}\}/);
  assert.equal(chartMismatch(chart([["Tecnologia", 420], ["Vendas", 610], ["Marketing", 180], ["Jurídico", 60]]), [people, departments]), null);
  assert.equal(chartMismatch("```grafico pizza: O\n| Departamento | Orçamento (mi) |\n| Tecnologia | 2,8 |\n| Vendas | 1,95 |\n```", [departments]), null, "in millions is the same number");
  assert.equal(chartMismatch("```grafico barras: Q\n| Mês | Vendas |\n| Jan | 10 |\n| Fev | 20 |\n```", [departments]), null, "data from no sheet read: nothing to check");
});

test("in a deck the dashboard is a slide; named, or outside a deck, it is a Power BI", () => {
  assert.equal(wantsPowerBi("monte uma apresentação com um slide de dashboard"), false);
  assert.equal(wantsPowerBi("faça slides com os indicadores"), false);
  assert.equal(wantsPowerBi("monte um dashboard das vendas"), true);
  assert.equal(wantsPowerBi("faça um power bi e uma apresentação"), true);
  assert.equal(serviceOrder("monte uma apresentação com um gráfico e um dashboard do orçamento").deliver.some((d) => /Power BI/.test(d)), false);
  assert.equal(serviceOrder("monte um dashboard do orçamento").deliver.some((d) => /Power BI/.test(d)), true);
});
