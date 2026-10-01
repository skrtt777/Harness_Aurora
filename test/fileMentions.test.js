import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "harness-mentions-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.LOCAL_BASE_URL = "http://127.0.0.1:1";
process.env.CODEX_BIN = join(temp, "missing-codex.exe");
process.env.CLAUDE_BIN = join(temp, "missing-claude.exe");

const { expandPath, findFilesByName, resolveExisting } = await import("../app/agentTools/files.js");
const { executeTool } = await import("../app/agentTools/index.js");
const { parseTextToolCall } = await import("../app/chatAgent.js");
const { makePdf } = await import("../app/sampleDocs.js");

// A fake user profile: Desktop (OneDrive-redirected, with an accent), Downloads.
const home = join(temp, "home");
const folders = { desktop: join(home, "OneDrive", "Área de Trabalho"), documents: join(home, "Documents"), downloads: join(home, "Downloads"), home };
for (const dir of Object.values(folders)) mkdirSync(dir, { recursive: true });
writeFileSync(join(folders.downloads, "MARU_MEDIA_KIT_PDF_FINAL.pdf"), makePdf(["MARU MEDIA KIT 2026", "TikTok + Reel + Story US$ 350"]));
writeFileSync(join(folders.downloads, "MARU_MEDIA_KIT_PDF_FINAL (1).pdf"), makePdf(["cópia antiga"]));
writeFileSync(join(folders.desktop, "Calendário 2026.xlsx"), "x");
const ctx = (extra = {}) => ({ mode: "auto", knownFolders: folders, workspaceRoots: [folders.desktop, folders.documents, folders.downloads], approve: async () => false, ...extra });

test("paths survive PowerShell variables, doubled backslashes and stray quotes", () => {
  process.env.AURORA_TEST_DIR = temp;
  assert.equal(expandPath("$env:AURORA_TEST_DIR\\a.txt", folders), join(temp, "a.txt"));
  assert.equal(expandPath('"C:\\\\Users\\\\x\\\\a.pdf",', folders), "C:\\Users\\x\\a.pdf");
  assert.equal(expandPath("\\\\servidor\\RH\\a.docx", folders), "\\\\servidor\\RH\\a.docx", "UNC prefix is kept");
  assert.equal(expandPath(".", folders, temp), temp);
});

test("a file named without its folder (or with a mangled one) is found in the person's folders", async () => {
  const exact = await findFilesByName("MARU_MEDIA_KIT_PDF_FINAL.pdf", [folders.desktop, folders.downloads]);
  assert.equal(exact[0], join(folders.downloads, "MARU_MEDIA_KIT_PDF_FINAL.pdf"), "exact name beats the (1) copy");
  assert.equal((await findFilesByName("maru_media_kit_pdf_final", [folders.downloads]))[0], join(folders.downloads, "MARU_MEDIA_KIT_PDF_FINAL.pdf"), "no extension, any case");
  assert.deepEqual(await findFilesByName("2026.xlsx", [folders.desktop]), [], "short names never match by 'contains'");
  const mangled = join(home, "OneDrive", "\uFFFDrea de Trabalho", "MARU_MEDIA_KIT_PDF_FINAL.pdf");
  assert.equal(await resolveExisting(mangled, ctx()), join(folders.downloads, "MARU_MEDIA_KIT_PDF_FINAL.pdf"));
  await assert.rejects(resolveExisting(join(folders.desktop, "nao-existe.pdf"), ctx()), /Peça o caminho ao usuário/);
});

test("read_file and search_files work from a bare name, across Desktop/Documents/Downloads", async () => {
  const read = await executeTool("read_file", { path: "C:\\Users\\ninguem\\Desktop\\MARU_MEDIA_KIT_PDF_FINAL.pdf" }, ctx());
  assert.equal(read.ok, true, read.result);
  assert.match(read.result, /US\$ 350/);
  const search = await executeTool("search_files", { pattern: "maru_media_kit" }, ctx());
  assert.match(search.result, /Downloads[\\/]MARU_MEDIA_KIT_PDF_FINAL\.pdf/);
  assert.match((await executeTool("search_files", { pattern: "calendario" }, ctx())).result, /Calendário 2026\.xlsx/, "accent-insensitive");
});

