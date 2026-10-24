import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makePdfDocument, parseBlocks } from "../app/documentWriter.js";
import { makeXlsx } from "../app/sampleDocs.js";

const { fileTools, typeExtensions, askedKind } = await import("../app/agentTools/files.js");
const { billTools, parseBill, parseDay } = await import("../app/agentTools/bills.js");
const { calcTools, evaluate, numberList } = await import("../app/agentTools/calc.js");
const { extremeMismatch } = await import("../app/codeGuards.js");
const { monthTypoNote } = await import("../app/chatAgent.js");
const tool = (list, name) => list.find((t) => t.name === name);

function home() {
  const base = mkdtempSync(join(tmpdir(), "ladder-tools-"));
  const folders = { home: base, desktop: join(base, "Desktop"), documents: join(base, "Documents"), downloads: join(base, "Downloads") };
  for (const d of [folders.desktop, folders.documents, folders.downloads]) mkdirSync(d, { recursive: true });
  return folders;
}
const ctxOf = (folders, request) => ({ request, knownFolders: folders, approve: async () => true });

test("make_folder makes folders; an empty extension-less write_file is a folder, not a file", async () => {
  const f = home();
  const ctx = ctxOf(f, "cria uma pasta Mudança na área de trabalho com as subpastas Fotos e Contratos");
  await tool(fileTools, "make_folder").run({ paths: ["Desktop/Mudança/Fotos", "Desktop/Mudança/Contratos"] }, ctx);
  assert.ok(statSync(join(f.desktop, "Mudança", "Fotos")).isDirectory());
  await tool(fileTools, "write_file").run({ path: "Desktop/Mudança/Listas", content: "" }, ctx);
  assert.ok(statSync(join(f.desktop, "Mudança", "Listas")).isDirectory());
  const out = await tool(fileTools, "move_file").run({ to: "Desktop/Mudança/Recibos" }, ctx);
  assert.match(out, /Criei a pasta/);
});

test("move_file by type: chosen by extension, never by name; the folder stays where the request said", async () => {
  const f = home();
  for (const n of ["foto_1.jpg", "foto_2.pdf", "img.png", "nota.docx"]) writeFileSync(join(f.downloads, n), "x");
  const ctx = ctxOf(f, "cria uma pasta Fotos nos downloads e move as imagens pra lá");
  const out = await tool(fileTools, "move_file").run({ from_folder: "Downloads", types: "imagens", to: "Desktop/Fotos" }, ctx);
  assert.match(out, /2 de 2/);
  assert.ok(existsSync(join(f.downloads, "Fotos", "foto_1.jpg")) && existsSync(join(f.downloads, "Fotos", "img.png")));
  assert.ok(existsSync(join(f.downloads, "foto_2.pdf")), "a pdf named foto stays");
  // Listed by hand, "as fotos": the pdf is left out and said so.
  writeFileSync(join(f.downloads, "foto_3.jpg"), "x");
  const listed = await tool(fileTools, "move_file").run({ files: ["Downloads/foto_2.pdf", "Downloads/foto_3.jpg"], to: "Downloads/Fotos" }, ctxOf(f, "junta as fotos dos downloads na pasta Fotos"));
  assert.match(listed, /Não movi foto_2\.pdf/);
  assert.deepEqual([...typeExtensions("pdfs")], ["pdf"]);
  assert.ok(askedKind("põe as imagens numa pasta").has("png"));
});

