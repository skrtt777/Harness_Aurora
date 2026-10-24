import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LADDER_LEVELS, ladderScenarios, numbersIn, PER_LEVEL, saysNum } from "../app/usageScenarios5.js";

test("the ladder: 800 scenarios, 80 per degree, unique ids, always the same", () => {
  const all = ladderScenarios();
  assert.equal(all.length, 800);
  assert.equal(new Set(all.map((s) => s.id)).size, 800);
  for (const level of Object.keys(LADDER_LEVELS)) assert.equal(all.filter((s) => s.level === level).length, PER_LEVEL, level);
  assert.deepEqual(ladderScenarios().map((s) => s.turns[0].message), all.map((s) => s.turns[0].message), "fixed seeds");
  assert.ok(all.every((s) => s.turns.every((t) => t.message && t.checks.length)));
  // The same question may repeat; its files and numbers are drawn again each time.
  assert.ok(new Set(all.map((s) => s.turns.map((t) => t.message).join("|"))).size > 560, "the messages vary");
});

test("numbers as people and spreadsheets write them", () => {
  assert.ok(saysNum("Deu R$ 1.234,56 no total", 1234.56));
  assert.ok(saysNum("total: 1234.56", 1234.56));
  assert.ok(saysNum("são doze itens", 12));
  assert.ok(saysNum("R$ 1.800", 1800));
  assert.ok(!saysNum("R$ 1.234,57", 1234.55));
  assert.deepEqual(numbersIn("1,5 e 2.000 e 3,000.25"), [1.5, 2000, 3000.25]);
});

test("every scenario's files can be prepared", async () => {
  const base = mkdtempSync(join(tmpdir(), "ladder-"));
  const all = ladderScenarios();
  // One scenario of each family per degree (the rest differ only in the drawn data).
  const seen = new Set();
  for (const s of all) {
    const fam = `${s.level}-${s.id.split("-f")[1]}`;
    if (seen.has(fam) || !s.setup) continue;
    seen.add(fam);
    const home = join(base, s.id);
    const folders = { home, desktop: join(home, "Desktop"), documents: join(home, "Documents"), downloads: join(home, "Downloads") };
    for (const d of [folders.desktop, folders.documents, folders.downloads]) mkdirSync(d, { recursive: true });
    await s.setup({ folders });
  }
  assert.ok(seen.size >= 40, `${seen.size} families prepared`);
});
