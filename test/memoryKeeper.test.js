import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "harness-keeper-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.EMBEDDINGS_ENABLED = "false";

const store = await import("../app/store.js");
const { getDb } = await import("../app/db.js");
const { keeperRound, keeperState, undoJoin, dismissFlag } = await import("../app/memoryKeeper.js");
const { memoryEvents } = await import("../app/memoryEvents.js");
const env = { EMBEDDINGS_ENABLED: "false" };

test("a Zeladora reads every memory, links the related, joins copies and flags disagreements — all reversible", async () => {
  const project = await store.createProject({ name: "Vendas" });
  const mk = (title, content, extra = {}) => store.createMemory({ scope: "project", projectId: project.id, title, content, kind: "extracted", dedupe: false, env, ...extra });
  const a = await mk("Relatório semanal de vendas", "O relatório semanal de vendas sai toda sexta com o resumo por região para a diretoria comercial.");
  const copy = await mk("Relatório semanal de vendas (cópia)", "O relatório semanal de vendas sai toda sexta com o resumo por região para a diretoria comercial.");
  // In another folder: the same subject can be linked there, never compacted with this one.
  const elsewhere = await store.createProject({ name: "Diretoria" });
  const related = await store.createMemory({ scope: "project", projectId: elsewhere.id, title: "Formato do relatório de vendas", content: "O relatório semanal de vendas sai toda sexta com o resumo por região e segue em Word.", kind: "extracted", dedupe: false, env });
  const metaA = await mk("Meta do Sul", "A meta de vendas do Sul em outubro é 263 mil reais.");
  // Nothing says which one is the newer news: a question for the person (flagged), not a prune.
  const metaB = await mk("Meta do Sul (planilha)", "A meta de vendas do Sul em outubro é 280 mil reais.");
  const manual1 = await store.createMemory({ scope: "global", title: "Prefere respostas curtas", content: "A pessoa prefere respostas curtas e diretas sem emojis.", kind: "manual", env });
  const manual2 = await store.createMemory({ scope: "global", title: "Prefere respostas curtas!", content: "A pessoa prefere respostas curtas e diretas sem emojis.", kind: "manual", env });

  const seen = [];
  const listen = (e) => { if (e.type === "keeper") seen.push(e); };
  memoryEvents.on("event", listen);
  const stats = await keeperRound({ paceMs: 0 });
  memoryEvents.off("event", listen);

  const db = await getDb();
  const status = (id) => db.prepare("SELECT status FROM memories WHERE id = ?").get(id).status;
  // Joined: the copy (newer, same uses) archived, linked to the one kept.
  assert.equal(status(copy.id), "archived");
  assert.equal(status(a.id), "active");
  assert.ok(db.prepare("SELECT 1 FROM memory_relations WHERE from_id = ? AND to_id = ? AND type = 'derivation'").get(copy.id, a.id));
  // Linked: related ones get a thematic relation.
  assert.ok(db.prepare("SELECT 1 FROM memory_relations WHERE type = 'thematic' AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))").get(a.id, related.id, related.id, a.id));
  // Disagreeing numbers: flagged, both kept.
  assert.equal(status(metaA.id), "active");
  assert.equal(status(metaB.id), "active");
  const state = await keeperState();
  assert.ok(state.flags.some((f) => [f.id, f.otherId].sort().join() === [metaA.id, metaB.id].sort().join() && /263/.test(f.reason) && /280/.test(f.reason)));
  // Hand-written memories are never joined.
  assert.equal(status(manual1.id), "active");
  assert.equal(status(manual2.id), "active");

  assert.equal(stats.read, 6, "every active memory read once (the archived copy is skipped)");
  assert.ok(stats.joined === 1 && stats.flagged === 1 && stats.linked >= 1, JSON.stringify(stats));
  const actions = seen.map((e) => e.action);
  for (const step of ["round", "walk", "read", "join", "link", "flag"]) assert.ok(actions.includes(step), `${step} in ${actions.join(",")}`);
  assert.ok(seen.filter((e) => e.action === "read").every((e) => e.id && e.area));

  // Reversible.
  await undoJoin(copy.id);
  assert.equal(status(copy.id), "active");
  const flag = state.flags[0];
  assert.equal((await dismissFlag(flag.id, flag.otherId)).length, state.flags.length - 1);

  // A second round: the copy the person brought back is not joined again, the related pair is not linked
  // twice, the disagreeing pair is still never joined.
  const again = await keeperRound({ paceMs: 0 });
  assert.equal(again.joined, 0);
  assert.equal(status(copy.id), "active");
  assert.equal(db.prepare("SELECT count(*) n FROM memory_relations WHERE type = 'thematic' AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))").get(a.id, related.id, related.id, a.id).n, 1);
  assert.equal(status(metaA.id), "active");
  assert.equal(status(metaB.id), "active");
});

