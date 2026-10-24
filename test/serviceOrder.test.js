import test from "node:test";
import assert from "node:assert/strict";

const { serviceOrder, orderBlock, dispatchCheck, writtenFiles } = await import("../app/serviceOrder.js");
const { runChatAgent } = await import("../app/chatAgent.js");
const { areaRules, agentRules } = await import("../app/economy.js");

test("Recepção: the order of a request (what to deliver, the rules, run it, official sources); none for a question", () => {
  const empresa = serviceOrder("quero que você crie dados sobre uma empresa aleatoria, com todos os departamentos com mais de 300 funcionarios e faça planilhas em excel");
  assert.deepEqual(empresa.deliver, ["uma planilha Excel (.xlsx)"]);
  assert.deepEqual(empresa.rules, ["mais de 300 funcionarios em cada item (não no total)"]);
  assert.match(orderBlock(empresa), /^ORDEM DE SERVIÇO \(Recepção, área Pessoas\):\n- Entregar: uma planilha Excel/);
  const python = serviceOrder("na pasta python, crie um arquivo jogos.csv com 15 jogos e um script relatorio.py. Rode o script e me mostre o resultado.");
  assert.deepEqual(python.deliver, ["o arquivo jogos.csv", "o arquivo relatorio.py"], "relatorio.py is not a Word report");
  assert.equal(python.run, true); assert.equal(python.folder, "python"); assert.equal(python.area, "ti");
  assert.match(orderBlock(python), /na pasta python[\s\S]*Rodar o que fizer/);
  assert.equal(orderBlock(serviceOrder("Quais clientes estão inadimplentes há mais de 30 dias?")), null);
  assert.equal(serviceOrder("faça um parecer sobre a Lei do Inquilinato citando fonte oficial").official, true);
  assert.deepEqual(serviceOrder("crie uma planilha com preços entre 10 e 50 reais").rules, ["entre 10 e 50 reais em cada item (não no total)"]);
  assert.equal(serviceOrder("oi, tudo bem?").areaSure, false);
  assert.equal(serviceOrder("Liste os contratos vigentes em 2026").area, "juridico");
});

