// The conversation "monte um BI interativo sobre departamentos" (13/10/2026): each fix, held.
import test from "node:test";
import assert from "node:assert/strict";
import { cellValue, columnSums, csvTable } from "../app/agentTools/files.js";
import { askedStyle } from "../app/powerbiPlanner.js";
import { claimsActionWithoutAction, FICTIONAL } from "../app/codeGuards.js";
import { routeTools } from "../app/toolRouter.js";

test("thousands without decimals are numbers", () => {
  assert.equal(cellValue("2.800.000"), 2800000);
  assert.equal(cellValue("R$ 1.234,56"), 1234.56);
  assert.equal(cellValue("69062.05"), 69062.05);
});

test("a sheet comes with its sums, largest and smallest ready", () => {
  const t = csvTable("Departamento;Funcionários;Orçamento\nTecnologia;420;2.800.000\nVendas;610;1.950.000\nRH;95;980.000\n");
  const note = columnSums(t);
  assert.match(note, /Funcionários: soma 1\.125, maior 610 \(Vendas\), menor 95 \(RH\)/);
  assert.match(note, /Orçamento: soma 5\.730\.000, maior 2\.800\.000 \(Tecnologia\)/);
});

test("the colours the person asks for win over the plan's", () => {
  assert.deepEqual(askedStyle("deixe o tema azul e amarelo"), { cor: "amarelo", tema: "escuro" });
  assert.deepEqual(askedStyle("tema claro verde"), { tema: "claro", cor: "verde" });
  assert.equal(askedStyle("BI de vendas"), null);
});

test("\"Pronto! Aplicado às 4 páginas\" with no tool run is caught", () => {
  const acts = new Set(["powerbi", "write_document"]);
  assert.equal(claimsActionWithoutAction("Pronto!\n\n**Atualizado:** - Tema do BI: Escuro", [], acts), true);
  assert.equal(claimsActionWithoutAction("Aplicado às 4 páginas: 1. Dashboard", [], acts), true);
  assert.equal(claimsActionWithoutAction("Pronto! Criei o BI.", [{ tool: "powerbi", ok: true }], acts), false);
  assert.equal(claimsActionWithoutAction("Nada foi executado: o modo Plano está ligado.", [], acts), false);
  assert.equal(claimsActionWithoutAction("Pronto, aqui está o e-mail:\nOlá João", [], acts), false);
});

test("made-up data asked for is allowed", () => {
  assert.equal(FICTIONAL.test("É FICTICIO, PODE GERAR NUMEROS"), true);
  assert.equal(FICTIONAL.test("me mostre os clientes reais"), false);
});

test("\"BI\" alone brings the Power BI tool", () => {
  for (const q of ["monte um BI interativo sobre departamentos", "quero um painel de vendas", "indicadores do RH"]) assert.ok(routeTools(q).has("powerbi"), q);
  assert.ok(!routeTools("resuma este contrato").has("powerbi"));
});

test("a presentation is a real .pptx, one slide per heading", async () => {
  const { makePresentation, slidesOf } = await import("../app/pptxWriter.js");
  const { parseBlocks } = await import("../app/documentWriter.js");
  const blocks = parseBlocks("# Pedidos\nResumo\n\n## Pendentes\n| Pedido | Situação |\n|---|---|\n| 1042 | Atrasado |\n\n## Próximos passos\n- Cobrar");
  assert.equal(slidesOf(blocks).length, 3);
  const zip = makePresentation(blocks);
  assert.equal(zip.subarray(0, 2).toString(), "PK");
  const { extractText } = await import("../app/docText.js");
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const file = `${mkdtempSync(`${tmpdir()}/pptx-`)}/t.pptx`;
  writeFileSync(file, zip);
  assert.match(await extractText(file), /1042/);
});

test("asked for slides, a .docx path becomes .pptx", async () => {
  const { requestedFormat } = await import("../app/agentTools/files.js");
  assert.equal(requestedFormat("faça uma apresentação curta (3 slides)"), "pptx");
  assert.equal(requestedFormat("relatório em Word"), "docx");
});

test("the days to a date are counted by the tool", async () => {
  const { daysNote } = await import("../app/agentTools/files.js");
  const note = daysNote(["Pedido | Data", "1042 | 15/09/2026"], "há quantos dias o pedido foi feito?", new Date(2026, 9, 4, 12));
  assert.match(note, /19 dia\(s\) atrás/);
  assert.equal(daysNote(["Pedido | Data", "1042 | 15/09/2026"], "quem é o fornecedor?", new Date(2026, 9, 4)), "");
});

test("\"ainda não foram entregues\" keeps every status but Entregue", async () => {
  const { notStatusHint } = await import("../app/agentTools/files.js");
  const t = ["## Pedidos", "Pedido | Situação", "1040 | Entregue", "1041 | Em trânsito", "1042 | Atrasado", "1043 | Entregue", "1044 | Aguardando"];
  const hint = notStatusHint(t, "os pedidos que ainda não foram entregues");
  assert.match(hint, /Situação!=Entregue/);
  assert.match(hint, /1041[\s\S]*1042[\s\S]*1044/);
  assert.doesNotMatch(hint, /1040 \|/);
});

