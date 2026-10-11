import test from "node:test";
import assert from "node:assert/strict";
import { design, pagesFor, profile } from "../app/powerbiDesign.js";
import { readFlow } from "../app/powerbiStory.js";
import { daxText, safe, yardScene } from "../app/powerbiScene.js";
import { makeXlsx } from "../app/sampleDocs.js";
import { readZip, xlsxText } from "../app/docText.js";

const HEADER = ["Pedido", "Data do pedido", "Cliente", "Cidade destino", "Transportadora", "Placa", "Motorista", "Doca", "Status", "Previsão de entrega", "Data de entrega", "Volumes", "Valor do frete"];
const STATUS = ["Entregue", "Entregue", "Entregue", "Em trânsito", "Carregando", "Em separação", "Pedido recebido"];
function shipments() {
  const rows = [];
  for (let i = 0; i < 60; i += 1) {
    const status = STATUS[i % STATUS.length];
    const day = String(1 + (i % 28)).padStart(2, "0");
    rows.push([`PED-${1000 + i}`, `${day}/09/2026`, `Cliente ${i % 5}`, `Cidade ${i % 4}`, `Transp ${i % 3}`, `ABC-${1000 + (i % 9)}`, `Motorista ${i % 9}`, status === "Pedido recebido" ? "" : `Doca 0${1 + (i % 6)}`, status, `${day}/10/2026`, status === "Entregue" ? `${day}/10/2026` : "", String(5 + i), `${100 + i},50`]);
  }
  return profile({ name: "Embarques", header: HEADER, rows, source: { kind: "excel", path: "C:/dados/cd.xlsx", sheet: "Embarques" } });
}
const stock = () => profile({ name: "Estoque", header: ["SKU", "Produto", "Estoque atual", "Estoque mínimo"], rows: [["S1", "Arroz", "100", "50"], ["S2", "Feijão", "20", "40"]], source: { kind: "excel", path: "C:/dados/cd.xlsx", sheet: "Estoque" } });

test("a flow is read from the columns: stages in order, the place, the vehicle and the deadlines", () => {
  const fact = shipments();
  const flow = readFlow(fact, [fact, stock()]);
  assert.ok(flow);
  assert.equal(flow.status, "Status");
  assert.deepEqual(flow.stages.map((s) => s.values[0]), ["Pedido recebido", "Em separação", "Carregando", "Em trânsito", "Entregue"]);
  assert.deepEqual(flow.done, ["Entregue"]);
  assert.equal(flow.place, "Doca");
  assert.equal(flow.asset, "Placa");
  assert.equal(flow.driver, "Motorista");
  assert.equal(flow.due, "Previsão de entrega");
  assert.equal(flow.doneAt, "Data de entrega");
  assert.equal(flow.date, "Data do pedido");
  assert.equal(flow.stock.column.name, "Estoque atual");
  assert.ok(flow.logistics);
  // A status that is not a flow (a category, a yes/no) is not taken for one.
  const plain = profile({ name: "Vendas", header: ["Produto", "Status", "Valor"], rows: [["A", "Ativo", "10"], ["B", "Inativo", "20"], ["C", "Ativo", "5"]], source: { kind: "csv", path: "v.csv", delimiter: ";", encoding: 65001 } });
  assert.equal(readFlow(plain, [plain]), null);
});

