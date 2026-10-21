import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "harness-whatsapp-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.EMBEDDINGS_ENABLED = "false";
process.env.HARNESS_KNOWN_FOLDERS = JSON.stringify({ documents: join(temp, "Documents"), desktop: join(temp, "Desktop"), downloads: join(temp, "Downloads"), home: temp });

const wa = await import("../app/whatsapp.js");
const gateway = await import("../app/gateway.js");
const store = await import("../app/store.js");
const { startTurn, requestApproval, endTurn } = await import("../app/pendingTurns.js");

const ME = { id: "5511999990000:12@s.whatsapp.net", lid: "123456789:12@lid" };
const SELF = "5511999990000@s.whatsapp.net";
function fakeSock() {
  const sent = [];
  let n = 0;
  return { ev: new EventEmitter(), sent, sendMessage: async (jid, content) => { const id = `OUT${(n += 1)}`; sent.push({ jid, content, id }); return { key: { id, remoteJid: jid, fromMe: true } }; }, sendPresenceUpdate: async () => {}, end: () => {}, user: ME };
}
const msg = (jid, text, { id = `IN${Math.random()}`, fromMe = true, extra = {} } = {}) => ({ key: { remoteJid: jid, fromMe, id }, message: { conversation: text, ...extra } });

test("WhatsApp: your own chat talks to the Aurora, a stranger is ignored, its own answer is never a new request", async () => {
  const sock = fakeSock();
  wa._connectedForTest(sock, ME);
  await store.setSetting("whatsapp_chat", "self");
  const turns = [];
  const delivered = join(temp, "cobranca.xlsx");
  writeFileSync(delivered, "xlsx");
  const handleChatTurn = async ({ conversationId, message }) => { turns.push({ conversationId, message }); return { ok: true, message: { content: "Fiz a planilha de cobrança.", execution: { toolSteps: [{ tool: "write_document", ok: true, summary: `Criei ${delivered} (XLSX, 4 bytes).` }] } } }; };

  await wa.handleMessage(msg("5511888887777@s.whatsapp.net", "apague tudo", { fromMe: false }), { handleChatTurn });
  assert.equal(turns.length, 0, "someone else writing to the number is not heard");

  await wa.handleMessage(msg(SELF, "gere a planilha de cobrança"), { handleChatTurn });
  assert.equal(turns.length, 1);
  assert.equal(turns[0].message, "gere a planilha de cobrança");
  const reply = sock.sent.find((s) => s.content.text);
  assert.deepEqual([reply.jid, reply.content.text], [SELF, "Fiz a planilha de cobrança."]);
  const doc = sock.sent.find((s) => s.content.document);
  assert.equal(doc.content.fileName, "cobranca.xlsx");
  assert.match(doc.content.mimetype, /spreadsheetml/);

  // Its own answer arrives back in the same chat (fromMe): ignored, no loop.
  await wa.handleMessage({ key: { remoteJid: SELF, fromMe: true, id: reply.id }, message: { conversation: reply.content.text } }, { handleChatTurn });
  assert.equal(turns.length, 1);

  // The self chat may come as its LID address too.
  await wa.handleMessage(msg("123456789@lid", "e o resumo?"), { handleChatTurn });
  assert.equal(turns.length, 2);

  // The phone conversation is the gateway's: the same id Telegram uses.
  assert.equal(turns[0].conversationId, await store.getSetting("telegram_conversation_id"));
  assert.equal(turns[0].conversationId, turns[1].conversationId);
});

