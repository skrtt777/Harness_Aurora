// The Aurora on the phone (OpenClaw's channels): a Telegram bot the person creates and links. Off until
// they paste the bot's token; then only the one chat that sent the pairing code is heard. A message
// from it is a turn in the "Celular (Telegram)" conversation and the answer goes back, with the files
// it created; an action that needs a yes comes as Permitir/Negar buttons; automatic agents report there.
import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { personalFolders } from "./fileAccess.js";
import { getSetting, setSetting, createConversation, getConversationWithMessages } from "./store.js";
import { approvalEvents, getApproval, resolveApproval } from "./pendingTurns.js";

const API = (env) => env.TELEGRAM_API_BASE || "https://api.telegram.org";
const MAX_TEXT = 4000;
const MAX_FILE = 20 * 1024 * 1024;

const state = { running: false, bot: null, error: null, controller: null, offset: 0, approvals: new Map(), env: process.env, wrongCodes: new Map() };

async function call(token, method, body, { env = process.env, signal } = {}) {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const response = await fetch(`${API(env)}/bot${token}/${method}`, {
    method: "POST", signal,
    ...(isForm ? { body } : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.description || `Telegram: HTTP ${response.status}`);
  return data.result;
}

/** What the settings screen shows: never the token itself. */
export async function telegramStatus() {
  const token = await getSetting("telegram_token");
  return {
    configured: Boolean(token), running: state.running, bot: state.bot, error: state.error,
    linked: Boolean(await getSetting("telegram_chat_id")),
    pairCode: (await getSetting("telegram_chat_id")) ? null : await getSetting("telegram_pair_code"),
  };
}

/** Saves the token after checking it with Telegram, and makes a pairing code. */
export async function connectTelegram(token, { env = process.env, handleChatTurn } = {}) {
  const clean = String(token || "").trim();
  if (!/^\d{5,}:[\w-]{30,}$/.test(clean)) throw Object.assign(new Error("Esse não parece um token de bot do Telegram (ex.: 123456789:ABC…)."), { status: 400 });
  const me = await call(clean, "getMe", {}, { env });
  await setSetting("telegram_token", clean);
  await setSetting("telegram_chat_id", "");
  await setSetting("telegram_pair_code", String(randomInt(100000, 999999)));
  state.bot = me.username || me.first_name || null;
  // The bot's Menu button: the two commands a person may not guess.
  await call(clean, "setMyCommands", { commands: [{ command: "agentes", description: "Ver seus agentes e a última vez de cada um" }, { command: "ajuda", description: "Como usar a Aurora pelo celular" }] }, { env }).catch(() => {});
  await startTelegram({ env, handleChatTurn });
  return telegramStatus();
}

export async function disconnectTelegram() {
  stopTelegram();
  for (const key of ["telegram_token", "telegram_chat_id", "telegram_pair_code"]) await setSetting(key, "");
  state.bot = null; state.error = null;
  return telegramStatus();
}

async function conversationId() {
  const saved = await getSetting("telegram_conversation_id");
  if (saved && (await getConversationWithMessages(saved).catch(() => null))) return saved;
  const created = await createConversation({ provider: "local", title: "Celular (Telegram)" });
  await setSetting("telegram_conversation_id", created.id);
  return created.id;
}

/** Sends text (split at Telegram's limit) to the linked chat. Quietly nothing when not linked. */
export async function sendToPhone(text, { env = process.env, buttons = null } = {}) {
  const token = await getSetting("telegram_token");
  const chat = await getSetting("telegram_chat_id");
  if (!token || !chat) return false;
  const parts = [];
  for (let rest = String(text || "").trim() || "(sem texto)"; rest.length; rest = rest.slice(MAX_TEXT)) parts.push(rest.slice(0, MAX_TEXT));
  for (const [i, part] of parts.entries()) {
    await call(token, "sendMessage", { chat_id: chat, text: part, ...(buttons && i === parts.length - 1 ? { reply_markup: { inline_keyboard: [buttons] } } : {}) }, { env });
  }
  return true;
}

async function sendFile(token, chat, file, env) {
  if (!existsSync(file) || statSync(file).size > MAX_FILE) return false;
  const form = new FormData();
  form.append("chat_id", String(chat));
  form.append("document", new Blob([readFileSync(file)]), basename(file));
  await call(token, "sendDocument", form, { env });
  return true;
}

/** Downloads a file the phone sent (Telegram serves up to 20 MB) into Documentos\Aurora\Recebidos do celular. */
export async function receiveFile(token, attachment, env = process.env) {
  if ((attachment.file_size || 0) > MAX_FILE) throw new Error("maior que 20 MB");
  const info = await call(token, "getFile", { file_id: attachment.file_id }, { env });
  const response = await fetch(`${API(env)}/file/bot${token}/${info.file_path}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const documents = personalFolders(env).find((f) => f.name === "Documentos")?.path || join(env.USERPROFILE || homedir(), "Documents");
  const dir = join(documents, "Aurora", "Recebidos do celular");
  mkdirSync(dir, { recursive: true });
  const name = basename(String(attachment.file_name || basename(info.file_path || "arquivo"))).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_") || "arquivo";
  let file = join(dir, name);
  for (let n = 2; existsSync(file); n += 1) file = join(dir, name.replace(/(\.[^.]+)?$/, ` (${n})$1`));
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  return file;
}

/** Files a turn wrote ("Criei C:\…\x.xlsx (XLSX, …)"), to send along with the answer. */
export function deliveredFiles(execution) {
  const steps = execution?.toolSteps || [];
  return [...new Set(steps.filter((s) => s.ok && ["write_document", "write_file", "edit_file"].includes(s.tool))
    .map((s) => /^(?:Criei|Salvei|Editei) (.+?)(?: \(|\.$)/.exec(s.summary || "")?.[1]).filter(Boolean))];
}

/** One update from Telegram: pairing, a message (a turn), or a button press (an approval). */
export async function handleUpdate(update, { env = process.env, handleChatTurn }) {
  const token = await getSetting("telegram_token");
  if (!token) return;
  const linked = await getSetting("telegram_chat_id");
  if (update.callback_query) {
    const q = update.callback_query;
    if (String(q.message?.chat?.id) !== linked) return;
    const target = state.approvals.get(q.data);
    const ok = target ? resolveApproval(target.conversationId, target.id, target.approved) : false;
    state.approvals.delete(q.data);
    await call(token, "answerCallbackQuery", { callback_query_id: q.id, text: ok ? (target.approved ? "Permitido" : "Negado") : "Esse pedido já expirou." }, { env }).catch(() => {});
    return;
  }
  const message = update.message;
  const chat = String(message?.chat?.id || "");
  const attachment = message?.document || (message?.photo?.length ? { ...message.photo.at(-1), file_name: `foto_${message.message_id || Date.now()}.jpg` } : null);
  let text = String(message?.text || message?.caption || "").trim();
  if (!chat || (!text && !attachment && !message?.voice && !message?.audio && !message?.video_note)) return;
  if (!linked) {
    // Pairing: the code shown in Configurações, from the person's own chat with the bot. Five wrong
    // codes and that chat is no longer answered (a 6-digit code must not be guessable by trying).
    if ((state.wrongCodes.get(chat) || 0) >= 5) return;
    const code = await getSetting("telegram_pair_code");
    const sent = text.replace(/^\/start\s*/, "").trim();
    if (code && sent && sent !== code && /^\d{4,8}$/.test(sent)) state.wrongCodes.set(chat, (state.wrongCodes.get(chat) || 0) + 1);
    if (code && sent === code) {
      await setSetting("telegram_chat_id", chat);
      await setSetting("telegram_pair_code", "");
      await call(token, "sendMessage", { chat_id: chat, text: "Pronto! Este chat agora fala com a Aurora do seu computador. Os agentes também avisam aqui." }, { env });
    } else {
      await call(token, "sendMessage", { chat_id: chat, text: "Para ligar este chat, mande o código que aparece na Aurora em Configurações → Celular." }, { env });
    }
    return;
  }
  if (chat !== linked) return; // anyone else who finds the bot is ignored
  if (/^\/start\b/.test(text)) return;
  if (message?.voice || message?.audio || message?.video_note) {
    await sendToPhone("Ainda não consigo ouvir áudios por aqui. Mande por texto, por favor.", { env });
    return;
  }
  if (/^\/(ajuda|help)\b/i.test(text)) {
    await sendToPhone("Escreva como escreveria no computador: \"organize meus Downloads\", \"resuma esse PDF\" (mande o arquivo com a legenda), \"faça uma planilha com…\".\nOs arquivos que eu criar chegam aqui. Quando eu precisar de autorização, aparecem os botões Permitir e Negar.\n/agentes mostra os seus agentes.", { env });
    return;
  }
  if (/^\/agentes\b/i.test(text)) {
    await sendToPhone(await agentsSummary(), { env });
    return;
  }
  // A file or photo from the phone lands in Documentos\Aurora\Recebidos do celular; the caption is the request.
  if (attachment) {
    let saved;
    try { saved = await receiveFile(token, attachment, env); } catch (e) { await sendToPhone(`Não consegui receber o arquivo (${e.message}).`, { env }); return; }
    text = `${text || "Guardei este arquivo que mandei pelo celular. Diga em uma linha o que ele é."}\n\n(Arquivo recebido pelo celular e salvo em: ${saved})`;
  }
  const id = await conversationId();
  await call(token, "sendChatAction", { chat_id: chat, action: "typing" }, { env }).catch(() => {});
  // A person is on the other end (the buttons answer approvals): not an automatic run.
  const turn = await handleChatTurn({ conversationId: id, message: text, env });
  const answer = turn?.message?.content || turn?.error || "Não consegui responder agora.";
  await sendToPhone(answer, { env });
  for (const file of deliveredFiles(turn?.message?.execution).slice(0, 5)) await sendFile(token, chat, file, env).catch(() => {});
}

/** "/agentes": each agent, on or off, and its last run, in a few lines. */
export async function agentsSummary() {
  const { listAgents, listRuns } = await import("./agents.js");
  const agents = await listAgents();
  if (!agents.length) return "Você ainda não tem agentes. Crie um na Aurora, em Agentes.";
  const lines = [];
  for (const agent of agents.slice(0, 15)) {
    const last = (await listRuns({ agentId: agent.id, limit: 1 }).catch(() => []))[0];
    const when = last ? new Date(last.startedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : null;
    lines.push(`• ${agent.name}${agent.enabled ? "" : " (desligado)"}${last ? ` — última vez ${when}: ${last.quiet ? "nada novo" : last.status === "done" ? "concluída" : last.status === "running" ? "trabalhando agora" : "não terminou"}` : " — ainda não trabalhou"}`);
  }
  return `Seus agentes:\n${lines.join("\n")}`;
}

/** An automatic agent's result on the phone: what it said and the files it delivered. */
export async function notifyRunOnPhone(agent, run, { env = process.env } = {}) {
  const token = await getSetting("telegram_token");
  const chat = await getSetting("telegram_chat_id");
  if (!token || !chat || !run) return false;
  const text = run.status === "done" ? `${agent.name}:\n${String(run.answer || "Terminou.").slice(0, 3500)}` : `${agent.name} não conseguiu terminar: ${String(run.error || run.answer || "erro").slice(0, 500)}`;
  await sendToPhone(text, { env });
  for (const file of (run.files || []).slice(0, 5)) await sendFile(token, chat, file, env).catch(() => {});
  return true;
}

// A yes/no the phone's conversation needs: Permitir / Negar buttons.
async function onApproval({ conversationId: convId, summary }) {
  if (!state.running || convId !== (await getSetting("telegram_conversation_id"))) return;
  const approval = getApproval(convId);
  if (!approval) return;
  const key = (yes) => `ap${yes ? 1 : 0}:${approval.id.slice(0, 20)}`;
  state.approvals.set(key(true), { conversationId: convId, id: approval.id, approved: true });
  state.approvals.set(key(false), { conversationId: convId, id: approval.id, approved: false });
  await sendToPhone(`A Aurora quer: ${summary}\nPermite?`, { env: state.env, buttons: [{ text: "Permitir", callback_data: key(true) }, { text: "Negar", callback_data: key(false) }] }).catch(() => {});
}

/** Long polling while a token is saved (desktop app only). */
export async function startTelegram({ env = process.env, handleChatTurn } = {}) {
  stopTelegram();
  const token = await getSetting("telegram_token");
  if (!token || !handleChatTurn) return false;
  const controller = new AbortController();
  state.controller = controller; state.running = true; state.error = null; state.env = env;
  approvalEvents.on("requested", onApproval);
  if (!state.bot) state.bot = (await call(token, "getMe", {}, { env }).catch(() => null))?.username || null;
  (async () => {
    let backoff = 1000;
    while (!controller.signal.aborted) {
      try {
        const updates = await call(token, "getUpdates", { offset: state.offset, timeout: Number(env.TELEGRAM_POLL_SECONDS ?? 25) }, { env, signal: controller.signal });
        backoff = 1000; state.error = null;
        for (const update of updates) {
          state.offset = update.update_id + 1;
          // One at a time: the conversation is one, and a turn can take a while.
          await handleUpdate(update, { env, handleChatTurn }).catch((e) => { state.error = e.message; });
        }
      } catch (e) {
        if (controller.signal.aborted) break;
        state.error = e.message;
        await new Promise((r) => setTimeout(r, backoff).unref?.());
        backoff = Math.min(backoff * 2, 60_000);
      }
    }
  })();
  return true;
}

export function stopTelegram() {
  state.controller?.abort();
  state.controller = null;
  state.running = false;
  approvalEvents.off("requested", onApproval);
}
