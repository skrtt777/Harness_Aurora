import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync, mkdirSync, mkdtempSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "harness-knowledge-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.LOCAL_BASE_URL = "http://127.0.0.1:1";
process.env.CODEX_BIN = join(temp, "missing-codex.exe");
process.env.CLAUDE_BIN = join(temp, "missing-claude.exe");

const { extractText, docxText, readZip } = await import("../app/docText.js");
const { makeDocx, makeXlsx, makePptx, makePdf, makeScannedPdf, SCANNED_ON_CALL, writeSampleHrShare } = await import("../app/sampleDocs.js");
const kb = await import("../app/knowledge.js");
const { executeTool } = await import("../app/agentTools/index.js");
const { citesSource, runChatAgent } = await import("../app/chatAgent.js");

// Deterministic "mapping" and "OCR" so tests never need the local model or Tesseract.
const fakeOcr = async (image) => { assert.ok(Buffer.isBuffer(image) && image.length > 1000, "OCR gets a rendered image"); return SCANNED_ON_CALL.join("\n"); };
const fakeMap = async ({ relPath, department }) => ({ category: `${department}/${relPath.split(/[\\/]/).length > 1 ? relPath.split(/[\\/]/)[0] : "Geral"}`, card: { title: relPath, type: "outro", topic: "", summary: `Resumo de ${relPath}`, keywords: [], dates: [], flow: relPath.includes("férias") ? ["Combine com o gestor", "Registre no portal"] : [], mapped: true } });

test("Word, Excel, PowerPoint, PDF and text documents become plain text", async () => {
  const dir = mkdtempSync(join(temp, "docs-"));
  writeFileSync(join(dir, "a.docx"), makeDocx(["Título do comunicado", [["Nome", "Ramal"], ["Diego", "2204"]], "Fim & começo <ok>"]));
  writeFileSync(join(dir, "b.xlsx"), makeXlsx({ Folha: [["Mês", "Valor"], ["Janeiro", 1500]], Outra: [["x"]] }));
  writeFileSync(join(dir, "c.pptx"), makePptx([["Slide um"], ["Linha A", "Linha B"]]));
  writeFileSync(join(dir, "d.pdf"), makePdf(["Política de férias", "Vale-refeição: R$ 42,00"]));
  writeFileSync(join(dir, "e.md"), "\uFEFF# Nota\nTexto");
  assert.equal(await extractText(join(dir, "a.docx")), "Título do comunicado\nNome | Ramal\nDiego | 2204\nFim & começo <ok>");
  assert.equal(await extractText(join(dir, "b.xlsx")), "## Folha\nMês | Valor\nJaneiro | 1500\n## Outra\nx");
  assert.equal(await extractText(join(dir, "c.pptx")), "## Slide 1\nSlide um\n\n## Slide 2\nLinha A\nLinha B");
  assert.match(await extractText(join(dir, "d.pdf")), /Política de férias\nVale-refeição: R\$ 42,00/);
  assert.equal(await extractText(join(dir, "e.md")), "# Nota\nTexto");
  await assert.rejects(extractText(join(dir, "x.exe")), /não suportado/);
  assert.throws(() => readZip(Buffer.from("não é zip")), /ZIP inválido/);
  assert.equal(docxText(makeDocx(["a"])), "a");
});