test("a count that disagrees with the list beside it is caught", async () => {
  const { countMismatch } = await import("../app/codeGuards.js");
  assert.deepEqual(countMismatch("totalizando **7 pessoas**:\n\n| Nome |\n|---|\n| Ana |\n| Lucas |\n| Diego |\n| João |"), { said: [7], listed: 4 });
  assert.equal(countMismatch("São 4 pessoas:\n- Ana\n- Lucas\n- Diego\n- João"), null);
  assert.equal(countMismatch("Dos 12 funcionários, 4 trabalham lá:\n- Ana\n- Lucas\n- Diego\n- João"), null);
});

test("\"o que está faltando comprar\" gets the rows under their minimum", async () => {
  const { minimumHint } = await import("../app/agentTools/files.js");
  const t = ["## E", "Produto | Estoque | Mínimo", "Parafuso M6 | 120 | 200", "Porca M6 | 450 | 300", "Broca 8mm | 15 | 10", "Lixa grão 120 | 30 | 60"];
  const hint = minimumHint(t, "o que está faltando comprar?");
  assert.match(hint, /Parafuso M6: falta 80; Lixa grão 120: falta 30/);
  assert.doesNotMatch(hint, /Broca 8mm \|/);
});

test("a whole list asked for and a short one answered is caught", async () => {
  const { shortList } = await import("../app/codeGuards.js");
  assert.deepEqual(shortList("| Dep |\n|---|\n| Vendas |\n| Op |", "liste os departamentos do maior para o menor", 8), { listed: 2, readRows: 8 });
  assert.equal(shortList("1. A\n2. B\n3. C", "liste os 3 maiores", 8), null);
  assert.equal(shortList("- a\n- b", "liste os pedidos acima de 5 mil", 8), null);
});

test("two sheets are crossed by the column they share", async () => {
  const { joinNote } = await import("../app/agentTools/files.js");
  const deps = ["Departamento | Orçamento", "    2  Tecnologia | 2.800.000", "    3  Vendas | 1.950.000", "    4  Logística | 2.100.000"];
  const people = ["Nome | Departamento", "    2  Ana | Tecnologia", "    3  Bruno | Vendas", "    4  João | Logística"];
  const note = joinNote([{ name: "Dep.csv", lines: deps }], people, "Func.xlsx", "quantas pessoas trabalham em departamentos com orçamento acima de 2 milhões?");
  assert.match(note, /2 linha\(s\)/);
  assert.match(note, /Ana \| Tecnologia/);
  assert.doesNotMatch(note, /Bruno/);
});

test("line numbers used as ids are caught", async () => {
  const { lineKeysOf, lineNumbersAsIds } = await import("../app/agentTools/files.js");
  const keys = lineKeysOf("Pedido | Fornecedor\n    4  1041 | Beta\n    9  1046 | Gama");
  assert.equal(lineNumbersAsIds(keys, "- Pedido #4 - Beta\n- Pedido #9 - Gama").length, 2);
  assert.equal(lineNumbersAsIds(keys, "- 1041 Beta\n- 1046 Gama").length, 0);
});

test("\"do maior para o menor número de funcionários\" comes sorted", async () => {
  const { sortHint } = await import("../app/agentTools/files.js");
  const t = ["## D", "Departamento | Funcionários", "Tecnologia | 420", "Vendas | 610", "Jurídico | 60"];
  const hint = sortHint(t, "liste os departamentos do maior para o menor número de funcionários");
  assert.match(hint, /Vendas[\s\S]*Tecnologia[\s\S]*Jurídico/);
  assert.equal(sortHint(t, "liste os departamentos"), "");
});

test("a document written with the read's line numbers gets the real codes", async () => {
  const { executeTool } = await import("../app/agentTools/index.js");
  const { makeXlsx } = await import("../app/sampleDocs.js");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { extractText } = await import("../app/docText.js");
  const dir = mkdtempSync(`${tmpdir()}/linhas-`);
  writeFileSync(`${dir}/Pedidos.xlsx`, makeXlsx({ Pedidos: [["Pedido", "Fornecedor", "Situação"], [1040, "Alfa", "Entregue"], [1041, "Beta", "Em trânsito"], [1042, "Gama", "Atrasado"]] }));
  const ctx = { workspace: dir, workspaceRoots: [dir], allowedRoots: [dir], request: "faça um documento com os pedidos", approve: async () => true, knownFolders: {} };
  await executeTool("read_file", { path: "Pedidos.xlsx" }, ctx);
  const out = await executeTool("write_document", { path: "pedidos.docx", content: "# Pedidos\n- Pedido 4 - Beta\n- Pedido 5 - Gama" }, ctx);
  assert.match(String(out.result), /4 → 1041, 5 → 1042/);
  const text = await extractText(`${dir}/pedidos.docx`);
  assert.match(text, /Pedido 1041 - Beta/);
  assert.match(text, /Pedido 1042 - Gama/);
});
