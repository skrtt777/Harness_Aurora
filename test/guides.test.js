import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HARNESS_DB_FILE = join(mkdtempSync(join(tmpdir(), "aurora-guias-")), "harness.db");
const { GUIDES, seedGuides } = await import("../app/guides.js");
const { listMemories, updateMemory } = await import("../app/store.js");

test("the step-by-step guides become memories once, and come back when their text changes", async () => {
  assert.deepEqual(await seedGuides(), GUIDES.map((g) => `+ ${g.id}`));
  const guides = () => listMemories({ scope: "global", kind: "imported" }).then((all) => all.filter((m) => /^aurora:guia:/.test(m.source || "")));
  assert.equal((await guides()).length, GUIDES.length);
  assert.deepEqual(await seedGuides(), [], "a second start writes nothing");
  const montar = (await guides()).find((m) => m.source === "aurora:guia:powerbi-montar");
  assert.match(montar.content, /action=build/);
  assert.match(montar.content, /goal/);
  // An old text (an earlier version of the app) is rewritten, never duplicated.
  await updateMemory(montar.id, { content: "texto antigo" });
  assert.deepEqual(await seedGuides(), ["~ powerbi-montar"]);
  assert.equal((await guides()).length, GUIDES.length);
});
