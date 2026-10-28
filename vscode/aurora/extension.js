// Aurora in VS Code. Everything goes to the Harness Aurora running on this PC (the same local model,
// memories, tools and teacher as the desktop), with the open folder as the project's folder:
// - the Aurora panel (✦ in the activity bar, lib/panel.js): her own chat, no Copilot needed;
// - @aurora in VS Code's chat panel, for who uses Copilot Chat;
// - Ctrl+I in the editor (lib/review.js): the snippet rewritten, reviewed hunk by hunk in the file;
// - the gray suggestion while typing (lib/completion.js), from the local model;
// - the terminal's failed command as context (lib/terminal.js), the Problems panel, the git diff;
// - the Harness opened by itself when it is closed.
"use strict";
const vscode = require("vscode");
const path = require("node:path");
const { HarnessError, stepLine, composeMessage, commandPrompt, orderLine } = require("./lib/client");
const ws = require("./lib/workspace");
const review = require("./lib/review");
const { watchTerminal } = require("./lib/terminal");
const { registerCompletion } = require("./lib/completion");
const { AuroraPanel } = require("./lib/panel");

/** The status bar: on, working, the Harness closed; a failed terminal command offers the fix. */
function statusBar(context, terminal) {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  let working = 0, thinking = false, failure = null;
  const show = async () => {
    item.backgroundColor = undefined;
    if (working) { item.text = "$(sync~spin) Aurora"; item.tooltip = "A Aurora está trabalhando"; item.command = "aurora.openChat"; item.show(); return; }
    if (failure) {
      item.text = "$(wrench) Corrigir com a Aurora"; item.tooltip = `O comando "${failure.command.slice(0, 60)}" falhou (código ${failure.exitCode}). Clique para a Aurora corrigir.`;
      item.command = "aurora.fixTerminal"; item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground"); item.show(); return;
    }
    item.command = "aurora.openChat";
    try {
      const h = await ws.client().health();
      const auto = ws.config().get("autocomplete", true);
      item.text = thinking ? "$(loading~spin) Aurora" : auto ? "$(sparkle) Aurora" : "$(sparkle) Aurora $(circle-slash)";
      item.tooltip = new vscode.MarkdownString(`**Aurora** · Harness ${h.version || ""} ligado\n\nAutocompletar: ${auto ? "ligado" : "desligado"} ([trocar](command:aurora.toggleAutocomplete))\n\nCtrl+Alt+A conversa · Ctrl+I edita no código`, true);
      item.tooltip.isTrusted = true;
    } catch {
      item.text = "$(circle-slash) Aurora"; item.tooltip = "O Harness Aurora está fechado: clique para abrir o painel (ele abre o Harness)";
      item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    }
    item.show();
  };
  show();
  const timer = setInterval(show, 20000);
  context.subscriptions.push(item, { dispose: () => clearInterval(timer) });
  context.subscriptions.push(terminal.onDidChange((run) => {
    failure = run.exitCode && run.exitCode !== 0 ? run : null;
    show();
    if (failure) setTimeout(() => { if (failure === run) { failure = null; show(); } }, 90_000);
  }));
  return {
    busy: (on) => { working = Math.max(0, working + (on ? 1 : -1)); show(); },
    thinking: (on) => { if (thinking !== on) { thinking = on; show(); } },
    clearFailure: () => { failure = null; show(); },
    refresh: show,
  };
}

/** Opens the chat with a prompt: the Aurora panel (default) or VS Code's chat with @aurora. */
async function openChatPanel(panel, text) {
  if (ws.config().get("chatLocation", "panel") === "copilot") {
    try { await vscode.commands.executeCommand("workbench.action.chat.open", { query: `@aurora ${text}`, isPartialQuery: false }); return; }
    catch { /* no Copilot chat: the panel */ }
  }
  await panel.ask(text);
}

