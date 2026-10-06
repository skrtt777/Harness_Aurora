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
  assert.match(out, /Usei Entrega prevista<=15\/10\/2026 \(o pedido diz "até" essa data\)/);
  assert.doesNotMatch(filterRows(sheet, "Entrega prevista=15/10/2026", { request: "o que chega dia 15/10?" }), /PC-1/);
});

test("write_document says which rows of the last filter a document left out", async () => {
  const { rowKeys, missingRows } = await import("../app/agentTools/files.js");
  const found = "C:/x/Pedidos.xlsx\n## Pedidos\nPedido | Fornecedor | Valor\n   12  PC-2026-909 | Santa Rita | 10\n   15  PC-2026-912 | Química | 20\n   16  PC-2026-913 | Caixas | 30\nSoma das 3 linhas acima: Valor = 60\n\n3 linha(s) com \"Entrega<=15/10/2026\".";
  assert.deepEqual(rowKeys(found), ["PC-2026-909", "PC-2026-912", "PC-2026-913"]);
  assert.deepEqual(missingRows(rowKeys(found), "| Pedido |\n| PC-2026-909 |"), ["PC-2026-912", "PC-2026-913"]);
  assert.deepEqual(missingRows(rowKeys(found), "| PC-2026-909 | PC-2026-912 | PC-2026-913 |"), [], "all there");
  assert.deepEqual(missingRows(rowKeys(found), "Relatório sobre outra coisa"), [], "a document not built from that read");
  assert.deepEqual(rowKeys("   3  Maria Souza | RH\n   4  João | TI"), [], "names are not keys");
});

test("a combined date filter that contradicts the request is corrected; a whole-sheet read suggests the date filter", async () => {
  const { filterRows, dateFilterHint } = await import("../app/agentTools/files.js");
  const sheet = ["## Pedidos", "Pedido | Entrega prevista", "PC-1 | 10/10/2026", "PC-2 | 15/10/2026", "PC-3 | 22/10/2026"];
  const out = filterRows(sheet, "Entrega prevista>=15/10/2026; Entrega prevista<=15/10/2026", { request: "entrega até 15/10/2026" });
  assert.match(out, /PC-1[\s\S]*PC-2/);
  assert.doesNotMatch(out, /PC-3/);
  assert.match(out, /Usei Entrega prevista<=15\/10\/2026/);
  const contracts = ["## Contratos", "Contratado | Início | Término | Valor", "A | 01/01/2025 | 31/10/2026 | 10", "B | 01/01/2025 | 31/03/2027 | 20"];
  assert.match(dateFilterHint(contracts, "contratos até 31/12/2026"), /filter="Início<=31\/12\/2026" ou "Término<=31\/12\/2026"/, "no column named: both are offered");
  assert.match(dateFilterHint(contracts, "contratos que terminam até 31/12/2026"), /Já apliquei filter="Término<=31\/12\/2026"/);
  assert.equal(dateFilterHint(contracts, "liste os contratos"), "", "no date in the request");
});

test("a CSV becomes a table the filters read: separator, quotes and Excel's BOM", async () => {
  const { csvTable, filterRows } = await import("../app/agentTools/files.js");
  const text = '﻿Cliente,Valor,Obs\n"Silva, Ltda",1200,"disse ""ok"""\nSouza,300,\n';
  const table = csvTable(text, "clientes.csv");
  assert.deepEqual(table, ["## clientes.csv", "Cliente | Valor | Obs", 'Silva, Ltda | 1200 | disse "ok"', "Souza | 300 | "]);
  assert.match(filterRows(table, "Valor>1000"), /Silva, Ltda/);
  assert.doesNotMatch(filterRows(table, "Valor>1000"), /Souza/);
  assert.equal(csvTable("a;b;c\n1;2;3")[1], "a | b | c", "semicolon (Brazilian Excel)");
});

