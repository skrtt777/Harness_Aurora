import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "harness-chat-agent-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.LOCAL_BASE_URL = "http://127.0.0.1:1";
process.env.EMBEDDINGS_ENABLED = "false";
process.env.CODEX_BIN = join(temp, "missing-codex.exe");
process.env.CLAUDE_BIN = join(temp, "missing-claude.exe");

const { runChatAgent, parseTextToolCall, renderTextPrompt, compactOldToolResults } = await import("../app/chatAgent.js");
const { runLocalChat } = await import("../app/local.js");
const { startTurn, endTurn, cancelTurn, requestApproval, resolveApproval, getApproval, pushTurnStep, getTurnSteps } = await import("../app/pendingTurns.js");

const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
const close = (server) => new Promise((resolve) => server.close(resolve));
const readBody = (req) => new Promise((resolve) => { let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => resolve(JSON.parse(body || "{}"))); });

const echoTool = { name: "echo", description: "eco", parameters: { type: "object", properties: { text: { type: "string" } } }, risk: "safe", run: async ({ text }) => `eco: ${text}` };
const scripted = (replies) => {
  const seen = [];
  const call = async (messages, tools) => { seen.push({ messages: structuredClone(messages), tools: tools.map((t) => t.name) }); return replies.shift() || { ok: true, text: "fim" }; };
  return { call, seen };
};

test("parseTextToolCall accepts the shapes small models and CLIs write, and ignores prose", () => {
  const known = ["browser_navigate"];
  assert.deepEqual(parseTextToolCall('{"tool":"browser_navigate","args":{"url":"youtube.com"}}', known), { name: "browser_navigate", arguments: { url: "youtube.com" } });
  assert.deepEqual(parseTextToolCall('<tool_call>{"name":"browser_navigate","arguments":{"url":"x.com"}}</tool_call>', known), { name: "browser_navigate", arguments: { url: "x.com" } });
  assert.deepEqual(parseTextToolCall('```json\n{"name":"browser_navigate","arguments":"{\\"url\\":\\"y.com\\"}"}\n```', known), { name: "browser_navigate", arguments: { url: "y.com" } });
  assert.equal(parseTextToolCall('Use {"tool":"browser_navigate"} para abrir.', known), null);
  assert.equal(parseTextToolCall('{"tool":"rm_rf","args":{}}', known), null);
  assert.equal(parseTextToolCall("Olá!", known), null);
});

test("agent loop runs a tool, feeds the result back and returns the final answer", async () => {
  const { call, seen } = scripted([
    { ok: true, text: "", toolCalls: [{ name: "echo", arguments: { text: "oi" } }], usage: { input_tokens: 10, output_tokens: 2 } },
    { ok: true, text: "Feito: eco recebido.", usage: { input_tokens: 20, output_tokens: 4 } },
  ]);
  const stages = []; const steps = [];
  const result = await runChatAgent({ system: "sys", input: "ecoe oi", tools: [echoTool], callModel: call, onStage: (s) => stages.push(s), onStep: (s) => steps.push(s) });
  assert.equal(result.ok, true);
  assert.equal(result.text, "Feito: eco recebido.");
  assert.deepEqual(result.steps.map((s) => [s.tool, s.ok, s.summary]), [["echo", true, "eco: oi"]]);
  assert.equal(seen[1].messages.at(-1).role, "tool");
  assert.equal(seen[1].messages.at(-1).content, "eco: oi");
  assert.deepEqual(seen[1].messages.at(-2).tool_calls, [{ function: { name: "echo", arguments: { text: "oi" } } }]);
  assert.equal(result.calls.length, 2);
  assert.deepEqual(steps.map((s) => s.status), ["running", "done"]);
  assert.ok(stages.includes("Usando echo…"));
});

