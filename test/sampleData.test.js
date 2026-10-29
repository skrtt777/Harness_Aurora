// Made-up data in volume (28/10/2026): "crie dados de uma empresa com mais de 300 funcionários" came back
// as 20 rows written by hand, "É FICTICIO, PODE GERAR NUMEROS" as a 12-line sheet.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "harness-sample-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.LOCAL_BASE_URL = "http://127.0.0.1:1";
process.env.EMBEDDINGS_ENABLED = "false";

const { sampleRows, guessKind } = await import("../app/agentTools/sampleData.js");
const { executeTool } = await import("../app/agentTools/index.js");
const { routeTools } = await import("../app/toolRouter.js");
const { extractText } = await import("../app/docText.js");

test("the rows are as many as asked, the same for the same file, each column of its kind", () => {
  const columns = [{ name: "ID", kind: "id", prefix: "F" }, { name: "Nome" }, { name: "Departamento", values: ["Vendas", "TI", "RH"], weights: [6, 3, 1] }, { name: "Salário (R$)", min: 2000, max: 15000 }, { name: "Admissão", from: "01/01/2018", to: "30/09/2026" }];
  const rows = sampleRows({ rows: 350, columns, seed: "a.xlsx" });
  assert.equal(rows.length, 351);
  assert.deepEqual(rows[0], ["ID", "Nome", "Departamento", "Salário (R$)", "Admissão"]);
  assert.deepEqual(sampleRows({ rows: 350, columns, seed: "a.xlsx" }), rows, "same file, same rows");
  assert.equal(rows[1][0], "F001");
  for (const r of rows.slice(1)) {
    assert.ok(Number(r[3]) >= 2000 && Number(r[3]) <= 15000, r[3]);
    assert.match(r[4], /^\d{2}\/\d{2}\/(2018|2019|202\d)$/);
  }
  const vendas = rows.filter((r) => r[2] === "Vendas").length;
  assert.ok(vendas > 150 && vendas < 260, `weights: ${vendas} of 350 in Vendas`);
  assert.equal(sampleRows({ rows: 99999, columns, seed: "b" }).length, 5001, "at most 5000");
  assert.equal(guessKind({ name: "Validade" }), "data");
  assert.equal(guessKind({ name: "Qtd. em estoque" }), "inteiro");
  assert.equal(guessKind({ name: "Preço (R$)" }), "dinheiro");
});

test("sample_data writes a real spreadsheet and is offered only for made-up data", async () => {
  const ctx = { allowedRoots: [temp], workspaceRoots: [temp], workspace: temp, mode: "auto", knownFolders: { desktop: temp }, env: process.env, approve: async () => false, request: "crie dados de uma empresa com mais de 300 funcionários" };
  const out = await executeTool("sample_data", { path: "Funcionarios.xlsx", rows: 320, columns: [{ name: "Nome", kind: "nome" }, { name: "Departamento", kind: "lista", values: ["Vendas", "TI"] }, { name: "Salário (R$)", kind: "dinheiro", min: 2000, max: 9000 }] }, ctx);
  assert.equal(out.ok, true, out.result);
  assert.match(out.result, /320 linhas fictícias/);
  const text = await extractText(join(temp, "Funcionarios.xlsx"));
  assert.equal(text.split("\n").filter((l) => /\b(Vendas|TI)\b/.test(l)).length, 320);
  assert.ok(readFileSync(join(temp, "Funcionarios.xlsx")).length > 1000);
  const bad = await executeTool("sample_data", { path: "x.docx", rows: 5, columns: [{ name: "A" }] }, ctx);
  assert.equal(bad.ok, false);
  assert.ok(routeTools("É FICTICIO, PODE GERAR NUMEROS").has("sample_data"));
  assert.ok(routeTools("quero que você crie dados sobre uma empresa aleatoria").has("sample_data"));
  assert.ok(!routeTools("resuma esse contrato").has("sample_data"));
});
