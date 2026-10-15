import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { asksAuroraHistory, auroraHistory, auroraHistoryBlock } = await import("../app/auroraHistory.js");

test("a request about the Aurora's own updates gets its real versions, not made-up numbers", () => {
  assert.equal(asksAuroraHistory("Consegue montar um excel com update que fizemos em você, quantidade, tempo e % de melhoria"), true);
  assert.equal(asksAuroraHistory("o que mudou na aurora essa semana?"), true);
  assert.equal(asksAuroraHistory("faça um excel de vendas"), false);
  const file = join(mkdtempSync(join(tmpdir(), "roadmap-")), "ROADMAP.md");
  writeFileSync(file, "# Roteiro\n\n- **0.1.2 (02/10, publicada): segunda.**\n  - Baterias: nova 57/58.\n- **0.1.1 (01/10, publicada): primeira.**\n  - Suíte 700/700.\n\n## Outra seção\n- não é versão\n");
  assert.equal(auroraHistory({ file }), "- **0.1.2 (02/10, publicada): segunda.**\n  - Baterias: nova 57/58.\n- **0.1.1 (01/10, publicada): primeira.**\n  - Suíte 700/700.");
  assert.match(auroraHistoryBlock("quais as versões da Aurora?", { file }), /use SÓ o que está aqui[\s\S]*nova 57\/58/);
  assert.equal(auroraHistoryBlock("faça um excel de vendas", { file }), "");
  assert.match(auroraHistory(), /^- \*\*0\.1\.\d+ \(/, "the project's own ROADMAP.md is read");
});