test("scanned PDF pages and images are read by OCR; pages with text keep their text", async () => {
  const dir = mkdtempSync(join(temp, "ocr-"));
  writeFileSync(join(dir, "scan.pdf"), makeScannedPdf(SCANNED_ON_CALL));
  writeFileSync(join(dir, "texto.pdf"), makePdf(["Política de férias", "Vale-refeição: R$ 42,00"]));
  writeFileSync(join(dir, "foto.png"), Buffer.alloc(30_000));
  let calls = 0;
  const ocr = async (image) => { calls += 1; return fakeOcr(image); };
  assert.equal(await extractText(join(dir, "scan.pdf"), { ocr }), `## Página 1 (OCR)\n${SCANNED_ON_CALL.join("\n")}`);
  assert.match(await extractText(join(dir, "texto.pdf"), { ocr }), /^Política de férias/);
  assert.equal(calls, 1, "a page with a text layer never goes through OCR");
  assert.equal(await extractText(join(dir, "scan.pdf"), { ocr: false }), "", "OCR can be turned off");
  assert.match(await extractText(join(dir, "foto.png"), { ocr }), /^## Imagem \(OCR\)\nCOMUNICADO/);
  assert.equal(await extractText(join(dir, "foto.png"), { ocr: async () => "~ |\\ .. ii" }), "", "noise from a photo is not text");
  await assert.rejects(extractText(join(dir, "scan.pdf"), { ocr: async () => { throw new Error("sem idioma"); } }), /escaneado, mas o OCR falhou: sem idioma/);
});

const OCR_CACHE = join(process.env.APPDATA || "", "Harness Aurora XR", "ocr-cache");
test("real Tesseract reads the sample scan (skipped without language data)", { skip: !existsSync(join(OCR_CACHE, "por.traineddata")) && "no traineddata" }, async () => {
  const { defaultOcr } = await import("../app/docText.js");
  const { terminateOcr } = await import("../app/ocr.js");
  const dir = mkdtempSync(join(temp, "tess-"));
  writeFileSync(join(dir, "scan.pdf"), makeScannedPdf(SCANNED_ON_CALL));
  const env = { ...process.env, OCR_LANG: "por+eng", OCR_CACHE_PATH: OCR_CACHE };
  try {
    const text = await extractText(join(dir, "scan.pdf"), { ocr: (image) => defaultOcr(image, env) });
    assert.match(text, /Marcos Lima, ramal 2210/);
    assert.match(text, /26\/12\/2026/);
  } finally { await terminateOcr(); }
});

test("read_file opens office documents with line numbers", async () => {
  const dir = mkdtempSync(join(temp, "read-"));
  writeFileSync(join(dir, "nota.docx"), makeDocx(["Primeira linha", "Segunda linha"]));
  const result = await executeTool("read_file", { path: "nota.docx" }, { mode: "auto", workspace: dir, workspaceRoots: [dir], knownFolders: {}, approve: async () => false });
  assert.equal(result.ok, true, result.result);
  assert.match(result.result, /1  Primeira linha\n +2  Segunda linha/);
});

test("chunks are labelled with their source and overlap a little", () => {
  const text = Array.from({ length: 30 }, (_, i) => `Parágrafo ${i} ${"x".repeat(80)}`).join("\n");
  const chunks = kb.chunkText(text, "RH — Eventos/a.docx");
  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((c) => c.startsWith("[RH — Eventos/a.docx]\n") && c.length < 1500));
  assert.equal(kb.chunkText("curto", "x").length, 1);
});

