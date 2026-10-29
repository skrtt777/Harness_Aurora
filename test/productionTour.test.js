// The production tour of 28-29/10/2026: the person's own requests replayed on the packaged 0.1.57.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "harness-tour-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.LOCAL_BASE_URL = "http://127.0.0.1:1";
process.env.EMBEDDINGS_ENABLED = "false";
// An agent's own folder goes under Documentos: here a fake one, never the person's.
process.env.HARNESS_KNOWN_FOLDERS = JSON.stringify({ desktop: temp, documents: temp, downloads: temp, home: temp });

const { makeXlsx } = await import("../app/sampleDocs.js");
const { xlsxText } = await import("../app/docText.js");
const { fileTools } = await import("../app/agentTools/files.js");

test("a title above the table is not its header: 'Qtd Atual<Qtd Mín' finds the product at 0 of 10", async () => {
  const sheet = [["CONTROLE DE ESTOQUE - 2026", "", "", ""], ["", "", "", ""], ["Código", "Produto", "Qtd Atual", "Qtd Mín"], ["P1", "Produto 1", 43, 10], ["P19", "Produto 19", 0, 10], ["P20", "Produto 20", 12, 10]];
  const file = join(temp, "Controle de Estoque.xlsx");
  writeFileSync(file, makeXlsx({ Estoque: sheet }));
  const text = xlsxText(makeXlsx({ Estoque: sheet }));
  assert.match(text, /^CONTROLE DE ESTOQUE - 2026$/m, "the title is a plain line");
  assert.match(text, /^Código \| Produto \| Qtd Atual \| Qtd Mín$/m);
  const read = fileTools.find((t) => t.name === "read_file");
  const out = String(await read.run({ path: file, filter: "Qtd Atual < Qtd Mín" }, { workspace: temp, env: process.env, request: "quais produtos estão abaixo do estoque mínimo?" }));
  assert.match(out, /Produto 19/);
  assert.match(out, /1 linha\(s\)/);
  assert.doesNotMatch(out, /Condição inválida/);
});

test("Claude runs out of Plan even when the person's Claude Code defaults to it; the paid CLIs are told the tools run in the Aurora", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../app/claude.js", import.meta.url), "utf8");
  assert.match(src, /"--no-session-persistence", "--permission-mode", "acceptEdits", \.\.\.\(noTools/);
  const { renderTextPrompt } = await import("../app/chatAgent.js");
  const prompt = renderTextPrompt([{ role: "system", content: "s" }, { role: "user", content: "cria uma planilha" }], [{ name: "write_document", description: "grava", parameters: { type: "object", properties: {} } }]);
  assert.match(prompt, /executadas pela Aurora no computador da pessoa/);
  assert.match(prompt, /nunca diga que não pode gravar sem ter chamado a ferramenta/);
});

