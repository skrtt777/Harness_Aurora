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
  const metaB = await mk("Meta do Sul revisada", "A meta de vendas do Sul em outubro é 280 mil reais.");
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
