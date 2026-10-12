import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { XRStore, createXRHandler } from '../app/xrBridge.js';
import { twinLayout, shortName, liveLabel, waitText } from '../app/xr/lib/twinLayout.js';
import { Pinch, Summon, HeadMotion, twoHand, lazyFollow, openHand, palmFacesHead } from '../app/xr/lib/gestures.js';
import { voiceCommand, encodeWav, downsample, SilenceGate } from '../app/xr/lib/voice.js';
import { deviceProfile, sessionInit } from '../app/xr/lib/device.js';
import { createBridgeClient, createChat } from '../app/xr/lib/api.js';

const state = {
  version: 1, title: 'Operação dos CDs', kind: 'operacao', lastRefresh: new Date().toISOString(), glyph: 'veiculo', noun: 'caminhões', placeLabel: 'Doca', environment: 'armazem', colorBy: null,
  stages: [{ key: 'fila', label: 'Pedido recebido' }, { key: 'carregando', label: 'Carregando' }],
  units: [
    { name: 'CD Contagem', places: [{ name: 'Doca 01', serving: ['ABC-1'], waiting: ['DEF-2'] }, { name: 'Doca 02', serving: [], waiting: [] }], queue: ['GHI-3'], road: ['JKL-4'], counts: { total: 4 } },
    { name: 'CD Betim', places: [{ name: 'Doca 01', serving: ['MNO-5'], waiting: [] }], queue: [], road: [], counts: { total: 2 } },
  ],
  entities: [
    { name: 'ABC-1', status: 'Carregando', where: 'doca', place: 'Doca 01', late: false, unit: 'CD Contagem' },
    { name: 'DEF-2', status: 'Pedido recebido', where: 'filalocal', place: 'Doca 01', late: true, unit: 'CD Contagem' },
    { name: 'GHI-3', status: 'Pedido recebido', where: 'fila', late: false, unit: 'CD Contagem' },
    { name: 'JKL-4', status: 'Em trânsito', where: 'estrada', late: false, unit: 'CD Contagem' },
    { name: 'MNO-5', status: 'Carregando', where: 'doca', place: 'Doca 01', unit: 'CD Betim' },
  ],
  numbers: { 'Caminhões nas docas': '1', 'Caminhões na fila': '2' },
  highlight: { values: ['Doca 02'], note: 'Doca 02 livre' }, notes: [{ when: '22:57', text: 'GHI-3 chegou.' }],
};

test('XR twin layout: one object per entity, where it is, in the colour of its stage', () => {
  const L = twinLayout(state);
  assert.equal(L.unit, 'CD Contagem');
  assert.equal(L.items.length, 4); assert.equal(L.drawn, 4); assert.equal(L.total, 4); assert.equal(L.seal.ok, true);
  assert.match(L.seal.text, /4 de 4/);
  const by = Object.fromEntries(L.items.map((i) => [i.name, i]));
  assert.equal(by['DEF-2'].color, '#d94b4b');            // late
  assert.equal(by['GHI-3'].color, '#f6d365');            // stage "fila"
  assert.equal(by['ABC-1'].color, '#2f6fdb');            // stage "carregando"
  assert.equal(by['JKL-4'].rot, Math.PI);                // on the way out, turned back
  assert.ok(by['ABC-1'].z < by['DEF-2'].z);              // served nearer the dock than its own line
  assert.equal(L.places.length, 2); assert.equal(L.places[1].free, true); assert.equal(L.places[1].highlight, true);
  assert.equal(L.places[0].short, '01');
  assert.equal(twinLayout(state, 'CD Betim').items.length, 1);
  assert.equal(twinLayout({ ...state, kind: 'numeros' }).operation, false);
  assert.equal(twinLayout(null).operation, false);
});

