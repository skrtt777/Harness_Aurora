// Usage scenarios, inside a throwaway VS Code (scripts/vscode-ext-e2e.mjs --tests scenarios.js), with
// the extension as it was packed (--vsix) and a test Harness with the real local model: what a person
// does with it in a day. Each scenario keeps its time, the answer and whether the result really works
// (node --check, node --test, py_compile on the files). Written to AURORA_SMOKE_OUT.
"use strict";
const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 60000, step = 250) { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(step); } return null; }
const runs = (cmd, args, cwd) => { try { return { ok: true, out: execFileSync(cmd, args, { cwd, encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"] }) }; } catch (e) { return { ok: false, out: `${e.stdout || ""}${e.stderr || ""}`.slice(-400) }; } };

exports.run = async function run() {
  const out = { scenarios: [] };
  const folder = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const at = (f) => path.join(folder, f);
  const ext = vscode.extensions.getExtension("harness-aurora.aurora-harness");
  const api = await ext.activate();
  const { createClient } = require(path.join(ext.extensionPath, "lib", "client.js"));
  const client = createClient({ base: vscode.workspace.getConfiguration("aurora").get("harnessUrl") });
  const panel = api.panel;
  await vscode.commands.executeCommand("aurora.panel.focus");
  await until(() => panel.view, 15000);
  const seen = [];
  const post = panel.post.bind(panel);
  const answered = new Set();
  // The person's side of the permissions: commands that run tests or node in the folder, yes; others, no.
  panel.post = (m) => {
    seen.push(m); post(m);
    if (m.type === "progress" && m.approval && !answered.has(m.approval.id)) {
      answered.add(m.approval.id);
      const what = `${m.approval.summary} ${m.approval.detail || ""}`;
      const yes = /\b(node|npm|npx|python|py)\b/i.test(what) && !/\b(rm|del|format|curl|Invoke-WebRequest)\b/i.test(what);
      out.approvals = [...(out.approvals || []), `${yes ? "sim" : "não"}: ${what.slice(0, 120)}`];
      client.approve(panel.conversationId, m.approval.id, yes).catch(() => {});
    }
  };
  await until(() => panel.conversationId, 30000);

  async function scenario(name, fn) {
    const started = Date.now();
    const s = { name, ok: false, ms: 0, detail: "" };
    try { Object.assign(s, await fn()); } catch (e) { s.detail = `exceção: ${e.message}`; }
    s.ms = Date.now() - started;
    out.scenarios.push(s);
    fs.writeFileSync(process.env.AURORA_SMOKE_OUT, JSON.stringify(out, null, 1));
  }
  async function ask(text) {
    seen.length = 0;
    await panel.send(text);
    const a = seen.find((m) => m.type === "answer");
    const err = seen.find((m) => m.type === "error");
    return { answer: a?.message || null, error: err?.text || null, sent: seen.find((m) => m.type === "sent")?.context };
  }
  async function open(file, selection) {
    const doc = await vscode.workspace.openTextDocument(at(file));
    const editor = await vscode.window.showTextDocument(doc);
    if (selection) editor.selection = selection;
    return { doc, editor };
  }

  // 1. /explicar with a selection.
  await scenario("/explicar um trecho selecionado", async () => {
    await open("vendas.js", new vscode.Selection(1, 0, 6, 1));
    const r = await ask("/explicar");
    const text = r.answer?.content || r.error || "";
    return { ok: /reduce|soma|total|vendedor/i.test(text) && r.sent?.lines === "2-7", detail: `${r.sent?.file}:${r.sent?.lines} → ${text.replace(/\s+/g, " ").slice(0, 260)}` };
  });

  // 2. /corrigir with the Problems panel (VS Code's own JavaScript checker finds the error).
  await scenario("/corrigir o erro do painel Problemas", async () => {
    const { doc } = await open("calc.js");
    const problems = await until(() => vscode.languages.getDiagnostics(doc.uri).length, 30000);
    const r = await ask("/corrigir");
    const check = runs("node", ["--check", at("calc.js")], folder);
    const run = runs("node", [at("calc.js")], folder);
    return { ok: check.ok && run.ok && /6/.test(run.out), detail: `problemas vistos: ${problems || 0} · node --check ${check.ok ? "ok" : "falhou"} · saída ${JSON.stringify(run.out.trim().slice(0, 80))} · ${(r.answer?.content || r.error || "").replace(/\s+/g, " ").slice(0, 160)}` };
  });

  // 3. /testes: tests written next to the code and run.
  await scenario("/testes escreve e roda os testes", async () => {
    await open("texto.js");
    const before = new Set(fs.readdirSync(folder));
    const r = await ask("/testes");
    const made = fs.readdirSync(folder).filter((f) => !before.has(f) && /test/i.test(f));
    const test = made.length ? runs("node", ["--test", ...made.map(at)], folder) : { ok: false, out: "nenhum arquivo de teste" };
    return { ok: made.length > 0 && test.ok, detail: `arquivos: ${made.join(", ") || "nenhum"} · node --test ${test.ok ? "passou" : `falhou: ${test.out.replace(/\s+/g, " ").slice(-160)}`} · passos: ${(r.answer?.steps || []).map((s) => s.tool).join(",")}` };
  });

  // 4. A command fails in the terminal; "Corrigir com a Aurora".
  await scenario("erro no terminal → Corrigir com a Aurora", async () => {
    const term = vscode.window.createTerminal({ name: "teste", cwd: folder });
    term.show();
    await until(() => term.shellIntegration, 20000);
    if (!term.shellIntegration) return { ok: false, detail: "sem shell integration" };
    term.shellIntegration.executeCommand("node relatorio.js");
    const failure = await until(() => api.terminal.lastFailure(), 20000);
    if (!failure) return { ok: false, detail: "a falha não foi vista" };
    seen.length = 0;
    await vscode.commands.executeCommand("aurora.fixTerminal");
    const r = { answer: seen.find((m) => m.type === "answer")?.message, sent: seen.find((m) => m.type === "sent")?.context };
    const run = runs("node", [at("relatorio.js")], folder);
    return { ok: Boolean(r.sent?.terminal) && run.ok, detail: `terminal no pedido: ${r.sent?.terminal || "não"} · node relatorio.js ${run.ok ? `ok: ${run.out.trim().slice(0, 80)}` : `falhou: ${run.out.slice(-120)}`}` };
  });

  // 5. /revisar a change with a bug (off by one) in a git repository.
  await scenario("/revisar acha o bug da mudança", async () => {
    fs.writeFileSync(at("paginas.js"), fs.readFileSync(at("paginas.js"), "utf8").replace("i < itens.length", "i <= itens.length"));
    const r = await ask("/revisar");
    const text = r.answer?.content || r.error || "";
    return { ok: /<=|i <= |fora|limite|undefined|índice|indice|off.by|última|ultima/i.test(text), detail: text.replace(/\s+/g, " ").slice(0, 300) };
  });

  // 6. Ctrl+I four times, accepted, and the code still runs.
  const edits = [
    { file: "vendas.js", sel: [1, 0, 6, 1], ask: "ignore vendas sem valor e arredonde o total para 2 casas", check: ["node", ["--check"]] },
    { file: "texto.js", sel: [0, 0, 2, 1], ask: "adicione um comentário JSDoc com @param e @returns", check: ["node", ["--check"]] },
    { file: "dados.py", sel: [0, 0, 4, 0], ask: "adicione type hints e uma docstring", check: ["python", ["-m", "py_compile"]] },
    { file: "busca.js", sel: [0, 0, 7, 1], ask: "converta para async/await com try/catch", check: ["node", ["--check"]] },
  ];
  for (const e of edits) {
    await scenario(`Ctrl+I: ${e.ask} (${e.file})`, async () => {
      const { doc, editor } = await open(e.file, new vscode.Selection(...e.sel));
      const before = doc.getText();
      await vscode.commands.executeCommand("aurora.inlineEdit", e.ask);
      const review = api.reviews.get(doc.uri.toString());
      if (!review) return { ok: false, detail: "nenhuma revisão" };
      const hunks = review.hunks.length;
      await vscode.commands.executeCommand("aurora.review.acceptAll");
      await doc.save();
      const check = runs(e.check[0], [...e.check[1], at(e.file)], folder);
      const after = doc.getText();
      return { ok: check.ok && after !== before, detail: `${hunks} trecho(s) · ${e.check[0]} ${check.ok ? "ok" : `falhou: ${check.out.slice(-160)}`}\n${after.split(/\r?\n/).slice(e.sel[0], e.sel[0] + 14).join("\n")}` };
    });
  }

  // 7. The gray suggestion at six places.
  await scenario("autocompletar em 6 lugares", async () => {
    const cases = [
      { lang: "javascript", text: "function media(xs) {\n  if (!xs.length) return 0;\n  const total = ", tail: "\n  return total / xs.length;\n}\n", ok: /reduce|for/ },
      { lang: "javascript", text: "const pessoas = [{ nome: 'Ana', idade: 31 }];\nconst adultos = pessoas.filter(", tail: ");\n", ok: /idade/ },
      { lang: "python", text: "import json\n\ndef ler(caminho):\n    with open(caminho, encoding='utf-8') as f:\n        ", tail: "\n", ok: /json\.load/ },
      { lang: "python", text: "def fatorial(n):\n    if n <= 1:\n        return 1\n    ", tail: "\n", ok: /fatorial\(n ?- ?1\)/ },
      { lang: "typescript", text: "export function soDigitos(cpf: string): string {\n  return cpf.", tail: "\n}\n", ok: /replace/ },
      { lang: "javascript", text: "const http = require('node:http');\nhttp.createServer((req, res) => {\n  res.writeHead(200);\n  ", tail: "\n}).listen(3000);\n", ok: /res\.end/ },
    ];
    const got = [];
    let right = 0;
    for (const c of cases) {
      const doc = await vscode.workspace.openTextDocument({ language: c.lang, content: c.text + c.tail });
      await vscode.window.showTextDocument(doc);
      const t = Date.now();
      const items = await api.completion.provideInlineCompletionItems(doc, doc.positionAt(c.text.length), { triggerKind: 1 }, new vscode.CancellationTokenSource().token);
      const text = items?.[0]?.insertText || "";
      if (c.ok.test(text)) right += 1;
      got.push(`${c.ok.test(text) ? "✓" : "✗"} ${JSON.stringify(text).slice(0, 60)} (${Date.now() - t} ms)`);
      await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
    }
    return { ok: right >= 5, detail: `${right}/6\n${got.join("\n")}` };
  });

  // 8. "Desfazer" what an answer changed.
  await scenario("Desfazer o que uma resposta mudou", async () => {
    const before = fs.readFileSync(at("config.js"), "utf8");
    await open("config.js");
    const r = await ask("mude a porta de 3000 para 8080 no config.js aberto");
    const changed = fs.readFileSync(at("config.js"), "utf8");
    if (!r.answer?.changes?.length || changed === before) return { ok: false, detail: `nada mudou: ${(r.answer?.content || r.error || "").slice(0, 160)}` };
    const undone = await client.undo(r.answer.id);
    const back = fs.readFileSync(at("config.js"), "utf8");
    return { ok: back === before && /8080/.test(changed), detail: `mudou para 8080: ${/8080/.test(changed)} · desfeito: ${undone.restored?.length} arquivo(s), igual ao original: ${back === before}` };
  });

  out.ok = out.scenarios.every((s) => s.ok);
  fs.writeFileSync(process.env.AURORA_SMOKE_OUT, JSON.stringify(out, null, 1));
};