test("'esse mês', 'mês que vem' and 'em outubro' become a ready date-range filter", async () => {
  const { monthRange, dateFilterHint } = await import("../app/agentTools/files.js");
  const now = new Date(2026, 9, 4);
  assert.deepEqual(monthRange("quais vencem esse mês?", now), { from: "01/10/2026", to: "31/10/2026" });
  assert.deepEqual(monthRange("e no mês que vem?", now), { from: "01/11/2026", to: "30/11/2026" });
  assert.deepEqual(monthRange("o que foi pago no mês passado", now), { from: "01/09/2026", to: "30/09/2026" });
  assert.deepEqual(monthRange("contratos que vencem em fevereiro de 2027", now), { from: "01/02/2027", to: "28/02/2027" });
  assert.deepEqual(monthRange("pedidos de dezembro", new Date(2026, 11, 20)), { from: "01/12/2026", to: "31/12/2026" });
  assert.equal(monthRange("liste os contratos", now), null);
  const sheet = ["## Contratos", "Fornecedor | Vencimento | Valor", "Papelaria | 12/10/2026 | 4200", "Limpa Bem | 28/10/2026 | 9800", "TransNorte | 05/11/2026 | 1000"];
  assert.match(dateFilterHint(sheet, "quais contratos vencem esse mês?", now), /filter="Vencimento>=01\/10\/2026; Vencimento<=31\/10\/2026"/);
  // Every row in the month: the date narrows nothing, so nothing is said.
  assert.equal(dateFilterHint(sheet.slice(0, 4), "quais contratos vencem esse mês?", now), "");
});

