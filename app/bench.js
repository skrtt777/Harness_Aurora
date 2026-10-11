// Creative workbench: PC-owned immutable references and explicitly confirmed decisions.
// No model or remote command is executed by capture or save.
import { randomUUID, createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { getDb } from './db.js';
import { isSensitive } from './sensitive.js';
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const hash = value => createHash('sha256').update(value).digest('hex');
const text = (value, max, name) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400, `${name} inválido.`);
  return value.trim();
};
function project(db, id) {
  const p = db.prepare('SELECT id, name FROM projects WHERE id = ?').get(id);
  if (!p) fail(404, 'Projeto não encontrado. Escolha outra bancada.');
  return p;
}
function revision(db, id) { return db.prepare('SELECT revision FROM bench_state WHERE project_id = ?').get(id)?.revision || 0; }
function bump(db, id) { db.prepare('INSERT INTO bench_state(project_id, revision) VALUES (?, 1) ON CONFLICT(project_id) DO UPDATE SET revision = revision + 1').run(id); }
function transaction(db, fn) { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch(e) { db.exec('ROLLBACK'); throw e; } }
function material(row) {
  return { id: row.id, projectId: row.project_id, title: row.title, note: row.note, source: row.source,
    fileName: row.file_name, sha256: row.sha256, hasPreview: Boolean(row.has_preview), createdAt: row.created_at };
}
const materialColumns = 'id, project_id, title, note, source, file_name, sha256, created_at, preview IS NOT NULL AS has_preview';
function decision(row) { return { id: row.id, projectId: row.project_id, memoryId: row.memory_id, content: row.content, materialIds: JSON.parse(row.material_ids), createdAt: row.created_at }; }
export async function getBench(projectId) {
  const db = await getDb(), p = project(db, projectId);
  return { project: p, revision: revision(db, projectId), executor: 'pc',
    materials: db.prepare(`SELECT ${materialColumns} FROM bench_materials WHERE project_id = ? ORDER BY rowid DESC LIMIT 50`).all(projectId).map(material),
    decisions: db.prepare('SELECT * FROM bench_decisions WHERE project_id = ? ORDER BY rowid DESC LIMIT 20').all(projectId).map(decision) };
}
export async function getBenchPreview(projectId, id) {
  const db = await getDb(); project(db, projectId);
  const row = db.prepare('SELECT preview FROM bench_materials WHERE project_id = ? AND id = ?').get(projectId, id);
  if (!row?.preview) fail(404, 'Esta referência não tem prévia de imagem.');
  return { id, mime: 'image/jpeg', image: Buffer.from(row.preview).toString('base64') };
}
export async function findBenchCapture(operationKey) {
  const db = await getDb();
  const row = db.prepare(`SELECT ${materialColumns} FROM bench_materials WHERE operation_key = ?`).get(operationKey);
  return row ? material(row) : null;
}
// Called only by the authenticated Telegram adapter, never accepts filesystem paths from HTTP.
export async function captureBenchMaterial({ projectId, operationKey, title, note = '', file = null, source = 'Telegram' }) {
  operationKey = text(operationKey, 250, 'Identificador'); title = text(title, 200, 'Título');
  if (typeof note !== 'string' || note.length > 12000) fail(400, 'Referência longa demais.');
  const db = await getDb(); project(db, projectId);
  let sha256 = null, originalPath = null, preview = null;
  if (file) {
    const bytes = await readFile(file);
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) fail(413, 'Arquivo deve ter até 20 MB.');
    sha256 = hash(bytes);
    const dbPath = db.prepare('PRAGMA database_list').all().find(x => x.name === 'main')?.file;
    if (!dbPath) fail(500, 'Banco persistente necessário para receber arquivos.');
    const dir = join(dirname(dbPath), 'bench-assets'); await mkdir(dir, { recursive: true });
    originalPath = join(dir, sha256);
    try { await writeFile(originalPath, bytes, { flag: 'wx' }); } catch(e) { if(e.code !== 'EEXIST') throw e; }
    const jpeg = bytes[0] === 255 && bytes[1] === 216;
    const png = bytes.subarray(0,8).toString('hex') === '89504e470d0a1a0a';
    if (jpeg || png) {
      try {
        const { loadImage, createCanvas } = await import('@napi-rs/canvas');
        const img = await loadImage(bytes);
        if (img.width * img.height <= 40000000 && img.width > 0 && img.height > 0) {
          const scale = Math.min(1, 640 / Math.max(img.width, img.height));
          const canvas = createCanvas(Math.max(1, Math.round(img.width * scale)), Math.max(1, Math.round(img.height * scale)));
          const ctx = canvas.getContext('2d'); ctx.fillStyle = '#101b26'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height); preview = await canvas.encode('jpeg', 80);
        }
      } catch { /* Keep the original when a preview is unavailable. */ }
    }
  }
  const payloadHash = hash(JSON.stringify({ projectId, title, note, sha256, source }));
  return transaction(db, () => {
    const existing = db.prepare('SELECT * FROM bench_materials WHERE operation_key = ?').get(operationKey);
    if (existing) {
      if (existing.payload_hash !== payloadHash) fail(409, 'Captura já recebida com outro conteúdo.');
      return material({ ...existing, has_preview: !!existing.preview });
    }
    const id = randomUUID(), at = new Date().toISOString();
    db.prepare('INSERT INTO bench_materials VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, projectId, operationKey, payloadHash, title, note, source, file ? basename(file) : null, originalPath, sha256, preview, at);
    bump(db, projectId);
    return material(db.prepare(`SELECT ${materialColumns} FROM bench_materials WHERE id = ?`).get(id));
  });
}
export async function saveBenchDecision(projectId, body) {
  const content = text(body.content, 12000, 'Decisão'), operationKey = text(body.operationKey, 250, 'Identificador');
  if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) fail(400, 'Revisão obrigatória.');
  if (!Array.isArray(body.materialIds) || body.materialIds.length > 3 || body.materialIds.some(x => typeof x !== 'string')) fail(400, 'Selecione até três referências.');
  const ids = [...new Set(body.materialIds)].sort();
  const payloadHash = hash(JSON.stringify({ projectId, content, ids, expectedRevision: body.expectedRevision }));
  const db = await getDb(); project(db, projectId);
  return transaction(db, () => {
    const existing = db.prepare('SELECT * FROM bench_decisions WHERE operation_key = ?').get(operationKey);
    if (existing) {
      if (existing.payload_hash !== payloadHash) fail(409, 'Pedido já utilizado para outra decisão.');
      return { ...decision(existing), revision: revision(db, projectId), replayed: true };
    }
    if (revision(db, projectId) !== body.expectedRevision) fail(409, 'A bancada mudou. Atualize, confira as referências e confirme novamente.');
    for (const id of ids) if (!db.prepare('SELECT 1 FROM bench_materials WHERE id = ? AND project_id = ?').get(id, projectId)) fail(400, 'Referência não pertence a este projeto.');
    const id = randomUUID(), memoryId = randomUUID(), at = new Date().toISOString();
    const source = `Bancada Aurora — decisão confirmada. Referências: ${ids.join(', ') || 'nenhuma'}`;
    db.prepare(`INSERT INTO memories (id, scope, project_id, title, content, tags, kind, source, sensitive, created_at, updated_at) VALUES (?, 'project', ?, ?, ?, '[]', 'manual', ?, ?, ?, ?)`).run(memoryId, projectId, content.slice(0,80), content, source, isSensitive(content) ? 1 : 0, at, at);
    db.prepare('INSERT INTO bench_decisions VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, projectId, operationKey, payloadHash, memoryId, content, JSON.stringify(ids), at);
    bump(db, projectId);
    return { ...decision(db.prepare('SELECT * FROM bench_decisions WHERE id = ?').get(id)), revision: revision(db, projectId), replayed: false };
  });
}
