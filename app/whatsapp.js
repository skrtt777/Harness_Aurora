// WhatsApp, a channel of the gateway (app/gateway.js), through WhatsApp Web (Baileys, as in OpenClaw): it
// runs on this computer, paired by reading a QR code on the phone; the login stays in the Aurora's own
// folder. Who is heard: by default only the person's own chat ("Mensagem para você"), so nobody else who
// writes to the number talks to the Aurora; with a number of its own, the chat that sends the pairing code.
// Not the official Business API (that one needs a company account and a public address for webhooks).
import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { personalFolders } from "./fileAccess.js";
import { TYPED_NO, TYPED_YES, agentsSummary, incoming, phoneConversation, registerChannel, replyChannel } from "./gateway.js";
import { approvalEvents, getApproval, resolveApproval } from "./pendingTurns.js";
import { getSetting, setSetting } from "./store.js";

const MAX_FILE = 50 * 1024 * 1024;
const MAX_TEXT = 4000;
// `gen` numbers each connection: the events of an older socket (its late "close" after a reconnect) are
// ignored, so a stale socket can never wipe the live one or start a second session with the same login
// (two sessions make WhatsApp drop one, then the other — the endless reconnect that left it "desligado").
const state = { sock: null, status: "desligado", qr: null, me: null, error: null, env: process.env, handleChatTurn: null, sent: new Set(), wrongCodes: new Map(), stopping: false, gen: 0, retry: null, attempts: 0, lastClose: null, lastChat: null };

// Next to the Aurora's database (%APPDATA%\Harness Aurora; the temp folder in tests).
const authDir = (env = process.env) => join(env.HARNESS_DB_FILE ? dirname(env.HARNESS_DB_FILE) : join(env.APPDATA || homedir(), "Harness Aurora"), "whatsapp-auth");
const bare = (jid) => String(jid || "").replace(/:\d+(?=@)/, "");

/** What the settings screen shows: status, the QR (as an image) while pairing, the number, never the keys. */
export async function whatsappStatus() {
  const linked = await getSetting("whatsapp_chat");
  let qr = null;
  if (state.qr) { try { qr = await (await import("qrcode")).toDataURL(state.qr, { margin: 1, width: 240 }); } catch { qr = null; } }
  return { status: state.status, qr, number: state.me?.id ? bare(state.me.id).split("@")[0] : null, linked: Boolean(linked), mode: linked && linked !== "self" ? "numero" : "proprio", pairCode: linked ? null : await getSetting("whatsapp_pair_code"), error: state.error, lastClose: state.lastClose };
}

/** The chat the Aurora answers: the person's own chat ("self") or the one paired by code. */
async function isHeard(jid, alt = null) {
  const linked = await getSetting("whatsapp_chat");
  const ids = [jid, alt].filter(Boolean).map(bare);
  if (!linked || linked === "self") { const mine = [state.me?.id, state.me?.lid].filter(Boolean).map(bare); return ids.some((j) => mine.includes(j)); }
  return ids.includes(linked);
}
async function replyJid() {
  const linked = await getSetting("whatsapp_chat");
  if (linked && linked !== "self") return linked;
  // The person's own chat: the address it last wrote from (number or LID), else the number.
  return state.lastChat || bare(state.me?.id || "");
}

/** Sends to the phone; says why when it cannot (the test button shows it). */
async function send(text) {
  if (!state.sock || state.status !== "conectado") throw new Error(state.status === "aguardando_qr" ? "o WhatsApp ainda espera a leitura do QR" : `o WhatsApp não está conectado agora (${state.status}${state.lastClose ? `, última queda: ${state.lastClose.reason}` : ""})`);
  const jid = await replyJid();
  if (!jid) throw new Error("não sei para qual conversa mandar");
  for (let rest = String(text || "").trim() || "(sem texto)"; rest.length; rest = rest.slice(MAX_TEXT)) {
    const sent = await state.sock.sendMessage(jid, { text: rest.slice(0, MAX_TEXT) });
    if (sent?.key?.id) state.sent.add(sent.key.id);   // its own answer lands in the same chat: never a new request
  }
  return true;
}
async function sendFile(file) {
  if (!state.sock || state.status !== "conectado" || !existsSync(file) || statSync(file).size > MAX_FILE) return false;
  const sent = await state.sock.sendMessage(await replyJid(), { document: readFileSync(file), fileName: basename(file), mimetype: MIME[extname(file).toLowerCase()] || "application/octet-stream" });
  if (sent?.key?.id) state.sent.add(sent.key.id);
  return true;
}
const MIME = { ".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", ".png": "image/png", ".jpg": "image/jpeg", ".csv": "text/csv", ".txt": "text/plain", ".md": "text/markdown", ".html": "text/html" };

registerChannel("whatsapp", {
  label: "WhatsApp",
  linked: async () => state.status === "conectado" && Boolean(state.me?.id),
  send: (text) => send(text),
  sendFile: (file) => sendFile(file),
});

