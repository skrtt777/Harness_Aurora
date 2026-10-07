import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "aurora-telegram-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");

// A stand-in for api.telegram.org: records what the Aurora sends.
const sent = [];
const server = http.createServer((req, res) => {
  let body = Buffer.alloc(0);
  req.on("data", (d) => { body = Buffer.concat([body, d]); });
  req.on("end", () => {
    if (req.url.startsWith("/file/")) return res.end("conteudo do boleto");
    const method = req.url.split("/").pop();
    const json = /json/.test(req.headers["content-type"] || "") ? JSON.parse(body.toString() || "{}") : { raw: body.toString("latin1") };
    sent.push({ method, body: json });
    const result = method === "getMe" ? { username: "aurora_teste_bot" } : method === "getUpdates" ? [] : method === "getFile" ? { file_path: "documents/file_7.pdf" } : true;
    setTimeout(() => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ok: true, result })); }, method === "getUpdates" ? 50 : 0);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const env = { ...process.env, TELEGRAM_API_BASE: `http://127.0.0.1:${server.address().port}`, TELEGRAM_POLL_SECONDS: "0" };
const TOKEN = "123456789:ABCdefGhIJKlmNoPQRsTUVwxyz0123456789";
const last = (method) => sent.filter((s) => s.method === method).at(-1)?.body;

test("pairing, a message answered with its file, strangers ignored, approvals by button, agent news", async (t) => {
  // A failed assertion must not leave the fake Telegram server holding the process (it hung a
  // regression run for 11 hours, 07/10).
  t.after(() => server.close());
  const tg = await import("../app/telegram.js");
  const { startTurn, requestApproval, endTurn } = await import("../app/pendingTurns.js");
  const delivered = join(temp, "cobranca.xlsx");
  writeFileSync(delivered, "planilha");
  const turns = [];
  const handleChatTurn = async ({ conversationId, message }) => {
    turns.push(message);
    return { ok: true, message: { conversationId, content: "Fiz a planilha de cobrança.", execution: { toolSteps: [{ tool: "write_document", ok: true, summary: `Criei ${delivered} (XLSX, 8 bytes).` }] } } };
  };
  await assert.rejects(tg.connectTelegram("nao-e-token", { env, handleChatTurn }), /não parece um token/);
  const status = await tg.connectTelegram(TOKEN, { env, handleChatTurn });
  assert.equal(status.bot, "aurora_teste_bot");
  assert.match(String(status.pairCode), /^\d{6}$/);
  assert.equal(status.linked, false);

  // Guessing codes: after five wrong ones, that chat is not answered any more (not even the right code).
  for (let n = 0; n < 5; n += 1) await tg.handleUpdate({ update_id: 100 + n, message: { chat: { id: 777 }, text: String(100000 + n) } }, { env, handleChatTurn });
  const before = sent.length;
  await tg.handleUpdate({ update_id: 110, message: { chat: { id: 777 }, text: `/start ${status.pairCode}` } }, { env, handleChatTurn });
  assert.equal(sent.length, before, "a chat that guessed five times is ignored");
  assert.equal((await tg.telegramStatus()).linked, false);

  // Before pairing, a message only gets the instructions.
  await tg.handleUpdate({ update_id: 1, message: { chat: { id: 555 }, text: "oi" } }, { env, handleChatTurn });
  assert.match(last("sendMessage").text, /mande o código/);
  assert.equal(turns.length, 0);
  await tg.handleUpdate({ update_id: 2, message: { chat: { id: 555 }, text: `/start ${status.pairCode}` } }, { env, handleChatTurn });
  assert.equal((await tg.telegramStatus()).linked, true);

  // The linked chat talks to the Aurora: the answer and the file come back.
  await tg.handleUpdate({ update_id: 3, message: { chat: { id: 555 }, text: "gere a planilha de cobrança" } }, { env, handleChatTurn });
  assert.deepEqual(turns, ["gere a planilha de cobrança"]);
  assert.equal(last("sendMessage").text, "Fiz a planilha de cobrança.");
  assert.match(last("sendDocument").raw, /cobranca\.xlsx/);

  // A voice message gets a kind "text, please"; /ajuda and /agentes answer without the model.
  await tg.handleUpdate({ update_id: 30, message: { chat: { id: 555 }, voice: { file_id: "v" } } }, { env, handleChatTurn });
  assert.match(last("sendMessage").text, /ouvir áudios/);
  await tg.handleUpdate({ update_id: 31, message: { chat: { id: 555 }, text: "/ajuda" } }, { env, handleChatTurn });
  assert.match(last("sendMessage").text, /Permitir e Negar/);
  await tg.handleUpdate({ update_id: 32, message: { chat: { id: 555 }, text: "/agentes" } }, { env, handleChatTurn });
  assert.match(last("sendMessage").text, /ainda não tem agentes/);
  assert.equal(turns.length, 1, "none of these is a turn");

  // Someone else who finds the bot is not heard.
  await tg.handleUpdate({ update_id: 4, message: { chat: { id: 999 }, text: "apague tudo" } }, { env, handleChatTurn });
  assert.equal(turns.length, 1);

  // An approval in the phone's conversation comes as buttons; pressing one answers it.
  await tg.startTelegram({ env, handleChatTurn });
  const { getSetting } = await import("../app/store.js");
  const convId = await getSetting("telegram_conversation_id");
  startTurn(convId);
  const answer = requestApproval(convId, { tool: "move_file", summary: "Mover boleto.pdf para Documentos" });
  await new Promise((r) => setTimeout(r, 100));
  const ask = last("sendMessage");
  assert.match(ask.text, /Mover boleto\.pdf/);
  const yes = ask.reply_markup.inline_keyboard[0][0];
  assert.equal(yes.text, "Permitir");
  await tg.handleUpdate({ update_id: 5, callback_query: { id: "q1", data: yes.callback_data, message: { chat: { id: 555 } } } }, { env, handleChatTurn });
  assert.equal(await answer, true);
  endTurn(convId);

  // An automatic agent's result reaches the phone, with its files.
  await tg.notifyRunOnPhone({ name: "Resumo da manhã" }, { status: "done", answer: "Chegou o boleto da luz.", files: [delivered] }, { env });
  assert.match(last("sendMessage").text, /Resumo da manhã:\nChegou o boleto da luz\./);
  tg.stopTelegram();

  // A file from the phone lands in Documentos\Aurora\Recebidos do celular; its caption is the request.
  const home = mkdtempSync(join(tmpdir(), "aurora-tg-home-"));
  mkdirSync(join(home, "Documents"));
  // (The evaluations' fake folders, when set, would win over USERPROFILE.)
  const phoneEnv = { ...env, USERPROFILE: home, OneDrive: "", HARNESS_KNOWN_FOLDERS: "" };
  await tg.handleUpdate({ update_id: 6, message: { message_id: 7, chat: { id: 555 }, caption: "resuma isso", document: { file_id: "abc", file_name: "boleto luz.pdf", file_size: 18 } } }, { env: phoneEnv, handleChatTurn });
  const saved = join(home, "Documents", "Aurora", "Recebidos do celular", "boleto luz.pdf");
  assert.equal(readFileSync(saved, "utf8"), "conteudo do boleto");
  assert.match(turns.at(-1), /^resuma isso[\s\S]*Arquivo recebido pelo celular e salvo em: .*boleto luz\.pdf/);

  const off = await tg.disconnectTelegram();
  assert.equal(off.configured, false);
  assert.equal(await tg.sendToPhone("x", { env }), false, "nothing goes out once disconnected");
});
