// Direitos do titular (LGPD, art. 18): find everything the Aurora keeps about a person or a client
// (a name, a CPF, a CNPJ, an e-mail), export it, and erase it. What the Aurora keeps: memories, the
// conversations (the text, the titles and the tool steps with their arguments and results) and the
// person's profile ("Sobre você"). The company's own files are the company's, not the Aurora's: they
// are not touched here.
import { getDb } from "./db.js";
import { getSetting, setSetting } from "./store.js";

const MASK = "[removido a pedido do titular]";
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const digits = (s) => String(s || "").replace(/\D/g, "");

/** The ways the term may be written: as typed, and for a CPF/CNPJ/phone, its digits with or without dots. */
export function termPatterns(term) {
  const clean = String(term || "").trim();
  if (clean.length < 3) throw Object.assign(new Error("Digite pelo menos 3 caracteres (um nome, CPF, CNPJ ou e-mail)."), { status: 400 });
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const number = digits(clean);
  const patterns = [new RegExp(escape(clean).replace(/\s+/g, "\\s+"), "gi")];
  // 123.456.789-09 and 12345678909 are the same CPF.
  if (number.length >= 8 && number.length === clean.replace(/[\s.\-/()]/g, "").length) patterns.push(new RegExp(number.split("").join("[\\s.\\-/]?"), "g"));
  return patterns;
}

const matches = (text, patterns) => patterns.some((re) => { re.lastIndex = 0; return re.test(String(text || "")); });
const redact = (text, patterns) => patterns.reduce((out, re) => { re.lastIndex = 0; return out.replace(re, MASK); }, String(text || ""));

async function found(term) {
  const patterns = termPatterns(term);
  const db = await getDb();
  const memories = db.prepare(`SELECT id, scope, project_id, title, content, created_at FROM memories`).all()
    .filter((m) => matches(`${m.title}\n${m.content}`, patterns) || fold(`${m.title} ${m.content}`).includes(fold(term)));
  // Every message is checked (a local database): a CNPJ typed as digits must find "12.345.678/0001-90",
  // and a name typed without accents must find "Empório".
  const allMessages = db.prepare("SELECT m.id, m.conversation_id, m.role, m.content, m.execution, m.created_at, c.title FROM messages m JOIN conversations c ON c.id = m.conversation_id").all()
    .filter((m) => matches(`${m.content}\n${m.execution || ""}`, patterns) || fold(`${m.content}\n${m.execution || ""}`).includes(fold(term)));
  const conversations = db.prepare("SELECT id, title, project_id, created_at FROM conversations").all().filter((c) => matches(c.title, patterns) || fold(c.title).includes(fold(term)));
  const profileText = (await getSetting("user_profile")) || "";
  let learned = [];
  try { learned = JSON.parse((await getSetting("user_profile_learned")) || "[]"); } catch { /* none */ }
  const profile = [profileText, ...learned.map((l) => (typeof l === "string" ? l : JSON.stringify(l)))].filter((t) => matches(t, patterns) || fold(t).includes(fold(term)));
  return { patterns, memories, messages: allMessages, conversations, profile, learned, profileText };
}

/** What is kept about the term: counts and short excerpts (for the screen). */
export async function searchSubject(term) {
  const f = await found(term);
  const excerpt = (text) => {
    const value = String(text || "");
    const at = Math.max(0, fold(value).indexOf(fold(term)));
    return `${at > 40 ? "…" : ""}${value.slice(Math.max(0, at - 40), at + 80).replace(/\s+/g, " ")}${value.length > at + 80 ? "…" : ""}`;
  };
  return {
    term,
    memories: f.memories.map((m) => ({ id: m.id, scope: m.scope, title: m.title, excerpt: excerpt(m.content) })),
    conversations: [...new Map(f.messages.map((m) => [m.conversation_id, { id: m.conversation_id, title: m.title, messages: f.messages.filter((x) => x.conversation_id === m.conversation_id).length }])).values()],
    profile: f.profile.length,
    total: f.memories.length + f.messages.length + f.conversations.length + f.profile.length,
  };
}

/** Everything kept about the term, in full (the titular's copy, art. 18, II). */
export async function exportSubject(term) {
  const f = await found(term);
  return {
    format: "aurora-lgpd-export", version: 1, term, exportedAt: new Date().toISOString(),
    memories: f.memories,
    messages: f.messages.map(({ execution, ...m }) => ({ ...m, execution: execution ? JSON.parse(execution) : null })),
    conversations: f.conversations,
    profile: f.profile,
  };
}

/**
 * Erases the term everywhere the Aurora keeps it (art. 18, VI): the memories that mention it are
 * deleted; in conversations and the profile, each occurrence is replaced so the rest of the history
 * stays readable. Returns what changed.
 */
export async function eraseSubject(term, { confirm } = {}) {
  if (confirm !== true) throw Object.assign(new Error("Confirme a exclusão."), { status: 400 });
  const f = await found(term);
  const db = await getDb();
  const foldRedact = (text) => {
    // A term typed without accents ("emporio") also erases "Empório".
    let out = redact(text, f.patterns);
    const folded = fold(out);
    const needle = fold(term);
    let at = folded.indexOf(needle);
    while (at >= 0) { out = out.slice(0, at) + MASK + out.slice(at + needle.length); at = fold(out).indexOf(needle, at + MASK.length); }
    return out;
  };
  const deleteMemory = db.prepare("DELETE FROM memories WHERE id = ?");
  const deleteRelations = db.prepare("DELETE FROM memory_relations WHERE from_id = ? OR to_id = ?");
  for (const m of f.memories) { deleteRelations.run(m.id, m.id); deleteMemory.run(m.id); }
  const updateMessage = db.prepare("UPDATE messages SET content = ?, execution = ? WHERE id = ?");
  for (const m of f.messages) updateMessage.run(foldRedact(m.content), m.execution ? foldRedact(m.execution) : m.execution, m.id);
  const updateTitle = db.prepare("UPDATE conversations SET title = ? WHERE id = ?");
  for (const c of f.conversations) updateTitle.run(foldRedact(c.title), c.id);
  if (f.profile.length) {
    await setSetting("user_profile", foldRedact(f.profileText));
    await setSetting("user_profile_learned", JSON.stringify(f.learned.map((l) => (typeof l === "string" ? foldRedact(l) : JSON.parse(foldRedact(JSON.stringify(l)))))));
  }
  return { term, memoriesDeleted: f.memories.length, messagesRedacted: f.messages.length, conversationsRenamed: f.conversations.length, profileRedacted: f.profile.length > 0 };
}