test("a plain message is answered in one call, and inline JSON tool calls still execute", async () => {
  const plain = scripted([{ ok: true, text: "Oi! Tudo bem." }]);
  const answer = await runChatAgent({ system: "s", input: "oi", tools: [echoTool], callModel: plain.call });
  assert.equal(answer.text, "Oi! Tudo bem.");
  assert.equal(answer.steps.length, 0);
  assert.equal(plain.seen.length, 1);

  const inline = scripted([{ ok: true, text: '{"tool":"echo","args":{"text":"x"}}' }, { ok: true, text: "ok" }]);
  const result = await runChatAgent({ system: "s", input: "ecoe", tools: [echoTool], callModel: inline.call });
  assert.equal(result.steps[0].summary, "eco: x");
});

test("tool errors are reported to the model instead of crashing the turn", async () => {
  const boom = { ...echoTool, name: "boom", run: async () => { throw new Error("não achei o botão"); } };
  const { call, seen } = scripted([{ ok: true, text: "", toolCalls: [{ name: "boom", arguments: {} }, { name: "nope", arguments: {} }] }, { ok: true, text: "Tentei, mas falhou." }]);
  const result = await runChatAgent({ system: "s", input: "x", tools: [boom], callModel: call });
  assert.equal(result.ok, true);
  assert.match(seen[1].messages.at(-2).content, /^ERRO: não achei o botão/);
  assert.match(seen[1].messages.at(-1).content, /^ERRO: a ferramenta "nope" não existe/);
  assert.deepEqual(result.steps.map((s) => s.ok), [false, false]);
});

test("repeating the same action or hitting the step cap forces a tool-less summary", async () => {
  const loop = async (messages, tools) => tools.length ? { ok: true, text: "", toolCalls: [{ name: "echo", arguments: { text: "igual" } }] } : { ok: true, text: `resumo após ${messages.filter((m) => m.role === "tool").length} resultados` };
  const repeated = await runChatAgent({ system: "s", input: "x", tools: [echoTool], callModel: loop });
  assert.equal(repeated.ok, true);
  assert.equal(repeated.steps.length, 3);
  assert.equal(repeated.steps.at(-1).ok, false);
  assert.match(repeated.text, /^resumo/);

  let n = 0;
  const varied = async (messages, tools) => tools.length ? { ok: true, text: "", toolCalls: [{ name: "echo", arguments: { text: String(n++) } }] } : { ok: true, text: "limite" };
  const capped = await runChatAgent({ system: "s", input: "x", tools: [echoTool], callModel: varied, maxSteps: 4 });
  assert.equal(capped.text, "limite");
  assert.equal(capped.steps.length, 4);
});

test("cancelling stops the loop and a model failure is returned as-is", async () => {
  const controller = new AbortController();
  const slowTool = { ...echoTool, name: "slow", run: async () => { controller.abort(); throw new Error("abortado"); } };
  const { call } = scripted([{ ok: true, text: "", toolCalls: [{ name: "slow", arguments: {} }] }]);
  const cancelled = await runChatAgent({ system: "s", input: "x", tools: [slowTool], callModel: call, signal: controller.signal });
  assert.equal(cancelled.cancelled, true);

  const failing = await runChatAgent({ system: "s", input: "x", tools: [echoTool], callModel: async () => ({ ok: false, status: 502, error: "sem Ollama", unsupported: true }) });
  assert.equal(failing.ok, false);
  assert.equal(failing.unsupported, true);
});

test("old tool results shrink so long browsing sessions fit a local model's context", () => {
  const big = "x".repeat(2000);
  const messages = [{ role: "system", content: "s" }, ...[1, 2, 3, 4].map((i) => ({ role: "tool", tool_name: "t", content: `${i}${big}` }))];
  compactOldToolResults(messages);
  assert.ok(messages[1].content.length < 500 && messages[2].content.length < 500);
  assert.equal(messages[3].content.length, 2001);
  assert.equal(messages[4].content.length, 2001);
});

test("text providers get a tool catalogue and the transcript of actions", () => {
  const prompt = renderTextPrompt([
    { role: "system", content: "Você é a Aurora." }, { role: "user", content: "ecoe" },
    { role: "assistant", content: "", tool_calls: [{ function: { name: "echo", arguments: { text: "a" } } }] },
    { role: "tool", tool_name: "echo", content: "eco: a" },
  ], [echoTool]);
  assert.match(prompt, /^Você é a Aurora\.\n\nFerramentas disponíveis:\n- echo\(text\?: string\): eco/);
  assert.match(prompt, /Você chamou: \{"tool":"echo","args":\{"text":"a"\}\}/);
  assert.match(prompt, /Resultado de echo:\neco: a/);
  assert.match(renderTextPrompt([{ role: "system", content: "s" }], []), /sem chamar ferramentas/);
});