test("bills_table: every bill at once, in due order, with the total and a due filter", async () => {
  const f = home();
  const bill = (company, value, due) => makePdfDocument(parseBlocks(`# ${company} - Conta\n\nValor a pagar: R$ ${value}\n\nVencimento: ${due}`));
  writeFileSync(join(f.downloads, "boleto_luz.pdf"), bill("Coelba", "230,45", "18/10/2026"));
  writeFileSync(join(f.downloads, "boleto_agua.pdf"), bill("Embasa", "88,10", "09/10/2026"));
  writeFileSync(join(f.downloads, "boleto_escola.pdf"), bill("Colégio Saber", "1.230,00", "25/10/2026"));
  writeFileSync(join(f.downloads, "foto.jpg"), "x");
  const out = await tool(billTools, "bills_table").run({ path: "Downloads" }, ctxOf(f, "quais contas tenho"));
  assert.match(out, /Total: R\$ 1\.548,55/);
  assert.match(out, /Vence primeiro: Embasa/);
  assert.ok(out.indexOf("Embasa") < out.indexOf("Coelba") && out.indexOf("Coelba") < out.indexOf("Colégio"));
  const until = await tool(billTools, "bills_table").run({ path: "Downloads", vence_ate: "20" }, ctxOf(f, "as que vencem até dia 20"));
  assert.match(until, /2 de 3/);
  assert.match(until, /Total: R\$ 318,55/);
  assert.match(until, /NÃO ponha estas.*Colégio Saber/);
  assert.equal(parseBill("Recibo de faxina, R$ 80,00"), null);
  // Only the digit line (no "Valor:"/"Vencimento:"): value and due date from it, the 2025 factor reset included.
  const fromLine = parseBill("BANCO X\nPagador: Marta\n23793.38128 60000.000003 00000.000400 1 16050000023045", "boleto.pdf", Date.UTC(2026, 9, 4));
  assert.equal(fromLine.value, 230.45);
  assert.deepEqual(fromLine.due, { day: 20, month: 10, year: 2026 });
  assert.equal(parseDay("12", { month: 10, year: 2026 }).getDate(), 12);
});

test("calculate: Brazilian numbers, percent, the person's list", async () => {
  assert.equal(evaluate("100 - 21,58 - 47,55 - 7,17"), 23.7);
  assert.equal(evaluate("12% de 500"), 60);
  assert.equal(evaluate("1.234,56 + 1.800"), 3034.56);
  assert.throws(() => evaluate("process.exit()"));
  assert.deepEqual(numberList("4,7, 7,8 e 4,2"), [4.7, 7.8, 4.2]);
  const calc = tool(calcTools, "calculate");
  assert.match(await calc.run({ numeros: "8,7,6,3,9", operacao: "media" }, { request: "tirei 8,7, 6,3, 9 nas provas" }), /media de 3 .* = 8\b/);
});

test("search_files looks INSIDE the person's files when no name has it, typos tolerated", async () => {
  const f = home();
  writeFileSync(join(f.documents, "gastos.xlsx"), makeXlsx({ Gastos: [["Descrição", "Categoria", "Valor"], ["Cinema", "Lazer", 40]] }));
  mkdirSync(join(f.documents, "Contatos"));
  writeFileSync(join(f.documents, "Contatos", "anotacao_3.txt"), "Paulo — eletricista. Telefone: (71) 91234-5678");
  const search = tool(fileTools, "search_files");
  assert.match(await search.run({ pattern: "**/Lazr*" }, ctxOf(f, "quanto gastei com lazr")), /gastos\.xlsx \("lazr" = "lazer"\)/);
  assert.match(await search.run({ pattern: "paulo" }, ctxOf(f, "telefone do paulo")), /anotacao_3\.txt: Paulo/);
});

test("guards: the other end of a sorted read, a month typed wrong, the person's data not read", async () => {
  const found = [{ side: "menor", column: "Valor", label: "Detergente", value: "2.5" }];
  assert.ok(extremeMismatch("O mais em conta é o Leite (caixa), R$ 52,13.", found));
  assert.equal(extremeMismatch("O mais barato é o Detergente, R$ 2,50.", found), null);
  assert.match(monthTypoNote("qnto foi lazer em stembro"), /"stembro" = setembro/);
  const { unreadPersonalData } = await import("../app/codeGuards.js");
  assert.equal(unreadPersonalData("Total R$ 3.540,00 (aluguel R$ 1.800,00)", "faz uma planilha com meus gastos: aluguel 1800, luz 230, internet 120, mercado 850, condominio 540"), null, "the person's own numbers and their sum");
  assert.equal(unreadPersonalData("sobra R$ 1.161,65", "sobra quanto da minha conta?", [], "saldo R$ 1.932,10; luz R$ 230,45; condomínio R$ 540,00; 1.161,65"), null, "read earlier in the conversation");
  assert.equal(unreadPersonalData("Dividindo R$ 500,00 por 45 pessoas, R$ 11,11 cada.", "divide o churrasco de sábado pela galera"), "invented");
  assert.equal(unreadPersonalData("Você possui alguma conta de condomínio que eu possa consultar?", "qual o valor do condominio de setembro?"), "asked");
  assert.equal(monthTypoNote("junto de outro arquivo"), "");
});
