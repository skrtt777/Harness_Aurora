import test from "node:test";
import assert from "node:assert/strict";

const { asksAboutCompany, unsupportedFacts, unsupportedTopic } = await import("../app/grounding.js");
const { runChatAgent } = await import("../app/chatAgent.js");

const DOCS = [
  "Fonte: C:\\rh\\Eventos\\Plantão do recesso (escaneado).pdf (RH/Eventos)",
  "COMUNICADO INTERNO - Plantão do RH no recesso",
  "Durante o recesso, de 26/12/2026 a 30/12/2026, o RH funciona em regime de plantão, das 9h às 15h.",
  "Responsável pelo plantão: Marcos Lima, ramal 2210.",
  "Urgências fora do horário: telefone (11) 4000-1234.",
  "Benefícios: Júlia Rocha - ramal 2207. Vale-refeição: R$ 42,00 por dia útil. Plano anual: US$ 1.200",
].join("\n");

test("names and numbers copied from the documents pass; wrong or invented ones are caught (real answers)", () => {
  assert.deepEqual(unsupportedFacts("O plantão é com **Marcos Lima**, ramal **2210**, de 26/12/2026 a 30/12/2026. Urgências: (11) 4000-1234.", DOCS), []);
  assert.deepEqual(unsupportedFacts("Marcoa Lima fica de plantão no RH durante o recesso.", DOCS), ["Marcoa Lima"]);
  assert.deepEqual(unsupportedFacts("O responsável pelo plantão é o **Carlos Eduardo Silva**, com ramal **2200**.", DOCS), ["2200"], "an invented ramal is caught; a whole invented name is not judged by spelling");
  // False alarms seen in the battery with the first version:
  assert.deepEqual(unsupportedFacts("O presente do **Amigo Secreto** é de **R$ 80,00**.", "valor sugerido do presente: R$ 80."), [], "R$ 80,00 is R$ 80");
  assert.deepEqual(unsupportedFacts("**Data do Evento:** amanhã. **Documentos Pessoais:** RG. Fale com Recursos Humanos.", DOCS), [], "headings and common phrases are not names");
  assert.deepEqual(unsupportedFacts("Confirme até 05/12/2026.", "Confirmação de presença até 05/12 pelo formulário"), [], "adding the year to a date is fine");
  assert.deepEqual(unsupportedFacts("O plantão vai de 27/12 a 30/12.", DOCS), ["27/12"], "a wrong day is caught");
  assert.deepEqual(unsupportedFacts("Para dúvidas sobre benefícios, Procure Júlia Rocha no ramal 2207.", DOCS), [], "two words of the name in the documents are enough");
  assert.deepEqual(unsupportedFacts("O vale é de R$ 42,00 por dia útil; o plano anual custa US$ 1.200.", DOCS), []);
  assert.deepEqual(unsupportedFacts("Em 22 dias úteis: 22 × R$ 42,00 = R$ 924,00 por mês.", DOCS), [], "computed values are not checked");
  assert.deepEqual(unsupportedFacts("Sim, das 9h às 15h, de 26 a 30 de dezembro.", DOCS), [], "short numbers are not checked");
  assert.deepEqual(unsupportedFacts("A integração é no Dia das Crianças, Lucas.", "Dia das Crianças em família — 10/10/2026"), []);
});

