// The Aurora's own panel (the ✦ in the activity bar): a chat that does not need Copilot. It shows the
// folder's conversation from the Harness and its history, the answer as she writes it, her steps, the
// permissions she asks for, the files she changed (diff, review in the editor, undo), the comprovante
// of each number and, when a sheet changed after an answer, the resposta viva. What goes with a message
// (the open file, the selection, the Problems, the terminal's failed command) is shown as chips that can
// be turned off. The page is media/panel.js; this side talks to the Harness.
"use strict";
const vscode = require("vscode");
const crypto = require("node:crypto");
const ws = require("./workspace");
const { composeMessage, commandPrompt, changesOf, HarnessError, COMMANDS } = require("./client");

const PROVIDERS = { local: "Local", codex: "Codex", claude: "Claude" };

/** "/corrigir o botão" -> { command: "corrigir", prompt: "o botão" }; other text has no command. */
function parseCommand(text) {
  const m = /^\/(\w+)\s*([\s\S]*)$/.exec(String(text || "").trim());
  if (m && (COMMANDS[m[1]] || m[1] === "nova")) return { command: m[1], prompt: m[2] };
  return { command: "", prompt: String(text || "").trim() };
}

/** A message as the page draws it. */
function viewMessage(m) {
  const steps = (m.execution?.toolSteps || []).map((s) => ({ tool: s.tool, ok: s.ok !== false, summary: String(s.summary || s.tool || "").slice(0, 160) }));
  return { id: m.id, role: m.role, content: String(m.content || ""), proof: m.execution?.proof || null, live: m.execution?.live || null, changes: changesOf(m.execution), steps, provider: m.provider || "", createdAt: m.createdAt || m.created_at || null };
}

class AuroraPanel {
  constructor(context, { terminal, review, status }) {
    this.context = context; this.terminal = terminal; this.review = review; this.status = status;
    this.view = null; this.conversationId = null; this.busy = null; this.use = { file: true, selection: true, problems: true, terminal: true };
  }

