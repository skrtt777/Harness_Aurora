// Aurora in VS Code: the chat participant @aurora in the chat panel (beside Copilot). Each message goes
// to the Harness Aurora running on this PC — the same local model, memories, tools and teacher as the
// desktop — with the open folder as the project's folder and the open file and selected code as
// context. While she works the chat shows her steps; a permission she asks for comes with buttons.
"use strict";
const vscode = require("vscode");
const { createClient, HarnessError, stepLine, composeMessage } = require("./lib/client");

const KEY = "aurora.conversations";       // workspaceState: folder -> conversation id

function client() {
  const base = vscode.workspace.getConfiguration("aurora").get("harnessUrl") || "http://127.0.0.1:8787";
  return createClient({ base });
}
const folderOf = () => vscode.workspace.workspaceFolders?.[0] || null;

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

/** What the person sees in VS Code: the open file, the selection, the files attached with #. */
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
  return {
    file: editor?.document?.uri?.scheme === "file" ? editor.document.uri.fsPath : null,
    selection: editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : "",
    language: editor?.document?.languageId || "",
    references,
  };
}

function activate(context) {
  const handler = async (request, chatContext, stream, token) => {
    const harness = client();
    const controller = new AbortController();
    let conversationId = null;
    token.onCancellationRequested(() => { controller.abort(); if (conversationId) harness.cancel(conversationId); });
    try {
      if (request.command === "nova") {
        conversationId = await conversationFor(context, harness, { fresh: true });
        if (!request.prompt.trim()) { stream.markdown("Conversa nova com a Aurora começada. Pode pedir."); return {}; }
      } else conversationId = await conversationFor(context, harness);
      stream.progress("A Aurora está pensando…");
      const shownSteps = new Set(); const askedFor = new Set();
      const result = await harness.send(conversationId, composeMessage(request.prompt, await editorContext(request)), {
        signal: controller.signal,
        onProgress: (p) => {
          for (const s of p.steps || []) {
            const line = stepLine(s); const k = `${s.tool}:${line}`;
            if (s.status !== "running" && line && !shownSteps.has(k)) { shownSteps.add(k); stream.markdown(`${s.ok === false || s.status === "failed" ? "✗" : "✓"} ${line.replace(/[*_`]/g, "")}\n\n`); }
          }
          if (p.stage) stream.progress(p.stage);
          if (p.approval && !askedFor.has(p.approval.id)) {
            askedFor.add(p.approval.id);
            stream.markdown(`**A Aurora pede autorização:** ${p.approval.summary}${p.approval.detail ? `\n\n\`${String(p.approval.detail).slice(0, 300)}\`` : ""}\n\n`);
            stream.button({ command: "aurora.approve", title: "Permitir", arguments: [conversationId, p.approval.id, true] });
            stream.button({ command: "aurora.approve", title: "Negar", arguments: [conversationId, p.approval.id, false] });
          }
        },
      });
      stream.markdown(result.content || "(sem resposta)");
      for (const f of result.files) {
        try { stream.reference(vscode.Uri.file(f)); } catch { /* not a local path */ }
      }
      return { metadata: { conversationId } };
    } catch (error) {
      if (error instanceof HarnessError && error.status === 499) return {};
      stream.markdown(`**Não consegui falar com a Aurora:** ${error.message}`);
      if (error instanceof HarnessError && error.status === 503) stream.button({ command: "aurora.openHarness", title: "Abrir o Harness Aurora" });
      return { errorDetails: { message: error.message } };
    }
  };

  const participant = vscode.chat.createChatParticipant("aurora.chat", handler);
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "aurora.png");
  participant.followupProvider = {
    provideFollowups: () => [{ prompt: "explique o que você fez", label: "O que você fez?" }, { prompt: "rode os testes e me diga o resultado", label: "Rodar os testes" }],
  };
  context.subscriptions.push(participant);

  context.subscriptions.push(
    vscode.commands.registerCommand("aurora.approve", async (conversationId, approvalId, approved) => {
      try { const r = await client().approve(conversationId, approvalId, approved); vscode.window.showInformationMessage(r.resolved ? (approved ? "Permitido: a Aurora continua." : "Negado.") : "Esse pedido já tinha sido respondido ou expirou."); }
      catch (e) { vscode.window.showErrorMessage(`Aurora: ${e.message}`); }
    }),
    vscode.commands.registerCommand("aurora.newConversation", async () => {
      try { await conversationFor(context, client(), { fresh: true }); vscode.window.showInformationMessage("Conversa nova com a Aurora. Abra o chat e escreva @aurora."); }
      catch (e) { vscode.window.showErrorMessage(`Aurora: ${e.message}`); }
    }),
    vscode.commands.registerCommand("aurora.openHarness", async () => {
      const exe = vscode.workspace.getConfiguration("aurora").get("harnessPath") || require("node:path").join(process.env.ProgramFiles || "C:\\Program Files", "Harness Aurora", "Harness Aurora.exe");
      try { require("node:child_process").spawn(exe, [], { detached: true, stdio: "ignore" }).unref(); }
      catch (e) { vscode.window.showErrorMessage(`Não consegui abrir ${exe}: ${e.message}`); }
    }),
  );
}

function deactivate() {}
module.exports = { activate, deactivate };
