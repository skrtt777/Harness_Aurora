import test from "node:test";
import assert from "node:assert/strict";
import { briefBlock, loadBriefs, pickBrief } from "../app/briefs.js";

test("every bundled briefing parses and has the four parts", () => {
  const briefs = loadBriefs();
  assert.ok(briefs.length >= 10);
  for (const b of briefs) {
    for (const part of ["Decida sozinho:", "Pergunte só se:", "Estrutura:", "Confira antes de entregar:"]) assert.ok(b.body.includes(part), `${b.name}: ${part}`);
    assert.ok(b.body.length < 1300, `${b.name} is short (${b.body.length})`);
  }
});

test("a poor request picks the briefing of what it asks for", () => {
  const cases = {
    "faz um convite pro niver da minha filha": "convite",
    "escreve um email pro meu chefe pedindo folga sexta": "mensagem",
    "cria uma legenda pro insta da minha loja de bolos": "post",
    "preciso de um curiculo, nunca trabalhei": "curriculo",
    "quero uma planilha pra controlar meus gastos": "planilha-controle",
    "monta um relatorio das vendas do mes": "relatorio",
    "faz uns slides sobre reciclagem pro trabalho da escola": "apresentacao",
    "monta um roteiro de viagem pra salvador": "plano",
    "qual o melhor celular ate 1500": "comparar",
    "faz um comunicado pra equipe sobre o horario novo": "comunicado",
  };
  for (const [request, name] of Object.entries(cases)) assert.equal(pickBrief(request)?.name, name, request);
});

test("questions, unrelated requests and look-alike words pick nothing", () => {
  for (const request of ["o que é um currículo?", "que horas são", "quanto deve o atacadão", "abre o email do banco", "me lembra de pagar a luz", "Agora abra http://127.0.0.1:5000/contato e envie uma mensagem com o nome Rafaela", "voltando ao kit de mídia: quantos seguidores ela tem no TikTok?"]) assert.equal(pickBrief(request), null, request);
  assert.match(briefBlock("faz um convite pro niver").block, /COMO ENTREGAR BEM[\s\S]*Quer ajustar\?/);
});

test("the briefing's options are added when the answer forgets them, kept when it has them", async () => {
  const { withAdjustOptions } = await import("../app/briefs.js");
  const brief = briefBlock("faz um convite pro niver da minha filha");
  const invite = "🎉 Você está convidado para o aniversário da nossa princesa! Venha comemorar com a gente. 📅 [data] ⏰ [hora] 📍 [local] Confirme até [data].";
  const added = withAdjustOptions(`${invite}\nQuer ajustar algum detalhe antes que eu finalize?`, brief);
  assert.match(added, /\*\*Quer ajustar\?\*\*\n1\. Versão para imprimir em PDF \(recomendado\)\n2\. /);
  assert.doesNotMatch(added, /algum detalhe/);
  const own = `${invite}\n\n**Quer ajustar?**\n1. Tema de princesa (recomendado)\n2. Mais curto`;
  assert.equal(withAdjustOptions(own, brief), own);
  assert.equal(withAdjustOptions("Qual o nome dela?", brief), "Qual o nome dela?");
});