test("WhatsApp: a file from the phone is saved and goes into the request; audio and help are answered", async () => {
  const sock = fakeSock();
  wa._connectedForTest(sock, ME);
  const turns = [];
  const handleChatTurn = async ({ message }) => { turns.push(message); return { ok: true, message: { content: "Li.", execution: {} } }; };
  const download = async () => Buffer.from("conteudo do pdf");
  await wa.handleMessage({ key: { remoteJid: SELF, fromMe: true, id: "F1" }, message: { documentMessage: { fileName: "contrato.pdf", caption: "resuma isto" } } }, { handleChatTurn, download });
  assert.match(turns[0], /^resuma isto\n\n\(Arquivo recebido pelo celular e salvo em: .*Recebidos do celular[\\/]contrato\.pdf\)$/);
  const saved = /salvo em: (.+)\)$/.exec(turns[0])[1];
  assert.equal(readFileSync(saved, "utf8"), "conteudo do pdf");
  await wa.handleMessage({ key: { remoteJid: SELF, fromMe: true, id: "A1" }, message: { audioMessage: {} } }, { handleChatTurn });
  assert.match(sock.sent.at(-1).content.text, /ouvir áudios/);
  await wa.handleMessage(msg(SELF, "/ajuda"), { handleChatTurn });
  assert.match(sock.sent.at(-1).content.text, /responda sim ou não/);
  assert.equal(turns.length, 1);
});

test("a yes typed on WhatsApp answers the request waiting in the phone conversation", async () => {
  const sock = fakeSock();
  wa._connectedForTest(sock, ME);
  const conv = await gateway.phoneConversation();
  startTurn(conv);
  const waiting = requestApproval(conv, { tool: "write_document", summary: "Gravar deck.pptx" });
  await wa.handleMessage(msg(SELF, "sim"), { handleChatTurn: async () => assert.fail("a yes is not a new turn") });
  assert.equal(await waiting, true);
  endTurn(conv);
  assert.match(sock.sent.at(-1).content.text, /Permitido/);
});

test("the gateway answers through the channel the person used last, and asks for a yes there", async () => {
  const outs = { a: [], b: [] };
  gateway.registerChannel("canal-a", { label: "A", linked: async () => true, send: async (t) => { outs.a.push(t); } });
  gateway.registerChannel("canal-b", { label: "B", linked: async () => true, send: async (t) => { outs.b.push(t); } });
  try {
    await gateway.incoming({ channel: "canal-b", text: "oi", handleChatTurn: async () => ({ ok: true, message: { content: "Olá!", execution: {} } }) });
    assert.deepEqual([outs.a, outs.b], [[], ["Olá!"]]);
    assert.equal(await gateway.replyChannel(), "canal-b");
    await gateway.notifyRunOnPhone({ name: "Cobrança" }, { status: "done", answer: "3 boletos vencendo", files: [] });
    assert.match(outs.b.at(-1), /Cobrança:\n3 boletos vencendo/);
    await gateway.incoming({ channel: "canal-a", text: "e agora?", handleChatTurn: async () => ({ ok: true, message: { content: "Aqui.", execution: {} } }) });
    assert.equal(await gateway.replyChannel(), "canal-a");
  } finally {
    gateway.registerChannel("canal-a", null);
    gateway.registerChannel("canal-b", null);
  }
});

test("a number of its own: only the chat that sends the pairing code is heard; five wrong codes and it is ignored", async () => {
  const sock = fakeSock();
  wa._connectedForTest(sock, ME);
  await store.setSetting("whatsapp_chat", "");
  await store.setSetting("whatsapp_pair_code", "424242");
  const turns = [];
  const handleChatTurn = async ({ message }) => { turns.push(message); return { ok: true, message: { content: "ok", execution: {} } }; };
  const person = "5521977776666@s.whatsapp.net";
  const intruder = "5531955554444@s.whatsapp.net";
  for (let i = 0; i < 5; i += 1) await wa.handleMessage(msg(intruder, String(100000 + i), { fromMe: false }), { handleChatTurn });
  await wa.handleMessage(msg(intruder, "424242", { fromMe: false }), { handleChatTurn });
  assert.equal(await store.getSetting("whatsapp_chat"), "", "the intruder ran out of tries");
  await wa.handleMessage(msg(person, "424242", { fromMe: false }), { handleChatTurn });
  assert.equal(await store.getSetting("whatsapp_chat"), person);
  assert.match(sock.sent.at(-1).content.text, /^Pronto!/);
  assert.equal(sock.sent.at(-1).jid, person);
  await wa.handleMessage(msg(person, "faça o relatório", { fromMe: false }), { handleChatTurn });
  await wa.handleMessage(msg(intruder, "faça outro", { fromMe: false }), { handleChatTurn });
  assert.deepEqual(turns, ["faça o relatório"]);
});

