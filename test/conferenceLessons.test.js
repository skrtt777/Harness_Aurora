import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.HARNESS_DB_FILE = join(mkdtempSync(join(tmpdir(), "aurora-conf-")), "harness.db");
const { conferenceLessons, rememberConference } = await import("../app/conferenceLessons.js");
const { listMemories } = await import("../app/store.js");

test("the Conferência's checks become lessons by kind of mistake and area, saved once", async () => {
  const checks = [{ check: "unconfirmed_citations", items: ["Artigo 609 da Lei 8.245"] }, { check: "dispatch", items: ["o arquivo pedido, documento Word (.docx) não foi gravado"] }];
  const lessons = conferenceLessons(checks, "Faça um parecer sobre a multa do contrato de locação");
  assert.deepEqual(lessons.map((l) => l.title), ["Jurídico: confirme cada citação antes de usar", "Jurídico: entregue no formato pedido"]);
  assert.ok(lessons[0].tags.includes("juridico"));
  assert.deepEqual(conferenceLessons([{ check: "claimed_run" }], "crie um script e rode").map((l) => l.title), ["TI e Código: rode de verdade antes de dizer que rodou"]);
  assert.deepEqual(conferenceLessons([{ check: "uncited_source" }], "x"), []);
  await rememberConference(checks, { request: "Faça um parecer sobre a multa do contrato de locação" });
  await rememberConference(checks, { request: "Outro parecer sobre contrato de locação" });
  const saved = (await listMemories({ scope: "global" })).filter((m) => m.source === "Lição da Conferência (Sede)");
  assert.equal(saved.length, 2, saved.map((m) => m.title).join(" | "));
});
