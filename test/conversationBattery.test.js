import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { SCENARIOS, scoreTurn, summarizeBattery, writeBatteryFixtures } = await import("../app/conversationBattery.js");
const { extractText } = await import("../app/docText.js");
const { renderDocument } = await import("../app/documentWriter.js");

const scenario = (id) => SCENARIOS.find((s) => s.id === id);

test("the fixtures are real files the extractor reads", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aurora-battery-"));
  await writeBatteryFixtures(dir);
  assert.match(await extractText(join(dir, "Kit_Midia_Luma_2026.pdf")), /48 mil seguidores/);
  assert.match(await extractText(join(dir, "contratos_fornecedores.xlsx")), /Limpa Bem Serviços/);
});

test("the checks pass a good conversation and fail the MARU-style one", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aurora-battery-"));
  await writeBatteryFixtures(dir);
  const ctx = { dir, turns: [], extract: (f) => extractText(f) };
  const [summary, create, where] = scenario("kit-midia").turns;

  const good = await scoreTurn({ text: "A Luma tem 48 mil seguidores no TikTok; TikTok até 30s custa US$ 150.", steps: [{ tool: "read_file", ok: true }] }, summary.checks, ctx);
  assert.ok(good.every((c) => c.ok), JSON.stringify(good));
  const narrated = await scoreTurn({ text: "Corrigi a situação: agora, após a leitura…", steps: [] }, summary.checks, ctx);
  assert.ok(narrated.some((c) => !c.ok));

  // "Consegui criar um novo documento" with no file: every creation check fails.
  const claimed = await scoreTurn({ text: "Consegui criar um novo documento com valores atualizados.", steps: [] }, create.checks, ctx);
  assert.ok(claimed.filter((c) => c.name !== "não mexe no original").every((c) => !c.ok), JSON.stringify(claimed));

  const file = join(dir, "Kit_Midia_Luma_2026_atualizado.docx");
  writeFileSync(file, await renderDocument("docx", "# Luma 2026\n| Formato | Valor |\n|---|---|\n| TikTok | US$ 180 |"));
  const real = await scoreTurn({ text: "Criei Kit_Midia_Luma_2026_atualizado.docx.", steps: [{ tool: "write_document", ok: true, summary: `Criei ${file} (DOCX, 900 bytes).`, args: { path: file } }] }, create.checks, ctx);
  assert.ok(real.every((c) => c.ok), JSON.stringify(real));
  const found = await scoreTurn({ text: `Está em ${file}.`, steps: [] }, where.checks, ctx);
  assert.ok(found.every((c) => c.ok));

  const summaryOf = summarizeBattery([{ id: "kit-midia", turns: [{ checks: good }, { checks: claimed }] }]);
  assert.equal(summaryOf.total, good.length + claimed.length);
});
