import test from "node:test";
import assert from "node:assert/strict";
import { design, finish, prepare, profile } from "../app/powerbiDesign.js";
import { autoPlan, humanTitle, normalizePlan, planPrompt, planSchema } from "../app/powerbiPlanner.js";
import { composePage, split } from "../app/powerbiLayout.js";
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

test("with a flow the catalog offers the yard, the tracker, the selected item and the table in progress", () => {
  const fact = shipments();
  const prep = prepare([fact, stock()], { title: "Operação do CD" });
  const { cat } = prep;
  assert.equal(cat.kind, "logistica");
  assert.ok(cat.scenes.patio);
  for (const k of ["rastreamento", "tabela_andamento", "detalhe_selecionado"]) assert.ok(cat.specials[k], k);
  assert.ok(!cat.cardable.includes("% do total"));
  assert.ok(cat.principal.includes("Em andamento"));
  // The stock measure lives in its own table and is never grouped by the fact's columns.
  const plan = finish(prep, null);
  assert.equal(plan.measures["Estoque no CD"], "Estoque");
  assert.ok(cat.foreign.has("Estoque no CD"));
  // The automatic plan opens on the yard; every field of every visual exists.
  assert.equal(plan.plan.paginas[0].cena, "patio");
  for (const v of plan.pages.flatMap((p) => p.visuals)) {
    for (const ref of [v.values, v.url, v.category].flat().filter((r) => typeof r === "string" && /^\[/.test(r))) assert.ok(plan.measures[ref.slice(1, -1)], `${v.type}: ${ref}`);
  }
});

test("the local model's plan is checked: unknown names out, cards not repeated, twins dropped, a column asked about gets its chart", () => {
  const fact = shipments();
  const { cat } = prepare([fact], { title: "CD" });
  const plan = normalizePlan({
    titulo: "CD Permacultura", estilo: { tema: "claro", cor: "roxo", tom: "inexistente" },
    paginas: [
      { nome: "VisaoGeralPatio", pergunta: "Como está o pátio?", layout: "cena_e_lateral", cena: "patio", numeros: ["Em andamento", "Não existe", "% do total"], blocos: [{ tipo: "tabela_andamento", medida: "", por: "", titulo: "" }, { tipo: "barras", medida: "Inventada", por: "Doca", titulo: "" }] },
      { nome: "Outra", pergunta: "Qual transportadora atrasa mais?", layout: "grade", cena: "patio", numeros: ["Em andamento", "Atrasados agora"], blocos: [] },
      { nome: "Gêmea", pergunta: "x", layout: "grade", cena: "nenhuma", numeros: ["Atrasados agora"], blocos: [] },
    ],
  }, cat, "operação do CD");
  assert.equal(plan.titulo, "CD");
  assert.deepEqual(plan.estilo, { tema: "claro", cor: "roxo", tom: "sobrio" });
  assert.equal(plan.paginas[0].nome, "Visão geral pátio");
  assert.deepEqual(plan.paginas[0].numeros, ["Em andamento"]);
  assert.deepEqual(plan.paginas[0].blocos.map((b) => b.tipo), ["tabela_andamento"]);
  // The second page: the yard again is dropped (one scene once), the card already shown is not repeated,
  // and "transportadora" in its question brings the ranking by Transportadora.
  assert.equal(plan.paginas[1].cena, "nenhuma");
  assert.deepEqual(plan.paginas[1].numeros, ["Atrasados agora"]);
  assert.ok(plan.paginas[1].blocos.some((b) => b.tipo === "barras" && b.por === "Transportadora"));
  assert.ok(planPrompt(cat, "x").includes("português do Brasil"));
  assert.ok(planSchema(cat).properties.paginas.items.properties.cena.enum.includes("patio"));
  assert.equal(humanTitle("evoluçao_do_orcamento"), "Evolução do orçamento");
});

test("the automatic plan follows the subject and varies with the request", () => {
  const fact = shipments();
  const { cat } = prepare([fact], { title: "CD" });
  const a = autoPlan(cat, "pátio para o supervisor");
  const b = autoPlan(cat, "visão para a diretoria sobre os prazos");
  assert.equal(a.paginas[0].cena, "patio");
  const shape = (p) => p.paginas.map((x) => `${x.nome}|${x.layout}`).join(";") + p.estilo.cor;
  assert.notEqual(shape(a), shape(b));
  assert.equal(autoPlan(cat, "quero só uma página").paginas.length, 1);
});

test("the layout places every visual inside the page, without overlap", () => {
  const card = (t) => ({ type: "card", values: `[${t}]`, title: t });
  const block = (t) => ({ type: "clusteredBarChart", title: t });
  for (const layout of ["cena_inteira", "cena_e_lateral", "cartoes_laterais", "grade", "narrativa", "comparacao", "foco_unico"]) {
    const visuals = composePage({ name: "P", question: "?", layout, cards: [card("a"), card("b"), card("c"), card("d")], scene: { type: "image", url: "[S]" }, blocks: [block("x"), block("y"), block("z")], slicers: [{ type: "slicer", values: "'T'[A]" }] }, { text: "#000", soft: "#555" }, "R");
    const boxes = visuals.filter((v) => v.type !== "textbox");
    for (const v of boxes) assert.ok(v.x >= 0 && v.y >= 0 && v.x + v.w <= 1280 && v.y + v.h <= 720 && v.w > 40 && v.h > 40, `${layout}: ${v.type} ${v.x},${v.y},${v.w},${v.h}`);
    for (const [i, a] of boxes.entries()) for (const b of boxes.slice(i + 1)) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${layout}: ${a.type} x ${b.type}`);
  }
  assert.deepEqual(split({ x: 0, y: 0, w: 100, h: 10 }, 2, true).map((r) => r.w), [44, 44]);
});

test("the scene's DAX: one slot per dock, quotes and parentheses balanced, data text escaped", () => {
  const fact = shipments();
  const flow = readFlow(fact, [fact]);
  const { dax, points } = yardScene(flow, { title: "CD 100% Norte #1", look: "dia", stamp: "[Última atualização]" });
  // Clickable: each bay's position for the scatter over the picture; the picture fills its box; it moves.
  assert.match(points.x, /SWITCH\(i, 1, [\d.]+, 2, /);
  assert.match(dax, /preserveAspectRatio='none'/);
  assert.match(dax, /animateTransform/);
  assert.match(dax, /AO VIVO/);
  const slots = dax.match(/SWITCH\(\[@i\], ([\s\S]*?), ""\), "", \[@i\], ASC\)/)[1];
  assert.equal((slots.match(/^ {4}\d+, |^\d+, /gm) || []).length, 6);
  const noStrings = dax.replace(/"(?:[^"]|"")*"/g, "\"\"");
  assert.equal((noStrings.match(/\(/g) || []).length, (noStrings.match(/\)/g) || []).length);
  assert.match(dax, /CD 100%25 NORTE %231/);
  assert.match(dax, /ISCROSSFILTERED\('Embarques'\[Pedido\]\)/);
  assert.equal(daxText("a#b%c\"d"), "\"a%23b%25c\"\"d\"");
  assert.match(safe("[@placa]"), /"&", "&amp;"\), "<", "&lt;"\), "%", "%25"\), "#", "%23"/);
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

test("rows with a place become a 3D plan: each row a box, the chosen lit, the rest wireframe, a click point each", async () => {
  const { readSpace, plantaScene } = await import("../app/powerbiSpace.js");
  const rows = [["Recepção", "Atendimento", "1", "0", "0", "8", "7", "56"], ["Diretoria", "Escritório", "1", "8,5", "0", "7", "7", "49"], ["RH", "Escritório", "2", "0", "10", "8", "7", "56"]];
  const t = profile({ name: "Salas", header: ["Sala", "Tipo", "Andar", "X", "Y", "Largura", "Profundidade", "Área (m²)"], rows, source: { kind: "csv", path: "s.csv", delimiter: ";", encoding: 65001 } });
  const space = readSpace(t);
  assert.deepEqual([space.name, space.kind, space.floor, space.x, space.y, space.w, space.d], ["Sala", "Tipo", "Andar", "X", "Y", "Largura", "Profundidade"]);
  // The geometry is not summed into measures.
  const plan = design([t], {});
  assert.ok(!plan.measureList.some((m) => /^(X|Y|Largura|Profundidade|Andar) total$/.test(m.name)));
  assert.ok(plan.measureList.some((m) => m.name === "Qtd. de salas"));
  const { dax, points } = plantaScene(space, { look: "dia" });
  const noStrings = dax.replace(/"(?:[^"]|"")*"/g, "\"\"");
  assert.equal((noStrings.match(/\(/g) || []).length, (noStrings.match(/\)/g) || []).length);
  assert.match(dax, /ISCROSSFILTERED\('Salas'\[Sala\]\)/);
  assert.match(dax, /fill='none' stroke=/, "the rest as wireframe");
  // Sums in the projection keep their parentheses (a missing pair mirrored the tops, 11/10).
  assert.match(dax, /INT\(\(\(/);
  assert.match(points.x, /SELECTEDVALUE\('Salas'\[Sala\]\)/);
});

test("the digital twin page: the scene is the page, a scatter over it for the clicks, the chosen item's card floating", () => {
  const visuals = composePage({ name: "Pátio", question: "agora", layout: "gemeo_digital", cards: [{ type: "card", values: "[a]", title: "a" }, { type: "card", values: "[b]", title: "b" }],
    scene: { type: "image", url: "[Cena]", overlay: { category: "'T'[Doca]", x: "[PX]", y: "[PY]", w: 1200, h: 680 } },
    blocks: [{ type: "image", url: "[Detalhe]", float: true }, { type: "image", url: "[Rastreamento]" }], slicers: [] }, { text: "#000", soft: "#555", pin: "#2F6FDB" }, "R");
  const scene = visuals.find((v) => v.url === "[Cena]");
  const overlay = visuals.find((v) => v.type === "scatterChart");
  assert.deepEqual([overlay.x, overlay.y, overlay.w, overlay.h], [scene.x, scene.y, scene.w, scene.h]);
  assert.ok(visuals.indexOf(overlay) > visuals.indexOf(scene), "the scatter is above the picture");
  // The scene keeps the drawing's proportion (1200 x 680) within 15%.
  assert.ok(Math.abs(scene.w / scene.h - 1200 / 680) / (1200 / 680) < 0.15);
  const card = visuals.find((v) => v.url === "[Detalhe]");
  assert.ok(card.x + card.w <= 1256 && card.y >= scene.y);
  assert.ok(!visuals.some((v) => "fitted" in v));
});