test("imported guides and hand-written memories are never joined, even when identical", async () => {
  const { keeperRound: round } = await import("../app/memoryKeeper.js");
  const text = "Guia de jogos: arquitetura, ciclo de vida, testes e entrega de um jogo pequeno.";
  const g1 = await store.createMemory({ scope: "global", title: "Jogos — Arquitetura", content: text, kind: "imported", dedupe: false, env });
  const g2 = await store.createMemory({ scope: "global", title: "Jogos — Testes", content: text, kind: "imported", dedupe: false, env });
  await round({ paceMs: 0 });
  const db = await getDb();
  for (const m of [g1, g2]) assert.equal(db.prepare("SELECT status FROM memories WHERE id = ?").get(m.id).status, "active");
});

test("off means off: with memory_keeper=off she does not touch anything", async () => {
  await store.setSetting("memory_keeper", "off");
  const project = await store.createProject({ name: "Outra" });
  const one = await store.createMemory({ scope: "project", projectId: project.id, title: "X igual", content: "Texto idêntico para teste da zeladora desligada.", kind: "extracted", dedupe: false, env });
  const two = await store.createMemory({ scope: "project", projectId: project.id, title: "X igual 2", content: "Texto idêntico para teste da zeladora desligada.", kind: "extracted", dedupe: false, env });
  const stats = await keeperRound({ paceMs: 0 });
  const db = await getDb();
  assert.equal(stats.joined, 0);
  assert.equal(db.prepare("SELECT status FROM memories WHERE id = ?").get(two.id).status, "active");
  assert.equal(db.prepare("SELECT status FROM memories WHERE id = ?").get(one.id).status, "active");
  await store.setSetting("memory_keeper", "on");
});

test("compacting a thought keeps every distinct sentence; undo brings the originals back for good", async () => {
  const { keeperRound: round, undoKeeper, keeperCompactions } = await import("../app/memoryKeeper.js");
  const project = await store.createProject({ name: "Clientes" });
  const mk = (title, content) => store.createMemory({ scope: "project", projectId: project.id, title, content, kind: "extracted", dedupe: false, env });
  const one = await mk("Cliente Atlas: pagamento", "O cliente Atlas paga sempre por boleto e pede a nota fiscal antes do pagamento.");
  const two = await mk("Cliente Atlas: pagamento e contato", "O cliente Atlas paga sempre por boleto e pede a nota fiscal antes do pagamento. Contato com a Joana do financeiro.");
  const other = await mk("Fornecedor Beta", "O fornecedor Beta entrega na terça e cobra frete à parte.");
  const stats = await round({ paceMs: 0 });
  assert.equal(stats.compacted, 1, JSON.stringify(stats));
  const [record] = await keeperCompactions();
  assert.deepEqual(new Set(record.from), new Set([one.id, two.id]));
  const db = await getDb();
  const row = (id) => db.prepare("SELECT status, content, kind FROM memories WHERE id = ?").get(id);
  const compacted = row(record.id);
  assert.equal(compacted.status, "active");
  assert.match(compacted.content, /boleto e pede a nota fiscal antes do pagamento\./);
  assert.match(compacted.content, /Contato com a Joana do financeiro\./);
  assert.equal(compacted.content.match(/boleto/g).length, 1, "a sentence both said is said once");
  assert.equal(row(one.id).status, "archived");
  assert.equal(row(two.id).status, "archived");
  assert.equal(row(other.id).status, "active");
  assert.equal(db.prepare("SELECT count(*) n FROM memory_relations WHERE to_id = ? AND type = 'derivation'").get(record.id).n, 2);

  await undoKeeper(record.id);
  assert.deepEqual([row(one.id).status, row(two.id).status, row(record.id).status], ["active", "active", "archived"]);
  const again = await round({ paceMs: 0 });
  assert.equal(again.compacted, 0, "brought back by the person: never compacted again");
  assert.deepEqual([row(one.id).status, row(two.id).status], ["active", "active"]);
});

