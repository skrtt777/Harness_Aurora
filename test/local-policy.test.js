import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
process.env.HARNESS_DB_FILE = join(mkdtempSync(join(tmpdir(), 'aurora-qwen3-')), 'test.db');
const { CURATED_MODELS, DEFAULT_LOCAL_MODEL, resolveLocalModel, setLocalModel } = await import('../app/ollamaSetup.js');
const { setSetting } = await import('../app/store.js');
const { runLocal } = await import('../app/local.js');

test('Qwen3 catalogue migrates retired choices without deleting settings and rejects selecting them again', async () => {
  assert.equal(DEFAULT_LOCAL_MODEL, 'qwen3.5:4b');
  assert.ok(CURATED_MODELS.every(m => /^qwen3/.test(m.id)));
  for (const model of ['qwen2.5-coder:1.5b', 'qwen2:7b', 'library/Qwen2.5:7b', 'aurora-local:1.5b-v2', 'aurora-local:1.5b-v2-e2', 'aurora-control:1.5b-v1']) {
    await setSetting('local_model', model);
    assert.equal(await resolveLocalModel({}), DEFAULT_LOCAL_MODEL);
    await assert.rejects(setLocalModel(model), /retirados/);
    // Historical research can explicitly reproduce its old model; it is not offered in the app.
    assert.equal(await resolveLocalModel({ LOCAL_MODEL: model }), model);
  }
  await setLocalModel('qwen3-coder:30b'); assert.equal(await resolveLocalModel({}), 'qwen3-coder:30b');
  await setLocalModel('auto');
});

test('Qwen3 uses direct answers by default and only enables thinking on explicit request', async () => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body)); res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ response: '{"ok":true}', prompt_eval_count: 10, eval_count: 5 }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const env = { LOCAL_BASE_URL: `http://127.0.0.1:${server.address().port}`, LOCAL_MODEL: 'qwen3.5:4b' };
    assert.equal((await runLocal('teste', env)).ok, true); assert.equal(requests.at(-1).think, false);
    await runLocal('teste', { ...env, LOCAL_THINK: 'true' }); assert.equal(requests.at(-1).think, true);
    await runLocal('teste', { ...env, LOCAL_MODEL: 'historical:custom' }); assert.equal('think' in requests.at(-1), false);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});