test("a document with Chinese slipped into Portuguese is held before it is written", async () => {
  const { executeTool } = await import("../app/agentTools/index.js");
  const ctx = { allowedRoots: [temp], workspaceRoots: [temp], workspace: temp, mode: "auto", knownFolders: { desktop: temp }, env: process.env, approve: async () => false, request: "crie um documento sobre a empresa" };
  const held = await executeTool("write_document", { path: "empresa.md", content: "# Empresa\n\nA empresa é uma虚构 (fictícia) criada para o exemplo." }, ctx);
  assert.equal(held.ok, false);
  assert.match(held.result, /palavras em chinês \("A empresa é uma虚构/);
  const ok = await executeTool("write_document", { path: "empresa.md", content: "# Empresa\n\nA empresa é fictícia, criada para o exemplo." }, ctx);
  assert.equal(ok.ok, true, ok.result);
});

test("'crie agentes pesquisadores' makes an agent of the tela Agentes, after the person says yes", async () => {
  const { executeTool } = await import("../app/agentTools/index.js");
  const { listAgents } = await import("../app/agents.js");
  const { routeTools } = await import("../app/toolRouter.js");
  assert.ok(routeTools("crie agentes pesquisadores para você, para os momentos que não tiver nada").has("agent_create"));
  const args = { name: "Pesquisador de IA", mission: "Pesquisar novidades de IA e guardar o que aprender", every_hours: 6 };
  const base = { allowedRoots: [temp], workspaceRoots: [temp], workspace: temp, mode: "auto", knownFolders: { desktop: temp, documents: temp }, env: { ...process.env, USERPROFILE: temp }, request: "crie agentes pesquisadores" };
  const denied = await executeTool("agent_create", args, { ...base, approve: async () => false });
  assert.equal(denied.ok, false);
  assert.equal((await listAgents()).length, 0, "nothing without a yes");
  const made = await executeTool("agent_create", args, { ...base, approve: async () => true });
  assert.equal(made.ok, true, made.result);
  assert.match(made.result, /a cada 6 h/);
  const [agent] = await listAgents();
  assert.equal(agent.name, "Pesquisador de IA");
  assert.equal(agent.trigger.everyMinutes, 360);
  const again = await executeTool("agent_create", args, { ...base, approve: async () => true });
  assert.match(again.result, /Já existe um agente/);
});

test("the Recepção does not order a Word for a summary of a .docx; it still does for 'em word'", async () => {
  const { serviceOrder } = await import("../app/serviceOrder.js");
  assert.deepEqual(serviceOrder("\"C:/x/Documentos/Aurora/Economia_Aurora_Analise.docx\" faça um resumo desse documento para mim").deliver, []);
  assert.deepEqual(serviceOrder("faça um resumo desse documento em word").deliver, ["um documento Word (.docx)"]);
});

test("a redo is told what the first attempt already left on disk, so it does not build it twice", async () => {
  const { redoMessage } = await import("../app/teacher.js");
  const message = redoMessage({ problems: ["A resposta não diz o caminho do .pbip"], lessons: [] }, "monte um BI", ["C:/x/Departamentos.csv", "o painel do Power BI \"Departamentos\" (com C:/x/Departamentos.csv)"]);
  assert.match(message, /Já feito na primeira tentativa \(está no disco\):\n- C:\/x\/Departamentos\.csv/);
  assert.match(message, /se o problema é só a resposta, responda sem chamar ferramentas de novo/);
  assert.doesNotMatch(redoMessage({ problems: ["x"], lessons: [] }, "oi"), /Já feito/);
});

test("a sheet named in the request joins the Power BI only if it is a table (the broken original stayed out)", async () => {
  const { namedSheets } = await import("../agentTools/powerbi.js".replace("../agentTools", "../app/agentTools"));
  const { mkdirSync } = await import("node:fs");
  const dir = join(temp, "bi");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "Departamentos_RandomCorp.xlsx"), makeXlsx({ Planilha: [["Departamento | Funcionários"], ["Vendas | 380"], ["TI | 350"], ["RH | 310"]] }));
  writeFileSync(join(dir, "Departamentos_limpo.xlsx"), makeXlsx({ Planilha: [["Departamento", "Funcionários"], ["Vendas", 380], ["TI", 350], ["RH", 310]] }));
  const clean = join(dir, "Orcamento.xlsx");
  writeFileSync(clean, makeXlsx({ Planilha: [["Departamento", "Orçamento"], ["Vendas", 1], ["TI", 2], ["RH", 3]] }));
  const extra = namedSheets([clean], "monte um BI com a planilha Departamentos_RandomCorp.xlsx");
  assert.ok(!extra.some((p) => /RandomCorp/.test(p)), extra.join(", "));
  assert.ok(extra.some((p) => /Departamentos_limpo/.test(p)));
});

test("a call to a tool the request does not have is not shown as the answer (raw JSON, 28/10)", async () => {
  const { runChatAgent } = await import("../app/chatAgent.js");
  const reader = { name: "read_file", description: "lê", parameters: { type: "object", properties: {} }, describe: () => ({ kind: "meta" }), run: async () => "texto" };
  const replies = [
    { ok: true, text: '{"tool":"write_document","args":{"path":"Documentos/Resumo.docx","content":"# Resumo"}}' },
    { ok: true, text: "O documento mostra economia de R$ 288 por semana." },
  ];
  const result = await runChatAgent({ provider: "claude", system: "s", input: "faça um resumo desse documento", tools: [reader], callModel: async () => replies.shift() });
  assert.equal(result.text, "O documento mostra economia de R$ 288 por semana.");
});

