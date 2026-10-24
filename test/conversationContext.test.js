import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HARNESS_DB_FILE = join(mkdtempSync(join(tmpdir(), "aurora-context-")), "test.db");
const { lastDelivery, personFacts, topicFile } = await import("../app/chatTurn.js");

test("'onde está?' right after a delivery brings the delivered path into the context", () => {
  const history = [{ role: "assistant", execution: { toolSteps: [{ tool: "read_file", ok: true, summary: "C:/kit.pdf" }, { tool: "write_document", ok: true, summary: "Criei C:/x/kit_atualizado.docx (DOCX, 900 bytes)." }] } }];
  assert.match(lastDelivery("onde está?", history)[0], /- C:\/x\/kit_atualizado\.docx\nResponda com esse caminho; não crie/);
  assert.deepEqual(lastDelivery("quanto custa o Reel?", history), []);
  assert.deepEqual(lastDelivery("onde está?", [{ role: "assistant", execution: { toolSteps: [] } }]), [], "nothing delivered: nothing to point at");
});

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

test("an answer that doesn't say where the delivered document is gets the path from the tool's report", async () => {
  const { withDeliveryPath } = await import("../app/chatTurn.js");
  const steps = [{ tool: "write_document", ok: true, summary: "Criei C:/Agentes/Logistica/reposicao.xlsx (XLSX, 4615 bytes)." }];
  assert.match(withDeliveryPath("Vou verificar os cálculos.", steps), /Arquivo salvo em:\n- C:\/Agentes\/Logistica\/reposicao\.xlsx$/);
  assert.equal(withDeliveryPath("Pronto: reposicao.xlsx está na sua pasta.", steps), "Pronto: reposicao.xlsx está na sua pasta.");
  assert.equal(withDeliveryPath("Pronto, veja a planilha reposicao.", steps), "Pronto, veja a planilha reposicao.", "the name without extension counts");
  assert.equal(withDeliveryPath("Oi!", [{ tool: "read_file", ok: true, summary: "Li x" }]), "Oi!");
  assert.equal(withDeliveryPath("Falhei.", [{ tool: "write_document", ok: false, summary: "Criei x.docx (…)" }]), "Falhei.");
});

test("a name the person gave is stated plainly in the context", async () => {
  const { personFacts } = await import("../app/chatTurn.js");
  const [block] = personFacts([{ role: "user", content: "Oi! Meu nome é Rafaela e eu cuido das parcerias." }, { role: "assistant", content: "Olá!" }]);
  assert.match(block, /^A pessoa se chama Rafaela\./);
  assert.doesNotMatch(personFacts([{ role: "user", content: "Eu cuido das parcerias da empresa." }])[0] || "", /se chama/);
});

test("'onde ficou aquela planilha que você criou?' in another conversation: the diary's file, checked on disk", async () => {
  const { whereDelivered } = await import("../app/chatTurn.js");
  const store = await import("../app/store.js");
  const { writeFileSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "aurora-where-"));
  const file = join(dir, "Planilha_Parc_Luma.xlsx");
  writeFileSync(file, "x");
  const other = await store.createConversation({ title: "Kit de mídia", provider: "local" });
  await store.addMessage({ conversationId: other.id, role: "assistant", content: "Pronto.", provider: "local", execution: { toolSteps: [{ tool: "write_document", ok: true, summary: `Criei ${file} (XLSX, 4431 bytes).` }] } });
  const block = await whereDelivered("onde ficou aquela planilha que você criou?", []);
  assert.match(block[0], /Planilha_Parc_Luma\.xlsx/);
  assert.match(block[0], /existe nesse caminho/);
  assert.deepEqual(await whereDelivered("crie uma planilha nova, onde ficou a outra?", []), [], "a request to create is not a question about where");
  assert.deepEqual(await whereDelivered("onde fica a praia mais perto?", []), [], "not about a file");
  assert.deepEqual(await whereDelivered("onde ficou a apresentação?", []), [], "no presentation in the diary");
});
