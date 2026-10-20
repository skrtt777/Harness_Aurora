import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "harness-engine-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.EMBEDDINGS_ENABLED = "false";

const { limitResetAt, escalationReason, escalate, engineNote, escalationOn, engineStatus, OUT_OF_LIMIT } = await import("../app/engine.js");

test("the limit's end comes from the CLI's own words, an hour when it does not say", () => {
  const now = new Date("2026-10-15T10:00:00").getTime();
  assert.equal(limitResetAt("Claude AI usage limit reached|1760536800", now), 1760536800 * 1000);
  assert.equal(limitResetAt("You've hit your usage limit. Try again in 2 hours 30 minutes.", now), now + 2.5 * 3600e3);
  assert.equal(limitResetAt("You've hit your limit · resets 3pm", now), new Date("2026-10-15T15:00:00").getTime());
  assert.equal(limitResetAt("You've hit your limit · resets 9am", now), new Date("2026-10-16T09:00:00").getTime(), "already past today: tomorrow");
  assert.equal(limitResetAt("rate limited", now), now + 3600e3);
  assert.ok(OUT_OF_LIMIT.test("You've hit your usage limit"));
  assert.ok(!OUT_OF_LIMIT.test("Codex CLI não encontrado."));
});

test("the local answer goes up when it gave up, failed, did not deliver or the person complained", () => {
  const ok = { ok: true, text: "Pronto, criei o arquivo.", steps: [{ tool: "write_document", ok: true, summary: "Criei C:\\x\\a.pptx (PPTX, 9 bytes)." }] };
  assert.equal(escalationReason({ request: "faça uma apresentação com gráficos", result: ok }), null);
  assert.match(escalationReason({ request: "faça uma apresentação com gráficos", result: { ok: true, text: "Não é possível criar gráficos nativos no PowerPoint com as ferramentas disponíveis.", steps: [] } }), /não conseguiu|não é possível/);
  assert.match(escalationReason({ request: "crie uma planilha de vendas", result: { ok: true, text: "Aqui estão os dados: ...", steps: [] } }), /nenhum/);
  assert.match(escalationReason({ request: "Não tem nenhum gráfico nessa apresentação", result: ok }), /reclamou/);
  assert.match(escalationReason({ request: "x", result: { ok: false, error: "fetch failed" } }), /falhou/);
  assert.equal(escalationReason({ request: "x", result: { ok: false, cancelled: true } }), null, "a cancelled turn is not sent anywhere");
});

test("Claude out of its limit: Codex does it, Claude is skipped until it comes back, both out: the local answer", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "engine-ws-"));
  writeFileSync(join(workspace, "dados.csv"), "a,b\n1,2");
  let now = Date.now();
  const calls = [];
  const run = async (id, prompt, { cwd }) => {
    calls.push(id);
    if (id === "claude") return { ok: false, error: "You've hit your usage limit. Try again in 2 hours." };
    writeFileSync(join(cwd, "graficos.pptx"), "pptx");
    return { ok: true, text: "Criei a apresentação com 2 gráficos em graficos.pptx." };
  };
  const first = await escalate({ task: "apresentação com gráficos", reason: "disse que não é possível", workspace, run, now: () => now });
  assert.equal(first.ok, true);
  assert.equal(first.engine, "codex");
  assert.deepEqual(calls, ["claude", "codex"]);
  assert.deepEqual(first.files.map((f) => f.split(/[\\/]/).pop()), ["graficos.pptx"], "only what the engine made, not dados.csv");
  assert.match(first.steps[0].summary, /^Criei .*graficos\.pptx \(pelo Codex\)\./);
  assert.match(engineNote(first, { reason: "disse que não é possível" }), /Feito pelo Codex \(a Aurora local não conseguiu/);
  const status = await engineStatus({ now });
  assert.ok(status.claude.limitedUntil > now, "Claude is marked out of its limit");

  calls.length = 0;
  now += 60_000;
  const second = await escalate({ task: "outra", workspace, run, now: () => now });
  assert.deepEqual(calls, ["codex"], "Claude is skipped while out of its limit");
  assert.equal(second.ok, true);

  calls.length = 0;
  const both = await escalate({ task: "mais uma", workspace, now: () => now, run: async (id) => { calls.push(id); return { ok: false, error: "usage limit reached, try again in 5 hours" }; } });
  assert.equal(both.ok, false);
  assert.equal(both.allLimited, true);
  assert.match(engineNote(both), /Claude e Codex estão sem limite de uso agora .*ficou a resposta da Aurora local/);

  now += 3 * 3600e3;
  assert.equal((await engineStatus({ now })).claude.limitedUntil, null, "back after its reset time");
});

test("on in the app, off for evaluations on a temp database unless asked", async () => {
  assert.equal(await escalationOn({ HARNESS_DB_FILE: join(tmpdir(), "x", "harness.db") }), false);
  assert.equal(await escalationOn({ HARNESS_DB_FILE: join(tmpdir(), "x", "harness.db"), AURORA_ESCALATION: "on" }), true);
  assert.equal(await escalationOn({ HARNESS_DB_FILE: "C:\\Users\\x\\AppData\\Roaming\\Harness Aurora\\harness.db" }), true);
  assert.equal(await escalationOn({ HARNESS_DB_FILE: "C:\\Users\\x\\AppData\\Roaming\\Harness Aurora\\harness.db", AURORA_ESCALATION: "off" }), false);
});
