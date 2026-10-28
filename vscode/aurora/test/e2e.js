// Runs inside a throwaway VS Code (scripts/vscode-ext-e2e.mjs: a temporary profile and folder, a test
// Harness with a temporary database and the real local model). Checks the 0.3 pieces for real:
// Ctrl+I reviewed in the file, the gray suggestion, the panel's chat, "Revisar no editor" of an
// answer's change, the terminal's failed command. Writes the result to AURORA_SMOKE_OUT.
"use strict";
const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 60000, step = 250) { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(step); } return null; }

exports.run = async function run() {
  const out = { checks: [] };
  const check = (name, ok, detail = "") => out.checks.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 400) });
  try {
    const ext = vscode.extensions.getExtension("harness-aurora.aurora-harness");
    const api = await ext.activate();
    const commands = await vscode.commands.getCommands(true);
    const wanted = ["aurora.inlineEdit", "aurora.review.acceptAll", "aurora.review.rejectAll", "aurora.reviewChanges", "aurora.fixTerminal", "aurora.toggleAutocomplete", "aurora.openChat", "aurora.panel.focus"];
    check("a extensão ativa com os comandos novos", wanted.every((c) => commands.includes(c)), wanted.filter((c) => !commands.includes(c)).join(", "));
    const folder = vscode.workspace.workspaceFolders[0].uri.fsPath;

    // 1. Ctrl+I on a selection: old and new lines in the file, then "Aceitar tudo".
    const file = path.join(folder, "util.js");
    const doc = await vscode.workspace.openTextDocument(file);
    const editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(1, 0, 3, 1);
    const before = doc.getText();
    const started = Date.now();
    await vscode.commands.executeCommand("aurora.inlineEdit", "trate lista vazia retornando 0");
    const review = api.reviews.get(doc.uri.toString());
    check("Ctrl+I: a revisão aparece no arquivo", review && review.hunks.length > 0, review ? `${review.hunks.length} trecho(s) em ${Date.now() - started} ms` : "sem revisão");
    if (review) {
      const merged = doc.getText();
      check("Ctrl+I: as linhas antigas ficam lá até decidir", merged.includes("return lista.reduce((a, b) => a + b);"), merged.slice(0, 300));
      await vscode.commands.executeCommand("aurora.review.acceptAll");
      const after = doc.getText();
      // Each old line is gone unless the new code has it too (once).
      const once = (s) => after.split(s).length - 1;
      const lines = after.split(/\r?\n/).filter((l) => l.trim() && l.trim() !== "}");
      const noDuplicates = new Set(lines).size === lines.length;
      check("Aceitar tudo: só o código novo fica", !api.reviews.has(doc.uri.toString()) && review.hunks.length === 0 && noDuplicates && once("function soma(lista) {") === 1 && after !== before && /length|vazi|!lista/.test(after), after.slice(0, 400));
      check("o resto do arquivo não muda", after.includes("// util") && after.trimEnd().endsWith("module.exports = { soma };"), after.slice(-80));
      out.inlineEdit = after;
    }
    // Ctrl+I again, then refused: the file is as it was.
    const keep = doc.getText();
    editor.selection = new vscode.Selection(0, 0, 0, 7);
    await vscode.commands.executeCommand("aurora.inlineEdit", "troque o comentário por um JSDoc dizendo o que o arquivo faz");
    if (api.reviews.get(doc.uri.toString())) { await vscode.commands.executeCommand("aurora.review.rejectAll"); check("Recusar tudo: o arquivo volta como estava", doc.getText() === keep, doc.getText().slice(0, 200)); }
    else check("Recusar tudo: o arquivo volta como estava", false, "a segunda edição não abriu revisão");

    // 2. The gray suggestion at a cursor.
    const comp = await vscode.workspace.openTextDocument({ language: "javascript", content: "function media(numeros) {\n  if (!numeros.length) return 0;\n  const total = \n  return total / numeros.length;\n}\n" });
    await vscode.window.showTextDocument(comp);
    const token = new vscode.CancellationTokenSource().token;
    const t0 = Date.now();
    const items = await api.completion.provideInlineCompletionItems(comp, new vscode.Position(2, 16), { triggerKind: 1 }, token);
    const text = items?.[0]?.insertText;
    check("autocompletar: uma sugestão do modelo local", typeof text === "string" && /reduce|for|sum|soma/.test(text), `${JSON.stringify(text)} em ${Date.now() - t0} ms`);
    out.completion = text;

    // 3. The panel: a question and its answer.
    await vscode.commands.executeCommand("aurora.panel.focus");
    const seen = [];
    const panel = api.panel;
    await until(() => panel.view, 15000);
    const post = panel.post.bind(panel);
    panel.post = (m) => { seen.push(m); post(m); };
    await until(() => panel.conversationId, 30000);
    check("painel: abre com a conversa da pasta", Boolean(panel.view && panel.conversationId), panel.conversationId || "sem conversa");
    await vscode.window.showTextDocument(doc);
    await panel.send("Explique a função soma do arquivo aberto em 5 tópicos: o que recebe, o que devolve, como funciona, o que acontece com lista vazia e uma melhoria.");
    const answer = seen.find((m) => m.type === "answer");
    check("painel: a resposta chega", answer && answer.message.content.length > 10, answer ? answer.message.content.slice(0, 200) : JSON.stringify(seen.filter((m) => m.type === "error")));
    check("painel: o texto aparece enquanto ela escreve", seen.some((m) => m.type === "progress" && m.partial), `${seen.filter((m) => m.type === "progress").length} atualizações`);
    const sent = seen.find((m) => m.type === "sent");
    check("painel: o arquivo aberto vai junto", sent?.context?.file === "util.js", JSON.stringify(sent?.context));

    // The suggestion again, now that the chat's model server is up (the engine the Harness uses then).
    const comp2 = await vscode.workspace.openTextDocument({ language: "python", content: "def media(valores):\n    if not valores:\n        return 0\n    total = \n    return total / len(valores)\n" });
    const t1 = Date.now();
    const items2 = await api.completion.provideInlineCompletionItems(comp2, new vscode.Position(3, 12), { triggerKind: 1 }, new vscode.CancellationTokenSource().token);
    check("autocompletar depois do chat (modelo já carregado)", typeof items2?.[0]?.insertText === "string" && /sum|for/.test(items2[0].insertText), `${JSON.stringify(items2?.[0]?.insertText)} em ${Date.now() - t1} ms`);

    // 4. "Revisar no editor" of an answer's change: refused, the file is back as it was and saved.
    const target = path.join(folder, "conta.js"), backup = path.join(folder, ".conta.antes.js");
    fs.writeFileSync(backup, "const a = 1;\nconst b = 2;\nconsole.log(a + b);\n");
    fs.writeFileSync(target, "const a = 1;\nconst b = 3;\nconsole.log(a + b);\nconsole.log('fim');\n");
    await vscode.commands.executeCommand("aurora.reviewChanges", [{ file: target, backup, created: false }]);
    const tdoc = vscode.workspace.textDocuments.find((d) => d.fileName.toLowerCase() === target.toLowerCase());
    const rv = tdoc && api.reviews.get(tdoc.uri.toString());
    check("Revisar no editor: os trechos da Aurora aparecem", rv && rv.hunks.length >= 1, rv ? `${rv.hunks.length} trecho(s)` : "sem revisão");
    if (rv) {
      await vscode.commands.executeCommand("aurora.review.accept", tdoc.uri, rv.hunks[0]);
      if (rv.hunks.length) await vscode.commands.executeCommand("aurora.review.reject", tdoc.uri, rv.hunks[0]);
      await until(() => !tdoc.isDirty, 5000);
      const saved = fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n");
      check("aceitar um trecho e recusar outro, e o arquivo é salvo", saved === "const a = 1;\nconst b = 3;\nconsole.log(a + b);\n" || saved === "const a = 1;\nconst b = 2;\nconsole.log(a + b);\nconsole.log('fim');\n", JSON.stringify(saved));
    }

    // 5. A failed command in the integrated terminal becomes context.
    const term = vscode.window.createTerminal({ name: "teste", cwd: folder });
    term.show();
    await until(() => term.shellIntegration, 20000);
    if (term.shellIntegration) {
      term.shellIntegration.executeCommand('node -e "console.error(\'falhou de propósito\'); process.exit(3)"');
      const failure = await until(() => api.terminal.lastFailure(), 20000);
      // PowerShell's shell integration reports "failed" (1), not node's own code.
      check("terminal: o comando que falhou é guardado com a saída", failure && failure.exitCode !== 0 && /falhou de propósito/.test(failure.output), failure ? `${failure.command} → ${failure.exitCode}: ${failure.output.slice(-80)}` : "nada");
    } else check("terminal: o comando que falhou é guardado com a saída", false, "sem shell integration nesta janela de teste");
  } catch (error) { check("sem exceção", false, error.stack || error.message); }
  out.ok = out.checks.every((c) => c.ok);
  fs.writeFileSync(process.env.AURORA_SMOKE_OUT, JSON.stringify(out, null, 1));
};
