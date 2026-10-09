import test from "node:test";
import assert from "node:assert/strict";
import { isSensitive, maskSensitive, sensitiveFindings } from "../app/sensitive.js";

test("a client's debt, a colleague's salary or a CPF is sensitive; a general lesson is not", () => {
  assert.ok(isSensitive("O cliente Empório Central deve R$ 157.935,04 em duplicatas atrasadas."));
  assert.ok(isSensitive("Bruno Gomes Souza ganha R$ 2.518,03."));
  assert.ok(isSensitive("CPF do titular: 123.456.789-09"));
  assert.ok(isSensitive("Contato do fornecedor: compras@alvorada.com.br, (71) 99876-5432"));
  assert.ok(isSensitive("A Ana está de atestado por depressão."));
  assert.ok(isSensitive("CNPJ 12.345.678/0001-90"));
  for (const general of [
    "Para planilhas, use read_file com filter em vez de contar de cabeça.",
    "A pessoa prefere respostas curtas e em tópicos.",
    "Relatórios devem ser entregues em .docx com a fonte no fim.",
    "Em outubro, confira o calendário de obrigações antes de responder sobre impostos.",
  ]) assert.equal(isSensitive(general), false, general);
  assert.deepEqual(sensitiveFindings("Empório Central deve R$ 10 mil").sort(), ["dívida ou cobrança", "nome de pessoa ou empresa", "valor em dinheiro"].sort());
});

test("identifiers are masked for a service outside the computer", () => {
  const masked = maskSensitive("Ligar para (71) 99876-5432 ou ana@empresa.com; CPF 123.456.789-09, CNPJ 12.345.678/0001-90.");
  assert.equal(masked, "Ligar para [telefone] ou [e-mail]; CPF [CPF], CNPJ [CNPJ].");
});

test("the central memory refuses a client's data; a search with a CPF never reaches the web", async () => {
  const { contribution } = await import("../app/centralProtocol.js");
  assert.throws(() => contribution({ title: "Cobrança", content: "O Empório Central deve R$ 157 mil em atraso.", tags: ["financeiro"] }), /dados privados/);
  assert.equal(contribution({ title: "Planilhas", content: "Para contar linhas, use read_file com filter.", tags: ["planilha"] }).format, "aurora-memory-contribution");
  const { webTools } = await import("../app/agentTools/web.js");
  const search = webTools.find((t) => t.name === "web_search");
  await assert.rejects(search.run({ query: "CPF 123.456.789-09 dívidas" }, { env: {} }), /dado pessoal \(CPF\)/);
});