  resolveWebviewView(view) {
    this.view = view;
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const nonce = crypto.randomBytes(16).toString("base64");
    const src = (f) => view.webview.asWebviewUri(vscode.Uri.joinPath(media, f));
    view.webview.html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${view.webview.cspSource} data:; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${src("panel.css")}"><title>Aurora</title></head>
<body><div id="app"></div><script nonce="${nonce}" src="${src("markdown.js")}"></script><script nonce="${nonce}" src="${src("panel.js")}"></script></body></html>`;
    view.webview.onDidReceiveMessage((msg) => this.onMessage(msg).catch((e) => this.post({ type: "error", text: e.message })));
    view.onDidChangeVisibility(() => { if (view.visible) { this.sendContext(); this.refresh({ quiet: true }); } });
    this.context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.sendContext()),
      vscode.window.onDidChangeTextEditorSelection(debounce(() => this.sendContext(), 250)),
      vscode.languages.onDidChangeDiagnostics(debounce(() => this.sendContext(), 500)),
      this.terminal.onDidChange(() => this.sendContext()),
    );
  }

  post(msg) { this.view?.webview.postMessage(msg); }

  /** What would go with a message now (the chips). */
  sendContext() {
    if (!this.view) return;
    const editor = vscode.window.activeTextEditor;
    const doc = editor?.document?.uri?.scheme === "file" ? editor.document : null;
    const sel = doc && !editor.selection.isEmpty ? editor.selection : null;
    const problems = doc ? ws.problemsOf(doc.uri) : [];
    const failed = this.terminal.lastFailure();
    this.post({ type: "context", use: this.use, file: doc ? ws.short(doc.uri.fsPath) : null, lines: sel ? `${sel.start.line + 1}–${sel.end.line + 1}` : null,
      problems: problems.length, errors: problems.filter((p) => p.severity === "erro").length, workspaceProblems: ws.problemsOf().length,
      terminal: failed ? { command: failed.command.slice(0, 80), exitCode: failed.exitCode } : null });
  }

  /** The Harness, the folder's conversation and its messages, then the resposta viva. */
  async refresh({ quiet = false, fresh = false } = {}) {
    if (!this.view) return;
    const harness = ws.client();
    let health;
    try { health = await harness.health(); } catch {
      if (!quiet && await ws.ensureHarness({ quiet: true })) return this.refresh({ quiet: true, fresh });
      this.post({ type: "offline", installed: ws.harnessCandidates().some((p) => require("node:fs").existsSync(p)) });
      return;
    }
    try {
      this.conversationId = await ws.conversationFor(this.context, harness, { fresh });
      const c = await harness.conversation(this.conversationId);
      this.post({ type: "conversation", harness: health.version || "", provider: ws.config().get("provider", "local"), providers: PROVIDERS,
        autocomplete: ws.config().get("autocomplete", true), folder: ws.folderOf()?.name || null,
        conversation: { id: c.id, title: c.title, provider: c.provider }, messages: (c.messages || []).filter((m) => m.role !== "system").map(viewMessage), busy: Boolean(this.busy) });
      this.sendContext();
      if ((c.messages || []).some((m) => m.execution?.proof)) harness.recheck(c.id).then((live) => this.post({ type: "live", live })).catch(() => {});
    } catch (error) { this.post({ type: "error", text: error.message }); }
  }

  async onMessage(msg) {
    const harness = ws.client();
    switch (msg.type) {
      case "ready": return this.refresh();
      case "send": return this.send(msg.text);
      case "stop": this.busy?.abort(); if (this.conversationId) harness.cancel(this.conversationId); return;
      case "approve": {
        const r = await harness.approve(this.conversationId, msg.id, msg.approved, msg.always);
        if (!r.resolved) this.post({ type: "notice", text: "Esse pedido já tinha sido respondido ou expirou." });
        return;
      }
      case "use": this.use = { ...this.use, [msg.key]: msg.on }; return this.sendContext();
      case "new": return this.refresh({ fresh: true });
      case "history": {
        const project = await ws.projectOf(harness).catch(() => null);
        const list = await harness.conversations(project?.id || null);
        return this.post({ type: "history", items: list.slice(0, 40).map((c) => ({ id: c.id, title: c.title, provider: c.provider, updatedAt: c.updatedAt || c.updated_at, current: c.id === this.conversationId })) });
      }
      case "pick": await ws.useConversation(this.context, msg.id); return this.refresh();
      case "provider": await ws.config().update("provider", msg.provider, vscode.ConfigurationTarget.Global); return this.post({ type: "notice", text: `As próximas conversas serão com ${PROVIDERS[msg.provider]}. Toque em + para começar uma.` });
      case "autocomplete": await ws.config().update("autocomplete", msg.on, vscode.ConfigurationTarget.Global); this.status?.refresh(); return;
      case "open": {
        const target = String(msg.path || "");
        if (/^https?:/i.test(target)) return vscode.env.openExternal(vscode.Uri.parse(target));
        const file = target.replace(/^file:\/\//i, "");
        const uri = /^[A-Za-z]:\\|^\//.test(file) ? vscode.Uri.file(file) : ws.folderOf() ? vscode.Uri.joinPath(ws.folderOf().uri, file) : vscode.Uri.file(file);
        return vscode.window.showTextDocument(uri, { preview: true }).then(undefined, () => vscode.commands.executeCommand("revealFileInOS", uri));
      }
      case "diffs": return vscode.commands.executeCommand("aurora.showDiffs", msg.changes);
      case "review": return this.review.reviewChanges(msg.changes);
      case "undo": return vscode.commands.executeCommand("aurora.undo", msg.messageId, msg.count);
      case "copy": await vscode.env.clipboard.writeText(String(msg.text || "")); return this.post({ type: "notice", text: "Copiado." });
      case "insert": return this.insert(String(msg.code || ""));
      case "openHarness": { const up = await ws.ensureHarness({ force: true }); if (up) return this.refresh(); return; }
      case "settings": return vscode.commands.executeCommand("workbench.action.openSettings", "@ext:harness-aurora.aurora-harness");
      default: return undefined;
    }
  }

  /** A code block of the answer into the editor: in place of the selection or below the cursor, reviewed. */
  async insert(code) {
    const editor = vscode.window.visibleTextEditors.find((e) => e === vscode.window.activeTextEditor) || vscode.window.visibleTextEditors[0];
    if (!editor) { vscode.window.showInformationMessage("Abra o arquivo onde o código deve entrar."); return; }
    const sel = editor.selection;
    const startLine = sel.isEmpty ? (editor.document.lineAt(sel.active.line).text.trim() ? sel.active.line + 1 : sel.active.line) : sel.start.line;
    const endLine = sel.isEmpty ? (editor.document.lineAt(sel.active.line).text.trim() ? startLine : startLine + 1) : (sel.end.character === 0 && sel.end.line > sel.start.line ? sel.end.line : sel.end.line + 1);
    const oldLines = Array.from({ length: endLine - startLine }, (_, k) => editor.document.lineAt(startLine + k).text);
    await this.review.startReview(editor, { startLine, endLine, oldLines, newText: code, title: "código do chat", source: "chat" });
  }

  /** One message to the Aurora, with what the chips allow, while the page shows her work. */
  async send(text) {
    if (this.busy) return;
    const { command, prompt } = parseCommand(text);
    const harness = ws.client();
    if (!(await ws.ensureHarness())) { this.post({ type: "offline", installed: ws.harnessCandidates().some((p) => require("node:fs").existsSync(p)) }); return; }
    if (command === "nova") { await this.refresh({ fresh: true }); if (!prompt) return; }
    const controller = new AbortController();
    this.busy = controller;
    this.status?.busy(true);
    try {
      this.conversationId ||= await ws.conversationFor(this.context, harness);
      const ctx = await ws.editorContext({ command, use: this.use, terminal: this.terminal });
      if (ctx.terminal) this.terminal.consume();
      if (command === "revisar" && !ctx.diff) { this.post({ type: "notice", text: "Não há mudanças para revisar (o git diff está vazio, ou a pasta não é um repositório git)." }); return; }
      this.post({ type: "sent", text, context: { file: ctx.file ? ws.short(ctx.file) : null, lines: ctx.selectionRange, problems: ctx.problems.length, terminal: ctx.terminal?.command || null } });
      const result = await harness.send(this.conversationId, composeMessage(commandPrompt(command, prompt), ctx), {
        signal: controller.signal,
        onProgress: (p) => this.post({ type: "progress", stage: p.stage || null, partial: p.partial || "", steps: (p.steps || []).map((s) => ({ tool: s.tool, status: s.status, ok: s.ok !== false, summary: String(s.summary || s.stage || s.tool || "").slice(0, 160) })), approval: p.approval || null, order: p.order || null, plan: p.plan || null }),
      });
      this.post({ type: "answer", message: viewMessage({ ...result.message, id: result.messageId, role: "assistant", content: result.content }) });
      if (result.changes.length && ws.config().get("openChangedFiles", true)) {
        const first = result.changes.find((c) => !c.created && c.backup) || result.changes[0];
        if (first && !/\.(png|jpe?g|gif|xlsx|docx|pdf|pptx|class)$/i.test(first.file)) {
          if (first.backup) vscode.commands.executeCommand("aurora.showDiffs", [first]);
          else vscode.window.showTextDocument(vscode.Uri.file(first.file), { preview: true, preserveFocus: true }).then(undefined, () => {});
        }
      }
    } catch (error) {
      if (error instanceof HarnessError && error.status === 499) this.post({ type: "stopped" });
      else this.post({ type: "error", text: error.message, offline: error instanceof HarnessError && error.status === 503 });
    } finally { this.busy = null; this.status?.busy(false); }
  }

  /** From a command (editor menu, the status bar, the terminal hint): the panel open with this text. */
  async ask(text, { send = false } = {}) {
    await vscode.commands.executeCommand("aurora.panel.focus");
    for (let i = 0; i < 20 && !this.view; i += 1) await new Promise((r) => setTimeout(r, 100));
    if (send) return this.send(text);
    this.post({ type: "draft", text });
  }
}

function debounce(fn, ms) { let t = null; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

module.exports = { AuroraPanel, parseCommand, viewMessage, PROVIDERS };
