import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "harness-subagents-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.LOCAL_BASE_URL = "http://127.0.0.1:1";
process.env.EMBEDDINGS_ENABLED = "false";

const { subagentTools, subagentPrompt, deliveryOf } = await import("../app/agentTools/subagents.js");
const { runChatAgent } = await import("../app/chatAgent.js");
const { startTurn, endTurn, turnSnapshots } = await import("../app/pendingTurns.js");
const { buildOffice } = await import("../app/office.js");
const tool = subagentTools[0];

// A subagent turn as runChatAgent returns it: the file it wrote, its words.
const fakeTurn = (file, ok = true) => ({ ok, text: ok ? `Entreguei ${file}.` : "Não consegui.", steps: ok ? [{ tool: "write_document", ok: true, summary: `Criei ${file} (XLSX, 3000 bytes).` }] : [{ tool: "read_file", ok: false, summary: "ERRO: não achei" }] });

test("subagents: each part to a named subagent (two at a time), what each delivered comes back, the parts' files count as the turn's", async () => {
  const conversationId = "sub-1"; const controller = startTurn(conversationId);
  let running = 0, most = 0; const prompts = [];
  const ctx = {
    conversationId, request: "crie dados de uma empresa e planilhas de departamentos, funcionários e frota", env: {},
    runSubagent: async (prompt, hooks) => {
      prompts.push(prompt); running += 1; most = Math.max(most, running);
      hooks.onStage("Pensando…"); hooks.onStep({ tool: "write_document", status: "running", summary: "" });
      // While they work, the office shows them beside their Aurora.
      const snap = turnSnapshots().active.find((t) => t.conversationId === conversationId);
      assert.ok(snap.subagents.some((s) => s.name === hooks.name && !s.done));
      await new Promise((r) => setTimeout(r, 20)); running -= 1;
      const part = /Sua parte: (.*)/.exec(prompt)[1];
      const file = /^planilha da frota/.test(part) ? "C:\\Docs\\Frota.xlsx" : /^planilha de funcion/.test(part) ? "C:\\Docs\\Funcionarios.xlsx" : null;
      return file ? fakeTurn(file) : fakeTurn("", false);
    },
  };
  const result = await tool.run({ tasks: [
    { name: "Departamentos", task: "planilha de departamentos, todos acima de 300 funcionários", deliver: "C:\\Docs\\Departamentos.xlsx" },
    { name: "Funcionários", task: "planilha de funcionários (amostra)", deliver: "C:\\Docs\\Funcionarios.xlsx" },
    { name: "Frota", task: "planilha da frota de carros", deliver: "C:\\Docs\\Frota.xlsx" },
  ] }, ctx);
  assert.equal(most, 2);
  // Names of people, one each, never "Aurora"; each prompt knows its part and the others'.
  const names = ctx.subagentRuns.map((r) => r.name);
  assert.equal(new Set(names).size, 3); assert.ok(!names.includes("Aurora"));
  assert.match(prompts[0], /esta é a SUA parte/); assert.match(prompts[0], /Outros subagentes fazem/); assert.match(prompts[0], /crie dados de uma empresa/);
  assert.match(result, /Frota\.xlsx/); assert.match(result, /NÃO terminou/); assert.match(result, /Refaça você mesmo o que não ficou pronto/);
  assert.equal(ctx.subagentSteps.length, 2);
  const office = buildOffice({ turns: turnSnapshots(), conversations: new Map([[conversationId, { id: conversationId, title: "Empresa", projectId: null }]]) });
  const subs = office.rooms.flatMap((r) => r.actors).filter((a) => a.kind === "subagente");
  assert.equal(subs.length, 3); assert.equal(subs.filter((s) => s.state === "cafe").length, 2); assert.equal(subs.filter((s) => s.state === "cobrado").length, 1);
  endTurn(conversationId, controller);
});

test("subagents: refused for one part, inside a subagent, or without the runner", async () => {
  const two = { tasks: [{ task: "a" }, { task: "b" }] };
  await assert.rejects(tool.run({ tasks: [{ task: "só uma" }] }, { runSubagent: async () => ({}) }), /2 ou mais partes/);
  await assert.rejects(tool.run(two, { subagent: "Bia", runSubagent: async () => ({}) }), /não cria outros/);
  await assert.rejects(tool.run(two, {}), /não estão disponíveis/);
  assert.deepEqual(deliveryOf({ ok: true, steps: [{ tool: "write_file", ok: true, summary: "Salvei C:\\x\\a.md." }] }).files, ["C:\\x\\a.md"]);
  assert.match(subagentPrompt({ name: "Bia", task: "t", deliver: "d", request: "r", others: [] }), /Você é Bia, um subagente da Aurora/);
});

test("subagents: the Aurora's turn that divided the work may say it created the files (the parts wrote them)", async () => {
  const subagents = { ...tool, run: async (args, ctx) => { ctx.subagentSteps = [{ tool: "write_document", ok: true, summary: "Criei C:\\Docs\\Frota.xlsx (XLSX).", by: "Fábio" }]; return "## Fábio — Frota: entregou\nArquivos: C:\\Docs\\Frota.xlsx"; } };
  const replies = [
    { ok: true, text: "", toolCalls: [{ name: "subagents", arguments: { tasks: [{ task: "frota" }, { task: "deptos" }] } }] },
    { ok: true, text: "Criei a planilha da frota em C:\\Docs\\Frota.xlsx (feita pelo subagente Fábio)." },
  ];
  const result = await runChatAgent({ system: "s", input: "crie as planilhas da empresa", tools: [subagents], callModel: async () => replies.shift() });
  assert.equal(result.ok, true); assert.match(result.text, /Frota\.xlsx/);
  assert.ok(result.steps.some((s) => s.by === "Fábio" && s.tool === "write_document"));
  assert.ok(!(result.checks || []).some((c) => /claimed_delivery/.test(c.check)));
});

test("subagents: a request with several deliveries is planned in parts (held to a schema); one delivery is not divided", async () => {
  const { multiPart, planParts, PARTS_SCHEMA } = await import("../app/agentTools/subagents.js");
  assert.deepEqual(multiPart("certo faça planilhas em execel e use os dados para montar um POWERBI interativo com modelos 3D"), ["planilhas", "Power BI"]);
  assert.equal(multiPart("monte o power bi com a planilha vendas.xlsx"), null);
  assert.equal(multiPart("faça uma planilha de vendas"), null);
  let seen = null;
  const plan = await planParts({ request: "faça planilhas e monte um power bi", history: [{ role: "user", content: "crie dados de uma empresa com mais de 300 funcionários por departamento" }], folder: "C:\Docs",
    ask: async (messages, schema) => { seen = { messages, schema }; return { ok: true, text: JSON.stringify({ partes: [{ nome: "Departamentos", tarefa: "planilha de departamentos, todos acima de 300", entrega: "C:\Docs\Departamentos.xlsx" }, { nome: "Frota", tarefa: "planilha da frota", entrega: "C:\Docs\Frota.xlsx" }], final: "montar o Power BI com as duas" }) }; } });
  assert.equal(plan.tasks.length, 2); assert.equal(plan.final, "montar o Power BI com as duas");
  assert.deepEqual(JSON.parse(seen.schema), PARTS_SCHEMA); assert.match(seen.messages[1].content, /mais de 300 funcionários/); assert.match(seen.messages[0].content, /NÃO é uma parte/);
  assert.equal(await planParts({ request: "x", ask: async () => ({ ok: true, text: "{\"partes\":[],\"final\":\"\"}" }) }), null);
});
