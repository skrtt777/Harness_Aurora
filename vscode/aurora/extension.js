// Aurora in VS Code: the chat participant @aurora in the chat panel (beside Copilot). Each message goes
// to the Harness Aurora running on this PC — the same local model, memories, tools and teacher as the
// desktop — with the open folder as the project's folder and what VS Code shows as context (the open
// file, the selection, the Problems panel, the git diff for /revisar). While she works the chat shows
// her steps and what she is writing; a permission comes with buttons; the files she changed come with
// "Ver diferenças" and "Desfazer". Commands on the editor's menu, a quick fix on errors and a status
// bar item lead to the same chat.
"use strict";
const vscode = require("vscode");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { createClient, HarnessError, stepLine, composeMessage, commandPrompt } = require("./lib/client");

const KEY = "aurora.conversations";       // workspaceState: folder -> conversation id

function client() {
  const base = vscode.workspace.getConfiguration("aurora").get("harnessUrl") || "http://127.0.0.1:8787";
  return createClient({ base });
}
const folderOf = () => vscode.workspace.workspaceFolders?.[0] || null;
const short = (file) => { const f = folderOf(); return f && file.toLowerCase().startsWith(f.uri.fsPath.toLowerCase()) ? path.relative(f.uri.fsPath, file) : file; };

/** The conversation of this folder (kept between sessions), made when there is none. */
async function conversationFor(context, harness, { fresh = false } = {}) {
  const folder = folderOf();
  const key = folder ? folder.uri.fsPath : "(sem pasta)";
  const map = context.workspaceState.get(KEY, {});
  if (!fresh && map[key]) {
    try { await harness.conversation(map[key]); return map[key]; } catch { /* removed in the desktop: a new one */ }
  }
  const cfg = vscode.workspace.getConfiguration("aurora");
  let projectId = null;
  if (folder && cfg.get("useWorkspaceProject", true)) projectId = (await harness.projectFor(folder.uri.fsPath, `VS Code: ${folder.name}`)).id;
  const c = await harness.newConversation({ projectId, title: folder ? `VS Code: ${folder.name}` : "VS Code", provider: cfg.get("provider", "local") });
  map[key] = c.id; await context.workspaceState.update(KEY, map);
  return c.id;
}

const SEVERITY = { [vscode.DiagnosticSeverity.Error]: "erro", [vscode.DiagnosticSeverity.Warning]: "aviso" };
/** The Problems panel: of one file, or of the whole workspace (errors and warnings). */
function problemsOf(uri = null) {
  const list = uri ? [[uri, vscode.languages.getDiagnostics(uri)]] : vscode.languages.getDiagnostics();
  const out = [];
  for (const [u, diags] of list) {
    if (u.scheme !== "file") continue;
    for (const d of diags) if (SEVERITY[d.severity]) out.push({ file: short(u.fsPath), line: d.range.start.line + 1, severity: SEVERITY[d.severity], message: d.message, source: d.source || "" });
  }
  return out;
}

/** git diff of the working tree (staged and not), for /revisar. */
function gitDiff(cwd) {
  return new Promise((done) => execFile("git", ["diff", "HEAD", "--no-color", "--unified=3"], { cwd, windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 15000 }, (error, stdout) => done(error ? "" : String(stdout))));
}

/** What the person sees in VS Code: the open file, the selection, its problems, the files attached with #. */
async function editorContext(request) {
  const editor = vscode.window.activeTextEditor;
  const references = [];
  for (const ref of request.references || []) {
    const value = ref.value;
    try {
      if (value instanceof vscode.Uri) references.push({ path: value.fsPath, text: (await vscode.workspace.openTextDocument(value)).getText() });
      else if (value instanceof vscode.Location) references.push({ path: value.uri.fsPath, text: (await vscode.workspace.openTextDocument(value.uri)).getText(value.range) });
      else if (typeof value === "string") references.push({ path: ref.id || "texto", text: value });
    } catch { /* unreadable reference: left out */ }
  }
  const doc = editor?.document?.uri?.scheme === "file" ? editor.document : null;
  const sel = editor && !editor.selection.isEmpty ? editor.selection : null;
  // /corrigir looks at the whole workspace; otherwise the open file's problems.
  const problems = request.command === "corrigir" ? problemsOf() : doc ? problemsOf(doc.uri) : [];
  const folder = folderOf();
  return {
    file: doc ? doc.uri.fsPath : null,
    selection: sel ? editor.document.getText(sel) : "",
    selectionRange: sel ? `${sel.start.line + 1}-${sel.end.line + 1}` : null,
    language: doc?.languageId || "",
    references, problems,
    diff: request.command === "revisar" && folder ? await gitDiff(folder.uri.fsPath) : "",
  };
}

