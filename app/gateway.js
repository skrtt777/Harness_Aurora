// The gateway (docs/VISAO_HARNESS_2.0.md, phase 1; OpenClaw's and Hermes's idea): every messaging channel
// (Telegram, WhatsApp…) is a door into the same Aurora. One phone conversation for all of them — started on
// Telegram, it goes on in WhatsApp — and the answer, the files and the questions that need a yes go back
// through the channel the person used last. Each channel only knows how to receive and send its messages.
import { createConversation, getConversationWithMessages, getSetting, setSetting } from "./store.js";

// The phone conversation's id keeps its historical key (it began as Telegram's).
const CONVERSATION_KEY = "telegram_conversation_id";
const LAST_CHANNEL_KEY = "gateway_last_channel";
const channels = new Map(); // id -> { label, linked(): Promise<bool>, send(text, { choices }), sendFile(path) }
let queue = Promise.resolve();

/** A channel joins the gateway (or leaves, with `null`). */
export function registerChannel(id, channel) {
  if (channel) channels.set(id, channel); else channels.delete(id);
}
export const channelIds = () => [...channels.keys()];

/** The one conversation the phone channels share. */
export async function phoneConversation() {
  const saved = await getSetting(CONVERSATION_KEY);
  if (saved && (await getConversationWithMessages(saved).catch(() => null))) return saved;
  const created = await createConversation({ provider: "local", title: "Celular" });
  await setSetting(CONVERSATION_KEY, created.id);
  return created.id;
}

/** The channel the person wrote from last, if it is still linked; else the first linked one. */
export async function replyChannel() {
  const last = await getSetting(LAST_CHANNEL_KEY);
  if (last && channels.has(last) && (await channels.get(last).linked().catch(() => false))) return last;
  for (const [id, ch] of channels) if (await ch.linked().catch(() => false)) return id;
  return null;
}

/**
 * Text to the phone: through `channel` (or the one used last). `choices` (["Permitir", "Negar"]) become
 * buttons where the channel has them, a line to answer where it does not. False when nothing is linked.
 */
export async function sendToPhone(text, { channel = null, choices = null, onChoice = null } = {}) {
  const id = channel || (await replyChannel());
  const ch = id ? channels.get(id) : null;
  if (!ch) return false;
  const sent = await ch.send(String(text || "").trim() || "(sem texto)", { choices, onChoice });
  return sent !== false;
}
export async function sendFileToPhone(file, { channel = null } = {}) {
  const id = channel || (await replyChannel());
  const ch = id ? channels.get(id) : null;
  return ch?.sendFile ? ch.sendFile(file).catch(() => false) : false;
}

/** Files a turn wrote ("Criei C:\…\x.xlsx (XLSX, …)"), to send along with the answer. */
export function deliveredFiles(execution) {
  const steps = execution?.toolSteps || [];
  return [...new Set(steps.filter((s) => s.ok && ["write_document", "write_file", "edit_file"].includes(s.tool))
    .map((s) => /^(?:Criei|Salvei|Editei) (.+?)(?: \(|\.$)/.exec(s.summary || "")?.[1]).filter(Boolean))];
}

/**
 * A message from a channel: a turn in the phone conversation, one at a time for all channels together,
 * the answer and up to 5 files back through the same channel. `typing()` is the channel's "digitando…".
 */
export function incoming({ channel, text, handleChatTurn, env = process.env, typing = null }) {
  const run = async () => {
    await setSetting(LAST_CHANNEL_KEY, channel);
    const id = await phoneConversation();
    await typing?.().catch?.(() => {});
    const turn = await handleChatTurn({ conversationId: id, message: text, env });
    const answer = turn?.message?.content || turn?.error || "Não consegui responder agora.";
    await sendToPhone(answer, { channel });
    for (const file of deliveredFiles(turn?.message?.execution).slice(0, 5)) await sendFileToPhone(file, { channel });
    return turn;
  };
  queue = queue.then(run, run);
  return queue;
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

/** An automatic agent's result on the phone (the channel used last): what it said and its files. */
export async function notifyRunOnPhone(agent, run) {
  if (!run || !(await replyChannel())) return false;
  const text = run.status === "done" ? `${agent.name}:\n${String(run.answer || "Terminou.").slice(0, 3500)}` : `${agent.name} não conseguiu terminar: ${String(run.error || run.answer || "erro").slice(0, 500)}`;
  await sendToPhone(text);
  for (const file of (run.files || []).slice(0, 5)) await sendFileToPhone(file);
  return true;
}

// "Permitido", "pode", "sim" (or "não") typed while the Aurora waits for a yes, from any channel.
export const TYPED_YES = /^(permitid[oa]|permit[oe]|permitir|pode(?: sim| fazer| ir| seguir| continuar)?|sim|ok|okay|autorizad[oa]|autorizo|liberad[oa]|libero|confirm[oa]|confirmad[oa]|manda ver|vai|faz|fa[cç]a)[\s.!]*$/i;
export const TYPED_NO = /^(n[ãa]o|nega(?:do)?|negar|recus[oa]|cancela(?:r)?|n[ãa]o pode|para)[\s.!]*$/i;
