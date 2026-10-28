// What the chat participant (@aurora) and the Aurora panel share: the open folder and its conversation
// in the Harness, what VS Code shows as context (the open file, the selection, the Problems panel, the
// git diff, the terminal's last failed command), and the Harness itself: found, opened when closed.
"use strict";
const vscode = require("vscode");
const path = require("node:path");
const { existsSync } = require("node:fs");
const { execFile, spawn } = require("node:child_process");
const { createClient } = require("./client");

const KEY = "aurora.conversations";       // workspaceState: folder -> conversation id

const config = () => vscode.workspace.getConfiguration("aurora");
function client() { return createClient({ base: config().get("harnessUrl") || "http://127.0.0.1:8787" }); }
const folderOf = () => vscode.workspace.workspaceFolders?.[0] || null;
const short = (file) => { const f = folderOf(); return f && String(file).toLowerCase().startsWith(f.uri.fsPath.toLowerCase()) ? path.relative(f.uri.fsPath, file) : file; };

/** The Harness project of the open folder (made when there is none), or null without a folder. */
async function projectOf(harness) {
  const folder = folderOf();
  if (!folder || !config().get("useWorkspaceProject", true)) return null;
  return harness.projectFor(folder.uri.fsPath, `VS Code: ${folder.name}`);
}

/** The conversation of this folder (kept between sessions), made when there is none. */
async function conversationFor(context, harness, { fresh = false } = {}) {
  const folder = folderOf();
  const key = folder ? folder.uri.fsPath : "(sem pasta)";
  const map = context.workspaceState.get(KEY, {});
  if (!fresh && map[key]) {
    try { await harness.conversation(map[key]); return map[key]; } catch { /* removed in the desktop: a new one */ }
  }
  const project = await projectOf(harness);
  const c = await harness.newConversation({ projectId: project?.id || null, title: folder ? `VS Code: ${folder.name}` : "VS Code", provider: config().get("provider", "local") });
  await useConversation(context, c.id);
  return c.id;
}
/** Makes `id` the folder's conversation (the panel's history picks an older one). */
async function useConversation(context, id) {
  const folder = folderOf();
  const map = context.workspaceState.get(KEY, {});
  map[folder ? folder.uri.fsPath : "(sem pasta)"] = id;
  await context.workspaceState.update(KEY, map);
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

/**
 * What the person sees in VS Code, for a message: the open file, the selection, its problems, the
 * files attached with # (chat participant), the last failed terminal command. `use` turns parts off
 * (the panel's chips): { file, selection, problems, terminal }.
 */
async function editorContext({ command = "", references = [], use = {}, terminal = null } = {}) {
  const on = (k) => use[k] !== false;
  const editor = vscode.window.activeTextEditor;
  const refs = [];
  for (const ref of references) {
    const value = ref.value;
    try {
      if (value instanceof vscode.Uri) refs.push({ path: value.fsPath, text: (await vscode.workspace.openTextDocument(value)).getText() });
      else if (value instanceof vscode.Location) refs.push({ path: value.uri.fsPath, text: (await vscode.workspace.openTextDocument(value.uri)).getText(value.range) });
      else if (typeof value === "string") refs.push({ path: ref.id || "texto", text: value });
    } catch { /* unreadable reference: left out */ }
  }
  const doc = on("file") && editor?.document?.uri?.scheme === "file" ? editor.document : null;
  const sel = doc && on("selection") && !editor.selection.isEmpty ? editor.selection : null;
  // /corrigir looks at the whole workspace; otherwise the open file's problems.
  const problems = !on("problems") ? [] : command === "corrigir" ? problemsOf() : doc ? problemsOf(doc.uri) : [];
  const folder = folderOf();
  // The terminal's failure goes with a fix or a plain request, not with explaining, reviewing or tests.
  const failed = on("terminal") && !["explicar", "revisar", "testes"].includes(command) ? terminal?.lastFailure?.() : null;
  return {
    file: doc ? doc.uri.fsPath : null,
    selection: sel ? editor.document.getText(sel) : "",
    selectionRange: sel ? `${sel.start.line + 1}-${sel.end.line + 1}` : null,
    language: doc?.languageId || "",
    references: refs, problems,
    terminal: failed ? { command: failed.command, exitCode: failed.exitCode, output: failed.output, cwd: failed.cwd } : null,
    diff: command === "revisar" && folder ? await gitDiff(folder.uri.fsPath) : "",
  };
}

/** Where the Harness may be installed (the setting first). */
function harnessCandidates() {
  const set = config().get("harnessPath");
  return [
    set,
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Harness Aurora", "Harness Aurora.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Harness Aurora", "Harness Aurora.exe"),
  ].filter(Boolean);
}

let starting = null;
/**
 * The Harness up: when it does not answer and aurora.autoStartHarness is on (or `force`), opens it and
 * waits until it answers (at most 90 s). Returns true when it is up.
 */
async function ensureHarness({ force = false, quiet = false } = {}) {
  const harness = client();
  try { await harness.health(); return true; } catch { /* closed */ }
  if (!force && !config().get("autoStartHarness", true)) return false;
  if (starting) return starting;
  const exe = harnessCandidates().find((p) => existsSync(p));
  if (!exe) {
    if (!quiet) vscode.window.showWarningMessage("Não encontrei o Harness Aurora instalado. Abra-o você mesmo ou diga onde ele está em Configurações → aurora.harnessPath.", "Configurar").then((c) => { if (c) vscode.commands.executeCommand("workbench.action.openSettings", "aurora.harnessPath"); });
    return false;
  }
  starting = vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Abrindo o Harness Aurora…" }, async () => {
    try { spawn(exe, [], { detached: true, stdio: "ignore", windowsHide: false }).unref(); } catch { return false; }
    const until = Date.now() + 90_000;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 1500));
      try { await harness.health(); return true; } catch { /* still opening */ }
    }
    return false;
  }).finally(() => { setTimeout(() => { starting = null; }, 0); });
  return starting;
}

module.exports = { client, config, folderOf, short, projectOf, conversationFor, useConversation, problemsOf, gitDiff, editorContext, ensureHarness, harnessCandidates, SEVERITY };
