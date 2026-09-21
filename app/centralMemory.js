import { randomUUID } from 'node:crypto';
import { getDb } from './db.js';
import { httpError } from './httpSecurity.js';
import { CENTRAL_REPO, CENTRAL_ROOT, contribution, contributionBody, validateManifest, validateBundle } from './centralProtocol.js';
import { githubApi } from './centralGitHub.js';

const defaults = { downloadEnabled: false, shareEnabled: false, crossChatEnabled: false, intervalHours: 6 };
const configKey = 'central_memory_config';
const stateKey = 'central_memory_state';
const read = (db, key, fallback) => { try { return JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || 'null') || fallback; } catch { return fallback; } };
const write = (db, key, value) => db.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(key, JSON.stringify(value), new Date().toISOString());
export async function centralDb() {
  const db = await getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS central_bundles(id TEXT PRIMARY KEY, hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS central_memories(id TEXT PRIMARY KEY, bundle TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, tags TEXT NOT NULL, issue INTEGER, updated_at TEXT NOT NULL);
    CREATE VIRTUAL TABLE IF NOT EXISTS central_fts USING fts5(id UNINDEXED, title, content, tags);
    CREATE TABLE IF NOT EXISTS central_outbox(id TEXT PRIMARY KEY, payload TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, sent_at TEXT, issue_url TEXT, error TEXT);
    CREATE TABLE IF NOT EXISTS central_lock(id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, expires INTEGER NOT NULL);`);
  return db;
}
export async function centralConfig() { return { ...defaults, ...read(await centralDb(), configKey, {}) }; }
export async function updateCentralConfig(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw httpError(400, 'Configuração inválida.');
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in defaults) || (key === 'intervalHours' ? !Number.isInteger(value) || value < 1 || value > 168 : typeof value !== 'boolean')) throw httpError(400, 'Configuração central inválida: ' + key);
  }
  const db = await centralDb(), config = { ...await centralConfig(), ...patch };
  write(db, configKey, config);
  const state = read(db, stateKey, {}); state.nextAt = null; write(db, stateKey, state);
  // Turning off sharing revokes every pending authorization, including ambiguous sends.
  if (patch.shareEnabled === false) db.prepare("UPDATE central_outbox SET status='cancelled', error=NULL WHERE status IN ('queued','uncertain')").run();
  return centralStatus();
}
export async function centralStatus() {
  const db = await centralDb();
  return { config: await centralConfig(), state: read(db, stateKey, {}), repo: CENTRAL_REPO,
    count: db.prepare('SELECT count(*) AS n FROM central_memories').get().n,
    contributions: db.prepare('SELECT id,payload,status,created_at AS createdAt,sent_at AS sentAt,issue_url AS issueUrl,error FROM central_outbox ORDER BY created_at DESC LIMIT 100').all().map(r => ({ ...r, memory: JSON.parse(r.payload).memory, payload: undefined })) };
}
const asMemory = row => ({ id: 'central:' + row.id, scope: 'central', title: row.title, content: row.content, tags: JSON.parse(row.tags), kind: 'imported', projectId: null, conversationId: null, source: row.issue ? `https://github.com/${CENTRAL_REPO}/issues/${row.issue}` : `https://github.com/${CENTRAL_REPO}/tree/main/central-memories`, createdAt: row.updated_at, updatedAt: row.updated_at, relations: [], relationTypes: {} });
export async function listCentralMemories(query = '', limit = 100) {
  const db = await centralDb();
  const terms = String(query).match(/[\p{L}\p{N}]{2,}/gu)?.slice(0, 12) || [];
  const rows = terms.length ? db.prepare('SELECT m.* FROM central_fts f JOIN central_memories m ON m.id=f.id WHERE central_fts MATCH ? ORDER BY rank LIMIT ?').all(terms.map(t => '"' + t + '"').join(' OR '), limit) : db.prepare('SELECT * FROM central_memories ORDER BY title LIMIT ?').all(limit);
  return rows.map(asMemory);
}
export async function relevantCentralMemories(input) {
  if (!(await centralConfig()).downloadEnabled || !(String(input).match(/[\p{L}\p{N}]{2,}/gu)?.length)) return [];
  return listCentralMemories(input, 12);
}
export async function previewContribution(value) { return contribution(value); }
export async function approveContribution({ memory, expectedId, consent }) {
  if (consent !== true) throw httpError(400, 'Confirme que revisou o conteúdo e autoriza publicação pública.');
  const payload = contribution(memory);
  if (payload.id !== expectedId) throw httpError(409, 'O texto mudou. Revise a prévia novamente antes de aprovar.');
  if (!(await centralConfig()).shareEnabled) throw httpError(409, 'Ative o envio de contribuições revisadas primeiro.');
  const db = await centralDb();
  const existing = db.prepare('SELECT status FROM central_outbox WHERE id=?').get(payload.id);
  if (existing && existing.status !== 'cancelled') return centralStatus();
  if (db.prepare("SELECT count(*) AS n FROM central_outbox WHERE status IN ('queued','sending','uncertain')").get().n >= 100) throw httpError(409, 'A fila já contém 100 contribuições pendentes. Sincronize ou cancele algumas antes de adicionar.');
  db.prepare("INSERT INTO central_outbox(id,payload,status,created_at) VALUES(?,?,'queued',?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,status='queued',created_at=excluded.created_at,error=NULL").run(payload.id, JSON.stringify(payload), new Date().toISOString());
  return centralStatus();
}
export async function cancelContribution(id) {
  const db = await centralDb();
  const changed = db.prepare("UPDATE central_outbox SET status='cancelled',error=NULL WHERE id=? AND status IN ('queued','uncertain')").run(id).changes;
  if (!changed) throw httpError(409, 'Somente envios pendentes podem ser cancelados. Um envio público confirmado precisa de revisão no GitHub.');
  return centralStatus();
}
export async function downloadText(url) {
  if (!url.startsWith(CENTRAL_ROOT)) throw new Error('Origem central inválida.');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Central indisponível (${response.status}). O cache anterior foi preservado.`);
  let length = 0; const chunks = [];
  for await (const chunk of response.body) { length += chunk.length; if (length > 1_000_000) { await response.body.cancel().catch(() => {}); throw new Error('Pacote central excede 1 MB.'); } chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks).toString('utf8');
}
export async function pullCentral({ download = downloadText, now = Date.now(), stillAllowed = async () => true } = {}) {
  const db = await centralDb();
  const manifest = validateManifest(JSON.parse(await download(CENTRAL_ROOT + 'manifest.json')));
  const cached = new Map(db.prepare('SELECT * FROM central_bundles').all().map(row => [row.id, row.hash]));
  const changed = [];
  let downloadedBytes = 0;
  // Downloads have no inference cost; unchanged content hashes are never fetched again.
  for (const bundle of manifest.bundles) if (cached.get(bundle.id) !== bundle.sha256) {
    const text = await download(CENTRAL_ROOT + bundle.file);
    downloadedBytes += Buffer.byteLength(text);
    if (downloadedBytes > 32_000_000) throw new Error('Atualização central excede o limite de 32 MB por ciclo. Cache anterior preservado.');
    changed.push({ bundle, rows: validateBundle(text, bundle) });
  }
  if (!await stillAllowed()) return { cancelled: true };
  const date = new Date(now).toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    const keep = new Set(manifest.bundles.map(b => b.id));
    const remove = new Set([...cached.keys()].filter(id => !keep.has(id)).concat(changed.map(c => c.bundle.id)));
    for (const id of remove) {
      db.prepare('DELETE FROM central_fts WHERE id IN (SELECT id FROM central_memories WHERE bundle=?)').run(id);
      db.prepare('DELETE FROM central_memories WHERE bundle=?').run(id);
      db.prepare('DELETE FROM central_bundles WHERE id=?').run(id);
    }
    for (const { bundle, rows } of changed) {
      for (const row of rows) {
        db.prepare('INSERT INTO central_memories VALUES(?,?,?,?,?,?,?)').run(row.id, bundle.id, row.title, row.content, JSON.stringify(row.tags), row.issue || null, date);
        db.prepare('INSERT INTO central_fts(id,title,content,tags) VALUES(?,?,?,?)').run(row.id, row.title, row.content, row.tags.join(' '));
      }
      db.prepare('INSERT INTO central_bundles VALUES(?,?)').run(bundle.id, bundle.sha256);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { revision: manifest.revision, changedBundles: changed.length };
}
export async function githubIdentity(api = githubApi) {
  const user = await api('user');
  if (!/^[a-z0-9-]{1,39}$/i.test(user.login || '')) throw new Error('Conta GitHub inválida.');
  return { login: user.login };
}
async function pushCentral(api, stillAllowed) {
  const db = await centralDb();
  // A crash after the POST may have published the issue. Never blindly retry it.
  db.prepare("UPDATE central_outbox SET status='uncertain' WHERE status='sending'").run();
  const pending = db.prepare("SELECT * FROM central_outbox WHERE status IN ('queued','uncertain') ORDER BY created_at LIMIT 10").all();
  if (!pending.length) return 0;
  const { login } = await githubIdentity(api);
  const existing = await api(`repos/${CENTRAL_REPO}/issues?creator=${encodeURIComponent(login)}&state=all&per_page=100&sort=created&direction=desc`);
  if (!Array.isArray(existing)) throw new Error('Lista de contribuições inválida.');
  let sent = 0;
  for (const row of pending) {
    if (!await stillAllowed()) break;
    if (!['queued','uncertain'].includes(db.prepare('SELECT status FROM central_outbox WHERE id=?').get(row.id)?.status)) continue;
    const marker = `<!-- aurora-central-v1:${row.id} -->`;
    const previous = existing.find(issue => !issue.pull_request && issue.body?.startsWith(marker));
    if (previous) {
      db.prepare("UPDATE central_outbox SET status='sent',sent_at=?,issue_url=?,error=NULL WHERE id=?").run(new Date().toISOString(), issueUrl(previous), row.id); continue;
    }
    if (row.status === 'uncertain') continue;
    const payload = JSON.parse(row.payload);
    if (contribution(payload.memory).id !== row.id) throw new Error('Contribuição aprovada foi alterada.');
    db.prepare("UPDATE central_outbox SET status='sending' WHERE id=?").run(row.id);
    try {
      const issue = await api(`repos/${CENTRAL_REPO}/issues`, { method: 'POST', body: { title: `[Memória central] ${payload.memory.title}`, body: contributionBody(payload) } });
      db.prepare("UPDATE central_outbox SET status='sent',sent_at=?,issue_url=?,error=NULL WHERE id=?").run(new Date().toISOString(), issueUrl(issue), row.id); sent++;
    } catch (error) {
      db.prepare("UPDATE central_outbox SET status='uncertain',error=? WHERE id=?").run('Envio sem confirmação. Confira suas issues no GitHub; não haverá reenvio automático.', row.id);
      throw error;
    }
  }
  return sent;
}
function issueUrl(issue) {
  if (!Number.isSafeInteger(issue.number) || issue.number < 1) throw new Error('GitHub não retornou o número da contribuição.');
  return `https://github.com/${CENTRAL_REPO}/issues/${issue.number}`;
}
export async function syncCentral({ manual = false, now = Date.now(), download, api = githubApi } = {}) {
  const db = await centralDb(), config = await centralConfig(), state = read(db, stateKey, {});
  if (!config.downloadEnabled && !config.shareEnabled) return centralStatus();
  if (!manual && state.nextAt && Date.parse(state.nextAt) > now) return centralStatus();
  const owner = randomUUID();
  const locked = db.prepare('INSERT INTO central_lock(id,owner,expires) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE central_lock.expires < ?').run(owner, now + 300000, now).changes;
  if (!locked) return centralStatus();
  const lease = setInterval(() => db.prepare('UPDATE central_lock SET expires=? WHERE owner=?').run(Date.now() + 300000, owner), 30000); lease.unref();
  const next = { ...state, lastAttemptAt: new Date(now).toISOString(), error: null };
  try {
    if (config.downloadEnabled) {
      const pulled = await pullCentral({ download, now, stillAllowed: async () => (await centralConfig()).downloadEnabled });
      if (!pulled.cancelled) { next.revision = pulled.revision; next.downloadedAt = new Date(now).toISOString(); next.changedBundles = pulled.changedBundles; }
    }
    if ((await centralConfig()).shareEnabled) next.sent = await pushCentral(api, async () => (await centralConfig()).shareEnabled);
    next.lastSuccessAt = new Date(now).toISOString();
    next.nextAt = new Date(now + (await centralConfig()).intervalHours * 3600000).toISOString();
  } catch (error) {
    next.error = String(error.message || 'Falha na sincronização.').slice(0, 500);
    next.nextAt = new Date(now + 15 * 60000).toISOString();
  } finally {
    clearInterval(lease); write(db, stateKey, next);
    db.prepare('DELETE FROM central_lock WHERE owner=?').run(owner);
  }
  return centralStatus();
}
export function startCentralScheduler() {
  let stopped = false, timer;
  const tick = async () => { try { if (!stopped) await syncCentral(); } catch { /* Next tick retries; no unhandled rejection. */ } finally { if (!stopped) { timer = setTimeout(tick, 60000); timer.unref(); } } };
  timer = setTimeout(tick, 1000); timer.unref();
  return () => { stopped = true; clearTimeout(timer); };
}