test("a network folder is indexed incrementally, organized by folder and searchable by the request's words", async () => {
  const share = writeSampleHrShare(join(temp, "RH"));
  await assert.rejects(kb.createSource({ path: "relativo/rh", department: "RH" }), /caminho completo/);
  await assert.rejects(kb.createSource({ path: join(temp, "nao-existe"), department: "RH" }), /não existe/);
  const source = await kb.createSource({ name: "Pasta do RH", path: share, department: "RH" });
  const first = await kb.indexSource(source.id, { map: fakeMap, ocr: fakeOcr });
  assert.deepEqual(first, { total: 7, done: 7, changed: 7, removed: 0, failed: 0, ...{} });
  assert.deepEqual((await kb.knowledgeMap()).map((c) => c.category), ["RH/Benefícios", "RH/Eventos", "RH/Geral", "RH/Procedimentos"]);
  const ferias = (await kb.knowledgeMap({ category: "Procedimentos" }))[0].documents.find((d) => d.relPath.includes("férias"));
  assert.deepEqual(ferias.flow, ["Combine com o gestor", "Registre no portal"]);

  const top = async (q) => (await kb.searchKnowledge(q, { limit: 3 }))[0]?.relPath;
  assert.equal(await top("me traz um resumo da programação de final de ano"), "Eventos/Confraternização 2026.docx");
  assert.equal(await top("quanto é o vale refeição"), "Benefícios/Política de Benefícios.pdf");
  assert.equal(await top("ramal da folha de pagamento"), "Contatos do RH.txt");
  assert.equal(await top("como solicitar férias"), "Procedimentos/Como solicitar férias.docx");
  assert.equal(await top("quem atende o plantão do RH no recesso"), "Eventos/Plantão do recesso (escaneado).pdf", "a scanned page is found by what OCR read");
  assert.equal((await kb.knowledgeMap({ category: "Eventos" }))[0].documents.find((d) => d.relPath.includes("escaneado")).ocr, true);
  assert.ok((await kb.searchKnowledge("oi, tudo bem?")).every((h) => h.score < 1.5), "small talk doesn't look like a document match");

  const again = await kb.indexSource(source.id, { map: fakeMap, ocr: async () => assert.fail("unchanged scans are not read again") });
  assert.equal(again.changed, 0, "nothing changed, nothing re-read");
  writeFileSync(join(share, "Contatos do RH.txt"), "Folha de pagamento: Ana Lima - ramal 2299\n");
  utimesSync(join(share, "Contatos do RH.txt"), new Date(), new Date(Date.now() + 5000));
  // unlinkSync: Node 24.1 rmSync silently keeps files with accented names on Windows.
  unlinkSync(join(share, "Procedimentos", "Admissão - checklist.pptx"));
  const changed = await kb.indexSource(source.id, { map: fakeMap });
  assert.deepEqual([changed.changed, changed.removed], [1, 1]);
  assert.match((await kb.searchKnowledge("ramal folha de pagamento"))[0].text, /Ana Lima - ramal 2299/);
  assert.equal((await kb.searchKnowledge("admissão crachá RG CPF")).some((h) => h.relPath.includes("Admissão")), false);
  assert.equal((await kb.sourceForPath(join(share, "Eventos", "x.docx"))).id, source.id);
  assert.equal(await kb.sourceForPath(join(temp, "outro.docx")), null);
});