test('XR twin layout: risk colours win over stages, and what does not fit is written', () => {
  const s = structuredClone(state);
  s.colorBy = { column: 'Risco', values: [['Vermelho', '#ff0000'], ['Verde', '#00ff00']] };
  s.entities[0].color = 'vermelho';
  s.units[0].queue = Array.from({ length: 25 }, (_, i) => `Q-${i}`);
  s.units[0].counts.total = 28;
  const L = twinLayout(s);
  assert.equal(L.items.find((i) => i.name === 'ABC-1').color, '#ff0000');
  assert.equal(L.extra, '+5 na fila'); assert.equal(L.seal.ok, false); assert.match(L.seal.text, /23 de 28/);
});

test('XR text helpers', () => {
  assert.equal(shortName('Guichê 4', 'Guichê'), '4'); assert.equal(shortName('Leito A', ''), 'Leito A');
  assert.equal(waitText(18), '18 min'); assert.equal(waitText(130), '2 h 10'); assert.equal(waitText(120), '2 h');
  const now = Date.parse('2026-10-12T15:00:00Z');
  assert.equal(liveLabel('2026-10-12T14:55:00Z', now).stale, false); assert.equal(liveLabel('2026-10-12T14:40:00Z', now).stale, true);
});

test('XR pinch has hysteresis and needs the fingers apart first', () => {
  const p = new Pinch(); const o = [0, 0, 0];
  assert.equal(p.update(true, o, [0.01, 0, 0]), false);  // starts closed: not armed
  assert.equal(p.update(true, o, [0.05, 0, 0]), false);
  assert.equal(p.update(true, o, [0.02, 0, 0]), true);
  assert.equal(p.update(true, o, [0.03, 0, 0]), true);   // holds until 3.5 cm
  assert.equal(p.update(true, o, [0.04, 0, 0]), false);
  assert.equal(p.update(false, o, o), false);
});

test('XR summon fires once after 0.8 s and never on lost tracking', () => {
  const s = new Summon(); let fired = 0;
  for (let i = 0; i < 30; i++) fired += s.update(true, true, 0.05) ? 1 : 0;
  assert.equal(fired, 1);
  for (let i = 0; i < 30; i++) fired += s.update(false, true, 0.05) ? 1 : 0;
  assert.equal(fired, 1);
});

test('XR hand shapes: open hand and palm to the face', () => {
  const j = { wrist: [0, 0, 0], 'thumb-tip': [-0.06, 0.05, 0], 'index-finger-tip': [0, 0.17, 0], 'middle-finger-tip': [0.02, 0.18, 0], 'ring-finger-tip': [0.04, 0.17, 0], 'pinky-finger-tip': [0.06, 0.15, 0],
    'index-finger-metacarpal': [-0.01, 0.06, 0], 'pinky-finger-metacarpal': [0.04, 0.05, 0] };
  assert.equal(openHand(j), true);
  assert.equal(openHand({ ...j, 'index-finger-tip': [0, 0.05, 0] }), false);
  // Right hand: (index - wrist) x (pinky - wrist) points to -z; a head at -z sees the palm.
  assert.equal(palmFacesHead(j, 'right', [0, 0.1, -0.4]), true);
  assert.equal(palmFacesHead(j, 'right', [0, 0.1, 0.4]), false);
});

test('XR two hands scale, turn and move what they hold', () => {
  const t = twoHand([-0.1, 1, -0.5], [0.1, 1, -0.5], [-0.2, 1, -0.5], [0.2, 1, -0.5]);
  assert.ok(Math.abs(t.scale - 2) < 1e-9); assert.ok(Math.abs(t.yaw) < 1e-9);
  const r = twoHand([-0.1, 1, 0], [0.1, 1, 0], [0, 1, -0.1], [0, 1, 0.1]);
  assert.ok(Math.abs(Math.abs(r.yaw) - Math.PI / 2) < 1e-9);
  const m = twoHand([0, 1, 0], [0.2, 1, 0], [0, 1.1, 0], [0.2, 1.1, 0]);
  assert.ok(Math.abs(m.move[1] - 0.1) < 1e-9);
});

