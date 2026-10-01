import { createHash, randomUUID } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { getDb } from "./db.js";
import { cosineSimilarity, decodeEmbedding, embedText, encodeEmbedding, resolveEmbeddingModel } from "./embeddings.js";
import { extractText, isDocument } from "./docText.js";
import { httpError } from "./httpSecurity.js";
import { runLocal } from "./local.js";

/**
 * Company knowledge (docs/CONHECIMENTO_EMPRESA.md). Folders on the network
 * (\\server\RH) or SharePoint libraries synced by OneDrive are registered as
 * sources of a department. An incremental indexer extracts the text of every
 * document, cuts it into passages (searchable by words and by meaning) and the
 * LOCAL model writes a card per document — category, summary, dates and, for
 * procedures, the step-by-step flow — so the department's knowledge ends up
 * organized by category. Everything stays on this machine; paid models only
 * see it when the source allows it or the person approves.
 *
 * Access: the indexer runs as the logged-in Windows user, so it only reads
 * what that person can already open, and the index lives in their profile.
 */

const CHUNK_CHARS = 900;
const CHUNK_OVERLAP = 150;
const MAX_WALK = 50_000;
const SKIP = /(^~\$|^\.|^thumbs\.db$|^desktop\.ini$)/i;
const jobs = new Map();

