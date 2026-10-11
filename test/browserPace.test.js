import assert from "node:assert/strict";
import test from "node:test";
import { challengeFrom, countAction, isWebSearchUrl, MAX_ACTIONS_PER_SITE, noteAction, paceDelay, resetPaceForTests, siteSearchUrl } from "../app/browserPace.js";

test("searches inside known sites go straight to their results", () => {
  assert.equal(siteSearchUrl("youtube.com", "bolo de cenoura"), "https://www.youtube.com/results?search_query=bolo+de+cenoura");
  assert.equal(siteSearchUrl("https://www.mercadolivre.com.br", "Geladeira Frost Free"), "https://lista.mercadolivre.com.br/geladeira-frost-free");
  assert.equal(siteSearchUrl("amazon.com.br", "fone"), "https://www.amazon.com.br/s?k=fone");
  assert.equal(siteSearchUrl("google.com/maps", "padaria"), "https://www.google.com/maps/search/padaria");
  assert.equal(siteSearchUrl("google.com", "padaria"), null);
  assert.equal(siteSearchUrl("lojadobairro.com.br", "pão"), null);
});

test("web search result pages are recognized", () => {
  assert.ok(isWebSearchUrl("https://www.google.com/search?q=x"));
  assert.ok(isWebSearchUrl("https://www.bing.com/search?q=x"));
  assert.ok(!isWebSearchUrl("https://www.google.com/maps/search/padaria"));
  assert.ok(!isWebSearchUrl("https://www.youtube.com/results?search_query=x"));
});

test("\"are you human?\" checks are seen; articles about them are not", () => {
  assert.match(challengeFrom({ url: "https://www.google.com/sorry/index?continue=x" }), /verifica/);
  assert.match(challengeFrom({ title: "Just a moment...", text: "" }), /Just a moment/);
  assert.match(challengeFrom({ frames: ["https://www.google.com/recaptcha/api2/anchor?k=1"] }), /captcha/);
  assert.match(challengeFrom({ text: "Detectamos tráfego incomum vindo da sua rede." }), /humano/);
  assert.equal(challengeFrom({ title: "Loja", text: "x".repeat(4000) + " tráfego incomum" }), null);
  assert.equal(challengeFrom({ title: "Produtos", text: "Pão francês R$ 0,90" }), null);
});

test("a human pace per site and a ceiling per request", () => {
  resetPaceForTests();
  assert.equal(paceDelay("https://loja.com/a", 1000), 0);
  noteAction("https://loja.com/a", 1000);
  assert.equal(paceDelay("https://loja.com/b", 1500, () => 0), 700);
  assert.equal(paceDelay("https://outra.com/", 1500), 0);
  const ctx = {};
  for (let i = 0; i < MAX_ACTIONS_PER_SITE; i += 1) countAction(ctx, "https://loja.com/x");
  assert.throws(() => countAction(ctx, "https://loja.com/y"), /pare aqui/);
  countAction(ctx, "https://outra.com/");
});
