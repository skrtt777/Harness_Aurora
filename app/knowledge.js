import { createHash, randomUUID } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import { getDb } from "./db.js";
import { embedText, embeddingPlacement, encodeEmbedding, resolveEmbeddingModel } from "./embeddings.js";
import { IMAGE_EXTENSIONS, extractText, isDocument } from "./docText.js";
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
// Icons, thumbnails and emoji images: never worth an OCR pass.
const MIN_IMAGE_BYTES = 20_000;
const jobs = new Map();
// Bumped on every index write: the in-memory vector cache is rebuilt lazily.
let indexVersion = 0;
let migrated = false;

async function ready() {
  const db = await getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_sources(id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, department TEXT NOT NULL, paid_allowed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, indexed_at TEXT, last_error TEXT);
    CREATE TABLE IF NOT EXISTS knowledge_docs(id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE, path TEXT NOT NULL, rel_path TEXT NOT NULL, mtime_ms REAL NOT NULL, size INTEGER NOT NULL, hash TEXT, category TEXT, card TEXT, chars INTEGER NOT NULL DEFAULT 0, error TEXT, indexed_at TEXT NOT NULL, UNIQUE(source_id, path));
    CREATE TABLE IF NOT EXISTS knowledge_chunks(id TEXT PRIMARY KEY, doc_id TEXT NOT NULL REFERENCES knowledge_docs(id) ON DELETE CASCADE, ord INTEGER NOT NULL, text TEXT NOT NULL, embedding BLOB, embedding_model TEXT);
    CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_doc ON knowledge_chunks(doc_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_text USING fts5(text, tokenize='unicode61 remove_diacritics 2');
    CREATE TABLE IF NOT EXISTS knowledge_suggestions(id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE, doc_id TEXT NOT NULL REFERENCES knowledge_docs(id) ON DELETE CASCADE, field TEXT NOT NULL, previous TEXT, value TEXT NOT NULL, reason TEXT, teacher TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, decided_at TEXT);
    CREATE INDEX IF NOT EXISTS idx_knowledge_suggestions_source ON knowledge_suggestions(source_id, status);`);
  if (!migrated) {
    migrated = true;
    // 0.1.27 keyed the word index by chunk id (an unindexed column): deleting
    // a document scanned the whole index per passage — a 50k-passage folder
    // never finished. Now the word index shares the passage rowid.
    if (db.prepare("SELECT count(*) n FROM sqlite_master WHERE name = 'knowledge_fts'").get().n) db.exec("DROP TABLE knowledge_fts");
    if (!db.prepare("SELECT rowid FROM knowledge_text LIMIT 1").get() && db.prepare("SELECT rowid FROM knowledge_chunks LIMIT 1").get()) db.exec("INSERT INTO knowledge_text(rowid, text) SELECT rowid, text FROM knowledge_chunks");
  }
  return db;
}

export const knowledgeDb = ready;

/**
 * Corrections a person approved (from the paid reviewer) are kept in
 * card.overrides and win over what the local model writes. The category
 * survives any change to the file; the other fields only while the text is
 * the same — new content deserves a fresh card.
 */
export const CARD_FIELDS = ["title", "summary", "keywords", "type", "category", "flow"];
export function applyOverrides(mapped, overrides, department) {
  if (!mapped.card || !overrides || !Object.keys(overrides).length) return mapped;
  for (const [field, value] of Object.entries(overrides)) {
    if (field === "category") mapped.category = `${department}/${String(value).replace(/\//g, "-")}`;
    else if (CARD_FIELDS.includes(field)) mapped.card[field] = value;
  }
  mapped.card.overrides = overrides;
  return mapped;
}

/** Up to 3 recent approved corrections of the department: the local model's examples. */
export async function reviewExamples(department, limit = 3) {
  const db = await ready();
  return db.prepare("SELECT s.field, s.previous, s.value, s.reason, d.rel_path FROM knowledge_suggestions s JOIN knowledge_docs d ON d.id = s.doc_id JOIN knowledge_sources k ON k.id = s.source_id WHERE s.status = 'accepted' AND k.department = ? ORDER BY s.decided_at DESC LIMIT ?").all(department, limit)
    .map((r) => ({ field: r.field, file: basename(r.rel_path), before: JSON.parse(r.previous ?? "null"), after: JSON.parse(r.value), reason: r.reason || "" }));
}

const FIELD_NAMES = { title: "titulo", summary: "resumo", keywords: "palavras_chave", type: "tipo", category: "categoria", flow: "fluxo" };

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
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM knowledge_text WHERE rowid IN (SELECT c.rowid FROM knowledge_chunks c JOIN knowledge_docs d ON d.id = c.doc_id WHERE d.source_id = ?)").run(id);
    db.prepare("DELETE FROM knowledge_chunks WHERE doc_id IN (SELECT id FROM knowledge_docs WHERE source_id = ?)").run(id);
    db.prepare("DELETE FROM knowledge_docs WHERE source_id = ?").run(id);
    const removed = db.prepare("DELETE FROM knowledge_sources WHERE id = ?").run(id).changes > 0;
    db.exec("COMMIT");
    indexVersion += 1;
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
export async function mapDocument({ relPath, text, department, categories = [], examples = [], env = process.env, signal, ask = runLocal }) {
  const folderHint = dirname(relPath) === "." ? "" : dirname(relPath).split(sep).join("/");
  const prompt = [
    `Você organiza os documentos do departamento ${department}. Leia o documento e responda SOMENTE um JSON com os campos categoria (assunto em 1 a 3 palavras), tipo (${CARD_TYPES.join(", ")}), titulo, resumo (2 frases com o essencial: datas, valores, prazos — copie números exatamente como estão), palavras_chave (5 a 8 termos, incluindo sinônimos que alguém usaria para pedir isso), datas (só as do conteúdo) e fluxo (passo a passo, só se for procedimento; senão []).`,
    'Exemplo de formato (de OUTRO documento): {"categoria":"Treinamentos","tipo":"procedimento","titulo":"Inscrição em cursos","resumo":"Cursos externos precisam de aprovação do gestor. O reembolso é de até R$ 500 por ano.","palavras_chave":["curso","capacitação","reembolso","treinamento","educação"],"datas":[{"data":"31/03/2026","o_que":"prazo de inscrição"}],"fluxo":["Escolha o curso","Peça aprovação ao gestor","Envie o comprovante ao RH"]}',
    categories.length ? `Categorias já usadas neste departamento (reutilize se servir): ${categories.join(", ")}.` : "",
    examples.length ? `Correções que um revisor fez em fichas de OUTROS documentos deste departamento (siga o mesmo critério):\n${examples.map((e) => `- ${e.file}: ${FIELD_NAMES[e.field] || e.field} ${JSON.stringify(e.before)} → ${JSON.stringify(e.after)}${e.reason ? ` (${e.reason})` : ""}`).join("\n")}` : "",
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

/** Embeddings 16 passages per Ollama call (/api/embed), one by one as a fallback. */
async function embedDocuments(chunks, env, signal) {
  const base = env.LOCAL_BASE_URL || "http://127.0.0.1:11434";
  const model = resolveEmbeddingModel(env);
  const out = [];
  for (let i = 0; i < chunks.length; i += 16) {
    const input = chunks.slice(i, i + 16).map((c) => `search_document: ${c}`);
    try {
      const response = await fetch(`${base}/api/embed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, input, keep_alive: "30m", ...embeddingPlacement(env) }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) });
      const data = response.ok ? await response.json() : null;
      if (Array.isArray(data?.embeddings) && data.embeddings.length === input.length) { out.push(...data.embeddings); continue; }
    } catch { /* older Ollama or offline: one by one below */ }
    for (const text of input) out.push(await embedText(text, env, signal).catch(() => null));
  }
  return out;
}

/**
 * Brings a source's index up to date: new or changed documents are read,
 * cut, embedded and mapped; documents that disappeared are dropped. Only the
 * difference is processed, so re-running is cheap.
 */
export async function indexSource(id, { env = process.env, signal, onProgress = () => {}, map = mapDocument, ocr } = {}) {
  const db = await ready();
  const source = db.prepare("SELECT * FROM knowledge_sources WHERE id = ?").get(id);
  if (!source) throw httpError(404, "Fonte não encontrada.");
  const known = new Map(db.prepare("SELECT id, path, mtime_ms, size, hash, card FROM knowledge_docs WHERE source_id = ?").all(id).map((r) => [r.path, r]));
  const examples = await reviewExamples(source.department);
  const files = [];
  for await (const path of walkDocs(source.path, signal)) files.push(path);
  const present = new Set(files);
  const stats = { total: files.length, done: 0, changed: 0, removed: 0, failed: 0 };
  const categories = new Set(db.prepare("SELECT DISTINCT category FROM knowledge_docs WHERE source_id = ? AND category IS NOT NULL").all(id).map((r) => r.category.split("/").slice(1).join("/")));
  const insertChunk = db.prepare("INSERT INTO knowledge_chunks(id,doc_id,ord,text,embedding,embedding_model) VALUES(?,?,?,?,?,?)");
  const insertText = db.prepare("INSERT INTO knowledge_text(rowid, text) VALUES(?, ?)");
  const dropDocChunks = (docId) => {
    db.prepare("DELETE FROM knowledge_text WHERE rowid IN (SELECT rowid FROM knowledge_chunks WHERE doc_id = ?)").run(docId);
    db.prepare("DELETE FROM knowledge_chunks WHERE doc_id = ?").run(docId);
  };
  for (const [path, row] of known) if (!present.has(path)) { dropDocChunks(row.id); db.prepare("DELETE FROM knowledge_docs WHERE id = ?").run(row.id); stats.removed += 1; indexVersion += 1; }

  for (const path of files) {
    if (signal?.aborted) break;
    onProgress({ ...stats, current: relative(source.path, path) });
    const info = await stat(path).catch(() => null);
    const previous = known.get(path);
    if (!info || (previous && previous.mtime_ms === info.mtimeMs && previous.size === info.size)) { stats.done += 1; continue; }
    if (!previous && IMAGE_EXTENSIONS.has(extname(path).toLowerCase()) && info.size < MIN_IMAGE_BYTES) { stats.done += 1; continue; }
    const relPath = relative(source.path, path);
    const docId = previous?.id || randomUUID();
    let text = "";
    let error = null;
    try { text = await extractText(path, ocr === undefined ? { signal } : { signal, ocr }); if (!text.trim()) error = IMAGE_EXTENSIONS.has(extname(path).toLowerCase()) ? "Imagem sem texto legível." : "Documento sem texto (nem o OCR achou texto legível)."; }
    catch (e) { error = e.message; }
    const hash = text ? hashText(text) : null;
    let mapped = { category: `${source.department}/${relPath.split(sep).length > 1 ? relPath.split(sep)[0] : "Geral"}`, card: null };
    if (!error) mapped = await map({ relPath, text, department: source.department, categories: [...categories], examples, env, signal });
    let overrides = {};
    try { overrides = JSON.parse(previous?.card || "{}")?.overrides || {}; } catch { overrides = {}; }
    if (!error) applyOverrides(mapped, Object.fromEntries(Object.entries(overrides).filter(([field]) => field === "category" || previous.hash === hash)), source.department);
    if (mapped.card && /^## (Página \d+ \(OCR\)|Imagem \(OCR\))$/m.test(text)) mapped.card.ocr = true;
    if (mapped.category) categories.add(mapped.category.split("/").slice(1).join("/"));
    const chunks = error ? [] : chunkText(text, `${source.department} — ${relPath.split(sep).join("/")}`);
    const vectors = await embedDocuments(chunks, env, signal);
    const model = resolveEmbeddingModel(env);
    db.exec("BEGIN");
    try {
      if (previous) dropDocChunks(docId);
      db.prepare(`INSERT INTO knowledge_docs(id,source_id,path,rel_path,mtime_ms,size,hash,category,card,chars,error,indexed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(source_id,path) DO UPDATE SET mtime_ms=excluded.mtime_ms,size=excluded.size,hash=excluded.hash,category=excluded.category,card=excluded.card,chars=excluded.chars,error=excluded.error,indexed_at=excluded.indexed_at`)
        .run(docId, id, path, relPath.split(sep).join("/"), info.mtimeMs, info.size, hash, mapped.category, mapped.card ? JSON.stringify(mapped.card) : null, text.length, error, new Date().toISOString());
      chunks.forEach((chunk, ord) => {
        const { lastInsertRowid } = insertChunk.run(randomUUID(), docId, ord, chunk, vectors[ord] ? encodeEmbedding(vectors[ord]) : null, vectors[ord] ? model : null);
        insertText.run(lastInsertRowid, chunk);
      });
      db.exec("COMMIT");
      indexVersion += 1;
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
const CONTACT_INTENT = /\b(quem (eu )?(procuro|procurar|falo|chamo|contato)|com quem|falar com|contato|ramal|respons[áa]vel)\b/i;
const stemOf = (w) => (w.length > 5 ? w.slice(0, w.length - 2) : w);

// Above this many passages, only candidates (best by words + best by meaning)
// are scored; below, everything is — small departments keep exact recall.
const SCORE_ALL_UP_TO = 5000;
const CANDIDATES = 300;
let vectorCache = null;

/** All passage vectors of the current model, normalized, in one Float32Array. */
function passageVectors(db, model) {
  if (vectorCache?.version === indexVersion && vectorCache.model === model) return vectorCache;
  const rows = db.prepare("SELECT c.rowid r, c.embedding e FROM knowledge_chunks c JOIN knowledge_docs d ON d.id = c.doc_id WHERE c.embedding IS NOT NULL AND c.embedding_model = ? AND d.error IS NULL").all(model);
  const dim = rows[0] ? rows[0].e.byteLength / 4 : 0;
  const matrix = new Float32Array(rows.length * dim);
  const ids = new Float64Array(rows.length);
  let n = 0;
  for (const row of rows) {
    if (row.e.byteLength !== dim * 4) continue;
    const v = new Float32Array(row.e.buffer, row.e.byteOffset, dim);
    let norm = 0; for (let k = 0; k < dim; k += 1) norm += v[k] * v[k];
    norm = Math.sqrt(norm) || 1;
    for (let k = 0; k < dim; k += 1) matrix[n * dim + k] = v[k] / norm;
    ids[n] = row.r; n += 1;
  }
  vectorCache = { version: indexVersion, model, dim, count: n, ids, matrix };
  return vectorCache;
}

function similarities(cache, query) {
  let norm = 0; for (const x of query) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  const q = Float32Array.from(query, (x) => x / norm);
  const out = new Map();
  const scores = new Float32Array(cache.count);
  for (let i = 0; i < cache.count; i += 1) { let dot = 0; const o = i * cache.dim; for (let k = 0; k < cache.dim; k += 1) dot += cache.matrix[o + k] * q[k]; scores[i] = dot; }
  const order = Array.from(scores.keys()).sort((a, b) => scores[b] - scores[a]);
  for (const i of order) out.set(cache.ids[i], scores[i]);
  // How far the best passages stand out from the whole collection: a real
  // question about a document does; "oi, tudo bem" in a big folder does not.
  let mean = 0; for (const s of scores) mean += s; mean /= scores.length || 1;
  let variance = 0; for (const s of scores) variance += (s - mean) ** 2; const std = Math.sqrt(variance / (scores.length || 1)) || 1;
  return { all: out, top: order.slice(0, CANDIDATES).map((i) => cache.ids[i]), zOf: (s) => (s - mean) / std };
}

const ftsQuery = (stems) => stems.slice(0, 12).map((w) => `"${w}"*`).join(" OR ");

/**
 * Hybrid search: words (FTS, accent-insensitive) + meaning (embeddings),
 * plus a boost when the document's card (keywords, summary) matches — the
 * map built by the local model is what finds "programação de fim de ano"
 * in a file called "Confraternização 2026".
 */
// How people say it vs. how the documents say it: "o pessoal que tá devendo" never matched "Contas a
// Receber e Inadimplência", and the Aurora delivered an empty template (usage tests, 06/10).
// Only the everyday words: a word the documents already use ("orçamento", "contrato", "férias")
// is left alone — expanded, "quando o orçamento de 2027 vai ser apresentado" pulled the 2026 budget
// sheet instead of the meeting calendar (empresa eval, 06/10).
const EVERYDAY_TERMS = [
  [/\b(devendo|devedor(es)?|calote|n[aã]o pag(ou|aram)|t[aá] devendo|cobrar)\b/i, "inadimplência títulos em atraso contas a receber"],
  [/\b(gast(ou|aram)|estour(ou|aram)|passou do (or[cç]ado|limite))\b/i, "orçado realizado desvio"],
  [/\b(holerite|contracheque|pagamento do pessoal)\b/i, "folha de pagamento"],
  [/\b(folga(s)?|sair de f[eé]rias)\b/i, "controle de férias"],
  [/\b(acabando|faltando produto|repor|reposi[cç][aã]o)\b/i, "posição de estoque estoque mínimo"],
  [/\b(problema(s)? (no|na|de|com) (computador|sistema|impressora|internet)|deu pau)\b/i, "chamados TI"],
  [/\b(vendeu|quem mais vende)\b/i, "vendas por vendedor"],
  [/\b(falar com|quem cuida d)\b/i, "lista de ramais contatos"],
  // "Próximo imposto a vencer" went to the September tax calculation, not the calendar; "quem é o
  // gerente de logística" missed the extensions list (empresa eval fiscal-1, administrativo-2).
  [/\b(impostos?|tributos?|guias?)\b[^.?!]{0,30}\b(venc|pagar|prazo)|\b(venc|pagar|prazo)[^.?!]{0,30}\b(impostos?|tributos?|guias?)\b/i, "calendário de obrigações vencimento"],
  [/\bquem [eé] (o|a) (gerente|respons[aá]vel|coordenador[a]?|supervisor[a]?|diretor[a]?|chefe)\b/i, "lista de ramais e responsáveis"],
];
// The kind of delivery is not the subject: "relatório vendas" found "Relatório Gerencial" of the
// Controladoria first and the sales sheet came second (battery 4, 06/10). Dropped while other words remain.
const DELIVERY_WORDS = /\b(relat[oó]rios?|planilhas?|documentos?|resumos?|apresenta[cç](?:[aã]o|[oõ]es)|slides?|arquivos?|word|excel|pdf|modelo)\b/gi;
export function subjectOnly(query) {
  const text = String(query || "");
  const left = text.replace(DELIVERY_WORDS, " ").replace(/\s+/g, " ").trim();
  return left.split(" ").filter((w) => w.length > 2).length ? left : text;
}

export function expandEverydayTerms(query) {
  const text = subjectOnly(query);
  const extra = EVERYDAY_TERMS.filter(([test]) => test.test(text)).map(([, add]) => add);
  return extra.length ? `${text}\n${extra.join(" ")}` : text;
}

export async function searchKnowledge(query, { category, sourceIds, limit = 6, env = process.env, signal } = {}) {
  const db = await ready();
  const text = expandEverydayTerms(String(query || "").trim());
  if (!text) return [];
  const where = ["d.error IS NULL"];
  const args = [];
  if (sourceIds) { if (!sourceIds.length) return []; where.push(`d.source_id IN (${sourceIds.map(() => "?").join(",")})`); args.push(...sourceIds); }
  if (category) { where.push("lower(d.category) LIKE ?"); args.push(`%${String(category).toLowerCase()}%`); }
  const vector = await embedText(`search_query: ${text}`, env, signal).catch(() => null);
  const model = resolveEmbeddingModel(env);
  // Coverage of the request's content words ("ferias" ~ "férias"), not a
  // relative rank: a stray "do" or "hoje" must not look like a match.
  // "Quem eu procuro?" asks for a contact: the department's contact list
  // shares no word with it, so the intent brings its usual words along.
  const words = contentWords(CONTACT_INTENT.test(text) ? `${text} contato ramal responsavel` : text);
  const stems = words.map(stemOf);
  const total = db.prepare("SELECT count(*) n FROM knowledge_chunks").get().n;
  if (!total) return [];
  const cache = vector ? passageVectors(db, model) : null;
  const sims = cache?.count && cache.dim === vector.length ? similarities(cache, vector) : null;
  if (total > SCORE_ALL_UP_TO) {
    const candidates = new Set(sims?.top || []);
    if (stems.length) {
      try { for (const hit of db.prepare("SELECT rowid FROM knowledge_text WHERE knowledge_text MATCH ? ORDER BY bm25(knowledge_text) LIMIT ?").all(ftsQuery(stems), CANDIDATES)) candidates.add(hit.rowid); }
      catch { /* unusual characters: meaning-only */ }
    }
    if (!candidates.size) return [];
    where.push(`c.rowid IN (${[...candidates].map(() => "?").join(",")})`);
    args.push(...candidates);
  }
  const rows = db.prepare(`SELECT c.rowid r, c.text, d.id doc_id, d.path, d.rel_path, d.category, d.card, d.mtime_ms, d.source_id, s.department, s.name source_name, s.paid_allowed FROM knowledge_chunks c JOIN knowledge_docs d ON d.id = c.doc_id JOIN knowledge_sources s ON s.id = d.source_id WHERE ${where.join(" AND ")}`).all(...args);
  if (!rows.length) return [];
  // Rare words weigh more (IDF): "pagamento" in an HR folder says a lot,
  // "tudo" or "bem" in a big mixed folder says nothing.
  const idf = new Map(stems.map((s) => {
    let df = 0;
    try { df = db.prepare("SELECT count(*) n FROM knowledge_text WHERE knowledge_text MATCH ?").get(`"${s}"*`).n; } catch { df = 0; }
    return [s, Math.log((total + 1) / (df + 0.5))];
  }));
  const idfTotal = stems.reduce((n, s) => n + Math.max(0, idf.get(s)), 0) || 1;
  const maxIdf = Math.log(total + 1) || 1;
  // A stem counts at the start of a word: "part" (partes) is not inside "coparticipação".
  const stemRe = new Map(stems.map((s) => [s, new RegExp(`(^|[^a-z0-9])${s}`)]));
  const hasStem = (body, s) => stemRe.get(s).test(body);
  const coverage = (body) => stems.reduce((n, s) => n + (hasStem(body, s) ? Math.max(0, idf.get(s)) : 0), 0) / idfTotal;
  const specificity = (body) => Math.max(0, ...stems.filter((s) => hasStem(body, s)).map((s) => idf.get(s))) / maxIdf;
  const scored = rows.map((row) => {
    const card = row.card ? JSON.parse(row.card) : null;
    const cardText = `${card?.title || ""} ${card?.topic || ""} ${card?.summary || ""} ${(card?.keywords || []).join(" ")} ${row.category || ""}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const body = row.text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const cardHits = stems.filter((s) => hasStem(cardText, s)).length;
    // The file's own name ("Controle de Férias 2026.xlsx"): a sheet's later chunks are bare rows
    // without the subject's word, and "férias esse mês" otherwise ranked the cash-flow sheet first.
    const fileName = basename(row.rel_path).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const fileHits = stems.filter((s) => idf.get(s) > 0 && hasStem(fileName, s)).length;
    const semantic = sims?.all.get(row.r) ?? 0;
    const score = coverage(body) * 1.5 + Math.max(0, semantic - 0.35) * 3 + Math.min(cardHits, 4) * 0.25 + Math.min(fileHits, 2) * 0.4;
    return { row, card, score, semantic, specificity: specificity(body) };
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
      semantic: Math.round(s.semantic * 100) / 100,
      specificity: Math.round(s.specificity * 100) / 100,
      standout: sims && s.semantic ? Math.round(sims.zOf(s.semantic) * 10) / 10 : null,
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
    tree.get(row.category).push({ title: card.title || row.rel_path, type: card.type || "outro", summary: card.summary || "", dates: card.dates || [], flow: card.flow || [], keywords: card.keywords || [], ocr: !!card.ocr, relPath: row.rel_path, path: row.path, source: row.name, updatedAt: new Date(row.mtime_ms).toISOString() });
  }
  return [...tree].map(([name, documents]) => ({ category: name, documents }));
}

const foldName = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\.(docx|xlsx|pptx|pdf|txt|md|csv|rtf|png|jpe?g)\b/g, "").replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
const NAME_JOINERS = new Set(["de", "do", "da", "dos", "das", "e", "em", "para", "com", "sem"]);
const DOC_FILE =/[^\s"*`'[\]\\/:|<>()]+(?: [^\s"*`'[\]\\/:|<>()]+){0,8}\.(?:docx|xlsx|pptx|pdf|csv)\b/gi;

/**
 * Documents an answer cites ("Fonte: …", or a file name like "Benefícios
 * corporativos.pptx") that exist nowhere: not in the company index (by file
 * name or card title), not among the files of this turn. A small model in a
 * long conversation invents a plausible document to back a "sim"; the
 * answer then goes back to it. Web links are not checked.
 */
export async function unknownCitations(text, files = []) {
  const db = await ready();
  const rows = db.prepare("SELECT rel_path, card FROM knowledge_docs WHERE error IS NULL").all();
  if (!rows.length) return [];
  const known = new Set(files.filter(Boolean).map((f) => foldName(basename(String(f)))));
  for (const row of rows) {
    known.add(foldName(basename(row.rel_path)));
    try { const title = JSON.parse(row.card || "{}").title; if (title) known.add(foldName(title)); } catch { /* no card */ }
  }
  known.delete("");
  // Word by word too: the title inside "Ata Reunião de Diretoria - 15-09-2026.pdf" is
  // "Ata da Reunião de Diretoria", and citing it is citing the real file.
  const words = (s) => s.split(" ").filter((w) => w && !NAME_JOINERS.has(w));
  const knownWords = [...known].map(words).filter((w) => w.length >= 3);
  const matches = (cited) => {
    const c = foldName(cited);
    if (!c || [...known].some((k) => c.includes(k) || (c.length >= 8 && k.includes(c)))) return true;
    const citedWords = new Set(words(c));
    return knownWords.some((k) => k.every((w) => citedWords.has(w)));
  };
  // The whole line is one real file (a path or name ending in it), so its " e " is part of the name.
  const endsWithKnown = (line) => { const c = foldName(line); return [...known].some((k) => c === k || c.endsWith(` ${k}`)); };
  const body = String(text || "");
  const cited = [
    // Several sources are split on ";" or " e Nome", unless the whole line already names a real
    // file: "Admissões e Desligamentos 2026.xlsx" is one name, not "Admissões" plus another.
    ...[...body.matchAll(/fontes?[*_]*\s*:[*_]*\s*([^\n\]]+)/gi)].flatMap((m) => (endsWithKnown(m[1]) ? [] : m[1].split(/;|\s+e\s+(?=[A-ZÀ-Ú])/))),
    // "Sim! Veja o Manual de Viagens.pdf" → "Manual de Viagens.pdf": the name
    // starts at the capitalized word after a lowercase one (or the first).
    ...(body.match(DOC_FILE) || []).map((m) => {
      const words = m.split(" ");
      // The longest ending that is a real file: "Treinamentos NR a Vencer.xlsx" was cut at the "a"
      // into "Vencer.xlsx", called invented, and the model took back a right answer (ssma-2, 05/10).
      for (let i = 0; i < words.length; i += 1) if (endsWithKnown(words.slice(i).join(" "))) return words.slice(i).join(" ");
      let start = 0;
      words.forEach((w, i) => { if (i && /^[A-ZÀ-Ú]/.test(w) && /^[a-zà-ú]+$/.test(words[i - 1]) && !NAME_JOINERS.has(words[i - 1])) start = i; });
      return words.slice(start).join(" ");
    }),
  ].map((c) => { let v = c; try { v = decodeURIComponent(c); } catch { /* not encoded */ } return v.replace(/[*`"]/g, "").replace(/^_+|_+$/g, "").trim(); }).filter((c) => c && !/https?:|www\.|\.(com|br|org)\b/i.test(c));
  return [...new Set(cited.filter((c) => !matches(c)))];
}

export async function sourceForPath(path) {
  const db = await ready();
  const lower = String(path).toLowerCase();
  return db.prepare("SELECT * FROM knowledge_sources").all().find((s) => lower.startsWith(s.path.toLowerCase())) || null;
}