/** A file the phone sent, into Documentos\Aurora\Recebidos do celular (the same place as Telegram's). */
async function receiveFile(msg, name, download) {
  const buffer = await download(msg, "buffer", {});
  if (buffer.length > MAX_FILE) throw new Error("maior que 50 MB");
  const documents = personalFolders(state.env).find((f) => f.name === "Documentos")?.path || join(state.env.USERPROFILE || homedir(), "Documents");
  const dir = join(documents, "Aurora", "Recebidos do celular");
  mkdirSync(dir, { recursive: true });
  const clean = basename(String(name || "arquivo")).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_") || "arquivo";
  let file = join(dir, clean);
  for (let n = 2; existsSync(file); n += 1) file = join(dir, clean.replace(/(\.[^.]+)?$/, ` (${n})$1`));
  writeFileSync(file, buffer);
  return file;
}

/**
 * One message from WhatsApp: pairing (with a number of its own), a yes/no typed for a waiting request, a
 * command, or a turn. `download` is Baileys's downloadMediaMessage (injected in the tests).
 */
export async function handleMessage(msg, { env = state.env, handleChatTurn = state.handleChatTurn, download = null } = {}) {
  if (!msg?.key || msg.key.remoteJid === "status@broadcast" || state.sent.has(msg.key.id)) return;
  const jid = msg.key.remoteJid;
  const m = msg.message || {};
  const doc = m.documentMessage || m.documentWithCaptionMessage?.message?.documentMessage;
  const image = m.imageMessage;
  let text = String(m.conversation || m.extendedTextMessage?.text || doc?.caption || image?.caption || "").trim();
  const linked = await getSetting("whatsapp_chat");
  // A number of its own: the chat that sends the code shown in Configurações. Five wrong codes: ignored.
  if (linked !== "self" && !(await isHeard(jid, msg.key.remoteJidAlt))) {
    if (msg.key.fromMe || (state.wrongCodes.get(jid) || 0) >= 5) return;
    const code = await getSetting("whatsapp_pair_code");
    if (code && text === code) {
      await setSetting("whatsapp_chat", bare(jid)); await setSetting("whatsapp_pair_code", "");
      await send("Pronto! Esta conversa agora fala com a Aurora do seu computador. Os agentes também avisam aqui.");
    } else if (code && /^\d{4,8}$/.test(text)) state.wrongCodes.set(jid, (state.wrongCodes.get(jid) || 0) + 1);
    return;
  }
  if (!(await isHeard(jid, msg.key.remoteJidAlt))) return;
  if (linked === "self" || !linked) state.lastChat = bare(jid);
  if (!text && !doc && !image && !m.audioMessage) return;
  if (m.audioMessage) { await send("Ainda não consigo ouvir áudios por aqui. Mande por texto, por favor."); return; }
  if (/^\/?(ajuda|help)\b/i.test(text)) {
    await send("Escreva como escreveria no computador: \"organize meus Downloads\", \"resuma esse PDF\" (mande o arquivo com a legenda), \"faça uma planilha com…\". Os arquivos que eu criar chegam aqui. Quando eu precisar de autorização, responda sim ou não.\n/agentes mostra os seus agentes.");
    return;
  }
  if (/^\/agentes\b/i.test(text)) { await send(await agentsSummary()); return; }
  // "sim" / "não" while a request waits in the phone conversation answers it now.
  if (text && (TYPED_YES.test(text) || TYPED_NO.test(text))) {
    const convId = await phoneConversation();
    const approval = getApproval(convId);
    if (approval) { const yes = TYPED_YES.test(text); if (resolveApproval(convId, approval.id, yes)) await send(yes ? "Permitido. Continuando…" : "Negado."); return; }
  }
  if (doc || image) {
    let saved;
    try { saved = await receiveFile(msg, doc?.fileName || `foto_${Date.now()}.jpg`, download || (await import("@whiskeysockets/baileys")).downloadMediaMessage); }
    catch (e) { await send(`Não consegui receber o arquivo (${e.message}).`); return; }
    text = `${text || "Guardei este arquivo que mandei pelo celular. Diga em uma linha o que ele é."}\n\n(Arquivo recebido pelo celular e salvo em: ${saved})`;
  }
  if (!handleChatTurn) return;
  return incoming({ channel: "whatsapp", text, handleChatTurn, env, typing: () => state.sock?.sendPresenceUpdate?.("composing", jid) });
}

// A yes the phone conversation needs, asked here when WhatsApp is the channel in use (no buttons on WhatsApp Web).
async function onApproval({ conversationId: convId, summary }) {
  if (state.status !== "conectado" || convId !== (await phoneConversation()) || (await replyChannel()) !== "whatsapp") return;
  await send(`A Aurora quer: ${summary}\nResponda *sim* para permitir ou *não* para negar.`).catch(() => {});
}

