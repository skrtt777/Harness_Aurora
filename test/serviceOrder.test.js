import test from "node:test";
import assert from "node:assert/strict";

const { serviceOrder, orderBlock, dispatchCheck, writtenFiles } = await import("../app/serviceOrder.js");
const { runChatAgent } = await import("../app/chatAgent.js");
const { areaRules, agentRules } = await import("../app/economy.js");

test("Recepção: the order of a request (what to deliver, the rules, run it, official sources); none for a question", () => {
  const empresa = serviceOrder("quero que você crie dados sobre uma empresa aleatoria, com todos os departamentos com mais de 300 funcionarios e faça planilhas em excel");
  assert.deepEqual(empresa.deliver, ["uma planilha Excel (.xlsx)"]);
  assert.deepEqual(empresa.rules, ["mais de 300 funcionarios em CADA linha"]);
  assert.match(orderBlock(empresa), /^ORDEM DE SERVIÇO \(Recepção, área Pessoas\):\n- Entregar: uma planilha Excel/);
  const python = serviceOrder("na pasta python, crie um arquivo jogos.csv com 15 jogos e um script relatorio.py. Rode o script e me mostre o resultado.");
  assert.deepEqual(python.deliver, ["o arquivo jogos.csv", "o arquivo relatorio.py"], "relatorio.py is not a Word report");
  assert.equal(python.run, true); assert.equal(python.folder, "python"); assert.equal(python.area, "ti");
  assert.match(orderBlock(python), /na pasta python[\s\S]*Rodar o que fizer/);
  assert.equal(orderBlock(serviceOrder("Quais clientes estão inadimplentes há mais de 30 dias?")), null);
  assert.equal(serviceOrder("faça um parecer sobre a Lei do Inquilinato citando fonte oficial").official, true);
  assert.deepEqual(serviceOrder("crie uma planilha com preços entre 10 e 50 reais").rules, ["entre 10 e 50 reais em CADA linha"]);
  assert.equal(serviceOrder("oi, tudo bem?").areaSure, false);
  assert.equal(serviceOrder("Liste os contratos vigentes em 2026").area, "juridico");
});

test("Expedição: the format asked must be written, what had to run must run, the answer says where the file is", () => {
  const order = serviceOrder("Liste numa planilha os funcionários que começam férias em outubro");
  assert.deepEqual(dispatchCheck(order, { answer: "Pronto.", steps: [] }).missing.map((m) => /xlsx/.test(m)), [true]);
  const steps = [{ tool: "write_document", ok: true, summary: "Criei C:/t/Ferias-Outubro.xlsx (XLSX, 10 bytes)." }];
  assert.deepEqual(writtenFiles(steps), ["C:/t/Ferias-Outubro.xlsx"]);
  assert.deepEqual(dispatchCheck(order, { answer: "Fiz a planilha.", steps }), { fix: "\n\nArquivo: C:/t/Ferias-Outubro.xlsx", missing: [] });
  assert.equal(dispatchCheck(order, { answer: "Está em C:/t/Ferias-Outubro.xlsx.", steps }).fix, null);
  const run = serviceOrder("crie um script soma.py e rode");
  assert.match(dispatchCheck(run, { answer: "ok", steps: [{ tool: "write_file", ok: true, summary: "Salvei C:/p/soma.py (10 bytes)." }] }).missing.join(), /nada rodou/);
  assert.deepEqual(dispatchCheck(serviceOrder("qual o total de vendas?"), { answer: "R$ 10", steps: [] }), { fix: null, missing: [] });
});

test("Expedição in the agent: once back when the delivery is incomplete, then the file's path appended", async () => {
  const order = serviceOrder("Liste numa planilha os funcionários que começam férias em outubro");
  const writer = { name: "write_document", description: "cria", parameters: { type: "object", properties: {} }, run: async () => "Criei C:/t/Ferias.xlsx (XLSX, 10 bytes)." };
  const replies = [{ ok: true, text: "São 9 funcionários: Ana, Bruno e outros." }, { ok: true, text: "", toolCalls: [{ name: "write_document", arguments: { path: "Ferias.xlsx", content: "| a |" } }] }, { ok: true, text: "Planilha pronta com os 9 funcionários." }];
  const seen = [];
  const result = await runChatAgent({ system: "s", input: "Liste numa planilha os funcionários que começam férias em outubro", tools: [writer], toolContext: { order }, callModel: async (messages) => { seen.push(messages.at(-1).content); return replies.shift(); } });
  assert.match(seen[1], /^Expedição: a entrega ainda não está completa/);
  assert.equal(result.text, "Planilha pronta com os 9 funcionários.\n\nArquivo: C:/t/Ferias.xlsx");
  assert.ok(result.checks.some((c) => c.check === "dispatch"));
});

test("department rules: one short checklist per area, outside the common prompt", () => {
  assert.deepEqual(Object.keys(areaRules).sort(), ["comercial", "financeiro", "juridico", "operacoes", "pessoas"]);
  for (const [id, text] of Object.entries(areaRules)) assert.ok(text.length < 700, `${id}: ${text.length}`);
  assert.match(areaRules.juridico, /fonte oficial[\s\S]*dias úteis ou corridos/);
  assert.doesNotMatch(agentRules, /Departamento Jurídico/);
});