test("a guard's message is marked as the Aurora's own check, and the answer to it is not shown as dialogue", async () => {
  const { runChatAgent, withoutCorrectionPreamble } = await import("../app/chatAgent.js");
  assert.equal(withoutCorrectionPreamble("Entendi sua crítica. Você está correto: os agentes foram criados.\n\nCriei o agente Pesquisador Geral, que trabalha a cada 4 h."), "os agentes foram criados.\n\nCriei o agente Pesquisador Geral, que trabalha a cada 4 h.");
  const seen = [];
  const replies = [{ ok: true, text: "Pronto! Aplicado o tema azul ao painel." }, { ok: true, text: "Não apliquei nenhuma mudança: o painel não foi alterado." }];
  const writer = { name: "write_document", description: "grava", parameters: { type: "object", properties: {} }, describe: () => ({ kind: "meta" }), run: async () => "ok" };
  await runChatAgent({ provider: "claude", system: "s", input: "mude o tema do painel para azul", tools: [writer], callModel: async (messages) => { seen.push(messages); return replies.shift(); } });
  const guard = seen[1].at(-1);
  assert.equal(guard.role, "user");
  assert.match(guard.content, /^\(Conferência automática da Aurora, não é a pessoa\.\)/);
  assert.match(seen[1].find((m) => m.role === "user").content, /^mude o tema/, "the person's request is not marked");
});

test("a .pbix question of numbers answered without reading its CSVs goes back once to read them", async () => {
  const { runChatAgent } = await import("../app/chatAgent.js");
  const calls = [];
  const reader = { name: "read_file", description: "lê", parameters: { type: "object", properties: {} }, describe: () => ({ kind: "meta" }), run: async (a) => { calls.push(a); return "RESUMO: 7.282 linha(s) com \"Status=Won\". Soma das 7.282 linhas: Value 26.435.925"; } };
  const replies = [
    { ok: true, text: "Não consigo somar sem o motor do Power BI." },
    { ok: true, text: '{"tool":"read_file","args":{"path":"Regional Sales Sample - Opportunities.csv","filter":"Status=Won"}}' },
    { ok: true, text: "Foram 7.282 oportunidades ganhas, com receita de 26.435.925." },
  ];
  const system = "## Modelo de dados (3 tabelas, lido direto do arquivo, sem o Power BI)\n### Opportunities (14.667 linhas)\nDados: read_file \"Regional Sales Sample - Opportunities.csv\"";
  const result = await runChatAgent({ provider: "claude", system, input: "qual a receita total das oportunidades ganhas?", tools: [reader], callModel: async () => replies.shift() });
  assert.equal(calls.length, 1);
  assert.match(result.text, /26\.435\.925/);
  assert.ok(result.checks.some((c) => c.check === "pbix_unread"));
});

test("a chart value with a note ('77 (34%)') is the number; a deck asked with charts is held until it has one", async () => {
  const { chartData } = await import("../app/pptxWriter.js");
  const data = chartData([["Produto", "Qtd"], ["PROD020", "77 (34%)"], ["PROD004", "76 (33%)"]]);
  assert.deepEqual(data.series[0].values, [77, 76]);
  const { executeTool } = await import("../app/agentTools/index.js");
  const deck = join(temp, "deck");
  (await import("node:fs")).mkdirSync(deck, { recursive: true });
  const ctx = { allowedRoots: [deck], workspaceRoots: [deck], workspace: deck, mode: "auto", knownFolders: { desktop: deck }, env: process.env, approve: async () => false, request: "monta um powerpoint com gráficos do estoque" };
  const plain = { path: "estoque.pptx", content: "# Estoque\n\n- 20 produtos\n\n## Categorias\n\n| Categoria | Qtd |\n|---|---|\n| Limpeza | 300 |\n| TI | 200 |" };
  assert.match((await executeTool("write_document", plain, ctx)).result, /não tem nenhum/);
  assert.match((await executeTool("write_document", plain, ctx)).result, /não tem nenhum/, "asked again, not let through on the second try");
});

