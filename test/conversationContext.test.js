import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HARNESS_DB_FILE = join(mkdtempSync(join(tmpdir(), "aurora-context-")), "test.db");
const { personFacts, topicFile } = await import("../app/chatTurn.js");

test("what the person says about themselves stays for the whole conversation", () => {
  const history = [
    { role: "user", content: "Oi! Meu nome é Rafaela e eu cuido das parcerias." },
    { role: "assistant", content: "Olá, meu nome é Aurora." },
    { role: "user", content: "resuma o kit de mídia" },
    { role: "user", content: "pode me chamar de Rafa" },
  ];
  const [block] = personFacts(history);
  assert.match(block, /Meu nome é Rafaela[\s\S]*pode me chamar de Rafa/);
  assert.doesNotMatch(block, /Aurora|resuma/, "only the person's own statements about themselves");
  assert.deepEqual(personFacts([{ role: "user", content: "quanto custa o Reel?" }]), []);
});

test("the file of the subject wins over the most recent one, and nothing is guessed without a match", () => {
  const named = ["contratos_fornecedores.xlsx", "Kit_Midia_Luma_2026"];
  assert.equal(topicFile("voltando ao kit de mídia: quantos seguidores?", named), "Kit_Midia_Luma_2026");
  assert.equal(topicFile("e os contratos dos fornecedores?", named), "contratos_fornecedores.xlsx");
  assert.equal(topicFile("crie uma planilha com isso", named), null);
});
