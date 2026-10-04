import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkAnswer } from "../app/companyEval.js";

const spec = JSON.parse(readFileSync(new URL("../app/empresaIaQuestions.json", import.meta.url), "utf8"));

test("the company questions are well formed and cover many sectors", () => {
  assert.ok(new Set(spec.perguntas.map((q) => q.setor)).size >= 7);
  assert.equal(new Set(spec.perguntas.map((q) => q.id)).size, spec.perguntas.length, "unique ids");
  for (const q of spec.perguntas) {
    assert.ok(q.notFound || q.expect.length, `${q.id} has something to check`);
    for (const r of [...q.expect, ...q.avoid]) assert.doesNotThrow(() => new RegExp(r, "iu"), `${q.id}: ${r}`);
  }
});

test("answers pass only with every expected fact; not-found needs an honest no", () => {
  const budget = spec.perguntas.find((q) => q.id === "controladoria-1");
  assert.equal(checkAnswer(budget, "O orçamento de 2026 é de R$ 23,35 milhões e até setembro foram gastos R$ 17,78 milhões."), true);
  assert.equal(checkAnswer(budget, "O orçamento de 2026 é de R$ 23.350.000,00."), false, "half the facts");
  const homeOffice = spec.perguntas.find((q) => q.notFound);
  assert.equal(checkAnswer(homeOffice, "Não encontrei nenhum documento sobre home office nas pastas da empresa."), true);
  assert.equal(checkAnswer(homeOffice, "O home office é permitido 2 dias por semana."), false);
});