test("a Claude CLI failure says why (the account's limit), not the command line", async () => {
  const { claudeError } = await import("../app/claude.js");
  assert.match(claudeError('{"type":"result","is_error":true,"result":"Claude AI usage limit reached|1761710400"}'), /limite de uso da sua conta/);
  assert.match(claudeError('{"is_error":true,"result":"API Error: 500"}'), /respondeu com erro: API Error: 500/);
  assert.equal(claudeError(""), "");
});

test("'o pior mês do Sul' comes summed per month, ranked by the money; 'já venceram' adds the due date before today", async () => {
  const { groupHint, overdueNote } = await import("../app/agentTools/files.js");
  const sales = ["## Vendas", "Mês | Vendedor | Quantidade | Valor Unitário | Total", "Janeiro | Ana | 9 | 95 | 855", "Fevereiro | Ana | 1 | 4200 | 4200", "Fevereiro | Bruno | 1 | 95 | 95", "Março | Ana | 2 | 1150 | 2300"];
  const hint = groupHint(sales, "qual foi o pior mês do Sul?");
  assert.match(hint, /MENOR total \(Total\): Janeiro, 855,00/, "by Total, not Quantidade (Janeiro has the most units)");
  assert.doesNotMatch(hint, /Valor Unitário/, "unit prices are not summed");
  const bills = ["## Contas", "Nº | Fornecedor | Vencimento | Valor | Status", "1 | A | 10/10/2026 | 100 | Em aberto", "2 | B | 30/10/2026 | 50 | Em aberto", "3 | C | 01/10/2026 | 70 | Pago"];
  const note = overdueNote(bills, "quais contas em aberto já venceram até hoje?", "Status!=Pago", new Date(2026, 9, 29));
  assert.match(note, /Status!=Pago; Vencimento<29\/10\/2026/);
  assert.match(note, /Soma das 1 linhas? acima: Valor = 100|1 linha\(s\)/);
  assert.equal(overdueNote(bills, "quais contas estão em aberto?", "Status!=Pago"), "");
});

test("the sheet of the subject is found one folder down for a question ('as vendas d fevereiro' → Documentos/Vendas_2026.xlsx)", async () => {
  const { unreadSubjectSheets } = await import("../app/agentTools/files.js");
  const { mkdirSync } = await import("node:fs");
  const root = join(temp, "proj");
  mkdirSync(join(root, "Documentos"), { recursive: true });
  writeFileSync(join(root, "Documentos", "Vendas_2026.xlsx"), makeXlsx({ Vendas: [["Mês", "Total"], ["Fevereiro", 10]] }));
  const ctx = { workspace: root, request: "qnto deu as vendas d fevereiro no norte" };
  assert.deepEqual(unreadSubjectSheets(ctx, { deep: true }), ["Documentos/Vendas_2026.xlsx"]);
  assert.deepEqual(unreadSubjectSheets(ctx), [], "the write guard keeps to the folder itself");
});

test("hard round 29/10: the format said wins over the source's name; same column '=' is any of them; groups carry their share", async () => {
  const { requestedFormat, filterRows, groupHint } = await import("../app/agentTools/files.js");
  assert.equal(requestedFormat("faça um relatório em Word das vendas por região da Vendas_2026.xlsx"), "docx");
  assert.equal(requestedFormat("crie o arquivo relatorio.xlsx com os totais"), "xlsx");
  assert.equal(requestedFormat("monte uma apresentação com os dados da Vendas.xlsx"), "pptx");
  const sheet = ["## Vendas", "Mês | Região | Total", "Janeiro | Sul | 100", "Fevereiro | Sul | 50", "Abril | Sul | 70", "Março | Norte | 30"];
  assert.match(filterRows(sheet, "Mês=Janeiro; Mês=Fevereiro; Mês=Março"), /3 linha\(s\)/);
  assert.match(filterRows(sheet, "Mês=Janeiro; Mês=Fevereiro; Região=Sul"), /2 linha\(s\)/);
  const hint = groupHint(sheet, "as vendas por região com o percentual sobre o total");
  assert.match(hint, /Sul \| 3 \| 220,00 \| 88,0%/);
  assert.match(hint, /TOTAL \| 4 \| 250,00 \| 100,0%/);
});