test("Expedição: the format asked must be written, what had to run must run, the answer says where the file is", () => {
  const order = serviceOrder("Liste numa planilha os funcionários que começam férias em outubro");
  assert.deepEqual(dispatchCheck(order, { answer: "Pronto.", steps: [] }).missing.map((m) => /xlsx/.test(m)), [true]);
  const steps = [{ tool: "write_document", ok: true, summary: "Criei C:/t/Ferias-Outubro.xlsx (XLSX, 10 bytes)." }];
  assert.deepEqual(writtenFiles(steps), ["C:/t/Ferias-Outubro.xlsx"]);
  assert.deepEqual(dispatchCheck(order, { answer: "Fiz a planilha.", steps }), { fix: "\n\nArquivo: C:/t/Ferias-Outubro.xlsx", missing: [], unconfirmed: [] });
  assert.equal(dispatchCheck(order, { answer: "Está em C:/t/Ferias-Outubro.xlsx.", steps }).fix, null);
  const run = serviceOrder("crie um script soma.py e rode");
  assert.match(dispatchCheck(run, { answer: "ok", steps: [{ tool: "write_file", ok: true, summary: "Salvei C:/p/soma.py (10 bytes)." }] }).missing.join(), /nada rodou/);
  assert.deepEqual(dispatchCheck(serviceOrder("qual o total de vendas?"), { answer: "R$ 10", steps: [] }), { fix: null, missing: [], unconfirmed: [] });
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

test("a file name Windows accepts (a > in the name failed with ENOENT); long results cut at a line, saying what is left", async () => {
  const { safeFileName } = await import("../app/agentTools/files.js");
  const { clipResult } = await import("../app/agentTools/index.js");
  assert.equal(safeFileName("C:/t/Cobrança Inadimplência > 30 dias.xlsx"), "C:/t/Cobrança Inadimplência acima de 30 dias.xlsx");
  assert.equal(safeFileName("C:/t/ok.xlsx"), "C:/t/ok.xlsx");
  const lines = Array.from({ length: 200 }, (_, i) => `${String(i + 1).padStart(5)}  linha ${i + 1} | 123,45 | texto`);
  lines.splice(150, 0, "  151  ## Orçado mensal");
  const clipped = clipResult(lines.join("\n"), 3000);
  assert.doesNotMatch(clipped, /cortado/);
  assert.match(clipped, /\| texto\n\(As linhas acima estão completas\. Faltam \d+ linha\(s\) deste trecho, das partes: Orçado mensal\. Só se precisar delas, leia de novo com offset=\d+\.\)$/);
  assert.equal(clipResult("curto"), "curto");
  // The tool's own notes at the end survive the cut (the count of a 113-row sheet, regression 24/10).
  const sheet = [...Array.from({ length: 120 }, (_, i) => `${String(i + 1).padStart(5)}  pessoa ${i + 1} | Produção | Operador`), "… (cortado; continue com offset=121)", "", "(Quadro ativo: 113 linha(s) de dados, sem contar o cabeçalho nem a linha de total.)"].join("\n");
  const kept = clipResult(sheet, 3000);
  assert.ok(kept.length <= 3100);
  assert.match(kept, /113 linha\(s\) de dados/);
  assert.match(kept, /Faltam \d{2,} linha\(s\) deste trecho/, "the rows left, not the notes");
});

test("a read repeated with the delivery still to write keeps the tools to write (not a forced text answer)", async () => {
  const order = serviceOrder("Faça um relatório em Word com as áreas que gastaram mais de 5% acima do orçado");
  const reader = { name: "read_file", description: "lê", parameters: { type: "object", properties: {} }, run: async () => "Orçamento.xlsx\n1 | TI | 14,35%" };
  const writer = { name: "write_document", description: "cria", parameters: { type: "object", properties: {} }, run: async () => "Criei C:/t/Desvios.docx (DOCX, 10 bytes)." };
  const offeredAt = [];
  const read = { ok: true, text: "", toolCalls: [{ name: "read_file", arguments: { path: "Orçamento.xlsx" } }] };
  const replies = [read, read, read, read, read, { ok: true, text: "", toolCalls: [{ name: "write_document", arguments: { path: "Desvios.docx", content: "# x" } }] }, { ok: true, text: "Relatório pronto." }];
  const result = await runChatAgent({ system: "s", input: "Faça um relatório em Word", tools: [reader, writer], toolContext: { order }, callModel: async (messages, tools) => { offeredAt.push(tools.map((t) => t.name).join(",")); return replies.shift(); } });
  assert.ok(result.steps.some((s) => s.tool === "write_document" && s.ok), JSON.stringify(result.steps.map((s) => s.tool)));
  assert.ok(offeredAt.includes("write_document"), offeredAt.join(" | "));
  assert.match(result.text, /Desvios\.docx|Relatório pronto/);
});

test("Conferência jurídica: law or case law cited with nothing consulted goes back; consulted or another area passes", () => {
  const legal = serviceOrder("explique o prazo de aviso prévio do contrato de locação");
  assert.equal(legal.area, "juridico");
  const cited = "Pelo art. 6º da Lei 8.245/1991, o inquilino avisa com 30 dias.";
  assert.match(dispatchCheck(legal, { answer: cited, steps: [] }).missing.join(), /sem consultar nada/);
  const page = { tool: "web_fetch", ok: true, result: "URL: https://www.planalto.gov.br/ccivil_03/leis/l8245.htm\nLei nº 8.245, de 18 de outubro de 1991 … Art. 6º O locatário poderá denunciar a locação…" };
  assert.deepEqual(dispatchCheck(legal, { answer: cited, steps: [page] }).missing, [], "cited and found in the page read");
  // A search that found nothing does not confirm an article (the "Art. 601" of 13/10).
  const invented = dispatchCheck(legal, { answer: "Pelo Art. 601 da Lei 8.245, a multa é integral.", steps: [page] }).missing.join();
  assert.match(invented, /não aparecem em nada que você leu[\s\S]*Art\. 601/);
  assert.doesNotMatch(invented, /Lei 8\.245,/);
  assert.deepEqual(dispatchCheck(legal, { answer: "O contrato prevê aviso de 30 dias.", steps: [] }).missing, []);
  assert.deepEqual(dispatchCheck(serviceOrder("qual o total de vendas de setembro?"), { answer: "Pelo art. 5 do manual, R$ 10.", steps: [] }).missing, []);
  assert.match(dispatchCheck(serviceOrder("cite fontes oficiais sobre férias"), { answer: "Súmula 450 do TST garante…", steps: [] }).missing.join(), /fonte oficial/);
});

test("Conferência: the documents written count (an invented article inside the Word), and text in another script goes back", () => {
  const order = serviceOrder("Faça um parecer curto em Word sobre multa por rescisão antecipada de contrato de locação residencial.");
  const steps = [{ tool: "write_document", ok: true, args: { path: "Parecer.docx", content: "Artigo 609 da Lei nº 8.245/1991: ... depende da是否存在 justa causa" }, summary: "Criei C:/t/Parecer.docx (DOCX)." }];
  const { missing } = dispatchCheck(order, { answer: "Criei o parecer em C:/t/Parecer.docx.", steps });
  assert.equal(missing.length, 2, missing.join(" | "));
  assert.match(missing[0], /outro alfabeto \(是否存在\)[\s\S]*grave o documento de novo/);
  assert.match(missing[1], /sem consultar nada/);
  assert.deepEqual(dispatchCheck(serviceOrder("traduza para o japonês: bom dia"), { answer: "おはよう", steps: [] }).missing.filter((m) => /alfabeto/.test(m)), [], "asked in another script: fine only if the request has it");
});

test("Expedição: citations still unconfirmed at the end are said plainly in the answer", async () => {
  const order = serviceOrder("Faça um parecer curto em Word sobre multa por rescisão antecipada de contrato de locação residencial.");
  const writer = { name: "write_document", description: "cria", parameters: { type: "object", properties: {} }, run: async () => "Criei C:/t/Parecer.docx (DOCX, 10 bytes)." };
  const write = { ok: true, text: "", toolCalls: [{ name: "write_document", arguments: { path: "Parecer.docx", content: "Pelo Artigo 36 da Lei 8.245, a multa é integral." } }] };
  const replies = [write, { ok: true, text: "Parecer pronto em C:/t/Parecer.docx." }, { ok: true, text: "Parecer pronto em C:/t/Parecer.docx." }];
  const result = await runChatAgent({ system: "s", input: "Faça um parecer", tools: [writer], toolContext: { order }, callModel: async () => replies.shift() });
  assert.match(result.text, /\*\*Atenção:\*\* estas citações não foram confirmadas[\s\S]*Artigo 36[\s\S]*Lei 8\.245/);
  assert.ok(result.checks.some((c) => c.check === "unconfirmed_citations"));
});

test("Conferência: 'artigo X da Lei N' must be in a page of that law (art. 613 of the Civil Code does not confirm it in the Lei do Inquilinato)", () => {
  const order = serviceOrder("explique a multa por rescisão antecipada do contrato de locação");
  const inquilinato = "Lei nº 8.245, de 18 de outubro de 1991 … Art. 4º Durante o prazo estipulado … multa pactuada, proporcionalmente";
  const codigoCivil = "Lei nº 10.406, de 10 de janeiro de 2002 … Art. 613. Sendo a empreitada unicamente de lavor";
  const answer = "Pelo Art. 4º da Lei nº 8.245, a multa é proporcional; e pelo Artigo 613 da Lei 8.245, é integral.";
  const { missing, unconfirmed } = dispatchCheck(order, { answer, steps: [], read: [inquilinato, codigoCivil] });
  assert.deepEqual(unconfirmed.map((c) => c.text), ["Artigo 613 da Lei 8.245"]);
  assert.match(missing.join(), /não aparecem em nada que você leu/);
  assert.match(dispatchCheck(order, { answer, steps: [], read: [] }).missing.join(), /sem consultar nada/);
});

test("a filter written like the hint's example works (Coluna=\"Situação\"=\"A pagar\")", async () => {
  const { normalizeFilter } = await import("../app/agentTools/files.js");
  assert.equal(normalizeFilter('Coluna="Situação"="A pagar"; Coluna="Vencimento"<=15/10/2026'), "Situação=A pagar; Vencimento<=15/10/2026");
  assert.equal(normalizeFilter('"Setor"="TI"'), "Setor=TI");
  assert.equal(normalizeFilter("Situação=A pagar"), "Situação=A pagar");
});

test("official pages of the laws a legal request speaks of: by name (Lei do Inquilinato, CLT, Código Civil) or number", async () => {
  const { officialPages, lawPage } = await import("../app/legalSources.js");
  assert.deepEqual(officialPages("parecer sobre multa de contrato de locação residencial").map((p) => p.url), ["https://www.planalto.gov.br/ccivil_03/leis/l8245.htm"]);
  assert.deepEqual(officialPages("art. 413 do Código Civil e a CLT").map((p) => p.name), ["Código Civil (Lei 10.406/2002)", "CLT (Decreto-Lei 5.452/1943)"]);
  assert.equal(lawPage("lei", "8.078").url, "https://www.planalto.gov.br/ccivil_03/leis/l8078.htm");
  assert.equal(lawPage("lei", "13.467"), null, "an address with the year in it is searched, not guessed");
  const order = serviceOrder("Faça um parecer curto em Word sobre multa por rescisão antecipada de contrato de locação residencial.");
  assert.match(orderBlock(order), /Páginas oficiais: Lei do Inquilinato \(Lei 8\.245\/1991\): https:\/\/www\.planalto\.gov\.br\/ccivil_03\/leis\/l8245\.htm/);
  assert.match(dispatchCheck(order, { answer: "Pelo Artigo 609 da Lei 8.245.", steps: [], read: [] }).missing[0], /l8245\.htm/);
});

test("Pessoas speaking of the law (CLT) gets the CLT's page and the citation check; a list of employees does not", () => {
  const ask = serviceOrder("Quantos dias de férias o funcionário tem direito pela CLT?");
  assert.equal(ask.legalAsk, true);
  assert.deepEqual(ask.sources.map((s) => s.name), ["CLT (Decreto-Lei 5.452/1943)"]);
  assert.match(dispatchCheck(ask, { answer: "Pelo art. 130 da CLT são 30 dias.", steps: [], read: [] }).missing.join(), /sem consultar nada/);
  assert.equal(serviceOrder("Liste numa planilha os funcionários que começam férias em outubro").legalAsk, false);
});

test("a big company project on a small context is fitted, never refused: big blocks shortened saying so, rules and task whole", async () => {
  const { compactContext, fitBlocks, agentRules } = await import("../app/economy.js");
  const instructions = "Regras do setor: ".padEnd(9000, "x");
  const files = "Arquivo anexado C:/empresa/Relatorio.xlsx:\n".padEnd(14000, "y");
  await assert.rejects(compactContext({ input: "faça o relatório", instructions, required: [files], limit: 20000, core: agentRules, includeOptional: false }), /excedem o contexto/);
  const ctx = await compactContext({ input: "faça o relatório", instructions, required: [files], limit: 20000, core: agentRules, includeOptional: false, fit: true });
  assert.ok(ctx.prompt.length <= 20000, String(ctx.prompt.length));
  assert.ok(ctx.prompt.startsWith(agentRules), "the rules stay whole");
  assert.match(ctx.prompt, /Tarefa atual:\nfaça o relatório$/);
  assert.match(ctx.prompt, /cortado para caber no contexto: faltam \d+ caracteres[\s\S]*read_file/);
  assert.match(ctx.prompt, /Arquivo anexado C:\/empresa\/Relatorio\.xlsx/);
  assert.throws(() => fitBlocks(["r".repeat(9000), "t".repeat(9000)], 6000), /aumente o tamanho do contexto/i);
});