test("each memory read is classified; a vague one is a question for the person", async () => {
  const { classifyMemory } = await import("../app/memoryKeeper.js");
  assert.equal(classifyMemory({ title: "Meta", content: "A meta do Sul é 263 mil reais em outubro." }), "valor");
  assert.equal(classifyMemory({ title: "Estilo", content: "A pessoa prefere respostas curtas e diretas sem emojis." }), "preferência");
  assert.equal(classifyMemory({ title: "Entrega", content: "Ficou combinado que o relatório vai toda sexta para o comercial." }), "combinado");
  assert.equal(classifyMemory({ title: "Publicar", content: "Os testes devem passar antes de publicar uma versão nova." }), "regra");
  assert.equal(classifyMemory({ title: "Projeto", content: "O projeto usa Electron e um servidor local em Node." }), "fato");
  assert.equal(classifyMemory({ title: "Coisa", content: "ver isso" }), "vaga");
});

test("only real values count for a disagreement: amounts, percentages, dates — not a note's counter", async () => {
  const { valuesIn } = await import("../app/memoryKeeper.js");
  assert.deepEqual([...valuesIn("A meta do Sul é 263 mil reais, 15% acima; revisão em 04/10.")], ["263 mil", "15%", "04/10"]);
  assert.deepEqual([...valuesIn("Manutenção das máquinas — nota 11, item 3")], []);
  assert.deepEqual([...valuesIn("Registro 110 do pedido 4512")], []);
  assert.deepEqual([...valuesIn("Custo de R$ 1.200,50 por mês")], ["r$ 1.200,50"]);
});

test("the person calls her: a resting Zeladora wakes up, goes to the memories asked and tends them", async () => {
  const { startMemoryKeeper, stopMemoryKeeper, visitMemories, keeperState } = await import("../app/memoryKeeper.js");
  await store.setSetting("memory_keeper", "on");
  const project = await store.createProject({ name: "Chamado" });
  const m1 = await store.createMemory({ scope: "project", projectId: project.id, title: "Cliente Gama: entrega", content: "O cliente Gama recebe as entregas sempre na segunda pela manhã no galpão dois.", kind: "extracted", dedupe: false, env });
  const m2 = await store.createMemory({ scope: "project", projectId: project.id, title: "Fornecedor Delta", content: "O fornecedor Delta fatura no dia 5 e aceita pedidos só por e-mail.", kind: "extracted", dedupe: false, env });
  const seen = [];
  const listen = (e) => { if (e.type === "keeper") seen.push(e); };
  memoryEvents.on("event", listen);
  startMemoryKeeper({ paceMs: 0, restMs: 60_000, firstDelayMs: 0 });
  try {
    const until = async (check, ms = 5000) => { const t0 = Date.now(); while (!check()) { if (Date.now() - t0 > ms) throw new Error(`timeout: ${seen.map((e) => e.action).join(",")}`); await new Promise((r) => setTimeout(r, 20)); } };
    await until(() => seen.some((e) => e.action === "rest"));
    const before = seen.length;
    assert.equal(visitMemories([m1.id, m2.id, "nao-existe"], "Chamado"), 3);
    await until(() => seen.slice(before).filter((e) => e.action === "read").length >= 2 && seen.slice(before).some((e) => e.action === "rest"));
    const after = seen.slice(before);
    assert.equal(after[0].action, "called");
    assert.ok(after.some((e) => e.action === "walk" && e.called && e.label === "Chamado"));
    assert.ok(after.some((e) => e.action === "read" && e.called && [m1.id, m2.id].includes(e.id)));
    assert.ok((await keeperState()).readIds.length > 0);
  } finally { stopMemoryKeeper(); memoryEvents.off("event", listen); }
  assert.equal(visitMemories([]), 0);
});

