import test from "node:test";
import assert from "node:assert/strict";
import { escalateAnswer, probeParallelCopies, shouldVote } from "../app/copies.js";
import { detectSignals } from "../app/teacher.js";

const answer = (text, steps = [{ tool: "knowledge_search", ok: true }]) => ({ ok: true, text, steps });

test("only answers are voted on: company or exact-fact questions answered without acting", () => {
  assert.equal(shouldVote({ first: answer("São 9."), companyQuestion: true }), true);
  assert.equal(shouldVote({ first: answer("51"), factQuestion: true }), true);
  assert.equal(shouldVote({ first: answer("Oi!"), companyQuestion: false, factQuestion: false }), false, "small talk");
  assert.equal(shouldVote({ first: answer("Criei o arquivo.", [{ tool: "write_file", ok: true }]), companyQuestion: true }), false, "a turn that acted is never re-run");
  assert.equal(shouldVote({ first: answer("Achei isto.", [{ tool: "web_search", ok: true }]), companyQuestion: true }), false, "the web is not hammered");
  assert.equal(shouldVote({ first: { ok: false, text: "" }, companyQuestion: true }), false);
});

test("two copies that agree stop the escalation; a split goes up and the majority wins", async () => {
  let calls = 0;
  const agree = await escalateAnswer({ first: answer("O ramal do suporte é 2800."), rerun: async () => { calls += 1; return answer("Suporte de TI: ramal 2800."); }, maxCopies: 5 });
  assert.equal(calls, 1);
  assert.equal(agree.result.copies.used, 2);
  assert.equal(agree.result.copies.disagree, false);

  const replies = ["São 9 funcionários em outubro.", "9 pessoas entram de férias.", "Em outubro entram 9.", "São 9."];
  const split = await escalateAnswer({ first: answer("Ninguém entra de férias, são 0."), rerun: async () => answer(replies.shift()), maxCopies: 5 });
  assert.match(split.result.text, /\b9\b/);
  assert.ok(split.result.copies.used >= 4);
});

test("copies that keep disagreeing are flagged for the paid teacher", async () => {
  const texts = ["É R$ 100.", "É R$ 250.", "É R$ 900.", "É R$ 40.", "É R$ 7."];
  const out = await escalateAnswer({ first: answer(texts.shift()), rerun: async () => answer(texts.shift()), maxCopies: 5 });
  assert.equal(out.result.copies.used, 5);
  assert.equal(out.result.copies.disagree, true);
  assert.ok(detectSignals({ userMessage: "Quanto custa?", result: out.result }).some((s) => s.code === "copies_disagree"));
});

test("the probe allows several copies only when they run in parallel", async () => {
  const fakeOllama = (perCallMs, parallel) => {
    let busy = Promise.resolve();
    return async () => {
      // Parallel slots: every call takes perCallMs. Without them, calls queue one after another.
      const run = () => new Promise((r) => setTimeout(r, perCallMs));
      if (parallel) await run(); else { const turn = busy.then(run); busy = turn; await turn; }
      return { ok: true, json: async () => ({ response: "um, dois" }) };
    };
  };
  assert.equal((await probeParallelCopies({ model: "m", fetchImpl: fakeOllama(40, true) })).max, 5);
  assert.equal((await probeParallelCopies({ model: "m", fetchImpl: fakeOllama(40, false) })).max, 1);
});