test("runLocalChat sends native tools to /api/chat and flags models without tool support", async () => {
  const requests = [];
  let mode = "tool";
  const stub = http.createServer(async (req, res) => {
    const body = await readBody(req); requests.push({ url: req.url, body });
    res.setHeader("content-type", "application/json");
    if (mode === "unsupported") { res.writeHead(400); return res.end(JSON.stringify({ error: "registry.ollama.ai/library/x does not support tools" })); }
    res.end(JSON.stringify({ message: { role: "assistant", content: "", tool_calls: [{ function: { name: "echo", arguments: { text: "oi" } } }] }, prompt_eval_count: 5, eval_count: 3, done_reason: "stop" }));
  });
  const base = await listen(stub);
  try {
    const env = { LOCAL_BASE_URL: base, LOCAL_MODEL: "qwen3.5:4b" };
    const result = await runLocalChat([{ role: "user", content: "oi" }], [{ type: "function", function: { name: "echo" } }], env);
    assert.equal(result.ok, true);
    assert.deepEqual(result.toolCalls, [{ name: "echo", arguments: { text: "oi" } }]);
    assert.equal(requests[0].url, "/api/chat");
    assert.equal(requests[0].body.think, false);
    assert.equal(requests[0].body.keep_alive, "30m", "keeps the model warm between bursts");
    assert.equal(requests[0].body.tools[0].function.name, "echo");
    mode = "unsupported";
    const unsupported = await runLocalChat([{ role: "user", content: "oi" }], [], env);
    assert.equal(unsupported.ok, false);
    assert.equal(unsupported.unsupported, true);
  } finally { await close(stub); }
});

test("approvals pause the turn until the user answers; cancel and end deny them", async () => {
  const controller = startTurn("conv-approval");
  try {
    const answer = requestApproval("conv-approval", { tool: "run_command", summary: "ipconfig" });
    const pending = getApproval("conv-approval");
    assert.equal(pending.summary, "ipconfig");
    assert.equal(resolveApproval("conv-approval", "wrong-id", true), false);
    assert.equal(resolveApproval("conv-approval", pending.id, true), true);
    assert.equal(await answer, true);
    assert.equal(getApproval("conv-approval"), null);

    const denied = requestApproval("conv-approval", { tool: "run_command", summary: "x" });
    cancelTurn("conv-approval");
    assert.equal(await denied, false);
  } finally { endTurn("conv-approval", controller); }

  const second = startTurn("conv-approval");
  const ended = requestApproval("conv-approval", { tool: "t", summary: "y" });
  pushTurnStep("conv-approval", { tool: "t", status: "running" });
  pushTurnStep("conv-approval", { tool: "t", status: "done", ok: true });
  assert.deepEqual(getTurnSteps("conv-approval").map((s) => s.status), ["done"]);
  endTurn("conv-approval", second);
  assert.equal(await ended, false);
  assert.equal(await requestApproval("no-turn", { tool: "t", summary: "z" }), false);
});

