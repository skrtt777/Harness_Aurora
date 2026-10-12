import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { compose, indexCatalog, resolveType, relevantTypes, PLATE, footprintOf, distToPath, standsStill } from '../app/xr/lib/compose.js';
import { sceneFromPrompt, parseSceneReply, scenePrompt, mergeWithDraft, recipeFor, isSceneRequest, sceneEdit, editScene, mentioned, ownWords, RECIPES } from '../app/xr/lib/scene.js';
import { makeBody, behave, stepBodies } from '../app/xr/lib/dynamics.js';
import { spokenPart } from '../app/xr/lib/voice.js';
import { TYPES } from '../scripts/xr-assets/library.mjs';

const catalog = JSON.parse(readFileSync(new URL('../app/xr/assets/catalog.json', import.meta.url), 'utf8'));
const cat = indexCatalog(catalog);
const resolve = (w) => resolveType(cat, w);
const W = PLATE.width, D = PLATE.depth;

test('XR library: every type explained to the Aurora, every model file present and CC0-sourced', () => {
  assert.ok(catalog.types.length >= 180, `${catalog.types.length} tipos`);
  for (const t of catalog.types) {
    assert.ok(t.nome && t.desc.length > 15 && t.tam > 0 && t.onde && t.zona && t.tags, t.id);
    for (const v of t.v) if (v.f) assert.ok(existsSync(new URL(`../app/xr/assets/${v.f}`, import.meta.url)), v.f);
  }
  // The library source names only Kenney packs, Quaternius models (poly.pizza) or the app's own drawings.
  for (const t of TYPES) for (const v of t.v) assert.match(v, /^(k:[a-z-]+\/[\w-]+|p:[\w-]+__[\w-]+|proc:\w+)$/, v);
  assert.match(readFileSync(new URL('../app/xr/assets/CREDITS.md', import.meta.url), 'utf8'), /CC0/);
  // Animals and people move: their files carry the walking animation.
  for (const id of ['vaca', 'cavalo', 'pessoa', 'tiranossauro', 'lobo']) assert.ok(cat.byId.get(id).v.some((v) => v.a?.walk || v.a?.run), id);
});