test("edit_file refuses a Word, Excel or PowerPoint: written back as text the .docx was destroyed (29/10)", async () => {
  const { executeTool } = await import("../app/agentTools/index.js");
  const { readFileSync } = await import("node:fs");
  const dir = join(temp, "edit");
  (await import("node:fs")).mkdirSync(dir, { recursive: true });
  const ctx = { allowedRoots: [dir], workspaceRoots: [dir], workspace: dir, mode: "auto", knownFolders: { desktop: dir }, env: process.env, approve: async () => false, request: "crie um relatório em Word" };
  assert.equal((await executeTool("write_document", { path: "rel.docx", content: "# Relatório\n\nA região Nordeste liderou." }, ctx)).ok, true);
  const before = readFileSync(join(dir, "rel.docx"));
  const out = await executeTool("edit_file", { path: "rel.docx", before: "Nordeste liderou", after: "Sul liderou" }, { ...ctx, request: "corrija o relatório" });
  assert.equal(out.ok, false);
  assert.match(out.result, /write_document no MESMO caminho/);
  assert.deepEqual(readFileSync(join(dir, "rel.docx")), before, "the file is untouched");
});

test("quarters come summed (1º = jan–mar); 'os 3 melhores vendedores' groups; an e-mail asked comes back as an e-mail", async () => {
  const { quarterTotals, groupHint } = await import("../app/agentTools/files.js");
  const sheet = ["## Vendas", "Mês | Vendedor | Total", "Janeiro | Ana | 100", "Março | Bia | 50", "Abril | Ana | 300", "Junho | Bia | 30"];
  const q = quarterTotals(sheet);
  assert.match(q, /1º trimestre \(jan–mar\) \| 2 \| 150,00/);
  assert.match(q, /2º trimestre \(abr–jun\) \| 2 \| 330,00/);
  assert.match(q, /Do 1º para o 2º: 120,0%/);
  assert.match(groupHint(sheet, "compare o 1º trimestre com o 2º"), /Totais por trimestre/);
  assert.match(groupHint(sheet, "quem são os 2 melhores vendedores?"), /Totais por Vendedor/);
  const { runChatAgent } = await import("../app/chatAgent.js");
  const reader = { name: "read_file", description: "lê", parameters: { type: "object", properties: {} }, describe: () => ({ kind: "meta" }), run: async () => "ok" };
  const replies = [{ ok: true, text: "# Pendências - Gráfica Norte\n\n| Nº | Valor |\n|---|---|\n| CP-002 | 7.603,76 |" }, { ok: true, text: "Assunto: Contas em aberto\n\nOlá, equipe da Gráfica Norte,\n\nTemos em aberto a CP-002 (R$ 7.603,76).\n\nAtenciosamente," }];
  const result = await runChatAgent({ provider: "claude", system: "s", input: "escreva um e-mail para a Gráfica Norte com as contas em aberto", tools: [reader], callModel: async () => replies.shift() });
  assert.match(result.text, /^Assunto:/);
  assert.ok(result.checks.some((c) => c.check === "message_format"));
});