test("'mais de 30 dias' and 'mais de 5%' become a ready filter on the columns of that unit", async () => {
  const { numberFilterHint } = await import("../app/agentTools/files.js");
  const bills = ["## Contas", "Cliente | Valor | Dias em atraso (em 04/10/2026) | Situação", "A | 100 | 62 | Em atraso"];
  assert.match(numberFilterHint(bills, "títulos em atraso há mais de 30 dias"), /filter="Dias em atraso \(em 04\/10\/2026\)>30"/);
  assert.match(numberFilterHint(bills, "atraso de pelo menos 15 dias"), />=15"/);
  const budget = ["## Resumo", "Área | Orçado | Desvio (%) | Situação", "Adm | 100 | 0.62% | ok"];
  assert.match(numberFilterHint(budget, "áreas que gastaram mais de 5% acima do orçado"), /filter="Desvio \(%\)>5"/);
  assert.equal(numberFilterHint(budget, "mais de 30 dias"), "", "no column of that unit");
  assert.equal(numberFilterHint(bills, "liste os clientes"), "");
});

test("the numeric hint skips a condition of another part of the request and uses the one this sheet has", async () => {
  const { numberFilterHint } = await import("../app/agentTools/files.js");
  const budget = ["## Resumo", "Área | Orçado | Desvio (%)", "Adm | 100 | 0.62%"];
  assert.match(numberFilterHint(budget, "Relatório das áreas. (Parte de: títulos há mais de 30 dias e áreas mais de 5% acima do orçado)"), /filter="Desvio \(%\)>5"/);
});

test("asked about now, a filter on the start date alone gets the rows in progress today", async () => {
  const { nowNote } = await import("../app/agentTools/files.js");
  const sheet = ["## Férias", "Nome | Início das férias | Fim das férias", "Ana | 20/09/2026 | 10/10/2026", "Bia | 13/10/2026 | 30/10/2026", "Caio | 01/09/2026 | 15/09/2026"];
  const now = new Date(2026, 9, 4);
  assert.match(nowNote(sheet, "Quem está de férias agora?", "Início das férias>=01/10/2026", now), /filter="Início das férias<=04\/10\/2026; Fim das férias>=04\/10\/2026": 1 linha\(s\)/);
  assert.equal(nowNote(sheet, "Quem tira férias em outubro?", "Início das férias>=01/10/2026", now), "", "not about now");
  assert.equal(nowNote(sheet, "quem está de férias hoje", "Início das férias<=04/10/2026; Fim das férias>=04/10/2026", now), "", "already the right filter");
});

test("the person's words decide a document's format over a plain-text one", async () => {
  const { requestedFormat } = await import("../app/agentTools/files.js");
  assert.equal(requestedFormat("Gere a planilha de quem começa as férias em outubro"), "xlsx");
  assert.equal(requestedFormat("Faça um relatório em Word com os contratos"), "docx");
  assert.equal(requestedFormat("Quero o resumo em PDF"), "pdf");
  assert.equal(requestedFormat("Salve as notas em markdown"), null, "a deliberate .md stays");
  assert.equal(requestedFormat("organize a pasta"), null);
});

test("'Coluna X>30' (the word Coluna then a space) still filters on X", async () => {
  const { filterRows } = await import("../app/agentTools/files.js");
  const sheet = ["## Contas", "Cliente | Dias em atraso (em 04/10/2026)", "A | 62", "B | 10"];
  const out = filterRows(sheet, "Coluna Dias em atraso>=31");
  assert.match(out, /1 linha\(s\)/);
  assert.match(out, /\bA\b/);
});

test("'vence primeiro' and 'próximo a vencer' get a ready ascending sort from today", async () => {
  const { nextDueHint } = await import("../app/agentTools/files.js");
  const sheet = ["## Contratos", "Contratado | Início | Término", "A | 01/01/2025 | 30/11/2026", "B | 01/01/2025 | 31/10/2026"];
  const now = new Date(2026, 9, 4);
  assert.match(nextDueHint(sheet, "Qual contrato vence primeiro?", now), /filter="Término>=04\/10\/2026" e sort="Término"/);
  assert.match(nextDueHint(sheet, "qual o próximo a vencer?", now), /sort="Término"/);
  assert.equal(nextDueHint(sheet, "quais contratos temos?", now), "");
});

test("'mais acima', 'maior' and 'menor' get ready sorts in the right direction", async () => {
  const { extremeHint } = await import("../app/agentTools/files.js");
  const sheet = ["## Resumo", "Área | Matrícula | Orçado | Desvio (%)", "TI | 1001 | 100 | 14.35%"];
  assert.match(extremeHint(sheet, "Qual área está mais acima do orçamento?"), /sort="-Orçado" ou sort="-Desvio \(%\)"/);
  assert.match(extremeHint(sheet, "Qual área gastou menos?"), /sort="Orçado" ou sort="Desvio \(%\)"/);
  assert.doesNotMatch(extremeHint(sheet, "maior desvio"), /Matrícula/, "id columns are not sorted for an answer");
  assert.equal(extremeHint(sheet, "Como está o orçamento?"), "");
});

test("a whole-sheet read for a date the request ties to a column comes with the filtered rows", async () => {
  const { dateFilterHint, requestColumn } = await import("../app/agentTools/files.js");
  const sheet = ["## Contratos", "Contratado | Início | Término | Valor", "   1  Alfa | 01/01/2025 | 30/11/2026 | 100", "   2  Beta | 01/02/2025 | 31/03/2027 | 200", "   3  Gama | 01/03/2025 | 15/12/2026 | 300"];
  assert.equal(requestColumn(["Início", "Término"], "contratos vigentes que terminam até 31/12/2026"), "Término");
  assert.equal(requestColumn(["Início", "Término"], "contratos até 31/12/2026"), null, "no column named: only the hint");
  assert.equal(requestColumn(["Entrega prevista", "Emissão"], "pedidos com entrega até 15/10/2026"), "Entrega prevista");
  const out = dateFilterHint(sheet, "Faça um relatório com os contratos que terminam até 31/12/2026");
  assert.match(out, /Já apliquei filter="Término<=31\/12\/2026"/);
  assert.match(out, /Alfa[\s\S]*Gama/);
  assert.doesNotMatch(out, /Beta/);
});

test("a date in a document's name doesn't turn into folders", async () => {
  const { undatedSlashes } = await import("../app/agentTools/files.js");
  assert.equal(undatedSlashes("C:\\x\\Contas a Pagar - Até 15/10/2026.xlsx"), "C:\\x\\Contas a Pagar - Até 15-10-2026.xlsx");
  assert.equal(undatedSlashes("Relatorios/cobranca 05\\10\\2026.docx"), "Relatorios/cobranca 05-10-2026.docx");
  assert.equal(undatedSlashes("2026/10/relatorio.docx"), "2026/10/relatorio.docx", "real year/month folders stay");
});

test("a number condition with one matching column comes with the filtered rows", async () => {
  const { numberFilterHint } = await import("../app/agentTools/files.js");
  const sheet = ["## Orçamento", "Área | Orçado | Realizado | Desvio (%)", "   1  TI | 100 | 114 | 14,35%", "   2  RH | 100 | 102 | 2,10%", "   3  Logística | 100 | 108 | 8,84%"];
  const out = numberFilterHint(sheet, "áreas que gastaram mais de 5% acima do orçado");
  assert.match(out, /Já apliquei filter="Desvio \(%\)>5"/);
  assert.match(out, /TI[\s\S]*Logística/);
  assert.doesNotMatch(out.split("Já apliquei")[1], /\bRH\b/);
});

test("'abaixo do estoque mínimo' compares the stock column with the minimum one", async () => {
  const { limitHint } = await import("../app/agentTools/files.js");
  const sheet = ["## Estoque", "Código | Produto | Saldo (caixas) | Estoque mínimo (caixas)", "FAR-001 | Farinha | 3844 | 1000", "CAF-001 | Café | 310 | 1000", "FUB-001 | Flocão | 427 | 1500"];
  const out = limitHint(sheet, "produtos que estão abaixo do estoque mínimo");
  assert.match(out, /Já apliquei filter="Saldo \(caixas\)<Estoque mínimo \(caixas\)"/);
  assert.match(out, /CAF-001[\s\S]*FUB-001/);
  assert.doesNotMatch(out, /FAR-001/);
  assert.equal(limitHint(sheet, "liste os produtos"), "");
});

test("'de cada cliente' comes with the totals per client, ready", async () => {
  const { groupHint } = await import("../app/agentTools/files.js");
  const sheet = ["## Títulos", "Cliente | Título | Valor | Dias em atraso", "Alfa | Duplicata 1 | 100,00 | 40", "Beta | Duplicata 2 | 50,00 | 35", "Alfa | Duplicata 3 | 25,50 | 60"];
  const out = groupHint(sheet, "relatório com o valor total em atraso de cada cliente");
  assert.match(out, /Totais por Cliente, já somados das 3 linhas \(2 grupos\)/);
  assert.match(out, /Alfa \| 2 \| 125,50/);
  assert.match(out, /Beta \| 1 \| 50,00/);
  assert.doesNotMatch(out, /Total Dias/, "days don't add up");
  assert.equal(groupHint(sheet, "liste os títulos, por favor"), "");
});

test("row keys find the id when the sheet starts with a name; extras are rows the condition left out", async () => {
  const { rowKeys, extraRows } = await import("../app/agentTools/files.js");
  const found = "## T\nCliente | Título | Vencimento | Valor\n    3  Bom Preço | Duplicata 2592 | 03/08/2026 | 10\n    7  Mercadinho | Duplicata 1479 | 16/09/2026 | 20";
  assert.deepEqual(rowKeys(found), ["Duplicata 2592", "Duplicata 1479"]);
  assert.deepEqual(extraRows(["Duplicata 1479"], "| Duplicata 2592 |\n| Duplicata 1479 |"), ["Duplicata 1479"]);
  assert.deepEqual(extraRows(["Duplicata 14"], "| Duplicata 1479 |"), [], "a key inside a longer one is not it");
});

test("the column the request's verb points to: 'começam' is Início, 'volta' is Fim, a shared word decides nothing", async () => {
  const { requestColumn } = await import("../app/agentTools/files.js");
  const cols = ["Início das férias", "Fim das férias"];
  assert.equal(requestColumn(cols, "funcionários que começam as férias em outubro"), "Início das férias");
  assert.equal(requestColumn(cols, "quem volta de férias em outubro"), "Fim das férias");
  assert.equal(requestColumn(cols, "férias em outubro"), null);
  assert.equal(requestColumn(["Emissão", "Vencimento"], "títulos que vencem até 15/10"), "Vencimento");
});

test("'acima do orçamento' with no number compares spent with the budget of the same period", async () => {
  const { limitHint } = await import("../app/agentTools/files.js");
  const sheet = ["## Resumo", "Área | Orçado anual | Orçado Jan-Set | Realizado Jan-Set", "TI | 1000 | 800 | 900", "RH | 1000 | 800 | 700", "Logística | 2000 | 1500 | 1600"];
  const out = limitHint(sheet, "relatório com as áreas acima do orçamento");
  assert.match(out, /Já apliquei filter="Realizado Jan-Set>Orçado Jan-Set"/);
  assert.match(out, /TI[\s\S]*Logística/);
  assert.doesNotMatch(out.split("Já apliquei")[1], /\bRH\b/);
  assert.equal(limitHint(sheet, "áreas mais de 5% acima do orçado"), "", "a number is the number filter's");
});