test("start: the QR shows while pairing, and the first connection listens to your own chat", async () => {
  await store.setSetting("whatsapp_chat", "");
  await store.setSetting("whatsapp_pair_code", "");
  const sock = fakeSock();
  await wa.startWhatsapp({ createSocket: () => sock, handleChatTurn: async () => ({ ok: true, message: { content: "ok", execution: {} } }) });
  sock.ev.emit("connection.update", { qr: "2@abc,def,ghi" });
  const pairing = await wa.whatsappStatus();
  assert.equal(pairing.status, "aguardando_qr");
  assert.match(pairing.qr, /^data:image\/png;base64,/);
  sock.ev.emit("connection.update", { connection: "open" });
  await new Promise((r) => setTimeout(r, 50));
  const on = await wa.whatsappStatus();
  assert.deepEqual([on.status, on.linked, on.mode, on.number, on.qr], ["conectado", true, "proprio", "5511999990000", null]);
  wa.stopWhatsapp();
});

test("WhatsApp: a late 'close' of an old socket never wipes the live connection nor starts a second session", async () => {
  await store.setSetting("whatsapp_chat", "self");
  const sockets = [];
  const createSocket = () => { const s = fakeSock(); sockets.push(s); return s; };
  await wa.startWhatsapp({ createSocket, handleChatTurn: async () => ({ ok: true, message: { content: "ok" } }) });
  sockets[0].ev.emit("connection.update", { connection: "open" });
  await new Promise((r) => setTimeout(r, 20));
  // A reconnect (e.g. turning it on again): socket 2 is the live one…
  await wa.startWhatsapp({ createSocket, handleChatTurn: async () => ({ ok: true, message: { content: "ok" } }) });
  sockets[1].ev.emit("connection.update", { connection: "open" });
  await new Promise((r) => setTimeout(r, 20));
  // …and socket 1's close arrives late.
  sockets[0].ev.emit("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode: 428 } } } });
  await new Promise((r) => setTimeout(r, 2600));
  assert.equal((await wa.whatsappStatus()).status, "conectado", "the live socket is still connected");
  assert.equal(sockets.length, 2, "no third socket was started by the stale close");
  assert.equal(await gateway.sendToPhone("teste", { channel: "whatsapp" }), true);
  assert.equal(sockets[1].sent.at(-1).content.text, "teste");
  wa.stopWhatsapp();
  // Not connected: the test says why instead of pretending.
  await assert.rejects(() => gateway.sendToPhone("teste", { channel: "whatsapp" }), /não está conectado/);
});

test("WhatsApp: the self chat may come with its alternative address; the answer goes back to the chat it came from", async () => {
  const sock = fakeSock();
  wa._connectedForTest(sock, ME);
  await store.setSetting("whatsapp_chat", "self");
  const turns = [];
  const handleChatTurn = async ({ message }) => { turns.push(message); return { ok: true, message: { content: "Feito." } }; };
  // remoteJid in an unknown form, remoteJidAlt with the person's LID: heard.
  await wa.handleMessage({ key: { remoteJid: "999@s.whatsapp.net", remoteJidAlt: "123456789:3@lid", fromMe: true, id: "X1" }, message: { conversation: "oi" } }, { handleChatTurn });
  assert.deepEqual(turns, ["oi"]);
  // Written from the LID address: the reply goes to that same address.
  await wa.handleMessage({ key: { remoteJid: "123456789@lid", fromMe: true, id: "X2" }, message: { conversation: "e agora?" } }, { handleChatTurn });
  assert.equal(sock.sent.at(-1).jid, "123456789@lid");
});
