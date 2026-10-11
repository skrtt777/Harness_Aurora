import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeTool } from "../app/agentTools/index.js";

test("what was kept of a cut call is written only whole, and never over an existing file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aurora-salvaged-"));
  writeFileSync(join(dir, "titulos.csv"), "Cliente;Título;Dias em atraso\nAlfa;Duplicata 111;40\nBeta;Duplicata 222;50\nGama;Duplicata 333;75\n");
  const ctx = { mode: "auto", workspace: dir, workspaceRoots: [dir], approve: async () => true, env: process.env, request: "lista dos títulos com mais de 30 dias" };
  await executeTool("read_file", { path: "titulos.csv", filter: "Dias em atraso>30" }, ctx);
  // Cut while copying the rows of the read: the table is completed from that read, exactly.
  const short = await executeTool("write_document", { path: "cobranca.md", content: "Títulos em atraso:\n\n| Cliente | Título |\n|---|---|\n| Alfa | Duplicata 111 |\n| Beta | Duplicata 222 |", __salvaged: true }, ctx);
  assert.equal(short.ok, true, short.result);
  assert.match(short.result, /completei a tabela com as 3 linhas/);
  const written = readFileSync(join(dir, "cobranca.md"), "utf8");
  assert.match(written, /Títulos em atraso/);
  for (const k of ["Duplicata 111", "Duplicata 222", "Duplicata 333"]) assert.ok(written.includes(k), k);
  // Rows the read does not have: still refused, nothing written.
  const odd = await executeTool("write_document", { path: "outra.md", content: "| Duplicata 111 |\n| Duplicata 999 |", __salvaged: true }, { ...ctx, lastTable: { header: ["Cliente", "Título"], rows: [["Alfa", "Duplicata 111"]] } });
  assert.equal(odd.ok, false);
  const before = readFileSync(join(dir, "cobranca.md"), "utf8");
  const over = await executeTool("write_document", { path: "cobranca.md", content: "| Duplicata 111 |\n| Duplicata 222 |\n| Duplicata 333 |", __salvaged: true }, ctx);
  assert.equal(over.ok, false, "a cut call never replaces a file");
  assert.equal(readFileSync(join(dir, "cobranca.md"), "utf8"), before);
});