test("obsolete memories are pruned — replaced by a newer one that says it changed, vague and unused, a moment past — reversible", async () => {
  const { keeperRound: round, undoKeeper, keeperPrunes } = await import("../app/memoryKeeper.js");
  const project = await store.createProject({ name: "Poda" });
  const db = await getDb();
  const mk = (title, content, extra = {}) => store.createMemory({ scope: "project", projectId: project.id, title, content, kind: "extracted", dedupe: false, env, ...extra });
  const age = (m, days) => db.prepare("UPDATE memories SET created_at = ? WHERE id = ?").run(new Date(Date.now() - days * 86_400_000).toISOString(), m.id);
  const old = await mk("Meta do Norte", "A meta de vendas do Norte em novembro é 250 mil reais.");
  age(old, 3);
  const updated = await mk("Meta do Norte", "A meta de vendas do Norte em novembro passou a ser 300 mil reais.");
  const vague = await mk("Coisa", "ver isso depois");
  age(vague, 40);
  const vagueNew = await mk("Outra coisa", "olhar aquilo");
  const moment = await mk("Revisão do contrato", "Hoje a pessoa está revisando o contrato da Atlas com o jurídico antes da assinatura.");
  age(moment, 20);
  const usedMoment = await mk("Planilha do estoque", "Hoje a pessoa está conferindo a planilha do estoque de outubro com o almoxarifado.");
  age(usedMoment, 20);
  db.prepare("UPDATE memories SET uses = 2 WHERE id = ?").run(usedMoment.id);
  const manualVague = await store.createMemory({ scope: "project", projectId: project.id, title: "Nota", content: "lembrar disso", kind: "manual", env });
  age(manualVague, 60);

  const seen = [];
  const listen = (e) => { if (e.type === "keeper" && e.action === "prune") seen.push(e); };
  memoryEvents.on("event", listen);
  const stats = await round({ paceMs: 0 });
  memoryEvents.off("event", listen);
  const status = (id) => db.prepare("SELECT status FROM memories WHERE id = ?").get(id).status;
  assert.equal(status(old.id), "archived", "replaced by the newer one");
  assert.equal(status(updated.id), "active");
  assert.ok(db.prepare("SELECT 1 FROM memory_relations WHERE from_id = ? AND to_id = ? AND type = 'correction'").get(updated.id, old.id));
  assert.equal(status(vague.id), "archived", "vague and unused for 40 days");
  assert.equal(status(vagueNew.id), "active", "vague but new: still a question");
  assert.equal(status(moment.id), "archived", "a moment that has passed");
  assert.equal(status(usedMoment.id), "active", "used: it still helps");
  assert.equal(status(manualVague.id), "active", "written by the person: never pruned");
  assert.ok(stats.pruned >= 3, JSON.stringify(stats));
  const reasons = Object.fromEntries(seen.map((e) => [e.id, e.reason]));
  assert.match(reasons[old.id], /mais nova.*250 mil.*300 mil/);
  assert.match(reasons[vague.id], /vaga/);
  assert.match(reasons[moment.id], /momento que já passou/);
  assert.ok((await keeperPrunes()).some((p) => p.id === old.id && p.by === updated.id));

  // Undo: back, and never pruned again.
  await undoKeeper(moment.id);
  assert.equal(status(moment.id), "active");
  await round({ paceMs: 0 });
  assert.equal(status(moment.id), "active");
  assert.ok(!(await keeperPrunes()).some((p) => p.id === moment.id));
});

