import { randomUUID } from "node:crypto";
import { CARD_FIELDS, applyOverrides, knowledgeDb } from "./knowledge.js";
import { httpError } from "./httpSecurity.js";
import { getSetting } from "./store.js";
import { callTeacher } from "./teacher.js";
import { spendTeacherCall, teacherSettings } from "./teachingLoop.js";

/**
 * The paid teacher reviews how the LOCAL model filed a department's
 * documents (docs/CONHECIMENTO_EMPRESA.md): it gets only the cards — title,
 * type, category, summary, keywords, flow and the file's path — never the
 * documents' text, and proposes corrections. Nothing changes until the
 * person accepts a suggestion; accepted ones are kept on the card and become
 * examples the local model follows when it files the next documents.
 */

const MAX_DOCS = 60;
const CARD_TYPES = ["comunicado", "politica", "procedimento", "planilha", "formulario", "apresentacao", "contatos", "contrato", "relatorio", "outro"];
const clip = (text, max) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function buildCardReviewPrompt({ department, docs }) {
  const list = docs.map((d, i) => JSON.stringify({ n: i + 1, arquivo: d.relPath, categoria: d.category.split("/").slice(1).join("/"), tipo: d.card.type, titulo: d.card.title, resumo: d.card.summary, palavras_chave: d.card.keywords, fluxo: d.card.flow?.length ? d.card.flow : undefined })).join("\n");
  return [
    `Você revisa como uma IA local pequena organizou os documentos do departamento ${department}. Para cada documento ela escreveu uma ficha (abaixo, uma por linha, numeradas). Você NÃO vê o texto dos documentos, só as fichas e o caminho do arquivo.`,
    "Procure: categoria errada ou incoerente com as outras (ex.: uma confraternização em \"Férias\"), categorias duplicadas com nomes diferentes, título vago, resumo que não diz o essencial, palavras-chave que faltam (sinônimos que alguém usaria para pedir esse documento), tipo errado.",
    "A categoria é o assunto em 1 a 3 palavras, sem barras. Prefira as categorias que já existem; crie uma nova só se várias fichas pedirem. Não invente fatos (datas, valores, nomes) que não estejam na ficha.",
    "",
    "Responda SOMENTE um objeto JSON válido, sem markdown:",
    '{"taxonomia":"1 a 3 frases sobre como as categorias deveriam ficar","correcoes":[{"n":3,"campo":"categoria|titulo|resumo|palavras_chave|tipo|fluxo","valor":"novo valor (lista de textos para palavras_chave e fluxo)","motivo":"curto"}]}',
    `Tipos válidos: ${CARD_TYPES.join(", ")}. No máximo 40 correções; só as que melhoram de verdade. Se estiver tudo bem, "correcoes": [].`,
    "",
    `Fichas:\n${list}`,
  ].join("\n");
}

const FIELDS = { categoria: "category", titulo: "title", resumo: "summary", palavras_chave: "keywords", tipo: "type", fluxo: "flow" };

