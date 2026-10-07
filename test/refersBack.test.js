import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeXlsx } from "../app/sampleDocs.js";
import { writeFileSync } from "node:fs";

test("'faz uma planilha com eles' brings back the sheet the last answer read", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aurora-back-"));
  const sheet = join(dir, "Pedidos em Aberto.xlsx");
  writeFileSync(sheet, makeXlsx({ "Em aberto": [["Pedido", "Fornecedor"], ["PC-1", "Agro"], ["PC-2", "Sal"]] }));
  const { mentionedFiles } = await import("../app/chatTurn.js");
  const history = [
    { role: "user", content: "quantos pedidos de compra tao em aberto?" },
    { role: "assistant", content: "São 2 pedidos.", execution: { toolSteps: [{ tool: "read_file", ok: true, args: { path: sheet } }] } },
  ];
  const ctx = { workspace: dir, knownFolders: { home: dir }, env: {} };
  const files = await mentionedFiles("faz uma planilha com eles e o fornecedor de cada um", ctx, history);
  assert.equal(files[0]?.path, sheet);
  assert.match(files[0].text, /PC-2/);
  assert.equal((await mentionedFiles("que horas são", ctx, history)).length, 0, "only a message that refers back");
});