/** @aurora in VS Code's chat panel (Copilot Chat): the same Harness, its answer in that chat. */
function registerParticipant(context, status, terminal) {
  if (typeof vscode.chat?.createChatParticipant !== "function") return;
  const handler = async (request, chatContext, stream, token) => {
    const harness = ws.client();
    const controller = new AbortController();
    let conversationId = null;
    token.onCancellationRequested(() => { controller.abort(); if (conversationId) harness.cancel(conversationId); });
    status.busy(true);
    try {
      await ws.ensureHarness();
      if (request.command === "nova") {
        conversationId = await ws.conversationFor(context, harness, { fresh: true });
        if (!request.prompt.trim()) { stream.markdown("Conversa nova com a Aurora começada. Pode pedir."); return {}; }
      } else conversationId = await ws.conversationFor(context, harness);
      const ctx = await ws.editorContext({ command: request.command, references: request.references || [], terminal, use: { terminal: request.command === "corrigir" } });
      if (request.command === "revisar" && !ctx.diff) { stream.markdown("Não há mudanças para revisar (o `git diff` está vazio, ou a pasta não é um repositório git)."); return {}; }
      if (request.command === "corrigir" && !ctx.problems.length && !ctx.selection && !ctx.terminal && !request.prompt.trim()) { stream.markdown("O painel Problemas está vazio. Selecione o trecho com defeito ou diga o que está errado: `@aurora /corrigir o botão não salva`."); return {}; }
      stream.progress("A Aurora está pensando…");
      const shownSteps = new Set(); const askedFor = new Set(); let orderShown = false;
      const result = await harness.send(conversationId, composeMessage(commandPrompt(request.command, request.prompt), ctx), {
        signal: controller.signal,
        onProgress: (p) => {
          if (!orderShown && p.order) { orderShown = true; const line = orderLine(p.order); if (line) stream.markdown(`${line}\n\n`); }
          for (const s of p.steps || []) {
            const line = stepLine(s); const k = `${s.tool}:${line}`;
            if (s.status !== "running" && line && !shownSteps.has(k)) { shownSteps.add(k); stream.markdown(`${s.ok === false || s.status === "failed" ? "✗" : "✓"} ${line.replace(/[*_`]/g, "")}\n\n`); }
          }
          const partial = String(p.partial || "").replace(/\s+/g, " ").trim();
          if (partial) stream.progress(`Escrevendo: …${partial.slice(-90)}`);
          else if (p.stage) stream.progress(p.stage);
          if (p.approval && !askedFor.has(p.approval.id)) {
            askedFor.add(p.approval.id);
            stream.markdown(`**A Aurora pede autorização:** ${p.approval.summary}${p.approval.detail ? `\n\n\`${String(p.approval.detail).slice(0, 300)}\`` : ""}\n\n`);
            stream.button({ command: "aurora.approve", title: "Permitir", arguments: [conversationId, p.approval.id, true] });
            stream.button({ command: "aurora.approve", title: "Negar", arguments: [conversationId, p.approval.id, false] });
          }
        },
      });
      stream.markdown(result.content || "(sem resposta)");
      if (result.proof?.total) stream.markdown(`\n\n${result.proof.proven === result.proof.total ? "✓ Comprovado" : "⚠ Comprovado em parte"}: ${result.proof.proven} de ${result.proof.total} números com fonte (veja de onde veio cada um no painel ✦ Aurora).`);
      if (result.changes.length) {
        stream.markdown(`\n\n---\n**Arquivos ${result.changes.some((c) => !c.created) ? "alterados" : "criados"} (${result.changes.length}):**\n\n`);
        for (const c of result.changes.slice(0, 20)) {
          stream.markdown(`- ${c.created ? "novo" : "editado"}: `);
          stream.anchor(vscode.Uri.file(c.file), ws.short(c.file));
          stream.markdown("\n");
        }
        const edited = result.changes.filter((c) => !c.created && c.backup);
        if (edited.length) {
          stream.button({ command: "aurora.reviewChanges", title: "Revisar no editor", arguments: [edited] });
          stream.button({ command: "aurora.showDiffs", title: `Ver diferenças (${edited.length})`, arguments: [edited] });
        }
        if (result.messageId) stream.button({ command: "aurora.undo", title: "Desfazer estas mudanças", arguments: [result.messageId, result.changes.length] });
        if (ws.config().get("openChangedFiles", true)) {
          const first = edited[0] || result.changes[0];
          if (first && !/\.(png|jpe?g|gif|xlsx|docx|pdf|pptx|class)$/i.test(first.file)) {
            if (first.backup) vscode.commands.executeCommand("aurora.showDiffs", [first]);
            else vscode.window.showTextDocument(vscode.Uri.file(first.file), { preview: true, preserveFocus: true }).then(undefined, () => {});
          }
        }
      } else {
        for (const f of result.files) { try { stream.reference(vscode.Uri.file(f)); } catch { /* not a local path */ } }
      }
      return { metadata: { conversationId, messageId: result.messageId, changed: result.changes.length } };
    } catch (error) {
      if (error instanceof HarnessError && error.status === 499) return {};
      stream.markdown(`**Não consegui falar com a Aurora:** ${error.message}`);
      if (error instanceof HarnessError && error.status === 503) stream.button({ command: "aurora.openHarness", title: "Abrir o Harness Aurora" });
      return { errorDetails: { message: error.message } };
    } finally { status.busy(false); }
  };
  const participant = vscode.chat.createChatParticipant("aurora.chat", handler);
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "aurora.png");
  participant.followupProvider = {
    provideFollowups: (result) => (result?.metadata?.changed
      ? [{ prompt: "rode os testes e me diga o resultado", label: "Rodar os testes" }, { prompt: "revise o que você mudou", command: "revisar", label: "Revisar as mudanças" }]
      : [{ prompt: "explique o que você fez", label: "O que você fez?" }, { prompt: "rode os testes e me diga o resultado", label: "Rodar os testes" }]),
  };
  context.subscriptions.push(participant);
}

function activate(context) {
  const terminal = watchTerminal(context);
  const status = statusBar(context, terminal);
  review.registerReview(context);
  const panel = new AuroraPanel(context, { terminal, review, status });
  context.subscriptions.push(vscode.window.registerWebviewViewProvider("aurora.panel", panel, { webviewOptions: { retainContextWhenHidden: true } }));
  registerParticipant(context, status, terminal);
  const completion = registerCompletion(context, { client: ws.client, config: ws.config, onState: (s) => status.thinking(Boolean(s)) });

  // "Corrigir com a Aurora" on the lightbulb of an error or warning; "Editar com a Aurora" on any code.
  context.subscriptions.push(vscode.languages.registerCodeActionsProvider({ scheme: "file" }, {
    provideCodeActions(document, range, ctx) {
      const actions = [];
      const diags = ctx.diagnostics.filter((d) => ws.SEVERITY[d.severity]);
      if (diags.length) {
        const fix = new vscode.CodeAction("Corrigir com a Aurora", vscode.CodeActionKind.QuickFix);
        fix.command = { command: "aurora.fixProblem", title: "Corrigir com a Aurora", arguments: [document.uri, diags[0].range.start.line + 1, diags[0].message] };
        fix.diagnostics = diags;
        actions.push(fix);
      }
      if (!range.isEmpty) {
        const edit = new vscode.CodeAction("Editar com a Aurora (Ctrl+I)", vscode.CodeActionKind.RefactorRewrite);
        edit.command = { command: "aurora.inlineEdit", title: "Editar com a Aurora" };
        actions.push(edit);
      }
      return actions;
    },
  }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.RefactorRewrite] }));

  const inline = (instruction = null) => review.inlineEdit({ client: ws.client, ensureHarness: () => ws.ensureHarness(), instruction });
  context.subscriptions.push(
    vscode.commands.registerCommand("aurora.approve", async (conversationId, approvalId, approved) => {
      try { const r = await ws.client().approve(conversationId, approvalId, approved); vscode.window.showInformationMessage(r.resolved ? (approved ? "Permitido: a Aurora continua." : "Negado.") : "Esse pedido já tinha sido respondido ou expirou."); }
      catch (e) { vscode.window.showErrorMessage(`Aurora: ${e.message}`); }
    }),
    vscode.commands.registerCommand("aurora.showDiffs", async (changes = []) => {
      for (const c of changes.slice(0, 8)) {
        if (!c.backup) continue;
        await vscode.commands.executeCommand("vscode.diff", vscode.Uri.file(c.backup), vscode.Uri.file(c.file), `${path.basename(c.file)}: antes ↔ Aurora`, { preview: changes.length === 1 });
      }
    }),
    vscode.commands.registerCommand("aurora.reviewChanges", (changes = []) => review.reviewChanges(changes)),
    vscode.commands.registerCommand("aurora.undo", async (messageId, count) => {
      const yes = await vscode.window.showWarningMessage(`Desfazer as ${count} mudança(s) desta resposta? Os arquivos editados voltam como estavam e os criados são apagados (um arquivo que você mudou depois fica como está).`, { modal: true }, "Desfazer");
      if (yes !== "Desfazer") return;
      try {
        const r = await ws.client().undo(messageId);
        vscode.window.showInformationMessage(`Desfeito: ${r.restored.length} arquivo(s).${r.skipped.length ? ` Mantidos: ${r.skipped.map((s) => `${path.basename(s.file)} (${s.reason})`).join(", ")}.` : ""}`);
      } catch (e) { vscode.window.showErrorMessage(`Aurora: ${e.message}`); }
    }),
    vscode.commands.registerCommand("aurora.inlineEdit", (instruction) => inline(typeof instruction === "string" ? instruction : null)),
    vscode.commands.registerCommand("aurora.openChat", () => openChatPanel(panel, "")),
    vscode.commands.registerCommand("aurora.explain", () => openChatPanel(panel, "/explicar ")),
    vscode.commands.registerCommand("aurora.fix", () => openChatPanel(panel, "/corrigir ")),
    vscode.commands.registerCommand("aurora.tests", () => openChatPanel(panel, "/testes ")),
    vscode.commands.registerCommand("aurora.review", () => openChatPanel(panel, "/revisar ")),
    vscode.commands.registerCommand("aurora.fixProblem", (uri, line, message) => openChatPanel(panel, `/corrigir o erro em ${ws.short(uri.fsPath)} linha ${line}: ${String(message).replace(/\s+/g, " ").slice(0, 200)}`)),
    vscode.commands.registerCommand("aurora.fixTerminal", async () => { status.clearFailure(); await panel.ask("/corrigir o erro do último comando no terminal", { send: true }); }),
    vscode.commands.registerCommand("aurora.toggleAutocomplete", async () => {
      const on = !ws.config().get("autocomplete", true);
      await ws.config().update("autocomplete", on, vscode.ConfigurationTarget.Global);
      vscode.window.setStatusBarMessage(`Aurora: autocompletar ${on ? "ligado" : "desligado"}.`, 3000);
      status.refresh();
    }),
    vscode.commands.registerCommand("aurora.newConversation", async () => {
      try { await ws.ensureHarness(); await panel.refresh({ fresh: true }); await vscode.commands.executeCommand("aurora.panel.focus"); }
      catch (e) { vscode.window.showErrorMessage(`Aurora: ${e.message}`); }
    }),
    vscode.commands.registerCommand("aurora.openHarness", () => ws.ensureHarness({ force: true })),
    vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration("aurora")) status.refresh(); }),
  );
  // Opened by itself when it is closed (aurora.autoStartHarness), quietly, once VS Code is up.
  if (ws.config().get("autoStartHarness", true) && ws.config().get("startHarnessWithVsCode", false)) ws.ensureHarness({ quiet: true });
  // For the end-to-end test (vscode/aurora/test/e2e.js): the pieces it checks.
  return { panel, terminal, completion, reviews: review.reviews };
}

function deactivate() {}
module.exports = { activate, deactivate };