test("'quais fornecedores em aberto também estão na lista de aprovados, e quanto devemos a cada um' is crossed by the tool, either order", async () => {
  const { fileTools } = await import("../app/agentTools/files.js");
  const read = fileTools.find((t) => t.name === "read_file");
  const dir = join(temp, "cross");
  (await import("node:fs")).mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "Contas.xlsx"), makeXlsx({ Contas: [["Nº", "Fornecedor", "Valor", "Status"], ["1", "Alfa", 100, "Em aberto"], ["2", "Beta", 50, "Em aberto"], ["3", "Alfa", 30, "Pago"], ["4", "Gama", 70, "Em aberto"]] }));
  writeFileSync(join(dir, "Aprovados.xlsx"), makeXlsx({ Aprovados: [["Fornecedor", "CNPJ"], ["Alfa", "1"], ["Gama", "2"], ["Delta", "3"]] }));
  const request = "quais fornecedores em aberto da Contas.xlsx também estão na Aprovados.xlsx, e quanto devemos a cada um?";
  for (const order of [["Contas", "Aprovados"], ["Aprovados", "Contas"]]) {
    const ctx = { workspace: dir, env: process.env, request };
    let out = "";
    for (const f of order) out = String(await read.run({ path: join(dir, `${f}.xlsx`), ...(f === "Contas" ? { filter: "Status=Em aberto" } : {}) }, ctx));
    assert.match(out, /Alfa \| 1 \| 100,00/, order.join(" → "));
    assert.match(out, /Gama \| 1 \| 70,00/);
    assert.match(out, /TOTAL \| 2 \| 170,00/);
    assert.match(out, /não entram\): Beta/);
  }
});

test("{{linhas}} under a table by region is the totals per region, not the raw sales under them", async () => {
  const { groupTableOf, expandRows, groupHint } = await import("../app/agentTools/files.js");
  const sheet = ["## Vendas", "Mês | Região | Total", "Janeiro | Sul | 100", "Fevereiro | Sul | 50", "Março | Norte | 30"];
  const group = groupTableOf(groupHint(sheet, "relatório das vendas por região"));
  assert.deepEqual(group.header, ["Região", "Linhas", "Total Total", "% do Total"]);
  const raw = { header: ["Mês", "Região", "Total"], rows: [["Janeiro", "Sul", "100"], ["Fevereiro", "Sul", "50"], ["Março", "Norte", "30"]] };
  const doc = expandRows("## Totais por região\n\n{{linhas: Região, Total, %}}", raw, group);
  assert.match(doc, /\| Sul \| 150,00 \| 83,3% \|/);
  assert.doesNotMatch(doc, /Janeiro/);
  assert.match(expandRows("## Vendas\n\n{{linhas}}", raw, null), /\| Janeiro \| Sul \| 100,00 \|/, "no totals read: the rows, as before");
});

test("an e-mail written as a report into a refused file is not the answer; quarters read with a month filter come from the whole sheet", async () => {
  const { runChatAgent } = await import("../app/chatAgent.js");
  const writer = { name: "write_document", description: "grava", parameters: { type: "object", properties: {} }, describe: () => ({ kind: "meta" }), run: async () => { throw new Error("A pessoa pediu só o texto: escreva-o direto na resposta."); } };
  const replies = [
    { ok: true, text: '{"tool":"write_document","args":{"path":"Documentos/Email.xlsx","content":"| Fornecedor | Valor |\n|---|---|\n| Gráfica Norte | R$ 7.603,76 |\n\nTotal: R$ 14.577,98"}}' },
    { ok: true, text: "Assunto: Contas em aberto\n\nOlá, equipe da Gráfica Norte,\n\nTotal em aberto: R$ 14.577,98.\n\nAtenciosamente," },
  ];
  const result = await runChatAgent({ provider: "claude", system: "s", input: "escreva um e-mail para a Gráfica Norte com as contas em aberto", tools: [writer], callModel: async () => replies.shift() });
  assert.match(result.text, /^Assunto:/);
  const { fileTools } = await import("../app/agentTools/files.js");
  const dir = join(temp, "tri");
  (await import("node:fs")).mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "V.xlsx"), makeXlsx({ Vendas: [["Mês", "Total"], ["Janeiro", 100], ["Março", 50], ["Abril", 300]] }));
  const out = String(await fileTools.find((t) => t.name === "read_file").run({ path: join(dir, "V.xlsx"), filter: "Mês=Janeiro" }, { workspace: dir, env: process.env, request: "compare o 1º trimestre com o 2º" }));
  assert.match(out, /1º trimestre \(jan–mar\) \| 2 \| 150,00/);
});