/** Teacher JSON → validated suggestions keyed to the documents shown to it. */
export function parseCardReview(text, docs) {
  const match = String(text || "").match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed;
  try { parsed = JSON.parse(match[0]); } catch { return null; }
  if (!Array.isArray(parsed?.correcoes)) return null;
  const suggestions = [];
  for (const fix of parsed.correcoes.slice(0, 40)) {
    const doc = docs[Number(fix?.n) - 1];
    const field = FIELDS[fix?.campo];
    if (!doc || !field) continue;
    let value;
    if (field === "keywords" || field === "flow") {
      const list = (Array.isArray(fix.valor) ? fix.valor : String(fix.valor || "").split(/[,;\n]/)).map((v) => clip(v, field === "flow" ? 300 : 40)).filter(Boolean);
      value = list.slice(0, field === "flow" ? 20 : 10);
      if (!value.length) continue;
    } else if (field === "type") {
      value = clip(fix.valor, 20).toLowerCase();
      if (!CARD_TYPES.includes(value)) continue;
    } else if (field === "category") {
      value = clip(fix.valor, 60).replace(/\//g, "-");
      if (!value || value.split(" ").length > 4) continue;
    } else value = clip(fix.valor, field === "title" ? 120 : 600);
    if (!value) continue;
    const previous = field === "category" ? doc.category.split("/").slice(1).join("/") : doc.card[field];
    if (JSON.stringify(previous) === JSON.stringify(value)) continue;
    suggestions.push({ docId: doc.id, field, previous: previous ?? null, value, reason: clip(fix.motivo, 300) });
  }
  return { taxonomy: clip(parsed.taxonomia, 800), suggestions };
}

/**
 * Sends a source's cards to the teacher and stores its suggestions as
 * pending (replacing the previous pending ones). A source not cleared for
 * paid AI needs `authorized` — the person confirmed in the UI.
 */
export async function reviewSourceCards(sourceId, { authorized = false, provider, env = process.env, signal, call = callTeacher } = {}) {
  const db = await knowledgeDb();
  const source = db.prepare("SELECT * FROM knowledge_sources WHERE id = ?").get(sourceId);
  if (!source) throw httpError(404, "Fonte não encontrada.");
  if (!source.paid_allowed && !authorized) throw httpError(403, "Esta pasta não está liberada para IA paga. Confirme para enviar as fichas (título, resumo, palavras-chave; não o texto dos documentos).");
  // Cards never reviewed first, then the oldest reviews.
  const docs = db.prepare("SELECT id, rel_path, category, card FROM knowledge_docs WHERE source_id = ? AND error IS NULL AND card IS NOT NULL").all(sourceId)
    .map((r) => ({ id: r.id, relPath: r.rel_path, category: r.category, card: JSON.parse(r.card) }))
    .sort((a, b) => String(a.card.reviewedAt || "").localeCompare(String(b.card.reviewedAt || "")) || a.relPath.localeCompare(b.relPath))
    .slice(0, MAX_DOCS);
  if (!docs.length) throw httpError(400, "Nenhum documento com ficha nesta pasta. Atualize a indexação primeiro.");
  const settings = await teacherSettings();
  if (settings.usedToday >= settings.dailyLimit) throw httpError(429, `Limite diário do professor atingido (${settings.dailyLimit} chamadas).`);
  const teacher = (provider || await getSetting("default_teacher", "codex")) === "claude" ? "claude" : "codex";
  await spendTeacherCall();
  const started = Date.now();
  const response = await call({ provider: teacher, env, signal, prompt: buildCardReviewPrompt({ department: source.department, docs }) });
  if (!response.ok) throw httpError(502, `O professor não respondeu: ${response.error || "erro desconhecido"}`);
  const review = parseCardReview(response.text, docs);
  if (!review) throw httpError(502, "Resposta do professor inválida.");
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM knowledge_suggestions WHERE source_id = ? AND status = 'pending'").run(sourceId);
    const insert = db.prepare("INSERT INTO knowledge_suggestions(id,source_id,doc_id,field,previous,value,reason,teacher,status,created_at) VALUES(?,?,?,?,?,?,?,?,'pending',?)");
    for (const s of review.suggestions) insert.run(randomUUID(), sourceId, s.docId, s.field, JSON.stringify(s.previous), JSON.stringify(s.value), s.reason, teacher, now);
    const mark = db.prepare("UPDATE knowledge_docs SET card = ? WHERE id = ?");
    for (const doc of docs) mark.run(JSON.stringify({ ...doc.card, reviewedAt: now }), doc.id);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return { teacher, reviewed: docs.length, taxonomy: review.taxonomy, suggestions: review.suggestions.length, ms: Date.now() - started };
}

export async function listSuggestions({ sourceId, status = "pending" } = {}) {
  const db = await knowledgeDb();
  return db.prepare(`SELECT s.*, d.rel_path, d.card FROM knowledge_suggestions s JOIN knowledge_docs d ON d.id = s.doc_id WHERE s.status = ?${sourceId ? " AND s.source_id = ?" : ""} ORDER BY d.rel_path, s.field`).all(...(sourceId ? [status, sourceId] : [status]))
    .map((r) => ({ id: r.id, sourceId: r.source_id, docId: r.doc_id, relPath: r.rel_path, title: JSON.parse(r.card || "{}").title || r.rel_path, field: r.field, previous: JSON.parse(r.previous ?? "null"), value: JSON.parse(r.value), reason: r.reason, teacher: r.teacher, status: r.status, createdAt: r.created_at }));
}

/** Accept: the correction goes on the card (and survives re-indexing). Reject: it's dropped. */
export async function decideSuggestion(id, action) {
  if (!["accept", "reject"].includes(action)) throw httpError(400, "Ação inválida (use accept ou reject).");
  const db = await knowledgeDb();
  const row = db.prepare("SELECT s.*, d.card, d.category, k.department FROM knowledge_suggestions s JOIN knowledge_docs d ON d.id = s.doc_id JOIN knowledge_sources k ON k.id = s.source_id WHERE s.id = ?").get(id);
  if (!row) throw httpError(404, "Sugestão não encontrada.");
  if (row.status !== "pending") throw httpError(409, "Essa sugestão já foi decidida.");
  if (!CARD_FIELDS.includes(row.field)) throw httpError(400, "Campo inválido.");
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    if (action === "accept") {
      const card = JSON.parse(row.card || "{}");
      const mapped = applyOverrides({ category: row.category, card }, { ...(card.overrides || {}), [row.field]: JSON.parse(row.value) }, row.department);
      db.prepare("UPDATE knowledge_docs SET category = ?, card = ? WHERE id = ?").run(mapped.category, JSON.stringify(mapped.card), row.doc_id);
    }
    db.prepare("UPDATE knowledge_suggestions SET status = ?, decided_at = ? WHERE id = ?").run(action === "accept" ? "accepted" : "rejected", now, id);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return { ok: true, status: action === "accept" ? "accepted" : "rejected" };
}
