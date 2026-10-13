// The conversation "monte um BI interativo sobre departamentos" (13/10/2026): each fix, held.
import test from "node:test";
import assert from "node:assert/strict";
import { cellValue, columnSums, csvTable } from "../app/agentTools/files.js";
import { askedStyle } from "../app/powerbiPlanner.js";
import { claimsActionWithoutAction, FICTIONAL } from "../app/codeGuards.js";
import { routeTools } from "../app/toolRouter.js";

test("thousands without decimals are numbers", () => {
  assert.equal(cellValue("2.800.000"), 2800000);
  assert.equal(cellValue("R$ 1.234,56"), 1234.56);
  assert.equal(cellValue("69062.05"), 69062.05);
});

test("a sheet comes with its sums, largest and smallest ready", () => {
  const t = csvTable("Departamento;Funcionários;Orçamento\nTecnologia;420;2.800.000\nVendas;610;1.950.000\nRH;95;980.000\n");
  const note = columnSums(t);
  assert.match(note, /Funcionários: soma 1\.125, maior 610 \(Vendas\), menor 95 \(RH\)/);
  assert.match(note, /Orçamento: soma 5\.730\.000, maior 2\.800\.000 \(Tecnologia\)/);
});

test("the colours the person asks for win over the plan's", () => {
  assert.deepEqual(askedStyle("deixe o tema azul e amarelo"), { cor: "amarelo", tema: "escuro" });
  assert.deepEqual(askedStyle("tema claro verde"), { tema: "claro", cor: "verde" });
  assert.equal(askedStyle("BI de vendas"), null);
});

test("\"Pronto! Aplicado às 4 páginas\" with no tool run is caught", () => {
  const acts = new Set(["powerbi", "write_document"]);
  assert.equal(claimsActionWithoutAction("Pronto!\n\n**Atualizado:** - Tema do BI: Escuro", [], acts), true);
  assert.equal(claimsActionWithoutAction("Aplicado às 4 páginas: 1. Dashboard", [], acts), true);
  assert.equal(claimsActionWithoutAction("Pronto! Criei o BI.", [{ tool: "powerbi", ok: true }], acts), false);
  assert.equal(claimsActionWithoutAction("Nada foi executado: o modo Plano está ligado.", [], acts), false);
  assert.equal(claimsActionWithoutAction("Pronto, aqui está o e-mail:\nOlá João", [], acts), false);
});

test("made-up data asked for is allowed", () => {
  assert.equal(FICTIONAL.test("É FICTICIO, PODE GERAR NUMEROS"), true);
  assert.equal(FICTIONAL.test("me mostre os clientes reais"), false);
});

test("\"BI\" alone brings the Power BI tool", () => {
  for (const q of ["monte um BI interativo sobre departamentos", "quero um painel de vendas", "indicadores do RH"]) assert.ok(routeTools(q).has("powerbi"), q);
  assert.ok(!routeTools("resuma este contrato").has("powerbi"));
});