test("chat turns run the agent end to end: tool call, approval-free file read, saved action steps", async () => {
  const { handleChatTurn } = await import("../app/server.js");
  const store = await import("../app/store.js");
  const { setSetting } = store;
  const folder = mkdtempSync(join(tmpdir(), "harness-agent-root-"));
  writeFileSync(join(folder, "nota.txt"), "senha do wifi: aurora123");
  await setSetting("agent_allowed_roots", JSON.stringify([folder]));
  const bodies = [];
  const stub = http.createServer(async (req, res) => {
    if (req.url !== "/api/chat") { res.writeHead(404); return res.end(); }
    const body = await readBody(req); bodies.push(body);
    res.setHeader("content-type", "application/json");
    const toolResult = body.messages.find((m) => m.role === "tool");
    res.end(JSON.stringify(toolResult
      ? { message: { role: "assistant", content: `Li o arquivo: ${toolResult.content.split("\n").at(-1)}` }, prompt_eval_count: 50, eval_count: 9 }
      : { message: { role: "assistant", content: "", tool_calls: [{ function: { name: "read_file", arguments: { path: join(folder, "nota.txt") } } }] }, prompt_eval_count: 40, eval_count: 7 }));
  });
  const base = await listen(stub);
  try {
    const conversation = await store.createConversation({ provider: "local" });
    const result = await handleChatTurn({ conversationId: conversation.id, message: "o que diz a nota.txt?", env: { ...process.env, LOCAL_BASE_URL: base, LOCAL_MODEL: "qwen3.5:4b" } });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.message.content, "Li o arquivo: senha do wifi: aurora123");
    assert.deepEqual(result.message.execution.toolSteps.map((s) => [s.tool, s.ok]), [["read_file", true]]);
    assert.equal(result.message.execution.callCount, 2);
    assert.deepEqual(result.usage, { input_tokens: 90, output_tokens: 16 });
    assert.match(bodies[0].messages[0].content, /Você é a Aurora/);
    assert.match(bodies[0].messages[0].content, new RegExp(folder.replace(/\\/g, "\\\\")));
    assert.ok(bodies[0].tools.some((t) => t.function.name === "browser_navigate"));
    assert.ok(bodies[0].options.num_ctx >= 12288);
    assert.equal(bodies[0].messages.at(-1).content, "o que diz a nota.txt?");

    // Follow-up turns carry what was done before as real chat history.
    await handleChatTurn({ conversationId: conversation.id, message: "e agora?", env: { ...process.env, LOCAL_BASE_URL: base, LOCAL_MODEL: "qwen3.5:4b" } });
    const history = bodies[2].messages.slice(1, -1);
    assert.deepEqual(history.map((m) => m.role), ["user", "assistant", "tool", "assistant"]);
    assert.equal(history[1].tool_calls[0].function.name, "read_file");
    assert.equal(history[2].tool_name, "read_file");
    assert.equal(history[3].content, "Li o arquivo: senha do wifi: aurora123");
  } finally {
    await close(stub);
    await setSetting("agent_allowed_roots", "");
  }
  assert.equal(readFileSync(join(folder, "nota.txt"), "utf8"), "senha do wifi: aurora123");
});

test("settings expose the agent switches and the approval route answers a waiting turn", async () => {
  const { createServer } = await import("../app/server.js");
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const api = (path, options = {}) => fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { headers: { "content-type": "application/json", "x-harness-token": server.apiToken }, ...options })
    .then(async (response) => ({ status: response.status, body: await response.json() }));
  try {
    const initial = await api("/settings");
    assert.equal(initial.body.agentToolsEnabled, true);
    assert.equal(initial.body.browserBackend, "aurora");
    assert.equal(initial.body.agentAllowedRoots.length, 3);
    const windowsRoot = "C:" + String.fromCharCode(92) + "Users" + String.fromCharCode(92) + "x" + String.fromCharCode(92) + "Projetos";
    const saved = await api("/settings", { method: "PUT", body: JSON.stringify({ agentToolsEnabled: false, browserBackend: "chrome", agentAllowedRoots: [windowsRoot, "/home/x"] }) });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.deepEqual([saved.body.agentToolsEnabled, saved.body.browserBackend, saved.body.agentAllowedRoots], [false, "chrome", [windowsRoot, "/home/x"]]);
    assert.equal((await api("/settings", { method: "PUT", body: JSON.stringify({ agentAllowedRoots: ["relativa/pasta"] }) })).status, 400);
    assert.equal((await api("/settings", { method: "PUT", body: JSON.stringify({ browserBackend: "firefox" }) })).status, 400);

    const controller = startTurn("conv-http");
    try {
      const answer = requestApproval("conv-http", { tool: "run_command", summary: "dir" });
      pushTurnStep("conv-http", { tool: "web_search", status: "done", ok: true });
      const pending = await api("/conversations/conv-http/pending");
      assert.equal(pending.body.approval.summary, "dir");
      assert.equal(pending.body.steps[0].tool, "web_search");
      assert.equal((await api("/conversations/conv-http/approval", { method: "POST", body: JSON.stringify({ id: pending.body.approval.id, approved: "sim" }) })).status, 400);
      const resolved = await api("/conversations/conv-http/approval", { method: "POST", body: JSON.stringify({ id: pending.body.approval.id, approved: true }) });
      assert.equal(resolved.body.resolved, true);
      assert.equal(await answer, true);
    } finally { endTurn("conv-http", controller); }
  } finally {
    await api("/settings", { method: "PUT", body: JSON.stringify({ agentToolsEnabled: true, browserBackend: "aurora", agentAllowedRoots: [] }) });
    await new Promise((resolve) => server.close(resolve));
  }
});