test('XR library: names as people say them', () => {
  assert.equal(resolve('vacas'), 'vaca'); assert.equal(resolve('coqueiro'), 'palmeira'); assert.equal(resolve('T-Rex'), 'tiranossauro');
  assert.equal(resolve('aviões'), 'aviao'); assert.equal(resolve('unicórnio'), null);
  assert.deepEqual(mentioned('uma fazenda com 6 vacas, dois tratores e uma árvore', resolve), [['vaca', 6], ['trator', 2], ['arvore', 1]]);
  // What the Aurora is told: the types that matter for the request, explained.
  const farm = relevantTypes(cat, 'uma fazenda com cavalos').map((t) => t.id);
  for (const id of ['cavalo', 'vaca', 'celeiro', 'cerca', 'trator']) assert.ok(farm.includes(id), id);
  assert.ok(!farm.includes('astronauta'));
  const prompt = scenePrompt(relevantTypes(cat, 'fazenda'));
  assert.match(prompt, /celeiro \(\d+ cm\): Celeiro vermelho/); assert.match(prompt, /cercado \(pasto com cerca/);
});

test('XR composer: a rich farm, laid out like a model (zones, fence with a gate, rows, water, roads)', () => {
  const spec = sceneFromPrompt('Aurora, faz uma fazenda com 8 vacas', resolve);
  assert.equal(spec.titulo, 'Fazenda');
  const L = compose(spec, cat, 'seed');
  const count = (id) => L.things.filter((t) => t.type === id).length;
  assert.equal(count('vaca'), 8); assert.ok(L.things.length > 100, `${L.things.length} coisas`); assert.ok(L.decor.length > 100);
  assert.deepEqual(L.missing, []);
  // Everything on the plate.
  for (const t of [...L.things.filter((x) => x.path == null), ...L.decor]) assert.ok(Math.abs(t.x) <= W / 2 + 1e-6 && Math.abs(t.z) <= D / 2 + 1e-6, `${t.type} ${t.x},${t.z}`);
  // The cows stay inside their fenced pasture, and the fence has a gate (a gap).
  const pasture = L.things.find((t) => t.type === 'vaca').area;
  assert.ok(pasture && L.things.filter((t) => t.type === 'vaca').every((c) => c.x > pasture.x0 && c.x < pasture.x1 && c.z > pasture.z0 && c.z < pasture.z1));
  assert.ok(L.fences.length > 10);
  // Crops in rows (same z), the tractor on the dirt road loop, fish on a swim loop inside the water.
  const corn = L.things.filter((t) => t.type === 'milho'); assert.ok(corn.length > 5 && new Set(corn.map((c) => c.z)).size < corn.length / 2);
  const tractor = L.things.find((t) => t.type === 'trator'); assert.equal(L.roads[tractor.path].kind, 'terra');
  const fish = L.things.find((t) => t.type === 'peixe'); assert.equal(L.roads[fish.path].kind, 'agua');
  const e = L.water[0]; assert.ok(L.roads[fish.path].points.every(([x, z]) => ((x - e.x) / e.rx) ** 2 + ((z - e.z) / e.rz) ** 2 < 1));
  // Same request, same scene.
  assert.deepEqual(compose(spec, cat, 'seed'), L);
});

test('XR composer: a city has streets on a grid, buildings facing them, cars driving them', () => {
  const L = compose(sceneFromPrompt('monta uma cidade', resolve), cat, 'c');
  assert.ok(L.roads.filter((r) => r.kind === 'rua').length >= 5);
  const cars = L.things.filter((t) => t.type === 'carro' && t.path != null); assert.ok(cars.length >= 5);
  // Nothing built on the streets.
  const streets = L.roads.filter((r) => r.kind === 'rua' && !r.loop);
  for (const b of L.things.filter((t) => ['predio', 'casa', 'arranha_ceu', 'sobrado'].includes(t.type))) {
    for (const r of streets) { const [[ax, az], [bx, bz]] = r.points; const d = ax === bx ? Math.abs(b.x - ax) : Math.abs(b.z - az); assert.ok(d > r.width / 2, `${b.type} na rua`); }
  }
});

test('XR composer: every recipe composes, fits the plate and uses only the library', () => {
  for (const r of RECIPES) {
    const L = compose(sceneFromPrompt(r.words.split(' ')[0], resolve), cat, r.titulo);
    assert.deepEqual(L.missing, [], r.titulo); assert.ok(L.things.length >= 20, `${r.titulo}: ${L.things.length}`);
    for (const t of L.things) assert.ok(cat.byId.has(t.type) && t.size > 0, t.type);
  }
  // An unknown thing is reported, not invented; an empty request still gives a park.
  assert.deepEqual(compose({ itens: [{ tipo: 'unicórnio' }, { tipo: 'vaca' }] }, cat).missing, ['unicórnio']);
  assert.equal(sceneFromPrompt('faz algo bonito', resolve).titulo, 'Parque');
});

test('XR scenes: the Aurora reply, checked against the request and enriched when thin', () => {
  const draft = sceneFromPrompt('o sistema solar', resolve);
  // An echo of the request (with the instruction's example) never becomes the scene.
  assert.equal(parseSceneReply(`Você disse: “O sistema solar${scenePrompt([])}”.`).spec, null);
  assert.equal(parseSceneReply('```cena\n{"titulo":"…","chao":"grama|areia","itens":[{"tipo":"vaca"}]}\n```').spec, null);
  // The instruction's farm example sent back for a solar system: the draft stays.
  const copied = parseSceneReply('Pronto!\n```cena\n{"titulo":"Fazenda Boa Vista","chao":"grama","zonas":[{"tipo":"cercado","itens":[{"tipo":"vaca","qtd":6}]}]}\n```');
  assert.equal(mergeWithDraft(copied.spec, draft, resolve).used, false);
  // A farm answered for a city (they share a tree and a car): still the city.
  const farm = { titulo: 'Fazenda', itens: ['vaca', 'trator', 'celeiro', 'arvore', 'carro', 'cavalo'].map((tipo) => ({ tipo })) };
  assert.equal(mergeWithDraft(farm, sceneFromPrompt('uma cidade', resolve), resolve).used, false);
  // A good but thin answer: hers, with the draft's zones added; lenient JSON (trailing comma).
  const thin = parseSceneReply('Montei! ```cena\n{"titulo":"Fazenda Sol","chao":"grama","zonas":[{"tipo":"cercado","itens":[{"tipo":"vacas","qtd":3},]}]}\n```');
  assert.equal(thin.rest, 'Montei!');
  const m = mergeWithDraft(thin.spec, sceneFromPrompt('fazenda', resolve), resolve);
  assert.ok(m.used && m.spec.titulo === 'Fazenda Sol' && m.spec.zonas.length > 3);
  // A reply cut in the middle of the JSON (the model's answer limit) still gives what she wrote.
  const cut = parseSceneReply('Fazenda!\n```json\n{"titulo":"Fazenda Sol","chao":"grama","zonas":[{"tipo":"cercado","itens":[{"tipo":"vaca","qtd":8},{"tipo":"cavalo","qtd":3}]},{"tipo":"lavoura","itens":[{"tipo":"mil');
  assert.deepEqual(cut.spec.zonas[0].itens.map((i) => i.tipo), ['vaca', 'cavalo']);
  // What she uses must be about the request: the types she was told for it count as on topic.
  const told = relevantTypes(cat, 'um castelo medieval').map((t) => t.id);
  const castle = { titulo: 'Reino', zonas: [{ tipo: 'livre', itens: [{ tipo: 'castelo' }, { tipo: 'torre', qtd: 2 }, { tipo: 'cavaleiro', qtd: 3 }, { tipo: 'dragao' }] }] };
  assert.equal(mergeWithDraft(castle, sceneFromPrompt('um castelo medieval', resolve), resolve, told).used, true);
  assert.equal(mergeWithDraft(farm, sceneFromPrompt('uma cidade', resolve), resolve, relevantTypes(cat, 'uma cidade').map((t) => t.id)).used, false);
  // The instruction carries a good scene of the theme as a reference, and asks for the JSON first.
  assert.match(scenePrompt([], recipeFor('faz uma fazenda')), /Exemplo de uma boa maquete deste tema.*"titulo":"Fazenda"/);
  assert.match(scenePrompt([]), /PRIMEIRO com um bloco/);
  // Asking and changing.
  assert.ok(isSceneRequest('Aurora, cria um cenário de praia')); assert.ok(!isSceneRequest('monta o power bi da operação'));
  assert.deepEqual(sceneEdit('adiciona 3 cavalos', resolve), { op: 'add', things: [['cavalo', 3]] });
  const less = editScene({ zonas: [{ tipo: 'livre', itens: [{ tipo: 'carro', qtd: 3 }, { tipo: 'vaca' }] }] }, sceneEdit('tira os carros', resolve), resolve);
  assert.deepEqual(less.zonas[0].itens, [{ tipo: 'vaca' }]);
  assert.equal(ownWords(`faz uma praia${scenePrompt([])}`), 'faz uma praia');
});

test('XR composer: nothing passes through anything (roads, rails, water, statues, walkers)', () => {
  // Every recipe, several seeds, and scenes as the Aurora really wrote them (crowded, a lake asked loose).
  const specs = RECIPES.map((r) => sceneFromPrompt(r.words.split(' ')[0], resolve));
  specs.push({ titulo: 'Cidade', chao: 'asfalto', estrada: 'grade', zonas: [{ tipo: 'quadra', onde: 'centro', tam: 'g', itens: [{ tipo: 'casa', qtd: 20 }, { tipo: 'predio', qtd: 15 }] }], itens: [{ tipo: 'carro', qtd: 45 }, { tipo: 'arvore', qtd: 60 }, { tipo: 'praca_fonte' }, { tipo: 'banco', qtd: 25 }, { tipo: 'pessoa', qtd: 80 }] });
  specs.push({ titulo: 'Fazenda', chao: 'grama', zonas: [{ tipo: 'cercado', onde: 'esquerda', tam: 'g', itens: [{ tipo: 'arvore', qtd: 10 }, { tipo: 'vaca', qtd: 8 }] }, { tipo: 'praca', onde: 'direita', itens: [{ tipo: 'banco', qtd: 6 }] }], itens: [{ tipo: 'lago' }, { tipo: 'pato', qtd: 5 }, { tipo: 'trator' }, { tipo: 'trem' }, { tipo: 'vagao', qtd: 3 }, { tipo: 'montanha', qtd: 3 }] });
  for (const spec of specs) for (const seed of ['a', 'b', 'c']) {
    const L = compose(spec, cat, seed); const T = (th) => cat.byId.get(th.type);
    const roads = L.roads.filter((r) => r.kind !== 'agua');
    const still = L.things.filter((th) => standsStill(th, T(th))).map((th) => ({ th, r: footprintOf(T(th), th.size, th.v) * 0.75 }));
    for (const { th, r } of still) {
      for (const rd of roads) assert.ok(distToPath(th.x, th.z, rd.points, rd.closed) >= rd.width / 2 + r - 0.003, `${spec.titulo}/${seed}: ${th.type} na ${rd.kind}`);
      if (th.type !== 'cais') for (const e of L.water) assert.ok(((th.x - e.x) / (e.rx + r * 0.8)) ** 2 + ((th.z - e.z) / (e.rz + r * 0.8)) ** 2 >= 0.98, `${spec.titulo}/${seed}: ${th.type} na água`);
    }
    for (let i = 0; i < still.length; i++) for (let j = i + 1; j < still.length; j++) {
      const a = still[i], b = still[j]; if (a.th.crop || b.th.crop) continue;
      assert.ok(Math.hypot(a.th.x - b.th.x, a.th.z - b.th.z) >= (a.r + b.r) * 0.55 - 1e-3, `${spec.titulo}/${seed}: ${a.th.type} dentro de ${b.th.type}`);
    }
    // A walker never reaches what stands: wandering its roam, it keeps clear.
    for (const w of L.things.filter((th) => th.behavior === 'passear' && th.path == null && !th.y)) {
      const rw = footprintOf(T(w), w.size, w.v) * 0.75; const reach = (w.roam ?? 0.045) * 1.42;
      for (const { th, r } of still) assert.ok(Math.hypot(w.x - th.x, w.z - th.z) - r - rw - reach >= -0.003, `${spec.titulo}/${seed}: ${w.type} anda até ${th.type}`);
    }
    // Counts stay reasonable for a headset.
    assert.ok(L.things.filter((th) => !th.crop).length <= 260, `${spec.titulo}: ${L.things.length}`);
  }
});

test('XR voice: one short opening is spoken, never code or a whole description', () => {
  assert.equal(spokenPart('Montei a fazenda! ```cena\n{"a":1}\n``` Tem vacas.'), 'Montei a fazenda! Tem vacas.');
  const long = 'Uma fazenda idílica com pastos. '.repeat(20);
  assert.ok(spokenPart(long).length <= 240 && spokenPart(long).endsWith('.'));
  assert.equal(spokenPart('**Pronto**: veja o [painel](x).'), 'Pronto: veja o painel.');
});

test('XR dynamics: vehicles follow their road, animals stay in their pasture', () => {
  const pts = [[0, 0], [0.2, 0], [0.2, 0.1], [0, 0.1]];
  const car = makeBody({ behavior: 'rota', path: { pts, closed: true, len: 0.6, s: 0, speed: 0.06 } });
  const a = behave(car, 0), b = behave(car, 1);
  assert.deepEqual([a.x, a.z], [0, 0]); assert.ok(Math.abs(b.x - 0.06) < 1e-9 && b.z === 0);
  assert.ok(Math.abs(b.rot - Math.PI / 2) < 1e-9);          // facing along the road (+x)
  const area = { x0: 0, x1: 0.1, z0: 0, z1: 0.1 };
  const cow = makeBody({ x: 0.01, z: 0.01, behavior: 'passear', radius: 0.01, area });
  for (let t = 0; t < 60; t += 0.7) { const p = behave(cow, t); assert.ok(p.x >= 0.01 - 1e-9 && p.x <= 0.09 + 1e-9 && p.z >= 0.01 - 1e-9 && p.z <= 0.09 + 1e-9); }
  stepBodies([car, cow], { t: 2, dt: 1 / 60 });
});