test('XR panel stays while you look around and follows when you turn away or walk', () => {
  const head = [0, 1.6, 0];
  assert.equal(lazyFollow({ panel: null, head, forward: [0, 0, -1] }).move, true);
  assert.equal(lazyFollow({ panel: [0.2, 1.5, -0.9], head, forward: [0, 0, -1] }).move, false);
  assert.equal(lazyFollow({ panel: [0, 1.5, -0.9], head, forward: [1, 0, 0] }).move, true);
  assert.equal(lazyFollow({ panel: [0, 1.5, -0.9], head, forward: [0, 0, -1], walking: true }).move, true);
  const m = new HeadMotion(); let walking = false;
  for (let i = 0; i <= 60; i++) walking = m.update([0, 1.6, -i * 0.02], i / 60, 1 / 60);  // 1.2 m/s for 1 s
  assert.equal(walking, true);
  for (let i = 61; i <= 200; i++) walking = m.update([0, 1.6, -1.2], i / 60, 1 / 60);
  assert.equal(walking, false);
});

test('XR voice commands are whole phrases; WAV is 16-bit mono', () => {
  assert.equal(voiceCommand('Aurora, pare.'), 'stop');
  assert.equal(voiceCommand('Mostra a operação'), 'page:operacao');
  assert.equal(voiceCommand('traz o painel'), 'recenter');
  assert.equal(voiceCommand('pare de mandar e-mail para o João'), null);
  const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]), 16000);
  const v = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.subarray(0, 4)), 'RIFF'); assert.equal(v.getUint32(24, true), 16000); assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getInt16(46, true), 32767); assert.equal(v.getInt16(48, true), -32768);
  assert.equal(downsample(new Float32Array(48000), 48000).length, 16000);
  const g = new SilenceGate(); let done = false;
  for (let i = 0; i < 10; i++) done = g.update(0.2, 0.1);
  assert.equal(done, false);
  for (let i = 0; i < 12 && !done; i++) done = g.update(0, 0.1);
  assert.equal(done, true);
});

test('XR device profile: headset, phone and PC present themselves differently', () => {
  const quest = deviceProfile({ width: 1280, height: 720, touch: false, coarse: false, ar: true, vr: true, ua: 'Mozilla/5.0 (X11; Linux x86_64; Quest 3S) OculusBrowser/41' });
  assert.equal(quest.kind, 'headset'); assert.deepEqual(quest.modes, ['mr', 'vr']); assert.equal(quest.primary, 'mr');
  const phone = deviceProfile({ width: 390, height: 844, touch: true, coarse: true, ar: true, vr: false, ua: 'Android' });
  assert.equal(phone.kind, 'phone'); assert.deepEqual(phone.modes, ['ar']); assert.equal(phone.layout, 'stack');
  const pc = deviceProfile({ width: 1600, height: 900, touch: false, coarse: false, ar: false, vr: false, ua: 'Windows' });
  assert.equal(pc.kind, 'desktop'); assert.equal(pc.layout, 'split'); assert.deepEqual(pc.modes, []);
  const init = sessionInit(quest, 'mr', null);
  assert.ok(init.optionalFeatures.includes('hand-tracking')); assert.ok(init.optionalFeatures.includes('anchors')); assert.equal(init.domOverlay, undefined);
  assert.deepEqual(sessionInit(phone, 'ar', { id: 'body' }).domOverlay, { root: { id: 'body' } });
});

async function bridge(t, desktop) {
  const directory = mkdtempSync(join(tmpdir(), 'aurora-xr-app-'));
  const store = new XRStore(directory); const b = createXRHandler({ store, desktop });
  const server = http.createServer(b.handler); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => { await new Promise((r) => server.close(r)); rmSync(directory, { recursive: true, force: true }); });
  return { base: `http://127.0.0.1:${server.address().port}`, store, b };
}