async function ready() {
  const db = await getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_sources(id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, department TEXT NOT NULL, paid_allowed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, indexed_at TEXT, last_error TEXT);
    CREATE TABLE IF NOT EXISTS knowledge_docs(id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE, path TEXT NOT NULL, rel_path TEXT NOT NULL, mtime_ms REAL NOT NULL, size INTEGER NOT NULL, hash TEXT, category TEXT, card TEXT, chars INTEGER NOT NULL DEFAULT 0, error TEXT, indexed_at TEXT NOT NULL, UNIQUE(source_id, path));
    CREATE TABLE IF NOT EXISTS knowledge_chunks(id TEXT PRIMARY KEY, doc_id TEXT NOT NULL REFERENCES knowledge_docs(id) ON DELETE CASCADE, ord INTEGER NOT NULL, text TEXT NOT NULL, embedding BLOB, embedding_model TEXT);
    CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_doc ON knowledge_chunks(doc_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(chunk_id UNINDEXED, text, tokenize='unicode61 remove_diacritics 2');`);
  return db;
}

const mapSource = (row, db) => row && {
  id: row.id, name: row.name, path: row.path, department: row.department, paidAllowed: !!row.paid_allowed,
  createdAt: row.created_at, indexedAt: row.indexed_at, lastError: row.last_error,
  documents: db.prepare("SELECT count(*) n FROM knowledge_docs WHERE source_id = ? AND error IS NULL").get(row.id).n,
  failed: db.prepare("SELECT count(*) n FROM knowledge_docs WHERE source_id = ? AND error IS NOT NULL").get(row.id).n,
  job: jobs.get(row.id)?.progress || null,
};

export async function listSources() {
  const db = await ready();
  return db.prepare("SELECT * FROM knowledge_sources ORDER BY department, name").all().map((r) => mapSource(r, db));
}

export async function getSource(id) {
  const db = await ready();
  return mapSource(db.prepare("SELECT * FROM knowledge_sources WHERE id = ?").get(id), db);
}

export async function createSource({ name, path, department, paidAllowed = false }) {
  const folder = String(path || "").trim();
  if (!/^(\\\\|[a-zA-Z]:[\\/]|\/)/.test(folder)) throw httpError(400, "Informe o caminho completo da pasta (ex.: \\\\servidor\\RH ou C:\\Users\\você\\Empresa\\RH).");
  const info = await stat(folder).catch(() => null);
  if (!info?.isDirectory()) throw httpError(400, "A pasta não existe ou você não tem acesso a ela.");
  const db = await ready();
  const id = randomUUID();
  db.prepare("INSERT INTO knowledge_sources(id,name,path,department,paid_allowed,created_at) VALUES(?,?,?,?,?,?)")
    .run(id, String(name || basename(folder)).trim().slice(0, 120) || basename(folder), folder, String(department || "Geral").trim().slice(0, 80) || "Geral", paidAllowed ? 1 : 0, new Date().toISOString());
  return getSource(id);
}

export async function updateSource(id, patch) {
  const db = await ready();
  const row = db.prepare("SELECT * FROM knowledge_sources WHERE id = ?").get(id);
  if (!row) throw httpError(404, "Fonte não encontrada.");
  db.prepare("UPDATE knowledge_sources SET name = ?, department = ?, paid_allowed = ? WHERE id = ?").run(
    patch.name !== undefined ? String(patch.name).trim().slice(0, 120) || row.name : row.name,
    patch.department !== undefined ? String(patch.department).trim().slice(0, 80) || row.department : row.department,
    patch.paidAllowed !== undefined ? (patch.paidAllowed ? 1 : 0) : row.paid_allowed, id);
  return getSource(id);
}

export async function deleteSource(id) {
  jobs.get(id)?.controller.abort();
  const db = await ready();
  const chunkIds = db.prepare("SELECT c.id FROM knowledge_chunks c JOIN knowledge_docs d ON d.id = c.doc_id WHERE d.source_id = ?").all(id).map((r) => r.id);
  const dropFts = db.prepare("DELETE FROM knowledge_fts WHERE chunk_id = ?");
  db.exec("BEGIN");
  try {
    for (const chunk of chunkIds) dropFts.run(chunk);
    db.prepare("DELETE FROM knowledge_chunks WHERE doc_id IN (SELECT id FROM knowledge_docs WHERE source_id = ?)").run(id);
    db.prepare("DELETE FROM knowledge_docs WHERE source_id = ?").run(id);
    const removed = db.prepare("DELETE FROM knowledge_sources WHERE id = ?").run(id).changes > 0;
    db.exec("COMMIT");
    return removed;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

/** Passages of ~900 chars on paragraph boundaries, each labelled with its source. */
export function chunkText(text, label) {
  const paragraphs = String(text).split(/\n\s*\n|\n(?=#)|\n/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 1 > CHUNK_CHARS) {
      chunks.push(current);
      current = current.slice(-CHUNK_OVERLAP);
    }
    current = current ? `${current}\n${paragraph}` : paragraph;
    while (current.length > CHUNK_CHARS * 1.5) { chunks.push(current.slice(0, CHUNK_CHARS)); current = current.slice(CHUNK_CHARS - CHUNK_OVERLAP); }
  }
  if (current.trim()) chunks.push(current);
  return chunks.map((c) => `[${label}]\n${c}`);
}

async function* walkDocs(root, signal) {
  const stack = [root];
  let seen = 0;
  while (stack.length && !signal?.aborted) {
    const dir = stack.pop();
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (++seen > MAX_WALK || SKIP.test(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile() && isDocument(path)) yield path;
    }
  }
}

const CARD_TYPES = ["comunicado", "politica", "procedimento", "planilha", "formulario", "apresentacao", "contatos", "contrato", "relatorio", "outro"];

/** The local model reads a document and files it: category, summary, dates, flow. */
export async function mapDocument({ relPath, text, department, categories = [], env = process.env, signal, ask = runLocal }) {
  const folderHint = dirname(relPath) === "." ? "" : dirname(relPath).split(sep).join("/");
  const prompt = [
    `Você organiza os documentos do departamento ${department}. Leia o documento e responda SOMENTE um JSON com os campos categoria (assunto em 1 a 3 palavras), tipo (${CARD_TYPES.join(", ")}), titulo, resumo (2 frases com o essencial: datas, valores, prazos — copie números exatamente como estão), palavras_chave (5 a 8 termos, incluindo sinônimos que alguém usaria para pedir isso), datas (só as do conteúdo) e fluxo (passo a passo, só se for procedimento; senão []).`,
    'Exemplo de formato (de OUTRO documento): {"categoria":"Treinamentos","tipo":"procedimento","titulo":"Inscrição em cursos","resumo":"Cursos externos precisam de aprovação do gestor. O reembolso é de até R$ 500 por ano.","palavras_chave":["curso","capacitação","reembolso","treinamento","educação"],"datas":[{"data":"31/03/2026","o_que":"prazo de inscrição"}],"fluxo":["Escolha o curso","Peça aprovação ao gestor","Envie o comprovante ao RH"]}',
    categories.length ? `Categorias já usadas neste departamento (reutilize se servir): ${categories.join(", ")}.` : "",
    folderHint ? `Pasta do arquivo: ${folderHint}` : "",
    `Arquivo: ${basename(relPath)}`,
    `Conteúdo:\n${text.slice(0, 6000)}`,
  ].filter(Boolean).join("\n");
  const result = await ask(prompt, { ...env, LOCAL_OUTPUT_FORMAT: "json", LOCAL_MAX_OUTPUT_TOKENS: "700" }, signal);
  let card = null;
  try { card = result.ok ? JSON.parse(result.text.match(/\{[\s\S]*\}/)?.[0] || "") : null; } catch { card = null; }
  const clean = (v, n) => String(v || "").replace(/\s+/g, " ").trim().slice(0, n);
  // The folder people already organized wins; the model's topic only files
  // documents left at the root (a copied placeholder or a sentence is ignored).
  const proposed = clean(card?.categoria, 60);
  const topic = proposed && !/ex\.|[,:;]/i.test(proposed) && proposed.split(" ").length <= 4 ? proposed : "";
  const category = folderHint.split("/")[0] || topic || "Geral";
  return {
    category: `${department}/${category.replace(/\//g, "-")}`,
    card: {
      title: clean(card?.titulo, 120) || basename(relPath).replace(/\.[^.]+$/, ""),
      type: CARD_TYPES.includes(card?.tipo) ? card.tipo : "outro",
      topic,
      summary: clean(card?.resumo, 600),
      keywords: (Array.isArray(card?.palavras_chave) ? card.palavras_chave : []).map((k) => clean(k, 40)).filter(Boolean).slice(0, 10),
      dates: (Array.isArray(card?.datas) ? card.datas : []).filter((d) => d && d.data).slice(0, 10).map((d) => ({ date: clean(d.data, 20), what: clean(d.o_que, 120) })),
      flow: (Array.isArray(card?.fluxo) ? card.fluxo : []).map((s) => clean(s, 300)).filter(Boolean).slice(0, 20),
      mapped: !!card,
    },
  };
}

const hashText = (text) => createHash("sha256").update(text).digest("hex");

/**
 * Brings a source's index up to date: new or changed documents are read,
 * cut, embedded and mapped; documents that disappeared are dropped. Only the
 * difference is processed, so re-running is cheap.
 */
export async function indexSource(id, { env = process.env, signal, onProgress = () => {}, map = mapDocument } = {}) {
  const db = await ready();
  const source = db.prepare("SELECT * FROM knowledge_sources WHERE id = ?").get(id);
  if (!source) throw httpError(404, "Fonte não encontrada.");
  const known = new Map(db.prepare("SELECT id, path, mtime_ms, size FROM knowledge_docs WHERE source_id = ?").all(id).map((r) => [r.path, r]));
  const files = [];
  for await (const path of walkDocs(source.path, signal)) files.push(path);
  const present = new Set(files);
  const stats = { total: files.length, done: 0, changed: 0, removed: 0, failed: 0 };
  const categories = new Set(db.prepare("SELECT DISTINCT category FROM knowledge_docs WHERE source_id = ? AND category IS NOT NULL").all(id).map((r) => r.category.split("/").slice(1).join("/")));
  const insertChunk = db.prepare("INSERT INTO knowledge_chunks(id,doc_id,ord,text,embedding,embedding_model) VALUES(?,?,?,?,?,?)");
  const insertFts = db.prepare("INSERT INTO knowledge_fts(chunk_id,text) VALUES(?,?)");
  const dropDocChunks = (docId) => {
    for (const { id: chunkId } of db.prepare("SELECT id FROM knowledge_chunks WHERE doc_id = ?").all(docId)) db.prepare("DELETE FROM knowledge_fts WHERE chunk_id = ?").run(chunkId);
    db.prepare("DELETE FROM knowledge_chunks WHERE doc_id = ?").run(docId);
  };
  for (const [path, row] of known) if (!present.has(path)) { dropDocChunks(row.id); db.prepare("DELETE FROM knowledge_docs WHERE id = ?").run(row.id); stats.removed += 1; }

  for (const path of files) {
    if (signal?.aborted) break;
    onProgress({ ...stats, current: relative(source.path, path) });
    const info = await stat(path).catch(() => null);
    const previous = known.get(path);
    if (!info || (previous && previous.mtime_ms === info.mtimeMs && previous.size === info.size)) { stats.done += 1; continue; }
    const relPath = relative(source.path, path);
    const docId = previous?.id || randomUUID();
    let text = "";
    let error = null;
    try { text = await extractText(path); if (!text.trim()) error = "Documento sem texto (talvez seja uma imagem escaneada)."; }
    catch (e) { error = e.message; }
    const hash = text ? hashText(text) : null;
    let mapped = { category: `${source.department}/${relPath.split(sep).length > 1 ? relPath.split(sep)[0] : "Geral"}`, card: null };
    if (!error) mapped = await map({ relPath, text, department: source.department, categories: [...categories], env, signal });
    if (mapped.category) categories.add(mapped.category.split("/").slice(1).join("/"));
    const vectors = [];
    const chunks = error ? [] : chunkText(text, `${source.department} — ${relPath.split(sep).join("/")}`);
    for (const chunk of chunks) vectors.push(await embedText(`search_document: ${chunk}`, env, signal).catch(() => null));
    const model = resolveEmbeddingModel(env);
    db.exec("BEGIN");
    try {
      if (previous) dropDocChunks(docId);
      db.prepare(`INSERT INTO knowledge_docs(id,source_id,path,rel_path,mtime_ms,size,hash,category,card,chars,error,indexed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(source_id,path) DO UPDATE SET mtime_ms=excluded.mtime_ms,size=excluded.size,hash=excluded.hash,category=excluded.category,card=excluded.card,chars=excluded.chars,error=excluded.error,indexed_at=excluded.indexed_at`)
        .run(docId, id, path, relPath.split(sep).join("/"), info.mtimeMs, info.size, hash, mapped.category, mapped.card ? JSON.stringify(mapped.card) : null, text.length, error, new Date().toISOString());
      chunks.forEach((chunk, ord) => {
        const chunkId = randomUUID();
        insertChunk.run(chunkId, docId, ord, chunk, vectors[ord] ? encodeEmbedding(vectors[ord]) : null, vectors[ord] ? model : null);
        insertFts.run(chunkId, chunk);
      });
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
    stats.done += 1; stats.changed += 1; if (error) stats.failed += 1;
  }
  db.prepare("UPDATE knowledge_sources SET indexed_at = ?, last_error = ? WHERE id = ?").run(new Date().toISOString(), signal?.aborted ? "Indexação interrompida." : null, id);
  onProgress({ ...stats, current: null, finished: true });
  return stats;
}

/** Background indexing with progress visible through listSources(). */
export function startIndexing(id, options = {}) {
  if (jobs.has(id)) return jobs.get(id).promise;
  const controller = new AbortController();
  const job = { controller, progress: { total: 0, done: 0, current: null } };
  job.promise = indexSource(id, { ...options, signal: controller.signal, onProgress: (p) => { job.progress = p; } })
    .catch(async (error) => { (await ready()).prepare("UPDATE knowledge_sources SET last_error = ? WHERE id = ?").run(error.message, id); throw error; })
    .finally(() => jobs.delete(id));
  job.promise.catch(() => {});
  jobs.set(id, job);
  return job.promise;
}

// Words that say nothing about the subject ("qual", "do", "hoje", "me traz").
const STOPWORDS = new Set("a o as os ao aos de do da dos das um uma uns umas e ou que qual quais quem como para pra pro por com sem no na nos nas em me mim meu minha meus minhas eu voce voces ele ela nos isso isto esse essa este esta aquele aquela ser sao foi tem ter tenho faco fazer pode posso quero queria preciso sobre hoje agora ja tambem mais menos muito pouco quanto quanta quantos quando onde porque traz traga trazer mostra mostre diga fala fale resumo explica explique favor oi ola obrigado".split(" "));
export const contentWords = (text) => [...new Set((String(text).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]{3,}/g) || []).filter((w) => !STOPWORDS.has(w)))];
const stemOf = (w) => (w.length > 5 ? w.slice(0, w.length - 2) : w);

const ftsQuery = (query) => (String(query).normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[\p{L}\p{N}]{2,}/gu) || []).slice(0, 12).map((w) => `"${w}"*`).join(" OR ");