/** The status bar: connected, working, or the Harness closed. */
function statusBar(context) {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  item.command = "aurora.openChat";
  let working = 0;
  const show = async () => {
    if (working) { item.text = "$(sync~spin) Aurora"; item.tooltip = "A Aurora está trabalhando"; item.show(); return; }
    try { const h = await client().health(); item.text = "$(sparkle) Aurora"; item.tooltip = `Harness ${h.version || ""} ligado — clique para conversar`; item.backgroundColor = undefined; }
    catch { item.text = "$(circle-slash) Aurora"; item.tooltip = "O Harness Aurora está fechado: clique para abrir o chat (e o botão Abrir o Harness)"; item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground"); }
    item.show();
  };
  show();
  const timer = setInterval(show, 20000);
  context.subscriptions.push(item, { dispose: () => clearInterval(timer) });
  return { busy: (on) => { working = Math.max(0, working + (on ? 1 : -1)); show(); } };
}

/** Opens the chat with a prompt for @aurora (from the menu, the quick fix or the status bar). */
async function openChat(query) {
  try { await vscode.commands.executeCommand("workbench.action.chat.open", { query, isPartialQuery: false }); }
  catch { await vscode.commands.executeCommand("workbench.action.chat.open", query); }
}

function activate(context) {
  const status = statusBar(context);

  const handler = async (request, chatContext, stream, token) => {
    const harness = client();
    const controller = new AbortController();
    let conversationId = null;
    token.onCancellationRequested(() => { controller.abort(); if (conversationId) harness.cancel(conversationId); });
    status.busy(true);
    try {
      if (request.command === "nova") {
        conversationId = await conversationFor(context, harness, { fresh: true });
        if (!request.prompt.trim()) { stream.markdown("Conversa nova com a Aurora começada. Pode pedir."); return {}; }
      } else conversationId = await conversationFor(context, harness);
      const ctx = await editorContext(request);
      if (request.command === "revisar" && !ctx.diff) { stream.markdown("Não há mudanças para revisar (o `git diff` está vazio, ou a pasta não é um repositório git)."); return {}; }
      if (request.command === "corrigir" && !ctx.problems.length && !ctx.selection && !request.prompt.trim()) { stream.markdown("O painel Problemas está vazio. Selecione o trecho com defeito ou diga o que está errado: `@aurora /corrigir o botão não salva`."); return {}; }
      stream.progress("A Aurora está pensando…");
      const shownSteps = new Set(); const askedFor = new Set();
      const result = await harness.send(conversationId, composeMessage(commandPrompt(request.command, request.prompt), ctx), {
        signal: controller.signal,
        onProgress: (p) => {
          for (const s of p.steps || []) {
            const line = stepLine(s); const k = `${s.tool}:${line}`;
            if (s.status !== "running" && line && !shownSteps.has(k)) { shownSteps.add(k); stream.markdown(`${s.ok === false || s.status === "failed" ? "✗" : "✓"} ${line.replace(/[*_`]/g, "")}\n\n`); }
          }
          // What she is writing now, as it comes (the tail of it, on the progress line).
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
      // The files she changed: each with its diff, and one undo for the whole answer.
      if (result.changes.length) {
        stream.markdown(`\n\n---\n**Arquivos ${result.changes.some((c) => !c.created) ? "alterados" : "criados"} (${result.changes.length}):**\n\n`);
        for (const c of result.changes.slice(0, 20)) {
          stream.markdown(`- ${c.created ? "novo" : "editado"}: `);
          stream.anchor(vscode.Uri.file(c.file), short(c.file));
          stream.markdown("\n");
        }
        const edited = result.changes.filter((c) => !c.created && c.backup);
        if (edited.length) stream.button({ command: "aurora.showDiffs", title: `Ver diferenças (${edited.length})`, arguments: [edited] });
        if (result.messageId) stream.button({ command: "aurora.undo", title: "Desfazer estas mudanças", arguments: [result.messageId, result.changes.length] });
        if (vscode.workspace.getConfiguration("aurora").get("openChangedFiles", true)) {
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
    provideFollowups: (result) => {
      const changed = result?.metadata?.changed;
      return changed
        ? [{ prompt: "rode os testes e me diga o resultado", label: "Rodar os testes" }, { prompt: "revise o que você mudou", command: "revisar", label: "Revisar as mudanças" }]
        : [{ prompt: "explique o que você fez", label: "O que você fez?" }, { prompt: "rode os testes e me diga o resultado", label: "Rodar os testes" }];
    },
  };
  context.subscriptions.push(participant);

  // "Corrigir com a Aurora" on the lightbulb of an error or warning.
  context.subscriptions.push(vscode.languages.registerCodeActionsProvider({ scheme: "file" }, {
    provideCodeActions(document, range, ctx) {
      const diags = ctx.diagnostics.filter((d) => SEVERITY[d.severity]);
      if (!diags.length) return [];
      const action = new vscode.CodeAction("Corrigir com a Aurora", vscode.CodeActionKind.QuickFix);
      action.command = { command: "aurora.fixProblem", title: "Corrigir com a Aurora", arguments: [document.uri, diags[0].range.start.line + 1, diags[0].message] };
      action.diagnostics = diags;
      return [action];
    },
  }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }));

  context.subscriptions.push(
    vscode.commands.registerCommand("aurora.approve", async (conversationId, approvalId, approved) => {
      try { const r = await client().approve(conversationId, approvalId, approved); vscode.window.showInformationMessage(r.resolved ? (approved ? "Permitido: a Aurora continua." : "Negado.") : "Esse pedido já tinha sido respondido ou expirou."); }
      catch (e) { vscode.window.showErrorMessage(`Aurora: ${e.message}`); }
    }),
    vscode.commands.registerCommand("aurora.showDiffs", async (changes = []) => {
      for (const c of changes.slice(0, 8)) {
        if (!c.backup) continue;
        await vscode.commands.executeCommand("vscode.diff", vscode.Uri.file(c.backup), vscode.Uri.file(c.file), `${path.basename(c.file)}: antes ↔ Aurora`, { preview: changes.length === 1 });
      }
    }),
    vscode.commands.registerCommand("aurora.undo", async (messageId, count) => {
      const yes = await vscode.window.showWarningMessage(`Desfazer as ${count} mudança(s) desta resposta? Os arquivos editados voltam como estavam e os criados são apagados (um arquivo que você mudou depois fica como está).`, { modal: true }, "Desfazer");
      if (yes !== "Desfazer") return;
      try {
        const r = await client().undo(messageId);
        vscode.window.showInformationMessage(`Desfeito: ${r.restored.length} arquivo(s).${r.skipped.length ? ` Mantidos: ${r.skipped.map((s) => `${path.basename(s.file)} (${s.reason})`).join(", ")}.` : ""}`);
      } catch (e) { vscode.window.showErrorMessage(`Aurora: ${e.message}`); }
    }),
    vscode.commands.registerCommand("aurora.openChat", () => openChat("@aurora ")),
    vscode.commands.registerCommand("aurora.explain", () => openChat("@aurora /explicar ")),
    vscode.commands.registerCommand("aurora.fix", () => openChat("@aurora /corrigir ")),
    vscode.commands.registerCommand("aurora.tests", () => openChat("@aurora /testes ")),
    vscode.commands.registerCommand("aurora.review", () => openChat("@aurora /revisar ")),
    vscode.commands.registerCommand("aurora.fixProblem", (uri, line, message) => openChat(`@aurora /corrigir o erro em ${short(uri.fsPath)} linha ${line}: ${String(message).replace(/\s+/g, " ").slice(0, 200)}`)),
    vscode.commands.registerCommand("aurora.newConversation", async () => {
      try { await conversationFor(context, client(), { fresh: true }); vscode.window.showInformationMessage("Conversa nova com a Aurora. Abra o chat e escreva @aurora."); }
      catch (e) { vscode.window.showErrorMessage(`Aurora: ${e.message}`); }
    }),
    vscode.commands.registerCommand("aurora.openHarness", async () => {
      const exe = vscode.workspace.getConfiguration("aurora").get("harnessPath") || path.join(process.env.ProgramFiles || "C:\\Program Files", "Harness Aurora", "Harness Aurora.exe");
      try { require("node:child_process").spawn(exe, [], { detached: true, stdio: "ignore" }).unref(); }
      catch (e) { vscode.window.showErrorMessage(`Não consegui abrir ${exe}: ${e.message}`); }
    }),
  );
}

function deactivate() {}
module.exports = { activate, deactivate };