test('XR bridge serves the web app with a strict policy and nothing outside it', async (t) => {
  const { base } = await bridge(t, async () => ({}));
  const page = await fetch(`${base}/xr/app/`);
  assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(await page.text(), /Aurora XR/);
  assert.equal((await fetch(`${base}/xr/app/vendor/three.module.js`)).status, 200);
  assert.equal((await fetch(`${base}/xr/app/lib/twinLayout.js`)).headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal((await fetch(`${base}/xr/app/..%2F..%2Fpackage.json`)).status, 404);
  assert.notEqual((await fetch(`${base}/xr/app/%2e%2e/xrBridge.js`)).status, 200);
  assert.equal((await fetch(`${base}/`, { redirect: 'manual' })).headers.get('location'), '/xr/app/');
});

test('XR bridge: the app pairs from the PC, uses its own origin and refuses other sites', async (t) => {
  const { base, store } = await bridge(t, async () => ({ projects: [{ id: 'p', name: 'Aurora' }] }));
  const opened = await (await fetch(`${base}/xr/v1/pairing`, { method: 'POST' })).json();
  assert.match(opened.code, /^\d{6}$/); assert.ok(Array.isArray(opened.addresses));
  const mem = new Map(); const storage = { get: (k) => mem.get(k), set: (k, v) => mem.set(k, v), remove: (k) => mem.delete(k) };
  const host = new URL(base).host;
  // A browser on the app's page sends its own origin.
  const browserFetch = (url, opts = {}) => fetch(url, { ...opts, headers: { ...opts.headers, origin: `http://${host}` } });
  const client = createBridgeClient({ base, storage, fetch: browserFetch });
  await client.pair(opened.code, 'Celular');
  assert.equal(client.paired, true); assert.ok(mem.get('aurora-xr-token'));
  assert.equal((await client.projects()).projects[0].name, 'Aurora');
  const token = mem.get('aurora-xr-token');
  const evil = await fetch(`${base}/xr/v1/projects`, { headers: { authorization: `Bearer ${token}`, origin: 'https://evil.example' } });
  assert.equal(evil.status, 403);
  assert.ok(Object.keys(store.data.devices).length === 1);
});

test('XR chat creates the conversation once, follows the stage and returns the answer', async (t) => {
  const seen = []; let polls = 0;
  const { base, store } = await bridge(t, async (path, method, body) => {
    seen.push(`${method || 'GET'} ${path}`);
    if (path === '/conversations' && method === 'POST') return { id: 'c1', title: body.title };
    if (path === '/conversations/c1/pending') { polls++; return { stage: 'Pensando', partial: 'Olá' }; }
    if (path === '/conversations/c1/messages') { await new Promise((r) => setTimeout(r, 30)); return { message: { role: 'assistant', content: `Eco: ${body.message}` } }; }
    return {};
  });
  const { token } = store.issueDevice('Quest');
  const mem = new Map([['aurora-xr-token', token]]); const storage = { get: (k) => mem.get(k), set: (k, v) => mem.set(k, v), remove: (k) => mem.delete(k) };
  const client = createBridgeClient({ base, storage, pollMs: 15 });
  const chat = createChat(client, storage); const stages = [];
  const reply = await chat.send('Oi Aurora', { onStage: (p) => stages.push(p.stage) });
  assert.equal(reply.content, 'Eco: Oi Aurora'); assert.equal(chat.id, 'c1'); assert.equal(mem.get('aurora-xr-conversation'), 'c1');
  await chat.send('De novo');
  assert.equal(seen.filter((s) => s === 'POST /conversations').length, 1);
  assert.ok(polls >= 1 && stages.includes('Pensando'));
});

test('XR scenes: the Aurora block read leniently, a draft from the words, laid out on the plate', async () => {
  const { parseSceneReply, sceneFromPrompt, normalizeScene, isSceneRequest, sceneEdit, editScene, mentioned, ownWords, SCENE_PROMPT, PLATE, CATALOG } = await import('../app/xr/lib/scene.js');
  // The block, with a trailing comma and curly quotes as small models write it.
  const r = parseSceneReply('Montei! ```cena\n{"titulo":"Lua","chao":"espaco","itens":[{"tipo":"foguetes","qtd":2},{"tipo":"unicórnio"},]}\n```');
  assert.equal(r.spec.titulo, 'Lua'); assert.equal(r.rest, 'Montei!');
  const s = normalizeScene(r.spec, 'x');
  assert.equal(s.ground, 'espaco'); assert.deepEqual(s.items.map((i) => i.type), ['foguete', 'foguete', 'objeto']);
  assert.equal(s.items[2].label, 'unicórnio');                       // unknown: a box with its name
  // Without a fence, the JSON object in the text; without any, nothing.
  assert.equal(parseSceneReply('ok {"titulo":"X","itens":[{"tipo":"vaca"}]} fim').spec.itens.length, 1);
  assert.equal(parseSceneReply('Não sei montar isso.').spec, null);
  // An echo of the request (with the instruction's example) never becomes the scene: that was the
  // "always the farm" bug.
  assert.equal(parseSceneReply(`Você disse: “O sistema solar${SCENE_PROMPT}”.`).spec, null);
  assert.equal(parseSceneReply('```cena\n{"titulo":"…","chao":"grama|areia","itens":[{"tipo":"vaca"}]}\n```').spec, null);
  // The draft from the request: its theme and the things it counts.
  assert.deepEqual(mentioned('faz 5 vacas, dois tratores e uma árvore'), [['vaca', 5], ['trator', 2], ['arvore', 1]]);
  const farm = normalizeScene(sceneFromPrompt('Aurora, faz uma fazenda com 6 vacas'), 'seed');
  assert.equal(farm.title, 'Fazenda'); assert.equal(farm.ground, 'grama');
  assert.equal(farm.items.filter((i) => i.type === 'vaca').length, 6);
  // Everything on the plate, the same request the same scene, at most 60 things.
  for (const i of farm.items) { assert.ok(Math.abs(i.x) <= PLATE.width / 2 && Math.abs(i.z) <= PLATE.depth / 2, i.id); assert.ok(CATALOG[i.type]); }
  assert.deepEqual(normalizeScene(sceneFromPrompt('fazenda com 6 vacas'), 'seed'), normalizeScene(sceneFromPrompt('fazenda com 6 vacas'), 'seed'));
  assert.equal(normalizeScene({ itens: [{ tipo: 'peixe', qtd: 20 }, { tipo: 'pato', qtd: 20 }, { tipo: 'vaca', qtd: 20 }, { tipo: 'arvore', qtd: 20 }] }).items.length, 60);
  // Vehicles drive the ring road, a fish brings its lake, things in the air stay up.
  const city = normalizeScene({ itens: [{ tipo: 'carro' }, { tipo: 'peixe' }, { tipo: 'aviao' }] });
  assert.deepEqual(city.items.map((i) => [i.type, i.behavior]), [['lago', 'parado'], ['carro', 'rodar'], ['peixe', 'nadar'], ['aviao', 'voar']]);
  assert.ok(city.items[3].y > 0.05);
  const fish = city.items[2], lake = city.items[0]; assert.ok(Math.hypot(fish.x - lake.x, fish.z - lake.z) < 0.07);
  // Asking and changing.
  assert.ok(isSceneRequest('Aurora, cria um cenário de praia')); assert.ok(isSceneRequest('monta uma maquete de um castelo'));
  assert.ok(!isSceneRequest('monta o power bi da operação')); assert.ok(!isSceneRequest('o que mudou na operação?'));
  assert.deepEqual(sceneEdit('adiciona 3 cavalos'), { op: 'add', things: [['cavalo', 3]] });
  assert.equal(sceneEdit('qual é a capital da França?'), null);
  const less = editScene({ itens: [{ tipo: 'carro', qtd: 3 }, { tipo: 'vaca' }] }, sceneEdit('tira os carros'));
  assert.deepEqual(less.itens, [{ tipo: 'vaca' }]);
  // The app's instruction is not shown back as the person's words.
  assert.equal(ownWords(`faz uma praia${SCENE_PROMPT}`), 'faz uma praia');
});

test('XR dynamics: behaviours, a push and the spring back, neighbours in line stay put', async () => {
  const { makeBody, stepBodies, behave, returnArc, RING } = await import('../app/xr/lib/dynamics.js');
  const bounds = { w: 0.6, d: 0.45 };
  // A car on the ring road moves along it and faces where it goes.
  const car = makeBody({ x: RING.ax, z: 0, behavior: 'rodar', bounds });
  const a = behave(car, 0), b = behave(car, 1);
  assert.ok(Math.abs(a.x - RING.ax) < 1e-9 && b.z > 0.02);
  assert.ok(Math.abs((b.x / RING.ax) ** 2 + (b.z / RING.az) ** 2 - 1) < 1e-9);
  // A cow wanders around its place, never far.
  const cow = makeBody({ x: 0.1, z: 0.05, behavior: 'passear', seed: 3 });
  for (let t = 0; t < 60; t += 1.7) { const p = behave(cow, t); assert.ok(Math.hypot(p.x - 0.1, p.z - 0.05) < 0.08); }
  // Two trucks in line, closer than their sizes by design: nothing moves them until a finger does.
  const t1 = makeBody({ x: 0, z: 0, radius: 0.0225, height: 0.022, bounds }), t2 = makeBody({ x: 0.03, z: 0, radius: 0.0225, height: 0.022, bounds });
  const bodies = [t1, t2]; let t = 0;
  for (let i = 0; i < 30; i++) stepBodies(bodies, { t: (t += 1 / 60), dt: 1 / 60 });
  assert.equal(t1.pose.x, 0); assert.equal(t2.pose.x, 0.03);
  // A fingertip 1 cm from the first: it moves out of the way...
  for (let i = 0; i < 10; i++) stepBodies(bodies, { t: (t += 1 / 60), dt: 1 / 60, pushers: [{ x: -0.01, y: 0.01, z: 0, r: 0.01 }] });
  assert.ok(Math.hypot(t1.ox, t1.oz) > 0.015);
  // ...a finger high above touches nothing...
  const free = makeBody({ x: 0.2, z: 0.1, radius: 0.02, height: 0.02 });
  stepBodies([free], { t, dt: 1 / 60, pushers: [{ x: 0.2, y: 0.2, z: 0.1, r: 0.02 }] }); assert.equal(free.ox, 0);
  // ...and once the finger leaves, both are back in their places.
  for (let i = 0; i < 120; i++) stepBodies(bodies, { t: (t += 1 / 60), dt: 1 / 60 });
  assert.ok(Math.hypot(t1.pose.x - 0, t1.pose.z) < 0.001 && Math.hypot(t2.pose.x - 0.03, t2.pose.z) < 0.001);
  // Held bodies are left to the hand; the plate's edge holds the others.
  const held = makeBody({ x: 0, z: 0 }); held.held = true; held.pose = { x: 9, y: 9, z: 9, rot: 0 };
  stepBodies([held], { t, dt: 1 / 60 }); assert.equal(held.pose.x, 9);
  const edge = makeBody({ x: 0.28, z: 0, radius: 0.02, bounds });
  stepBodies([edge], { t, dt: 1 / 60, pushers: [{ x: 0.25, z: 0, r: 0.04 }] }); assert.ok(edge.pose.x <= 0.28 + 1e-9);
  // The way home: eased, lifted in the middle, exactly there at the end.
  assert.deepEqual(returnArc(0), { mix: 0, lift: 0 }); assert.equal(returnArc(1).mix, 1); assert.ok(returnArc(0.5).lift > 0.99);
});
