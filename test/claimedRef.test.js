import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimsDelivery } from "../app/teacher.js";

test("naming a file made earlier that is on disk is not a false delivery", () => {
  const dir = mkdtempSync(join(tmpdir(), "aurora-ref-"));
  const file = join(dir, "Precos_Luma.xlsx");
  writeFileSync(file, "x");
  assert.equal(claimsDelivery(`A planilha que criei está em ${file}.`), false, "full path on disk");
  const diary = `O que você fez hoje:\n- hoje 04:05: criou/editou ${file}`;
  assert.equal(claimsDelivery("Criei a planilha Precos_Luma.xlsx mais cedo, ela está na pasta do projeto.", [], { context: diary }), false, "name the context gives the path of");
  assert.equal(claimsDelivery("Criei a planilha Nova_Lista.xlsx com os dados.", [], { context: diary }), true, "a file that doesn't exist is still a false delivery");
});