test("with a flow the BI opens on the operation: the scene, the tracker, the vehicles and their detail", () => {
  const fact = shipments();
  const plan = design([fact, stock()], { title: "Operação do CD" });
  const op = plan.pages[0];
  assert.equal(op.displayName, "Operação");
  assert.equal(plan.palette.dark, true);
  const images = op.visuals.filter((v) => v.type === "image").map((v) => v.url);
  assert.deepEqual(images, ["[Cena do pátio]", "[Rastreamento]", "[Detalhe selecionado]"]);
  for (const name of ["Cena do pátio", "Rastreamento", "Progresso", "Detalhe selecionado"]) {
    assert.equal(plan.measureList.find((m) => m.name === name)?.category, "ImageUrl", name);
  }
  // The stock measure lives in its own table; every card names a measure that exists.
  assert.equal(plan.measures["Estoque no CD"], "Estoque");
  assert.ok(plan.model.tables.find((t) => t.name === "Estoque").measures.some((m) => m.name === "Estoque no CD"));
  assert.ok(!plan.model.tables.find((t) => t.name === "Embarques").measures.some((m) => m.name === "Estoque no CD"));
  for (const v of plan.pages.flatMap((p) => p.visuals)) {
    for (const ref of [v.values, v.url, v.category].flat().filter((r) => typeof r === "string" && /^\[/.test(r))) assert.ok(plan.measures[ref.slice(1, -1)], `${v.type}: ${ref}`);
  }
  const table = op.visuals.find((v) => v.type === "tableEx");
  assert.equal(table.totals, false);
  assert.deepEqual(table.image, { height: 22, width: 128 });
  // Deliveries: on time by carrier, late by destination (not the generic share by status).
  const deliveries = plan.pages.find((p) => p.displayName === "Entregas");
  assert.ok(deliveries.visuals.some((v) => v.values === "[Entregas no prazo %]" && /Transportadora/.test(v.category)));
  assert.ok(!deliveries.visuals.some((v) => v.type === "donutChart"));
});

test("the scene's DAX: one slot per dock, quotes and parentheses balanced, data text escaped", () => {
  const fact = shipments();
  const flow = readFlow(fact, [fact]);
  const dax = yardScene(flow, { title: "CD 100% Norte #1" });
  const slots = dax.match(/SWITCH\(\[@i\], ([\s\S]*?), ""\), "", \[@i\], ASC\)/)[1];
  assert.equal((slots.match(/^ {4}\d+, |^\d+, /gm) || []).length, 6);
  const noStrings = dax.replace(/"(?:[^"]|"")*"/g, "\"\"");
  assert.equal((noStrings.match(/\(/g) || []).length, (noStrings.match(/\)/g) || []).length);
  assert.match(dax, /CD 100%25 NORTE %231/);
  assert.match(dax, /ISCROSSFILTERED\('Embarques'\[Pedido\]\)/);
  assert.equal(daxText("a#b%c\"d"), "\"a%23b%25c\"\"d\"");
  assert.match(safe("[@placa]"), /"&", "&amp;"\), "<", "&lt;"\), "%", "%25"\), "#", "%23"/);
});

test("the pages follow the request", () => {
  const P = ["Operação", "Entregas", "Detalhamento", "Tendência"].map((displayName) => ({ displayName }));
  const names = (goal) => pagesFor(P, goal).map((p) => p.displayName).join(", ");
  assert.equal(names(""), "Operação, Entregas, Detalhamento, Tendência");
  assert.equal(names("quero só a operação"), "Operação");
  assert.equal(names("painel sem a tendência"), "Operação, Entregas, Detalhamento");
  assert.equal(names("uma página com a evolução mês a mês"), "Tendência");
  assert.equal(names("BI das entregas por transportadora"), "Entregas, Operação, Detalhamento, Tendência");
});

test("a spreadsheet written by the Aurora is a whole workbook (Excel and Power Query open it)", () => {
  const wide = Array.from({ length: 30 }, (_, i) => `C${i + 1}`);
  const buffer = makeXlsx({ Dados: [wide, wide.map((_, i) => i)], Outra: [["A"], ["x"]] });
  const zip = readZip(buffer);
  assert.ok(zip.has("xl/_rels/workbook.xml.rels"));
  const rels = zip.get("xl/_rels/workbook.xml.rels")().toString();
  assert.match(rels, /worksheets\/sheet1\.xml/);
  assert.match(rels, /worksheets\/sheet2\.xml/);
  assert.match(rels, /sharedStrings\.xml/);
  const types = zip.get("[Content_Types].xml")().toString();
  assert.match(types, /\/xl\/worksheets\/sheet2\.xml/);
  assert.match(zip.get("xl/worksheets/sheet1.xml")().toString(), /r="AD1"/);
  const text = xlsxText(buffer);
  assert.match(text, /## Dados\nC1 \| C2/);
  assert.match(text, /\| C30\n0 \| 1/);
  assert.match(text, /## Outra\nA\nx/);
});
