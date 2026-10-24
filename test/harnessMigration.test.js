import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "harness-migration-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.EMBEDDINGS_ENABLED = "false";
const home = join(temp, "home");
const env = { ...process.env, AURORA_SKILL_HOME: home, EMBEDDINGS_ENABLED: "false" };
const { memoryEntries, harnessSummary, importHarness } = await import("../app/harnessMigration.js");
const store = await import("../app/store.js");

test("memory files split by §, by list items or by paragraphs (headings and comments dropped)", () => {
  assert.deepEqual(memoryEntries("O usuário prefere respostas curtas.\n§\nO projeto usa Python 3.12 e pytest."), ["O usuário prefere respostas curtas.", "O projeto usa Python 3.12 e pytest."]);
  assert.deepEqual(memoryEntries("# Memória\n<!-- nota -->\n- Prefere café sem açúcar\n- Mora em Recife desde 2020\n"), ["Prefere café sem açúcar", "Mora em Recife desde 2020"]);
  assert.deepEqual(memoryEntries("# Título\n\nPrimeiro parágrafo longo.\n\nSegundo parágrafo longo."), ["Primeiro parágrafo longo.", "Segundo parágrafo longo."]);
  assert.deepEqual(memoryEntries("§\n\n§"), []);
});

test("Hermes and OpenClaw memories come in once (importing again adds nothing)", async () => {
  mkdirSync(join(home, ".hermes", "memories"), { recursive: true });
  writeFileSync(join(home, ".hermes", "memories", "MEMORY.md"), "O build do projeto roda com npm run build.\n§\nNunca apagar a pasta dist manualmente.");
  writeFileSync(join(home, ".hermes", "memories", "USER.md"), "A pessoa se chama Lucas e prefere português.");
  mkdirSync(join(home, ".openclaw", "workspace", "memory"), { recursive: true });
  writeFileSync(join(home, ".openclaw", "workspace", "MEMORY.md"), "- Reunião semanal às sextas, 10h\n");
  writeFileSync(join(home, ".openclaw", "workspace", "memory", "2026-10-20.md"), "- Enviou o relatório mensal ao financeiro\n");
  const summary = harnessSummary(env);
  assert.deepEqual(summary.map((h) => [h.harness, h.entries]).sort(), [["hermes", 3], ["openclaw", 2]]);
  const first = await importHarness("hermes", env);
  assert.deepEqual([first.imported, first.skipped], [3, 0]);
  const again = await importHarness("hermes", env);
  assert.equal(again.imported, 0, "nothing new the second time");
  const open = await importHarness("openclaw", env);
  assert.equal(open.imported, 2);
  const all = await store.listMemories({});
  const daily = all.find((m) => /relatório mensal/.test(m.content));
  assert.ok(daily.tags.includes("2026-10-20"), "a daily note keeps its day");
  await assert.rejects(importHarness("outro", env), /Harness desconhecido/);
});