test("an answer that only announces the next action is pushed to actually do it, once", async () => {
  const { announcesAction } = await import("../app/chatAgent.js");
  assert.equal(announcesAction("Os vídeos não apareceram. Vou rolar a página para baixo e verificar."), true);
  assert.equal(announcesAction("Deixe-me clicar no primeiro resultado."), true);
  assert.equal(announcesAction("Abri o YouTube. O que você quer ver?"), false);
  assert.equal(announcesAction("Pronto! Vou ficar aguardando."), false);

  const { call, seen } = scripted([
    { ok: true, text: "Vou rolar a página para ver os vídeos." },
    { ok: true, text: "", toolCalls: [{ name: "echo", arguments: { text: "rolei" } }] },
    { ok: true, text: "Vou tentar de novo depois." },
  ]);
  const result = await runChatAgent({ system: "s", input: "abre o segundo vídeo", tools: [echoTool], callModel: call });
  assert.equal(result.steps.length, 1);
  assert.equal(result.text, "Vou tentar de novo depois.", "only one nudge per turn");
  assert.match(seen[1].messages.at(-1).content, /Faça isso agora/);
});

test("an unanswered approval expires, and the tool reports that nobody answered", async () => {
  const controller = startTurn("conv-timeout");
  try {
    const started = Date.now();
    await assert.rejects(requestApproval("conv-timeout", { tool: "run_command", summary: "dir" }, { timeoutMs: 60 }), /Ninguém respondeu/);
    assert.ok(Date.now() - started < 2000);
    assert.equal(getApproval("conv-timeout"), null);
    const { executeTool } = await import("../app/agentTools/index.js");
    const result = await executeTool("run_command", { command: "dir" }, { approve: (request) => requestApproval("conv-timeout", request, { timeoutMs: 30 }), knownFolders: {}, allowedRoots: [] });
    assert.equal(result.ok, false);
    assert.match(result.result, /Ninguém respondeu/);
  } finally { endTurn("conv-timeout", controller); }
});

test("automatic lessons don't pile up as duplicates; hand-written memories are never merged", async () => {
  const store = await import("../app/store.js");
  const env = { LOCAL_BASE_URL: "http://127.0.0.1:1", EMBEDDINGS_ENABLED: "false" };
  const first = await store.createMemory({ scope: "global", title: "Números", content: "Formate números en-US sem separador de milhar usando useGrouping:false.", kind: "extracted", env });
  const again = await store.createMemory({ scope: "global", title: "Formatação", content: "Formate números en-US sem separador de milhar, usando useGrouping: false", kind: "extracted", env });
  assert.equal(again.id, first.id);
  assert.equal(again.deduplicated, true);
  const different = await store.createMemory({ scope: "global", title: "Select", content: "Um select com estado inicial precisa do atributo selected explícito.", kind: "extracted", env });
  assert.notEqual(different.id, first.id);
  const conversation = await store.createConversation({ provider: "local" });
  const otherScope = await store.createMemory({ scope: "conversation", conversationId: conversation.id, content: "Formate números en-US sem separador de milhar usando useGrouping:false.", kind: "extracted", env });
  assert.notEqual(otherScope.id, first.id, "dedupe only within the same scope/owner");
  const manual = await store.createMemory({ scope: "global", content: "Formate números en-US sem separador de milhar usando useGrouping:false.", kind: "manual", env });
  assert.notEqual(manual.id, first.id);
});