/**
 * Hybrid search: words (FTS, accent-insensitive) + meaning (embeddings),
 * plus a boost when the document's card (keywords, summary) matches — the
 * map built by the local model is what finds "programação de fim de ano"
 * in a file called "Confraternização 2026".
 */
export async function searchKnowledge(query, { category, sourceIds, limit = 6, env = process.env, signal } = {}) {
  const db = await ready();
  const text = String(query || "").trim();
  if (!text) return [];
  const where = ["d.error IS NULL"];
  const args = [];
  if (sourceIds) { if (!sourceIds.length) return []; where.push(`d.source_id IN (${sourceIds.map(() => "?").join(",")})`); args.push(...sourceIds); }
  if (category) { where.push("lower(d.category) LIKE ?"); args.push(`%${String(category).toLowerCase()}%`); }
  const rows = db.prepare(`SELECT c.id, c.text, c.embedding, c.embedding_model, d.id doc_id, d.path, d.rel_path, d.category, d.card, d.mtime_ms, d.source_id, s.department, s.name source_name, s.paid_allowed FROM knowledge_chunks c JOIN knowledge_docs d ON d.id = c.doc_id JOIN knowledge_sources s ON s.id = d.source_id WHERE ${where.join(" AND ")}`).all(...args);
  if (!rows.length) return [];
  const vector = await embedText(`search_query: ${text}`, env, signal).catch(() => null);
  const model = resolveEmbeddingModel(env);
  // Coverage of the request's content words ("ferias" ~ "férias"), not a
  // relative rank: a stray "do" or "hoje" must not look like a match.
  const words = contentWords(text);
  const stems = words.map(stemOf);
  const coverage = (body) => (stems.length ? stems.filter((s) => body.includes(s)).length / stems.length : 0);
  const scored = rows.map((row) => {
    const card = row.card ? JSON.parse(row.card) : null;
    const cardText = `${card?.title || ""} ${card?.topic || ""} ${card?.summary || ""} ${(card?.keywords || []).join(" ")} ${row.category || ""}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const body = row.text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const cardHits = stems.filter((s) => cardText.includes(s)).length;
    const semantic = vector && row.embedding && row.embedding_model === model ? cosineSimilarity(vector, decodeEmbedding(row.embedding)) : 0;
    const score = coverage(body) * 1.5 + Math.max(0, semantic - 0.35) * 3 + Math.min(cardHits, 4) * 0.25;
    return { row, card, score, semantic };
  }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  const perDoc = new Map();
  const out = [];
  for (const s of scored) {
    const n = perDoc.get(s.row.doc_id) || 0;
    if (n >= 2) continue;
    perDoc.set(s.row.doc_id, n + 1);
    out.push({
      path: s.row.path, relPath: s.row.rel_path, category: s.row.category, department: s.row.department, source: s.row.source_name,
      sourceId: s.row.source_id, paidAllowed: !!s.row.paid_allowed, updatedAt: new Date(s.row.mtime_ms).toISOString(),
      title: s.card?.title || s.row.rel_path, summary: s.card?.summary || "", text: s.row.text.replace(/^\[[^\]]*\]\n/, ""), score: Math.round(s.score * 100) / 100,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Categories → documents (with summary, dates and flows): the organized map. */
export async function knowledgeMap({ department, category } = {}) {
  const db = await ready();
  const rows = db.prepare("SELECT d.rel_path, d.path, d.category, d.card, d.mtime_ms, s.department, s.name FROM knowledge_docs d JOIN knowledge_sources s ON s.id = d.source_id WHERE d.error IS NULL ORDER BY d.category, d.rel_path").all();
  const tree = new Map();
  for (const row of rows) {
    if (department && row.department.toLowerCase() !== String(department).toLowerCase()) continue;
    if (category && !String(row.category).toLowerCase().includes(String(category).toLowerCase())) continue;
    const card = row.card ? JSON.parse(row.card) : {};
    if (!tree.has(row.category)) tree.set(row.category, []);
    tree.get(row.category).push({ title: card.title || row.rel_path, type: card.type || "outro", summary: card.summary || "", dates: card.dates || [], flow: card.flow || [], keywords: card.keywords || [], relPath: row.rel_path, path: row.path, source: row.name, updatedAt: new Date(row.mtime_ms).toISOString() });
  }
  return [...tree].map(([name, documents]) => ({ category: name, documents }));
}

export async function sourceForPath(path) {
  const db = await ready();
  const lower = String(path).toLowerCase();
  return db.prepare("SELECT * FROM knowledge_sources").all().find((s) => lower.startsWith(s.path.toLowerCase())) || null;
}
