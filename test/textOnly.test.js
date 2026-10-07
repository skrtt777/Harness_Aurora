import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onlyTextAsked, tableSums } from "../app/agentTools/files.js";
import { executeTool } from "../app/agentTools/index.js";

test("a text to use is not saved as a file unless saving was asked", async () => {
  assert.equal(onlyTextAsked("me ajuda a escrever uma msg de aniversario pra minha sobrinha"), true);
  assert.equal(onlyTextAsked("escreve uma carta e salva num documento pra eu imprimir"), false);
  assert.equal(onlyTextAsked("escreve um script python que renomeia as fotos"), false);
  assert.equal(onlyTextAsked("escreva a mensagem de boas-vindas", { AGENT_RUN_TRIGGER: "schedule" }), false, "an agent's run follows its mission");
  const dir = mkdtempSync(join(tmpdir(), "aurora-textonly-"));
  const out = await executeTool("write_file", { path: "msg.txt", content: "Parabéns!" }, { mode: "auto", workspace: dir, workspaceRoots: [dir], approve: async () => true, env: process.env, request: "me ajuda a escrever uma msg de aniversario pra ana" });
  assert.equal(out.ok, false);
  assert.match(out.result, /escreva-o direto na resposta/);
});

test("a table just written reports its row count and the sum of its money columns", () => {
  const md = "| Gasto | Valor |\n|---|---|\n| Aluguel | R$ 1.800,00 |\n| Luz | R$ 230,00 |\n| Internet | 120 |\n| **Total** | **R$ 2.150,00** |";
  assert.match(tableSums(md), /3 linha\(s\); soma de Valor = 2\.150/);
  assert.equal(tableSums("# só texto"), "");
});

test("a Total row that doesn't add up holds the document once", async () => {
  const { wrongTotals } = await import("../app/agentTools/files.js");
  const wrong = "| Gasto | Valor |\n|---|---|\n| Aluguel | 1.800,00 |\n| Luz | 230,00 |\n| Mercado | 850,00 |\n| **Total** | **3.940,00** |";
  assert.deepEqual(wrongTotals(wrong), [{ column: "Valor", written: 3940, sum: 2880 }]);
  assert.deepEqual(wrongTotals(wrong.replace("3.940,00", "2.880,00")), []);
  const dir = mkdtempSync(join(tmpdir(), "aurora-total-"));
  const ctx = { mode: "auto", workspace: dir, workspaceRoots: [dir], approve: async () => true, env: process.env, request: "faz uma planilha com meus gastos" };
  const held = await executeTool("write_document", { path: "gastos.xlsx", content: wrong }, ctx);
  assert.equal(held.ok, false);
  assert.match(held.result, /está 3\.940, a soma é 2\.880/);
  assert.equal((await executeTool("write_document", { path: "gastos.xlsx", content: wrong.replace("3.940,00", "2.880,00") }, ctx)).ok, true);
});

test("write_document with append adds to the document written earlier in the same answer", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileTools } = await import("../app/agentTools/files.js");
  const { extractText } = await import("../app/docText.js");
  const write = fileTools.find((t) => t.name === "write_document");
  const dir = mkdtempSync(join(tmpdir(), "aurora-append-"));
  const ctx = { workspace: dir, request: "monta um relatorio das vendas", env: {} };
  await assert.rejects(write.run({ path: "r.docx", content: "x", append: true }, ctx), /primeira parte/);
  await write.run({ path: "r.docx", content: "# Relatório\n\nResumo: Camila lidera." }, ctx);
  const out = await write.run({ path: "r.docx", content: "## Tabela\n\n| Vendedor | Total |\n|---|---|\n| Camila | 5.839 |", append: true }, ctx);
  assert.match(out, /^Criei /);
  const text = await extractText(join(dir, "r.docx"));
  assert.match(text, /Camila lidera[\s\S]*Vendedor \| Total/);
});

test("a control sheet without a TOTAL row gets one; one with it is left alone", async () => {
  const { withTotalRow } = await import("../app/agentTools/files.js");
  const sheet = "# Gastos\n\n| Data | Descrição | Categoria | Valor |\n|---|---|---|---|\n| exemplo | Mercado | Mercado | R$ 50,00 |\n| exemplo | Luz | Contas | 120,50 |";
  assert.match(withTotalRow(sheet), /\| TOTAL \|  \|  \| 170,50 \|$/);
  const done = `${sheet}\n| TOTAL | | | 170,50 |`;
  assert.equal(withTotalRow(done), done);
  assert.equal(withTotalRow("| Nome | Cargo |\n|---|---|\n| Ana | RH |"), "| Nome | Cargo |\n|---|---|\n| Ana | RH |");
});