test("she keeps the nodes: plants them, the sections of the map are hers, a new memory is adopted, an emptied node folds", async () => {
  const { keeperRound: round, keeperNodes } = await import("../app/memoryKeeper.js");
  const { encodeEmbedding, resolveEmbeddingModel } = await import("../app/embeddings.js");
  const { memoryAtlas } = await import("../app/memoryAtlas.js");
  const db = await getDb();
  // Only these memories have vectors here, and no nodes yet: she plants them.
  db.prepare("UPDATE memories SET embedding = NULL").run();
  await store.setSetting("memory_keeper_nodes", JSON.stringify({ next: 1, nodes: [] }));
  const project = await store.createProject({ name: "Nódulos" });
  const axis = (a, i) => Array.from({ length: 16 }, (_, d) => (d === a ? 1 : 0) + Math.sin(d * 5 + i) * 0.05);
  const make = async (title, a, i) => {
    const m = await store.createMemory({ scope: "project", projectId: project.id, title, content: `${title}: anotação de trabalho número ${i} sobre o assunto.`, kind: "manual", env });
    db.prepare("UPDATE memories SET embedding = ?, embedding_model = ? WHERE id = ?").run(encodeEmbedding(axis(a, i)), resolveEmbeddingModel(process.env), m.id);
    return m;
  };
  const games = []; const sales = [];
  for (let i = 0; i < 6; i += 1) games.push(await make(`Jogo canvas fase ${i}`, 2, i));
  for (let i = 0; i < 6; i += 1) sales.push(await make(`Vendas região ${i}`, 9, i + 10));
  const seen = [];
  const listen = (e) => { if (e.type === "keeper") seen.push(e); };
  memoryEvents.on("event", listen);
  await round({ paceMs: 0 });
  assert.ok(seen.some((e) => e.action === "plant"), seen.map((e) => e.action).join(","));
  const book = await keeperNodes();
  const nodeOf = (b, id) => b.nodes.find((n) => n.members.includes(id))?.id;
  assert.equal(new Set(games.map((m) => nodeOf(book, m.id))).size, 1);
  assert.notEqual(nodeOf(book, games[0].id), nodeOf(book, sales[0].id));
  // The atlas (and so the map and her round) uses her nodes as the sections.
  const atlas = await memoryAtlas();
  assert.equal(atlas.nodes, true);
  const point = (id) => atlas.memories.find((m) => m.id === id);
  assert.equal(point(games[0].id).cluster, nodeOf(book, games[0].id));
  assert.ok(atlas.clusters.filter((c) => c.id >= 0).every((c) => book.nodes.some((n) => n.id === c.id)));

  // A new memory: before she adopts it, the atlas already places it in the closest node; then she adopts it.
  const fresh = await make("Jogo canvas fase nova", 2, 99);
  assert.equal((await memoryAtlas()).memories.find((m) => m.id === fresh.id).cluster, nodeOf(book, games[0].id));
  seen.length = 0;
  await round({ paceMs: 0 });
  const adopt = seen.find((e) => e.action === "adopt" && e.id === fresh.id);
  assert.ok(adopt, seen.map((e) => e.action).join(","));
  assert.equal(adopt.node, nodeOf(book, games[0].id));

  // The sales memories all deleted: their node goes.
  for (const m of sales) await store.deleteMemory(m.id);
  seen.length = 0;
  await round({ paceMs: 0 });
  memoryEvents.off("event", listen);
  assert.ok(seen.some((e) => e.action === "node-gone" && e.node === nodeOf(book, sales[0].id)), seen.map((e) => e.action).join(","));
  assert.ok(!(await keeperNodes()).nodes.some((n) => n.id === nodeOf(book, sales[0].id)));
});

test("a new memory calls her: a resting Zeladora goes to it at once and then rests again", async () => {
  const { startMemoryKeeper, stopMemoryKeeper } = await import("../app/memoryKeeper.js");
  const project = await store.createProject({ name: "Chegada" });
  const seen = [];
  const listen = (e) => { if (e.type === "keeper") seen.push(e); };
  memoryEvents.on("event", listen);
  startMemoryKeeper({ paceMs: 0, restMs: 60_000, firstDelayMs: 0 });
  try {
    const until = async (check, ms = 5000) => { const t0 = Date.now(); while (!check()) { if (Date.now() - t0 > ms) throw new Error(`timeout: ${seen.map((e) => e.action).join(",")}`); await new Promise((r) => setTimeout(r, 20)); } };
    await until(() => seen.some((e) => e.action === "rest"));
    const before = seen.length;
    const fresh = await store.createMemory({ scope: "project", projectId: project.id, title: "Cliente Ômega: horário", content: "O cliente Ômega só recebe ligações depois das 14h, de segunda a quinta.", kind: "extracted", dedupe: false, env });
    await until(() => seen.slice(before).some((e) => e.action === "read" && e.id === fresh.id) && seen.slice(before).some((e) => e.action === "rest"));
    const after = seen.slice(before);
    assert.equal(after[0].action, "arrival");
    assert.ok(after.some((e) => e.action === "walk" && e.label === "memória nova"));
    assert.ok(!after.some((e) => e.action === "round"), "only the new memory, not a whole round");
  } finally { stopMemoryKeeper(); memoryEvents.off("event", listen); }
});
