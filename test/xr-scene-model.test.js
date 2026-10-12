import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { XRStore, createXRHandler } from '../app/xrBridge.js';
import { createSceneModel } from '../app/xrScene.js';
import { createBridgeClient } from '../app/xr/lib/api.js';
import { sceneSchema, sceneSystem, recipeFor, sceneFromPrompt, mergeWithDraft } from '../app/xr/lib/scene.js';
import { indexCatalog, resolveType, relevantTypes, compose } from '../app/xr/lib/compose.js';

const cat = indexCatalog(JSON.parse(readFileSync(new URL('../app/xr/assets/catalog.json', import.meta.url), 'utf8')));
const resolve = (w) => resolveType(cat, w);

test('XR scene: the theme is the one the request names most ("cidade medieval com castelos" is a kingdom)', () => {
  assert.equal(recipeFor('Faço uma cidade medieval com castelos e estradas e animais').titulo, 'Reino');
  assert.equal(recipeFor('monta uma cidade com carros').titulo, 'Cidade');
  assert.equal(recipeFor('uma fortaleza com muralhas sob cerco').titulo, 'Fortaleza');
  assert.equal(recipeFor('algo bonito'), null);
});

test('XR scene: the answer is held to a schema of the library (zones that exist, the types told, sensible counts)', () => {
  const told = relevantTypes(cat, 'um castelo medieval').map((t) => t.id);
  const schema = sceneSchema(told);
  const item = schema.properties.zonas.items.properties.itens.items;
  assert.deepEqual(item.properties.tipo.enum, [...new Set(told)]); assert.equal(item.properties.qtd.maximum, 12);
  assert.ok(!schema.properties.zonas.items.properties.tipo.enum.includes('ceu'));
  assert.deepEqual(schema.required.sort(), ['chao', 'estrada', 'frase', 'itens', 'titulo', 'zonas']);
  const system = sceneSystem(told.map((id) => cat.byId.get(id)), recipeFor('castelo'));
  assert.match(system, /maquetista/); assert.match(system, /castelo \(\d+ cm\):/); assert.match(system, /"titulo":"Reino"/);
  // What she answers with it is used whole (its types are all of the request).
  const answer = { titulo: 'Reino Medieval', chao: 'grama', estrada: 'anel', zonas: [{ tipo: 'livre', onde: 'fundo', tam: 'g', itens: [{ tipo: 'castelo', qtd: 1 }, { tipo: 'torre', qtd: 2 }] }, { tipo: 'cercado', onde: 'direita', tam: 'm', itens: [{ tipo: 'cavalo', qtd: 3 }] }], itens: [{ tipo: 'soldado', qtd: 4 }], frase: 'Um reino.' };
  const m = mergeWithDraft(answer, sceneFromPrompt('um castelo medieval', resolve), resolve, told);
  assert.equal(m.used, true); assert.ok(compose(m.spec, cat, 's').things.some((t) => t.type === 'castelo'));
  // A zone named after a thing ("castelo") becomes an open zone with it.
  assert.ok(compose({ zonas: [{ tipo: 'castelo', itens: [{ tipo: 'torre', qtd: 2 }] }] }, cat, 's').things.some((t) => t.type === 'castelo'));
});

test('XR scene model: the desktop\'s local model with the schema; off -> 503; bad input -> 400', async () => {
  const calls = [];
  const fetchImpl = async (url) => ({ ok: true, json: async () => ({ data: [{ id: 'qwen3.5:4b' }] }), url });
  const run = async (messages, env) => { calls.push({ messages, env }); return { ok: true, text: '{"titulo":"X"}', usage: { output_tokens: 9 } }; };
  const scene = createSceneModel({ env: { LLAMA_SERVER_PORT: '18555' }, run, fetchImpl });
  const r = await scene({ system: 'regras', prompt: 'Monte: praia', schema: { type: 'object' } });
  assert.equal(r.text, '{"titulo":"X"}'); assert.equal(r.model, 'qwen3.5:4b');
  assert.equal(calls[0].env.LOCAL_BASE_URL, 'http://127.0.0.1:18555'); assert.equal(calls[0].env.LOCAL_OUTPUT_SCHEMA, '{"type":"object"}');
  assert.deepEqual(calls[0].messages.map((m) => m.role), ['system', 'user']);
  await assert.rejects(scene({ prompt: '', schema: {} }), (e) => e.status === 400);
  await assert.rejects(scene({ prompt: 'x', schema: null }), (e) => e.status === 400);
  const off = createSceneModel({ run, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  await assert.rejects(off({ prompt: 'x', schema: {} }), (e) => e.status === 503);
});

test('XR bridge: /scene is an operation of a paired device, and capabilities say it exists', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'aurora-xr-scene-'));
  const seen = [];
  const store = new XRStore(directory);
  const b = createXRHandler({ store, desktop: async () => ({}), scene: async (req) => { seen.push(req); return { text: '{"titulo":"Praia"}' }; } });
  const server = http.createServer(b.handler); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => { await new Promise((r) => server.close(r)); rmSync(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const { token } = store.issueDevice('Quest');
  const mem = new Map([['aurora-xr-token', token]]); const storage = { get: (k) => mem.get(k), set: (k, v) => mem.set(k, v), remove: (k) => mem.delete(k) };
  const client = createBridgeClient({ base, storage, pollMs: 10 });
  assert.equal((await client.capabilities()).scene, true);
  const r = await client.scene('regras', 'Monte: praia', { type: 'object' });
  assert.equal(r.text, '{"titulo":"Praia"}'); assert.deepEqual(seen[0], { system: 'regras', prompt: 'Monte: praia', schema: { type: 'object' } });
  // Without a token: refused.
  assert.equal((await fetch(`${base}/xr/v1/scene`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
});
