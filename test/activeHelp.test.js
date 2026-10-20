import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const temp = mkdtempSync(join(tmpdir(), "harness-active-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.LOCAL_BASE_URL = "http://127.0.0.1:1";
process.env.EMBEDDINGS_ENABLED = "false";
process.env.CODEX_BIN = join(temp, "missing-codex.exe");
process.env.CLAUDE_BIN = join(temp, "missing-claude.exe");
const fakeCli = fileURLToPath(new URL("./fixtures/fake-cli.mjs", import.meta.url));

const { proactiveFit, engineBudget, escalate } = await import("../app/engine.js");
const store = await import("../app/store.js");
const hasPython = (() => { for (const py of ["python", "py"]) { try { execFileSync(py, ["--version"], { stdio: "ignore" }); return true; } catch { /* next */ } } return false; })();

const SHEET = "cliente;cpf;regiao;vendas\nMaria Souza;123.456.789-09;Sul;120\nJoão Lima;987.654.321-00;Norte;95\nAna Prado;111.222.333-44;Sul;143\n";
const SECRETS = ["Maria", "João", "Ana Prado", "123.456.789-09", "Sul", "Norte"];
// What a strong engine writes on the mirror: totals per region, read from the file.
const SCRIPT = [
  "import csv",
  "rows = list(csv.DictReader(open('vendas.csv', encoding='utf-8'), delimiter=';'))",
  "tot = {}",
  "for r in rows: tot[r['regiao']] = tot.get(r['regiao'], 0) + int(r['vendas'])",
  "open('vendas_por_regiao.txt', 'w', encoding='utf-8').write('\\n'.join(f'{k}: {v}' for k, v in tot.items()))",
  "print('Vendas por região: ' + ', '.join(f'{k} {v}' for k, v in tot.items()))",
].join("\n");

test("what goes to a strong engine first: files, charts, analyses of the sheets; chat stays local", () => {
  assert.equal(proactiveFit({ request: "faça uma apresentação com os resultados do trimestre" }), "é uma entrega de arquivo");
  assert.equal(proactiveFit({ request: "monte um gráfico das vendas por região" }), "pede um gráfico ou painel");
  assert.equal(proactiveFit({ request: "qual região vendeu mais em março?", hasTables: true }), "é uma análise das planilhas do projeto");
  assert.equal(proactiveFit({ request: "qual região vendeu mais em março?", hasTables: false }), null, "no sheet: nothing to analyze");
  assert.equal(proactiveFit({ request: "oi, tudo bem com você hoje?" }), null);
  assert.equal(proactiveFit({ request: "quem cuida da folha de pagamento?" }), null);
});

test("the daily cap stops the strong engines and says so", async () => {
  const ws = mkdtempSync(join(tmpdir(), "active-cap-"));
  await store.setSetting("engine_daily_limit", "0");
  let calls = 0;
  const out = await escalate({ task: "gráfico", workspace: ws, run: async () => { calls += 1; return { ok: true, text: "x" }; } });
  assert.equal(out.ok, false);
  assert.equal(out.budget, true);
  assert.equal(calls, 0);
  await store.setSetting("engine_daily_limit", "");
});

async function withLocalStub(fn) {
  const bodies = [];
  const stub = http.createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    if (/chat/.test(req.url)) bodies.push(raw);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ message: { role: "assistant", content: "Resposta da Aurora local." }, prompt_eval_count: 10, eval_count: 5 }));
  });
  await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
  try { return await fn(`http://127.0.0.1:${stub.address().port}`, bodies); } finally { await new Promise((resolve) => stub.close(resolve)); }
}

test("active help: a chart request goes to the strong engine first, blind; the local model is not even called", { skip: !hasPython && "sem Python" }, async () => {
  const { handleChatTurn } = await import("../app/server.js");
  const workspace = join(temp, "vendas");
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, "vendas.csv"), SHEET, "utf8");
  const project = await store.createProject({ name: "Vendas", workspaceDir: workspace });
  const log = join(temp, "engine.log");
  await withLocalStub(async (base, bodies) => {
    const env = { ...process.env, LOCAL_BASE_URL: base, LOCAL_MODEL: "qwen3.5:4b", AURORA_ESCALATION: "on", CLAUDE_BIN: fakeCli, FAKE_ENGINE_LOG: log, FAKE_MIRROR_SCRIPT: SCRIPT };
    const conversation = await store.createConversation({ provider: "local", projectId: project.id });
    const before = (await engineBudget()).usedToday;
    const result = await handleChatTurn({ conversationId: conversation.id, message: "Monte um gráfico das vendas por região da planilha. A Maria Souza pediu.", env });
    assert.equal(result.ok, true, result.error);
    assert.equal(bodies.length, 0, "the local model was not needed");
    assert.match(result.message.content, /Vendas por região: Sul 263, Norte 95/, "computed here, on the real data");
    assert.match(result.message.content, /sem enviar seus dados/);
    assert.equal(readFileSync(join(workspace, "vendas_por_regiao.txt"), "utf8").replace(/\r\n/g, "\n"), "Sul: 263\nNorte: 95");
    const seen = JSON.parse(readFileSync(log, "utf8").trim().split("\n")[0]);
    for (const s of SECRETS) assert.ok(!seen.prompt.includes(s), `${s} reached the strong engine`);
    assert.match(seen.cwd.toLowerCase(), /aurora-espelho-/);
    assert.ok(!existsSync(seen.cwd), "the mirror is removed afterwards");
    assert.equal((await engineBudget()).usedToday, before + 1);

    // Small talk stays with the local Aurora.
    const chat = await handleChatTurn({ conversationId: conversation.id, message: "oi, tudo bem com você?", env });
    assert.equal(chat.ok, true, chat.error);
    assert.ok(bodies.length > 0, "the local model answered the chat");
    assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 1, "and the engine was not called again");

    // "Só se falhar": the same request starts with the local model.
    await store.setSetting("paid_help", "quando_falha");
    const calls = bodies.length;
    const later = await handleChatTurn({ conversationId: conversation.id, message: "Monte um gráfico das vendas por região da planilha.", env });
    assert.equal(later.ok, true, later.error);
    assert.ok(bodies.length > calls, "the local model went first");
    await store.setSetting("paid_help", "ativa");
  });
});
