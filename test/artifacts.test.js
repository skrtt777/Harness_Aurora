import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractArtifacts, listArtifacts, materializeArtifact } from '../app/artifacts.js';

const message = (content, id = 'message-1') => ({ id, role: 'assistant', content, createdAt: '2026-09-20T00:00:00Z' });
test('files preserve exact content, prose offsets and distinct versions', () => {
  const m = message('Aqui está.\n```html filename=index.html\n<html>jogo</html>\n```\nAjuste pelo chat.\n```json\n{"a":2}\n```');
  const files = extractArtifacts(m);
  assert.equal(files.length, 2); assert.equal(files[0].name, 'index.html');
  assert.equal(files[0].content, '<html>jogo</html>'); assert.equal(m.content.slice(0, files[0].start), 'Aqui está.\n');
  assert.equal(files[1].name, 'arquivo.json'); assert.equal(files[1].previewable, false);
  assert.equal(listArtifacts([m])[0].content, undefined);
  assert.notEqual(extractArtifacts(message(m.content, 'message-2'))[0].id, files[0].id);
  assert.equal(extractArtifacts({ ...m, role: 'user' }).length, 0);
  assert.equal(extractArtifacts(message('Texto normal sem código.')).length, 0);
});
test('raw HTML, named fences and Windows path edge cases are handled without traversal', () => {
  assert.equal(extractArtifacts(message('Texto\n<html><body>ok</body></html>Fim'))[0].content, '<html><body>ok</body></html>');
  const files = extractArtifacts(message('```html filename=../../CON.html\n<html></html>\n```\n```json filename=../../report.json\n{}\n```\n```json report.json\n{}\n```'));
  assert.equal(files[0].name, 'arquivo.html'); assert.equal(files[1].name, 'report.json'); assert.equal(files[2].name, '3-report.json');
  assert.equal(extractArtifacts(message('```index.html\n<html></html>\n```'))[0].previewable, true);
  assert.equal(extractArtifacts(message('```payload.exe\ntext\n```'))[0].name, 'payload.txt');
  assert.equal(extractArtifacts(message('```constructor\nx\n```')).length, 0);
});
test('opening is idempotent, saves real files and does not overwrite external edits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aurora-artifacts-'));
  const file = extractArtifacts(message('```json\n{"total":10}\n```'))[0];
  const saved = await materializeArtifact('conversation-1', file, directory);
  assert.equal(await readFile(saved.filePath, 'utf8'), file.content);
  assert.equal((await materializeArtifact('conversation-1', file, directory)).filePath, saved.filePath);
  await writeFile(saved.filePath, 'user edits');
  await assert.rejects(materializeArtifact('conversation-1', file, directory), /editado/);
  assert.equal(await readFile(saved.filePath, 'utf8'), 'user edits');
  await assert.rejects(materializeArtifact('../escape', file, directory), /inválido/);
  await assert.rejects(materializeArtifact('conversation-1', { ...file, name: '../../escape' }, directory), /inválido/);
});
test('directory junctions cannot redirect writes outside the artifact directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aurora-artifacts-link-'));
  const outside = await mkdtemp(join(tmpdir(), 'aurora-artifacts-outside-'));
  await mkdir(join(directory, 'conversation-1'));
  await symlink(outside, join(directory, 'conversation-1', 'message-1'), 'junction');
  const file = extractArtifacts(message('```json\n{}\n```'))[0];
  await assert.rejects(materializeArtifact('conversation-1', file, directory), /inválida/);
});
test('HTTP artifact operations require session and conversation ownership', async () => {
  process.env.HARNESS_DB_FILE = join(await mkdtemp(join(tmpdir(), 'aurora-artifacts-api-')), 'test.db');
  process.env.EMBEDDINGS_ENABLED = 'false';
  const { createConversation, addMessage } = await import('../app/store.js');
  const { createServer } = await import('../app/server.js');
  const conversation = await createConversation({ provider: 'local' });
  const other = await createConversation({ provider: 'local' });
  const m = await addMessage({ conversationId: conversation.id, role: 'assistant', content: '```html\n<html>ok</html>\n```' });
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const route = `/api/conversations/${conversation.id}/artifacts`;
  try {
    assert.equal((await fetch(base + route)).status, 401);
    const headers = { 'x-harness-token': server.apiToken };
    const data = await (await fetch(base + route, { headers })).json();
    assert.equal(data.artifacts.length, 1); assert.equal(data.artifacts[0].messageId, m.id);
    const id = data.artifacts[0].id;
    assert.equal((await fetch(`${base}/api/conversations/${other.id}/artifacts/${id}/open`, { method: 'POST', headers })).status, 404);
    assert.equal((await fetch(`${base}${route}/${id}/open`, { method: 'POST' })).status, 401);
    const opened = await (await fetch(`${base}${route}/${id}/open`, { method: 'POST', headers })).json();
    assert.equal(opened.content, '<html>ok</html>'); assert.equal(await readFile(opened.filePath, 'utf8'), opened.content);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