test("file mentions: bare names, quoted paths and names with extensions; never plain talk", async () => {
  const { fileMentions } = await import("../app/server.js");
  assert.ok(fileMentions("Resuma esse documento pra mim por favor > MARU_MEDIA_KIT_PDF_FINAL").includes("MARU_MEDIA_KIT_PDF_FINAL"));
  assert.ok(fileMentions('"C:\\Users\\lucas\\Downloads\\MARU_MEDIA_KIT_PDF_FINAL.pdf"').includes("C:\\Users\\lucas\\Downloads\\MARU_MEDIA_KIT_PDF_FINAL.pdf"));
  assert.ok(fileMentions("leia o relatorio_final.docx").includes("relatorio_final.docx"));
  assert.deepEqual(fileMentions("oi, tudo bem? abra o youtube.com"), []);
});

test("broken tool-call JSON at the end of a reply is rescued; tool names in prose are not", () => {
  const known = ["run_command", "browser_navigate"];
  assert.deepEqual(parseTextToolCall('Vou procurar o arquivo.\n\n["name": "run_command", "parameters": {"command":"Get-ChildItem -Filter \'MARU*\'"}}', known), { name: "run_command", arguments: { command: "Get-ChildItem -Filter 'MARU*'" } });
  assert.equal(parseTextToolCall('Posso usar {"name":"run_command"} se quiser, é só pedir.', known), null);
  assert.equal(parseTextToolCall('["name": "apagar_tudo", "parameters": {}}', known), null);
});

test("a mentioned file is read before the model answers, stays attached in later turns, and failed calls aren't replayed", async () => {
  const store = await import("../app/store.js");
  const { handleChatTurn } = await import("../app/server.js");
  const { knownFolders } = await import("../app/agentTools/index.js");
  // Point the agent's known folders at the fake profile.
  (await knownFolders()).desktop = folders.desktop;
  (await knownFolders()).downloads = folders.downloads;
  (await knownFolders()).home = home;
  await store.setSetting("teacher_mode", "off");
  const bodies = [];
  let round = 0;
  const stub = http.createServer(async (req, res) => {
    if (req.url !== "/api/chat") { res.writeHead(404); return res.end(); }
    let raw = ""; for await (const chunk of req) raw += chunk;
    bodies.push(JSON.parse(raw));
    round += 1;
    res.setHeader("content-type", "application/json");
    const reply = round === 1 ? { message: { role: "assistant", content: "", tool_calls: [{ function: { name: "web_fetch", arguments: { url: "https://drive.google.com/inventado" } } }] } }
      : { message: { role: "assistant", content: round === 2 ? "Resumo: media kit da Maru." : "Custa US$ 350." } };
    res.end(JSON.stringify({ ...reply, prompt_eval_count: 5, eval_count: 3 }));
  });
  await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const env = { ...process.env, LOCAL_BASE_URL: `http://127.0.0.1:${stub.address().port}`, LOCAL_MODEL: "qwen3.5:4b" };
  try {
    const conversation = await store.createConversation({ provider: "local" });
    const first = await handleChatTurn({ conversationId: conversation.id, message: "Resuma esse documento > MARU_MEDIA_KIT_PDF_FINAL", env });
    assert.equal(first.ok, true, first.error);
    assert.deepEqual(first.message.execution.attachments, [join(folders.downloads, "MARU_MEDIA_KIT_PDF_FINAL.pdf")]);
    assert.match(bodies[0].messages[0].content, /ARQUIVOS DO USUÁRIO JÁ LIDOS[\s\S]*TikTok \+ Reel \+ Story US\$ 350/);
    const second = await handleChatTurn({ conversationId: conversation.id, message: "quanto custa o pacote completo?", env });
    assert.equal(second.ok, true, second.error);
    assert.deepEqual(second.message.execution.attachments, [join(folders.downloads, "MARU_MEDIA_KIT_PDF_FINAL.pdf")], "the file from the earlier turn stays attached");
    const replay = bodies.at(-1).messages;
    assert.equal(replay.some((m) => m.tool_calls?.some((c) => c.function.name === "web_fetch")), false, "the failed made-up link is not replayed");
  } finally { await new Promise((resolve) => stub.close(resolve)); }
});

test("documents are pulled in automatically only for information requests", async () => {
  const { asksForInformation } = await import("../app/server.js");
  for (const t of ["oi, tudo bem?", "bom dia", "valeu, obrigado", "e aí, tudo bem?", "crie um arquivo soma.js", "abra o youtube"]) assert.equal(asksForInformation(t), false, t);
  for (const t of ["quem cuida da folha de pagamento?", "me traz um resumo da programação de final de ano", "Resuma esse documento > MARU_MEDIA_KIT", "quanto custa o pacote tiktok", "quando é o dia das crianças"]) assert.equal(asksForInformation(t), true, t);
});