test("a company question whose subject no document mentions can't be answered with a 'sim' (real answer)", () => {
  const benefits = "Benefícios/Política de Benefícios.pdf\nVale-refeição: R$ 42,00 por dia útil. Plano de saúde: coparticipação de 20%. Auxílio home office: R$ 150,00.";
  assert.deepEqual(unsupportedTopic("A empresa paga curso de inglês?", "Sim, a empresa oferece cursos de inglês como benefício para os colaboradores.", benefits), ["curso", "ingles"]);
  assert.deepEqual(unsupportedTopic("A empresa paga curso de inglês?", "Não encontrei curso de inglês nos documentos; eles cobrem vale-refeição e plano de saúde.", benefits), [], "honest 'não encontrei'");
  assert.deepEqual(unsupportedTopic("Quanto é o vale-refeição?", "O vale-refeição é de R$ 42,00 por dia útil.", benefits), []);
  assert.deepEqual(unsupportedTopic("E o auxílio home office?", "O auxílio home office é de R$ 150,00 por mês.", benefits), []);
  assert.deepEqual(unsupportedTopic("Existe bônus anual?", "Sim, o bônus anual é de um salário extra.", benefits), ["bonus", "anual"]);
  // False alarms from the battery with the first, word-based version: open questions are not judged.
  const contacts = "Contatos do RH.txt\nFolha de pagamento: Diego Santos - ramal 2204";
  assert.deepEqual(unsupportedTopic("Quem cuida da folha de pagamento e qual o ramal?", "Cuida da folha de pagamento: Diego Santos - ramal 2204.", contacts), []);
  assert.deepEqual(unsupportedTopic("Quem fica de plantão no RH durante o recesso?", "O Marcos Lima fica de plantão.", "Plantão: Marcos Lima"), []);
  assert.deepEqual(unsupportedTopic("Como eu faço para pedir férias?", "Para pedir férias, combine com o gestor.", "Procedimento: solicitação de férias"), []);
  assert.deepEqual(unsupportedTopic("Crie um arquivo resumo.txt com o valor do vale-refeição.", "Arquivo resumo.txt criado com o valor.", benefits), []);
  assert.deepEqual(unsupportedTopic("Qual o 202026?", "x", "y"), [], "the answer doesn't talk about it");
  assert.deepEqual(unsupportedFacts("Dia 19 de dezembro de 2026, das 19h às 23h, Final de Ano 2026 (dia 20) 2026", "Confraternização no dia 19 de dezembro de 2026. Final de Ano 2026."), [], "separate numbers are not glued together");
});

test("company questions are told apart from general ones", () => {
  for (const q of ["A empresa paga curso de inglês?", "Qual é a política de bônus anual?", "Quanto é o vale-refeição?", "Como peço férias?"]) assert.equal(asksAboutCompany(q), true, q);
  for (const q of ["Quanto é 17 vezes 3?", "Qual a cotação do dólar hoje?", "Oi, tudo bem?"]) assert.equal(asksAboutCompany(q), false, q);
});

test("the agent consults documents before answering a company question, and fixes copied names", async () => {
  const search = { name: "knowledge_search", description: "busca", parameters: { type: "object", properties: {} }, describe: () => ({ kind: "meta" }), run: async () => "Nenhum documento encontrado." };
  let replies = [{ ok: true, text: "Sim, a empresa oferece cursos de idiomas como benefício." }, { ok: true, text: "", toolCalls: [{ name: "knowledge_search", arguments: { query: "curso de inglês" } }] }, { ok: true, text: "Não encontrei nada sobre curso de inglês nos documentos da empresa." }];
  const seen = [];
  const call = async (messages) => { seen.push(messages.at(-1).content); return replies.shift(); };
  const result = await runChatAgent({ system: "s", input: "A empresa paga curso de inglês?", tools: [search], companyQuestion: true, checkFacts: true, callModel: call });
  assert.match(seen[1], /respondeu sem consultar os documentos/);
  assert.equal(result.text, "Não encontrei nada sobre curso de inglês nos documentos da empresa.");

  const direct = await runChatAgent({ system: "s", input: "Existe política de bônus?", tools: [search], companyQuestion: true, callModel: async () => ({ ok: true, text: "Não encontrei uma política de bônus nos documentos." }) });
  assert.equal(direct.steps.length, 0, "an honest 'não encontrei' needs no nudge");

  replies = [{ ok: true, text: "O plantão é com Marcoa Lima, ramal 2210." }, { ok: true, text: "O plantão é com Marcos Lima, ramal 2210." }];
  seen.length = 0;
  const fixed = await runChatAgent({ system: `Trechos:\n${DOCS}`, input: "Quem fica de plantão?", tools: [search], grounded: true, checkFacts: true, callModel: call });
  assert.match(seen[1], /"Marcoa Lima"/);
  assert.equal(fixed.text, "O plantão é com Marcos Lima, ramal 2210.");
});