/** Connects (or reconnects) with the saved login; without one, a QR to read appears in Configurações. */
export async function startWhatsapp({ env = process.env, handleChatTurn = null, createSocket = null } = {}) {
  if (!createSocket && (await getSetting("whatsapp_enabled")) !== "true") return false;
  stopWhatsapp();
  const gen = (state.gen += 1);
  state.env = env; state.handleChatTurn = handleChatTurn; state.stopping = false; state.error = null;
  const baileys = await import("@whiskeysockets/baileys");
  const dir = authDir(env);
  mkdirSync(dir, { recursive: true });
  const { state: auth, saveCreds } = await baileys.useMultiFileAuthState(dir);
  const make = createSocket || baileys.makeWASocket;
  const version = createSocket ? undefined : (await baileys.fetchLatestBaileysVersion().catch(() => null))?.version;
  // Baileys logs every frame as JSON on the console: only its errors.
  const logger = (await import("pino")).default({ level: "error" });
  if (gen !== state.gen) return false; // another start began while this one was loading
  const sock = make({ auth, logger, ...(version ? { version } : {}), browser: baileys.Browsers.windows("Aurora"), syncFullHistory: false, markOnlineOnConnect: false });
  state.sock = sock; state.status = "conectando";
  const live = () => gen === state.gen && state.sock === sock;
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (!live()) return; // an older socket's late event: never touches the live connection
    if (qr) { state.qr = qr; state.status = "aguardando_qr"; }
    if (connection === "open") {
      state.qr = null; state.status = "conectado"; state.me = sock.user || null; state.attempts = 0;
      // First time: the person's own chat, unless a pairing code is waiting for a number of its own.
      if (!(await getSetting("whatsapp_chat")) && !(await getSetting("whatsapp_pair_code"))) await setSetting("whatsapp_chat", "self");
    }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      state.status = "desligado"; state.sock = null;
      state.lastClose = { code: code ?? null, reason: closeReason(code, baileys.DisconnectReason), at: new Date().toISOString() };
      if (code === baileys.DisconnectReason.loggedOut) { state.error = "O WhatsApp desconectou este computador. Leia o QR de novo."; rmSync(dir, { recursive: true, force: true }); await setSetting("whatsapp_chat", ""); return; }
      // Another session took over with this login (WhatsApp Web opened elsewhere with the same pairing):
      // retrying would only fight it. Stop and say so.
      if (code === baileys.DisconnectReason.connectionReplaced) { state.error = "Outra sessão abriu com este mesmo pareamento e o WhatsApp fechou esta. Feche a outra (ou leia o QR de novo) e ligue outra vez."; return; }
      if (state.stopping) return;
      // One reconnect at a time, waiting longer after each failure (restart-required after pairing: at once).
      state.attempts += 1;
      const wait = code === baileys.DisconnectReason.restartRequired ? 500 : Math.min(60_000, 2000 * 2 ** Math.min(5, state.attempts - 1));
      clearTimeout(state.retry);
      state.retry = setTimeout(() => { if (gen === state.gen) void startWhatsapp({ env, handleChatTurn, createSocket }).catch((e) => { state.error = e.message; }); }, wait);
      state.retry.unref?.();
    }
  });
  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (!live() || type !== "notify") return;
    for (const msg of messages) void handleMessage(msg, { env, handleChatTurn }).catch((e) => { state.error = e.message; });
  });
  approvalEvents.off("requested", onApproval);
  approvalEvents.on("requested", onApproval);
  return true;
}

/** Turns WhatsApp on (QR on the screen) or off. `own: true` waits for a number of its own (pairing code). */
export async function enableWhatsapp({ own = false, env, handleChatTurn } = {}) {
  await setSetting("whatsapp_enabled", "true");
  if (own) { await setSetting("whatsapp_chat", ""); await setSetting("whatsapp_pair_code", String(randomInt(100000, 999999))); }
  await startWhatsapp({ env, handleChatTurn });
  return whatsappStatus();
}
export async function disableWhatsapp({ env = process.env } = {}) {
  stopWhatsapp();
  try { await state.sock?.logout?.(); } catch { /* already gone */ }
  rmSync(authDir(env), { recursive: true, force: true });
  for (const key of ["whatsapp_enabled", "whatsapp_chat", "whatsapp_pair_code"]) await setSetting(key, "");
  state.me = null; state.qr = null; state.error = null;
  return whatsappStatus();
}
function closeReason(code, R) {
  if (code === R.loggedOut) return "desconectado no celular";
  if (code === R.connectionReplaced) return "outra sessão com o mesmo pareamento";
  if (code === R.restartRequired) return "reinício pedido pelo WhatsApp";
  if (code === R.timedOut || code === R.connectionLost) return "conexão perdida";
  if (code === R.badSession) return "sessão inválida";
  return code ? `código ${code}` : "fechada";
}

export function stopWhatsapp() {
  state.stopping = true;
  clearTimeout(state.retry); state.retry = null;
  try { state.sock?.end?.(undefined); } catch { /* closed */ }
  state.sock = null; state.status = "desligado"; state.qr = null;
  approvalEvents.off("requested", onApproval);
}
/** For the tests: the state as a connected socket would leave it. */
export function _connectedForTest(sock, me) { state.sock = sock; state.status = "conectado"; state.me = me; state.sent.clear(); state.wrongCodes.clear(); state.lastChat = null; }