test("knowledge tools answer with sources; paid chats must ask before seeing restricted documents", async () => {
  const ctx = { mode: "auto", workspaceRoots: [temp], knownFolders: {}, approve: async () => false, restrictedSources: new Set() };
  const local = await executeTool("knowledge_search", { query: "vale refeição" }, { ...ctx, provider: "local" });
  assert.equal(local.ok, true, local.result);
  assert.match(local.result, /Fonte: .*Política de Benefícios\.pdf \(RH\/Benefícios/);
  assert.match(local.result, /R\$ 42,00/);
  assert.equal(ctx.restrictedSources.size, 1, "a restricted source used in the turn is remembered");
  const asked = [];
  const paid = await executeTool("knowledge_search", { query: "vale refeição" }, { ...ctx, provider: "codex", approve: async (r) => { asked.push(r); return false; } });
  assert.equal(paid.ok, false);
  assert.match(asked[0].summary, /não estão liberados para IA paga/);
  const map = await executeTool("knowledge_map", { category: "Eventos" }, { ...ctx, provider: "local" });
  assert.match(map.result, /# RH\/Eventos\n[\s\S]*Confraternização/);
  const [source] = await kb.listSources();
  await kb.updateSource(source.id, { paidAllowed: true });
  assert.equal((await executeTool("knowledge_search", { query: "vale refeição" }, { ...ctx, provider: "codex" })).ok, true, "a source cleared for paid AI needs no question");
  await kb.updateSource(source.id, { paidAllowed: false });
});

test("documents an answer cites that exist nowhere are caught (real answers from the long-conversation battery)", async () => {
  const unknown = (text, files) => kb.unknownCitations(text, files);
  assert.deepEqual(await unknown("R$ 42,00.\n\nFonte: Política de Benefícios - 2026 (RH/Benefícios)"), []);
  assert.deepEqual(await unknown("Das 9h às 15h.\n\nFonte: Plantão do recesso.pdf"), [], "a name without its '(escaneado)' is still the real file");
  assert.deepEqual(await unknown("Fonte: C:\\Users\\x\\compartilhamento-rh\\Eventos\\Confraternização 2026.docx"), []);
  assert.deepEqual(await unknown("Veja o arquivo Como solicitar férias.docx."), []);
  assert.deepEqual(await unknown("**Fonte:** [Como solicitar férias.docx](file://C:/rh/Procedimentos/Como%20solicitar%20f%C3%A9rias.docx)"), [], "an encoded link to a real file");
  assert.deepEqual(await unknown("Dia 10/10.\n\nFonte: C:\\Temp\\rh\\Eventos\\Calendário de eventos 2026.xlsx (RH/Eventos)"), [], "a number inside the name is not where the name starts");
  assert.deepEqual(await unknown("Segundo o **PROPOSTA_COMERCIAL_ACME.pdf**, custa US$ 1.200.", ["C:\\x\\PROPOSTA_COMERCIAL_ACME.pdf"]), [], "underscores are part of the name");
  assert.deepEqual(await unknown('Sim, a empresa oferece. Consulte o documento **"Benefícios corporativos.pptx"**.'), ["Benefícios corporativos.pptx"]);
  assert.deepEqual(await unknown("Sim, a empresa financia [Fonte: Programa de Educação Corporativa 2026]"), ["Programa de Educação Corporativa 2026"]);
  assert.deepEqual(await unknown("Fonte: https://www.gov.br/trabalho"), [], "web links are not checked");
  assert.deepEqual(await unknown("Fonte: Proposta ACME.pdf", ["C:\\Downloads\\Proposta ACME.pdf"]), [], "files of the turn count");
  assert.deepEqual(await unknown("Não encontrei nada sobre isso nos documentos."), []);

  const echo = { name: "knowledge_search", description: "busca", parameters: { type: "object", properties: {} }, describe: () => ({ kind: "meta" }), run: async () => "nada" };
  const replies = [{ ok: true, text: "Sim! Veja o Manual de Viagens.pdf" }, { ok: true, text: "Não encontrei uma política de viagens nos documentos da empresa." }];
  const seen = [];
  const result = await runChatAgent({ system: "s", input: "tem política de viagens?", tools: [echo], grounded: true, checkCitations: (text) => unknown(text), callModel: async (messages) => { seen.push(messages.at(-1).content); return replies.shift(); } });
  assert.match(seen[1], /Não existe nenhum documento chamado "Manual de Viagens\.pdf"/);
  assert.equal(result.text, "Não encontrei uma política de viagens nos documentos da empresa.");
});

test("the teacher only sees conversations that used restricted documents if the person agrees", async () => {
  const { runTeachingLoop } = await import("../app/teachingLoop.js");
  const store = await import("../app/store.js");
  const conversation = await store.createConversation({ provider: "local" });
  const first = { ok: true, text: "Pronto", steps: [{ tool: "write_file", ok: true, args: {}, summary: "ok" }], calls: [], messages: [] };
  let called = 0;
  const call = async () => { called += 1; return { ok: true, text: '{"verdict":"ok"}' }; };
  const denied = await runTeachingLoop({ userMessage: "x", history: [], first, teacherProvider: "codex", conversation, rerun: async () => first, call, needsConsent: () => true, approve: async () => false });
  assert.equal(denied.review.skipped, "privacy");
  assert.equal(called, 0);
  const allowed = await runTeachingLoop({ userMessage: "x", history: [], first, teacherProvider: "codex", conversation, rerun: async () => first, call, needsConsent: () => true, approve: async (r) => /Enviar esta conversa ao Codex/.test(r.summary) });
  assert.equal(allowed.review.verdict, "ok");
  assert.equal(called, 1);
});

test("an answer that cites a source without consulting anything is sent back to search", async () => {
  assert.equal(citesSource("Resposta.\n\n**Fonte:** arquivo.docx"), true);
  assert.equal(citesSource("Fonte: x"), true);
  assert.equal(citesSource("A fonte de energia é solar."), false);
  const echo = { name: "knowledge_search", description: "busca", parameters: { type: "object", properties: {} }, describe: () => ({ kind: "meta" }), run: async () => "Fonte: real.docx\ntrecho" };
  const replies = [{ ok: true, text: "Diego cuida.\n\nFonte: C:\\inventado\\Folha.docx" }, { ok: true, text: "", toolCalls: [{ name: "knowledge_search", arguments: { query: "folha" } }] }, { ok: true, text: "Diego, ramal 2204.\n\nFonte: real.docx" }];
  const seen = [];
  const result = await runChatAgent({ system: "s", input: "quem cuida da folha?", tools: [echo], callModel: async (messages) => { seen.push(messages.at(-1).content); return replies.shift(); } });
  assert.match(seen[1], /citou uma fonte sem consultar/);
  assert.equal(result.text, "Diego, ramal 2204.\n\nFonte: real.docx");
  const grounded = await runChatAgent({ system: "s", input: "x", tools: [echo], grounded: true, callModel: async () => ({ ok: true, text: "Fonte: real.docx" }) });
  assert.equal(grounded.steps.length, 0, "documents injected up front count as consulted");
});

test("the paid teacher reviews the cards (not the text); accepted fixes stick and teach the local model", async () => {
  const review = await import("../app/knowledgeReview.js");
  const store = await import("../app/store.js");
  const [source] = (await kb.listSources()).filter((s) => !s.paidAllowed);
  await assert.rejects(review.reviewSourceCards(source.id, { call: async () => assert.fail("no call without consent") }), /não está liberada para IA paga/);
  let prompt = "";
  const call = async (args) => {
    prompt = args.prompt;
    const n = (name) => prompt.split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((c) => c?.arquivo?.includes(name)).n;
    return { ok: true, text: `Segue: {"taxonomia":"Eventos e benefícios separados.","correcoes":[
      {"n":${n("Confraternização")},"campo":"categoria","valor":"Festas","motivo":"é um evento festivo"},
      {"n":${n("Benefícios.pdf")},"campo":"palavras_chave","valor":["vale-refeição","VR","plano de saúde"],"motivo":"sinônimos"},
      {"n":${n("Benefícios.pdf")},"campo":"tipo","valor":"inventado","motivo":"inválido"},
      {"n":999,"campo":"titulo","valor":"x","motivo":"não existe"}]}` };
  };
  const result = await review.reviewSourceCards(source.id, { authorized: true, provider: "codex", call });
  assert.equal(result.suggestions, 2, "invalid type and unknown document are dropped");
  assert.match(prompt, /"resumo":"Resumo de Eventos.{1,3}Confraternização 2026\.docx"/, "the teacher sees the cards");
  assert.doesNotMatch(prompt, /Rua das Palmeiras/, "but never the documents' text");
  const pending = await review.listSuggestions({ sourceId: source.id });
  assert.deepEqual(pending.map((s) => s.field).sort(), ["category", "keywords"]);
  const category = pending.find((s) => s.field === "category");
  assert.equal(category.previous, "Eventos");
  await review.decideSuggestion(category.id, "accept");
  await review.decideSuggestion(pending.find((s) => s.field === "keywords").id, "reject");
  await assert.rejects(review.decideSuggestion(category.id, "accept"), /já foi decidida/);
  assert.ok((await kb.knowledgeMap()).some((c) => c.category === "RH/Festas" && c.documents.some((d) => d.relPath.includes("Confraternização"))));

  // Touched but same content: re-indexed, and the approved category stays.
  const file = join(source.path, "Eventos", "Confraternização 2026.docx");
  utimesSync(file, new Date(), new Date(Date.now() + 10000));
  await kb.indexSource(source.id, { map: fakeMap, ocr: fakeOcr });
  assert.ok((await kb.knowledgeMap()).some((c) => c.category === "RH/Festas"), "an approved category survives re-indexing");

  const examples = await kb.reviewExamples("RH");
  assert.deepEqual(examples.map((e) => [e.field, e.before, e.after]), [["category", "Eventos", "Festas"]]);
  let mapPrompt = "";
  await kb.mapDocument({ relPath: "x.docx", text: "Festa junina dia 20/06.", department: "RH", examples, ask: async (p) => { mapPrompt = p; return { ok: true, text: "{}" }; } });
  assert.match(mapPrompt, /Correções que um revisor fez[\s\S]*Confraternização 2026\.docx: categoria "Eventos" → "Festas"/);

  await store.setSetting("teacher_daily_limit", "1");
  await assert.rejects(review.reviewSourceCards(source.id, { authorized: true, call }), /Limite diário/);
  await store.setSetting("teacher_daily_limit", "30");
});

test("HTTP: sources are added, listed, cleared for paid AI and removed", async () => {
  const { createServer } = await import("../app/server.js");
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const api = (path, options = {}) => fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { headers: { "content-type": "application/json", "x-harness-token": server.apiToken }, ...options }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    const folder = join(temp, "Financeiro");
    mkdirSync(folder);
    writeFileSync(join(folder, "Reembolso.txt"), "Reembolso de despesas em até 30 dias.");
    assert.equal((await api("/knowledge/sources", { method: "POST", body: JSON.stringify({ path: "x", department: "Fin" }) })).status, 400);
    const created = await api("/knowledge/sources", { method: "POST", body: JSON.stringify({ path: folder, department: "Financeiro", paidAllowed: true }) });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.paidAllowed, true);
    for (let i = 0; i < 100; i += 1) { const s = (await api("/knowledge/sources")).body.sources.find((x) => x.id === created.body.id); if (s.documents === 1 && !s.job) break; await new Promise((r) => setTimeout(r, 50)); }
    assert.equal((await api("/knowledge/sources")).body.sources.find((x) => x.id === created.body.id).documents, 1, "indexing starts on its own");
    assert.ok((await api("/knowledge/map")).body.map.some((c) => c.category === "Financeiro/Geral"));
    assert.equal((await api(`/knowledge/sources/${created.body.id}`, { method: "PATCH", body: JSON.stringify({ paidAllowed: "sim" }) })).status, 400);
    assert.equal((await api(`/knowledge/sources/${created.body.id}`, { method: "DELETE" })).status, 200);
    assert.equal((await api("/knowledge/sources")).body.sources.some((x) => x.id === created.body.id), false);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("a paid chat must ask before reading a restricted company document with read_file", async () => {
  const [source] = (await kb.listSources()).filter((s) => !s.paidAllowed);
  const file = join(source.path, "Eventos", "Confraternização 2026.docx");
  const isRestricted = async (path) => { const s = await kb.sourceForPath(path); return Boolean(s && !s.paid_allowed); };
  const asked = [];
  const base = { mode: "auto", workspaceRoots: [temp], knownFolders: {}, isRestricted, approve: async (r) => { asked.push(r); return false; } };
  assert.equal((await executeTool("read_file", { path: file }, { ...base, provider: "local" })).ok, true, "the local model reads it freely");
  const paid = await executeTool("read_file", { path: file }, { ...base, provider: "claude" });
  assert.equal(paid.ok, false);
  assert.match(asked.at(-1).summary, /não liberado para IA paga/);
});
