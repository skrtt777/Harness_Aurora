import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The MARU media kit conversation (04/10/2026): the summary came back as
// "Corrigi a situação…", then "crie um novo documento com valores atualizados"
// fell back to plain chat (Llama 3.2 refused the replayed calls) and claimed a
// file that was never written.
const temp = mkdtempSync(join(tmpdir(), "harness-delivery-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.LOCAL_BASE_URL = "http://127.0.0.1:1";
process.env.EMBEDDINGS_ENABLED = "false";

const { claimsDelivery, detectSignals, narratesCorrection, redoMessage, requestsFile } = await import("../app/teacher.js");
const { runChatAgent } = await import("../app/chatAgent.js");
const { agentHistory } = await import("../app/server.js");
const { executeTool } = await import("../app/agentTools/index.js");
const { extractText } = await import("../app/docText.js");
const { parseBlocks } = await import("../app/documentWriter.js");
const { terms } = await import("../app/skills.js");
const { compactContext } = await import("../app/economy.js");

test("a created file claimed without a write is caught; real writes, negations and offers are not", () => {
  for (const text of [
    "Consegui criar um novo documento com valores atualizados e coerentes com o mercado.",
    "Ação realizada: Criei um novo documento com valores atualizados.\n\nResultados:\n- Documento criado com sucesso",
    "Gerei a planilha com os inadimplentes.",
    "O relatório foi salvo em C:\\Users\\lucas\\Documentos.",
  ]) assert.equal(claimsDelivery(text, []), true, text);
  for (const text of [
    "Não criei nenhum documento ainda: me diga o formato.",
    "Posso criar um documento com esses valores, quer?",
    "O media kit apresenta a Maru e os formatos de investimento.",
  ]) assert.equal(claimsDelivery(text, []), false, text);
  assert.equal(claimsDelivery("Criei o documento.", [{ tool: "write_document", ok: true }]), false);
  assert.equal(claimsDelivery("Criei o documento.", [{ tool: "write_document", ok: false }]), true);
  assert.ok(detectSignals({ result: { text: "Documento criado com sucesso.", steps: [] } }).some((s) => s.code === "claimed_delivery"));
  assert.ok(detectSignals({ userMessage: "onde está?", result: { text: "x", steps: [] } }).some((s) => s.code === "user_complaint"));
  assert.ok(!detectSignals({ userMessage: "onde está a política de férias da empresa?", result: { text: "x", steps: [] } }).some((s) => s.code === "user_complaint"));
  const delivered = [{ role: "assistant", content: "Criei C:/x.docx.", execution: { toolSteps: [{ tool: "write_document", ok: true }] } }];
  assert.ok(!detectSignals({ userMessage: "onde está?", history: delivered, result: { text: "Em C:/x.docx.", steps: [] } }).some((s) => s.code === "user_complaint"), "after a real delivery it is just a question");
});

test("the agent is sent back once when it claims a file it did not write", async () => {
  const seen = [];
  const replies = [{ ok: true, text: "Consegui criar um novo documento com valores atualizados." }, { ok: true, text: "", toolCalls: [{ name: "write_document", arguments: { path: "x.docx", content: "# x" } }] }, { ok: true, text: "Criei C:\\x.docx." }];
  const writer = { name: "write_document", description: "cria documento", parameters: { type: "object", properties: {} }, run: async () => "Criei C:\\x.docx (DOCX, 10 bytes)." };
  const result = await runChatAgent({ system: "s", input: "crie um novo documento", tools: [writer], callModel: async (messages) => { seen.push(structuredClone(messages)); return replies.shift(); } });
  assert.equal(result.text, "Criei C:\\x.docx.");
  assert.deepEqual(result.checks.map((c) => c.check), ["claimed_delivery"]);
  assert.match(seen[1].at(-1).content, /nenhuma ferramenta escreveu arquivo.*write_document/s);
});

test("history replays one tool call per message, once per distinct call, or none at all", () => {
  const read = { tool: "read_file", args: { path: "C:\\maru.pdf" }, ok: true, summary: "C:\\maru.pdf" };
  const history = [
    { role: "user", content: "Resuma esse documento" },
    { role: "assistant", content: "Resumo do media kit.", execution: { toolSteps: [read, { ...read }, { ...read, args: { path: "C:\\outro.pdf" } }, { ...read, ok: false }] } },
  ];
  const replayed = agentHistory(history);
  assert.deepEqual(replayed.filter((m) => m.tool_calls).map((m) => m.tool_calls.length), [1, 1], "the repeated read is replayed once, each call in its own message");
  assert.deepEqual(replayed.map((m) => m.role), ["user", "assistant", "tool", "assistant", "tool", "assistant"]);
  assert.deepEqual(agentHistory(history, 8, { replaySteps: false }).map((m) => m.role), ["user", "assistant"]);
});

test("the redo is asked for the deliverable, and a narrated redo is flagged", () => {
  const message = redoMessage({ problems: ["Leu o PDF 4 vezes"], guidance: "Resuma a partir do texto anexado", lessons: [] }, "Resuma esse documento pra mim");
  assert.match(message, /Pedido do usuário: Resuma esse documento/);
  assert.doesNotMatch(message, /diga ao usuário o que foi corrigido/);
  assert.equal(narratesCorrection("Corrigi a situação: agora, após a leitura do conteúdo do PDF…"), true);
  assert.equal(narratesCorrection("O media kit da Maru apresenta a criadora e seus formatos."), false);
});

test("write_document creates real Word, Excel and PDF files, never overwriting", async () => {
  const root = mkdtempSync(join(tmpdir(), "harness-docs-"));
  const ctx = { allowedRoots: [root], workspaceRoots: [root], workspace: root, mode: "auto", knownFolders: { desktop: root }, env: process.env, approve: async () => false };
  const content = "# Media Kit Maru 2026\n\nCriadora de **K-pop**.\n\n| Formato | Valor (R$) |\n|---|---|\n| Vídeo TikTok | 1500 |\n\n- Spark Ads: +30%";
  for (const format of ["docx", "xlsx", "pdf"]) {
    const out = await executeTool("write_document", { path: join(root, "maru_atualizado"), format, content }, ctx);
    assert.equal(out.ok, true, out.result);
    const file = join(root, `maru_atualizado.${format}`);
    assert.ok(existsSync(file), format);
    const text = await extractText(file);
    assert.match(text, /Vídeo TikTok \| 1500/, format);
    if (format !== "xlsx") assert.match(text, /Media Kit Maru 2026/, format);
  }
  const again = await executeTool("write_document", { path: join(root, "maru_atualizado.docx"), content }, ctx);
  assert.match(again.result, /maru_atualizado\.docx/, "a document Aurora created is updated in place (a redo fixing its own file)");
  const users = join(root, "do_usuario.docx");
  writeFileSync(users, "original");
  const safe = await executeTool("write_document", { path: users, content }, ctx);
  assert.match(safe.result, /do_usuario \(2\)\.docx/, "a file of the person is never replaced");
  assert.equal(readFileSync(users, "utf8"), "original");
  assert.deepEqual(parseBlocks("# T\n- a\n| x | y |\n|---|---|\n| 1 | 2 |").map((b) => b.type), ["heading", "bullet", "table"]);
});

test("grammar words no longer pick skills, and plain chat history reads as a dialogue in order", async () => {
  assert.deepEqual(terms("crie um novo documento com valores"), ["documento", "valores"]);
  const { prompt } = await compactContext({ input: "onde está?", history: [{ role: "user", content: "Resuma o PDF" }, { role: "assistant", content: "Resumo X" }], includeSkills: false });
  assert.match(prompt, /Usuário: Resuma o PDF\nAurora: Resumo X/);
  assert.doesNotMatch(prompt, /Histórico assistant/);
});

test("asked to create a file, a confirmation question is sent back; plain questions are not", async () => {
  const writer = { name: "write_document", description: "cria documento", parameters: { type: "object", properties: {} }, run: async () => "Criei C:/x.docx (DOCX, 10 bytes)." };
  const seen = [];
  const replies = [{ ok: true, text: "Posso criar o documento estimado, mas você precisa confirmar se quer que eu avance." }, { ok: true, text: "", toolCalls: [{ name: "write_document", arguments: { path: "x.docx", content: "# x" } }] }, { ok: true, text: "Criei C:/x.docx." }];
  const result = await runChatAgent({ system: "s", input: "crie um novo documento com valores atualizados", tools: [writer], callModel: async (messages) => { seen.push(structuredClone(messages)); return replies.shift(); } });
  assert.deepEqual(result.checks.map((c) => c.check), ["asked_instead_of_doing"]);
  assert.equal(result.steps[0].tool, "write_document");
  const plain = await runChatAgent({ system: "s", input: "qual o valor do Reel?", tools: [writer], callModel: async () => ({ ok: true, text: "US$ 100. Quer que eu compare com o mercado?" }) });
  assert.equal(plain.checks, undefined);
});

test("after a few web searches the model is told to deliver with what it has", async () => {
  const search = { name: "web_search", description: "pesquisa na web", parameters: { type: "object", properties: {} }, run: async ({ q }) => `nada para ${q}` };
  let n = 0;
  const seen = [];
  const result = await runChatAgent({ system: "s", input: "pesquise preços", tools: [search], callModel: async (messages) => { seen.push(structuredClone(messages)); return n < 5 ? { ok: true, text: "", toolCalls: [{ name: "web_search", arguments: { q: `preço ${n++}` } }] } : { ok: true, text: "Entrego com estimativas." }; } });
  const results = seen.at(-1).filter((m) => m.role === "tool").map((m) => m.content);
  assert.equal(result.text, "Entrego com estimativas.");
  assert.doesNotMatch(results[2], /Pare de pesquisar/);
  assert.match(results[3], /já fez 4 pesquisas.*Pare de pesquisar/s);
});

test("a forced summary that still claims a file gets an honest warning", async () => {
  const writer = { name: "write_document", description: "cria documento", parameters: { type: "object", properties: {} }, run: async () => { throw new Error("Ninguém respondeu ao pedido de autorização em 1 s; a ação não foi executada."); } };
  const result = await runChatAgent({ system: "s", input: "crie um documento", tools: [writer], maxSteps: 1, callModel: async (messages, tools) => tools.length ? { ok: true, text: "", toolCalls: [{ name: "write_document", arguments: { path: "x.md", content: "# x" } }] } : { ok: true, text: "Já criei o arquivo com os valores atualizados." } });
  assert.match(result.text, /^Já criei o arquivo/);
  assert.match(result.text, /Atenção:\*\* nenhum arquivo foi gravado nesta resposta \(Ninguém respondeu/);
  assert.ok(result.checks.some((c) => c.check === "claimed_delivery_final"));
});

test("an answer that only repeats the request goes back to do the task", async () => {
  const { echoesRequest } = await import("../app/chatAgent.js");
  const request = "Gere uma planilha com os produtos que estão abaixo do estoque mínimo, com código e saldo.";
  assert.equal(echoesRequest(request, request), true);
  assert.equal(echoesRequest("Gerei a planilha com 4 produtos abaixo do mínimo: FAR-002, FUB-001, CAF-001 e CAF-002, salva em estoque.xlsx.", request), false);
  const writer = { name: "write_document", description: "cria documento", parameters: { type: "object", properties: {} }, run: async () => "Criei C:/estoque.xlsx (XLSX, 900 bytes)." };
  const replies = [{ ok: true, text: request }, { ok: true, text: "", toolCalls: [{ name: "write_document", arguments: { path: "estoque.xlsx", content: "| a |" } }] }, { ok: true, text: "Criei C:/estoque.xlsx." }];
  const result = await runChatAgent({ system: "s", input: request, tools: [writer], callModel: async () => replies.shift() });
  assert.deepEqual(result.checks.map((c) => c.check), ["asked_instead_of_doing"]);
  assert.equal(result.steps[0].tool, "write_document");
});

test("a form claimed as sent without pressing Send goes back to press it", async () => {
  const { claimsSentWithoutSubmit } = await import("../app/chatAgent.js");
  const typed = [{ tool: "browser_navigate", ok: true }, { tool: "browser_type", ok: true, args: { field: "nome" } }, { tool: "browser_type", ok: true, args: { field: "email" } }];
  assert.equal(claimsSentWithoutSubmit("A mensagem foi enviada com sucesso.", typed), true);
  assert.equal(claimsSentWithoutSubmit("A mensagem foi enviada com sucesso.", [...typed, { tool: "browser_click", ok: true }]), false);
  assert.equal(claimsSentWithoutSubmit("Enviei.", [{ tool: "browser_type", ok: true, args: { submit: true } }]), false, "typing with submit sends");
  assert.equal(claimsSentWithoutSubmit("Não consegui enviar a mensagem.", typed), false);
  assert.equal(claimsSentWithoutSubmit("O preço é R$ 349,90.", typed), false);
  const clicker = { name: "browser_click", description: "clica", parameters: { type: "object", properties: {} }, run: async () => "Cliquei em e4." };
  const replies = [{ ok: true, text: "A mensagem foi enviada com sucesso." }, { ok: true, text: "", toolCalls: [{ name: "browser_click", arguments: { ref: "e4" } }] }, { ok: true, text: "Enviada: a página mostra a confirmação." }];
  const history = [{ role: "assistant", content: "", tool_calls: [{ function: { name: "browser_type", arguments: {} } }] }];
  const result = await runChatAgent({ system: "s", input: "envie o formulário", tools: [clicker], callModel: async () => replies.shift(), history: [] , toolContext: {} });
  assert.equal(result.checks, undefined, "no typing in this turn: nothing to check");
  void history;
});

test("claimed_submit: typing with submit in a multi-line field with no form is not sending", async () => {
  const { claimsSentWithoutSubmit } = await import("../app/chatAgent.js");
  const steps = [{ tool: "browser_type", ok: true, args: { submit: true }, result: 'Digitei "oi". Este campo tem várias linhas e Enter não envia: clique no botão de enviar (browser_click).' }];
  assert.equal(claimsSentWithoutSubmit("Mensagem enviada com sucesso!", steps), true);
});

test("asked for a spreadsheet, a list written into the answer is sent back to become the file; a 'couldn't' is not", async () => {
  const writer = { name: "write_document", description: "cria documento", parameters: { type: "object", properties: {} }, run: async () => "Criei C:/ferias.xlsx (XLSX, 10 bytes)." };
  const replies = [{ ok: true, text: "Agora vou extrair os funcionários de outubro:\n- 1081 | Eduarda\n- 1091 | Henrique" }, { ok: true, text: "", toolCalls: [{ name: "write_document", arguments: { path: "ferias.xlsx", content: "| a |" } }] }, { ok: true, text: "Criei C:/ferias.xlsx." }];
  const result = await runChatAgent({ system: "s", input: "Crie a planilha de quem começa as férias em outubro.", tools: [writer], callModel: async () => replies.shift() });
  assert.deepEqual(result.checks.map((c) => c.check), ["missing_delivery"]);
  assert.equal(result.steps[0].tool, "write_document");
  const honest = [{ ok: true, text: "Não encontrei a planilha de férias na pasta do RH." }];
  const refused = await runChatAgent({ system: "s", input: "Crie a planilha de férias.", tools: [writer], callModel: async () => honest.shift() });
  assert.deepEqual(refused.checks || [], [], "an honest 'não encontrei' is the answer");
  assert.equal(requestsFile("Entregar a planilha dos títulos em atraso."), true);
});

test("after a guard, the model's 'I'll fix it' sentence is not shown to the person", async () => {
  const { withoutCorrectionPreamble } = await import("../app/chatAgent.js");
  const table = "## Resumo do Budget 2026\n| Área | Desvio |\n|---|---|\n| TI | 14,35% |";
  assert.equal(withoutCorrectionPreamble(`Vou corrigir a resposta com os dados exatamente como estão nos documentos.\n\n---\n${table}`), table);
  assert.equal(withoutCorrectionPreamble(`Vocês estão corretos, meu erro. ${table}`), table);
  assert.equal(withoutCorrectionPreamble(`Tem razão: ${table}`), table);
  assert.equal(withoutCorrectionPreamble(table), table, "a plain answer stays");
  assert.equal(withoutCorrectionPreamble("Peço desculpas pela confusão."), "Peço desculpas pela confusão.", "nothing left after it: kept");
});

test("asked why, an answer that found the number but not the cause searches other documents once", async () => {
  const search = { name: "knowledge_search", description: "busca", parameters: { type: "object", properties: {} }, describe: () => ({ kind: "meta" }), run: async () => "Ata: a Linha 2 parou 3 dias por quebra da embaladora." };
  const replies = [
    { ok: true, text: "", toolCalls: [{ name: "knowledge_search", arguments: { query: "OEE setembro" } }] },
    { ok: true, text: "A Linha 2 teve o pior OEE (61,2%). Não há explicação detalhada sobre o motivo nos dados disponíveis." },
    { ok: true, text: "", toolCalls: [{ name: "knowledge_search", arguments: { query: "Linha 2 setembro parada motivo" } }] },
    { ok: true, text: "A Linha 2 (61,2%): a embaladora quebrou e a linha parou 3 dias." },
  ];
  const result = await runChatAgent({ system: "s", input: "Qual linha teve o pior OEE em setembro e por quê?", tools: [search], callModel: async () => replies.shift() });
  assert.deepEqual(result.checks.map((c) => c.check), ["why_unexplained"]);
  assert.match(result.text, /embaladora/);
});

test("asked why, an answer that leaves the why out altogether also searches for the cause once", async () => {
  const search = { name: "knowledge_search", description: "busca", parameters: { type: "object", properties: {} }, describe: () => ({ kind: "meta" }), run: async () => "Ata: a embaladora da Linha 2 quebrou." };
  const replies = [
    { ok: true, text: "A Linha 2 teve o pior OEE em setembro: 61,2%, a menor das três linhas." },
    { ok: true, text: "", toolCalls: [{ name: "knowledge_search", arguments: { query: "Linha 2 setembro parada" } }] },
    { ok: true, text: "A Linha 2 (61,2%), porque a embaladora quebrou." },
  ];
  const result = await runChatAgent({ system: "s", input: "Qual linha teve o pior OEE em setembro e por quê?", tools: [search], callModel: async () => replies.shift() });
  assert.deepEqual(result.checks.map((c) => c.check), ["why_unexplained"]);
  const plain = [{ ok: true, text: "A Linha 2 teve o pior OEE." }];
  const noWhy = await runChatAgent({ system: "s", input: "Qual linha teve o pior OEE em setembro?", tools: [search], callModel: async () => plain.shift() });
  assert.deepEqual(noWhy.checks || [], [], "no why asked, no nudge");
});

test("a text the model tried to save in a file (refused: text only) is the answer, not written again", async () => {
  const write = { name: "write_file", description: "grava", parameters: { type: "object", properties: {} }, describe: () => ({ kind: "meta" }), run: async () => { throw new Error("A pessoa pediu só o texto: escreva-o direto na resposta, para ela copiar."); } };
  const message = "Oi, Ana! Me desculpa de coração por ter esquecido o seu aniversário. Você é muito especial pra mim.";
  const replies = [{ ok: true, text: "", toolCalls: [{ name: "write_file", arguments: { path: "desculpa.md", content: message } }] }];
  let calls = 0;
  const result = await runChatAgent({ system: "s", input: "me ajuda a pedir desculpa pra minha amiga", tools: [write], callModel: async () => { calls += 1; return replies.shift(); } });
  assert.equal(result.text, message);
  assert.equal(calls, 1, "one model call: nothing generated again");
});

test("a text left with [Nome do Cliente] after only a search goes back to read the document", async () => {
  const search = { name: "knowledge_search", description: "busca", parameters: { type: "object", properties: {} }, describe: () => ({ kind: "meta" }), run: async () => "1. Fonte: Contas a Receber.xlsx" };
  const replies = [
    { ok: true, text: "", toolCalls: [{ name: "knowledge_search", arguments: { query: "inadimplência" } }] },
    { ok: true, text: "Assunto: Cobrança - [Nome do Cliente]\n\nPrezado, o valor de [Valor total em atraso] segue pendente.\n\n[Seu nome]" },
    { ok: true, text: "Assunto: Cobrança - Empório Central\n\nPrezado, o valor de R$ 157.935,04 segue pendente.\n\n[Seu nome]" },
  ];
  const sent = [];
  const result = await runChatAgent({ system: "s", input: "escreve um email de cobrança pro cliente q mais deve", tools: [search], callModel: async (messages) => { sent.push(messages.at(-1)?.content); return replies.shift(); } });
  assert.deepEqual(result.checks.map((c) => c.check), ["data_blanks"]);
  assert.match(String(sent.at(-1)), /leia o documento com read_file/);
  assert.match(result.text, /Empório Central/);
});

test("an answer that says it created a file it never wrote is asked for the file, not told it invented a document", async () => {
  const read = { name: "read_file", description: "lê", parameters: { type: "object", properties: {} }, describe: () => ({ kind: "meta" }), run: async () => "Controle de Férias 2026.xlsx\nNome | Início\nMarcos | 05/10/2026" };
  const write = { name: "write_document", description: "grava", parameters: { type: "object", properties: {} }, describe: () => ({ kind: "meta" }), run: async () => "Criei C:\RH\ferias_outubro_2026.xlsx (XLSX, 900 bytes)." };
  const replies = [
    { ok: true, text: "", toolCalls: [{ name: "read_file", arguments: { path: "Controle de Férias 2026.xlsx" } }] },
    { ok: true, text: "Criei a planilha ferias_outubro_2026.xlsx com os funcionários que saem de férias em outubro." },
    { ok: true, text: "", toolCalls: [{ name: "write_document", arguments: { path: "ferias_outubro_2026.xlsx", content: "| Nome | Início |\n|---|---|\n| Marcos | 05/10/2026 |" } }] },
    { ok: true, text: "Criei C:\RH\ferias_outubro_2026.xlsx com 1 funcionário." },
  ];
  const result = await runChatAgent({ system: "s", input: "faça uma planilha com quem sai de férias em outubro", tools: [read, write], callModel: async () => replies.shift(), checkCitations: async (text, steps) => (steps.some((s) => s.tool === "write_document" && s.ok) ? [] : ["ferias_outubro_2026.xlsx"]) });
  assert.deepEqual(result.checks.map((c) => c.check), ["claimed_delivery"]);
  assert.ok(result.steps.some((s) => s.tool === "write_document" && s.ok));
});
