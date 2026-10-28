// The review inside the editor: a change shown in the file itself, each hunk as the old lines (red)
// above the new ones (green), with "Aceitar" and "Recusar" over it (CodeLens) and, at the top, for all
// of them. Used by Ctrl+I (the snippet the Aurora rewrote) and by "Revisar no editor" (the files the
// Aurora changed in a chat answer, against the copy from before). Nothing is deleted unless the lines
// are still exactly what the review put there; saving the file accepts what is left.
"use strict";
const vscode = require("vscode");
const { diffLines, countText } = require("./diff");
const { widenToBlock } = require("./blocks");

const reviews = new Map();      // document uri -> Review
const changed = new vscode.EventEmitter();
let decoRemoved = null, decoAdded = null, decoBusy = null;

const linesOf = (text) => String(text).split(/\r?\n/);
const eolOf = (doc) => (doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n");

class Review {
  /**
   * doc: the document; startLine: where the region starts; oldLines/newLines: the region before and
   * after; title: what is shown at the top; saveAtEnd: save the file when the last hunk is decided.
   */
  constructor(doc, { startLine, title, saveAtEnd = false, source = "edit" }) {
    this.doc = doc; this.startLine = startLine; this.title = title; this.saveAtEnd = saveAtEnd; this.source = source;
    this.hunks = []; this.applying = false; this.accepted = 0; this.rejected = 0;
  }
  /** The document's lines [from, to) as they are now. */
  lines(from, to) { const out = []; for (let i = from; i < to && i < this.doc.lineCount; i += 1) out.push(this.doc.lineAt(i).text); return out; }
  /** A hunk is still what the review wrote: its old lines then its new lines, unchanged. */
  intact(h) {
    const now = this.lines(h.line, h.line + h.removed.length + h.added.length);
    return now.length === h.removed.length + h.added.length && now.every((l, i) => l === (i < h.removed.length ? h.removed[i] : h.added[i - h.removed.length]));
  }
  decorate() {
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document !== this.doc) continue;
      const removed = [], added = [];
      for (const h of this.hunks) {
        for (let i = 0; i < h.removed.length; i += 1) removed.push(new vscode.Range(h.line + i, 0, h.line + i, 0));
        for (let i = 0; i < h.added.length; i += 1) added.push(new vscode.Range(h.line + h.removed.length + i, 0, h.line + h.removed.length + i, 0));
      }
      editor.setDecorations(decoRemoved, removed);
      editor.setDecorations(decoAdded, added);
    }
  }
  /** Deletes lines [from, from+count) of the document (the old ones on accept, the new on reject). */
  async drop(from, count) {
    if (!count) return true;
    const edit = new vscode.WorkspaceEdit();
    const end = from + count;
    const range = end < this.doc.lineCount ? new vscode.Range(from, 0, end, 0)
      : from > 0 ? new vscode.Range(from - 1, this.doc.lineAt(from - 1).text.length, end - 1, this.doc.lineAt(end - 1).text.length)
      : new vscode.Range(0, 0, end - 1, this.doc.lineAt(end - 1).text.length);
    edit.delete(this.doc.uri, range);
    this.applying = true;
    try { return await vscode.workspace.applyEdit(edit); } finally { this.applying = false; }
  }
  async decide(h, accept) {
    if (!this.hunks.includes(h)) return;
    if (!this.intact(h)) { this.forget(h); return; }
    const from = accept ? h.line : h.line + h.removed.length;
    const count = accept ? h.removed.length : h.added.length;
    if (!(await this.drop(from, count))) return;
    this.hunks = this.hunks.filter((x) => x !== h);
    for (const x of this.hunks) if (x.line > h.line) x.line -= count;
    if (accept) this.accepted += 1; else this.rejected += 1;
    await this.settle();
  }
  async decideAll(accept) {
    // From the bottom up: the lines above do not move.
    for (const h of [...this.hunks].sort((a, b) => b.line - a.line)) await this.decide(h, accept);
  }
  forget(h) { this.hunks = this.hunks.filter((x) => x !== h); }
  async settle() {
    this.decorate(); changed.fire();
    if (this.hunks.length) return;
    reviews.delete(this.doc.uri.toString());
    this.decorate(); setContext();
    if (this.saveAtEnd && this.doc.isDirty) await this.doc.save();
    const total = this.accepted + this.rejected;
    if (total) vscode.window.setStatusBarMessage(`Aurora: ${this.accepted} de ${total} trecho(s) aceito(s)${this.rejected ? `, ${this.rejected} recusado(s)` : ""}.`, 5000);
  }
  /** The person typed in the file: the hunks below move, a hunk that was touched is no longer reviewed. */
  onChange(event) {
    if (this.applying) return;
    for (const c of event.contentChanges) {
      const delta = linesOf(c.text).length - 1 - (c.range.end.line - c.range.start.line);
      for (const h of this.hunks) {
        const end = h.line + h.removed.length + h.added.length;
        if (c.range.start.line >= end) continue;
        if (c.range.end.line < h.line) h.line += delta;
        else h.touched = true;
      }
    }
    this.hunks = this.hunks.filter((h) => !h.touched && this.intact(h));
    this.settle();
  }
}

/**
 * Starts a review over lines [startLine, endLine) of the document's editor, whose text becomes
 * `newText`: the old and new lines go into the file together. Returns the review, or null when nothing
 * changes.
 */
async function startReview(editor, { startLine, endLine, oldLines, newText, title, saveAtEnd = false, source = "edit" }) {
  const doc = editor.document;
  const key = doc.uri.toString();
  if (reviews.has(key)) await reviews.get(key).decideAll(true);
  const newLines = linesOf(newText);
  const hunks = diffLines(oldLines, newLines);
  if (!hunks.length) return null;
  // The region as it will be in the file: unchanged lines, and each hunk's old lines then new ones.
  const merged = [];
  const review = new Review(doc, { startLine, title, saveAtEnd, source });
  let i = 0;
  for (const h of hunks) {
    while (i < h.at) merged.push(oldLines[i++]);
    review.hunks.push({ line: startLine + merged.length, removed: h.removed, added: h.added });
    merged.push(...h.removed, ...h.added);
    i += h.removed.length;
  }
  while (i < oldLines.length) merged.push(oldLines[i++]);
  const eol = eolOf(doc);
  const edit = new vscode.WorkspaceEdit();
  if (endLine > startLine) {
    const last = Math.min(endLine, doc.lineCount) - 1;
    edit.replace(doc.uri, new vscode.Range(startLine, 0, last, doc.lineAt(last).text.length), merged.join(eol));
  } else if (startLine >= doc.lineCount) {
    const lastLine = doc.lineAt(doc.lineCount - 1);
    edit.insert(doc.uri, lastLine.range.end, eol + merged.join(eol));
  } else edit.insert(doc.uri, new vscode.Position(startLine, 0), merged.join(eol) + eol);
  review.applying = true;
  try { if (!(await vscode.workspace.applyEdit(edit))) return null; } finally { review.applying = false; }
  reviews.set(key, review);
  review.decorate(); setContext(); changed.fire();
  const first = review.hunks[0];
  // The selection over the review hides its colors: the cursor goes to the first hunk.
  editor.selection = new vscode.Selection(first.line, 0, first.line, 0);
  editor.revealRange(new vscode.Range(first.line, 0, first.line + first.removed.length + first.added.length, 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  return review;
}

function setContext() {
  const doc = vscode.window.activeTextEditor?.document;
  vscode.commands.executeCommand("setContext", "aurora.reviewing", Boolean(doc && reviews.has(doc.uri.toString())));
}

/** The review of the active editor (for the keybindings). */
const activeReview = () => { const doc = vscode.window.activeTextEditor?.document; return doc ? reviews.get(doc.uri.toString()) || null : null; };

/** Ctrl+I: asks what to change, the Harness rewrites the lines (or writes at the cursor), then the review. */
async function inlineEdit({ client, ensureHarness, instruction = null } = {}) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showInformationMessage("Abra um arquivo para a Aurora editar."); return; }
  const doc = editor.document;
  const sel = editor.selection;
  const hasSelection = !sel.isEmpty;
  // Whole lines: from the start of the first one to the end of the last (a selection ending at column
  // 0 of a line does not take that line).
  const startLine = hasSelection ? sel.start.line : sel.active.line;
  const endLine = hasSelection ? (sel.end.character === 0 && sel.end.line > sel.start.line ? sel.end.line : sel.end.line + 1) : sel.active.line;
  const cursorBlank = !hasSelection && !doc.lineAt(sel.active.line).text.trim();
  const ask = instruction ?? await vscode.window.showInputBox({
    title: hasSelection ? `Aurora: mudar as linhas ${startLine + 1}–${endLine}` : "Aurora: escrever código aqui",
    prompt: hasSelection ? "O que mudar no trecho selecionado?" : "O que escrever no lugar do cursor?",
    placeHolder: hasSelection ? "ex.: trate lista vazia · renomeie para camelCase · adicione tipos" : "ex.: uma função que valida CPF",
    ignoreFocusOut: true,
  });
  if (!ask?.trim()) return;
  if (!(await ensureHarness())) { vscode.window.showWarningMessage("O Harness Aurora está fechado: abra-o para editar com a Aurora."); return; }
  // The lines that go: the selection widened to whole blocks, or the blank line under the cursor (or
  // none: insert below it).
  const all = Array.from({ length: doc.lineCount }, (_, k) => doc.lineAt(k).text);
  const [wideStart, wideEnd] = hasSelection ? widenToBlock(all, startLine, endLine, { language: doc.languageId }) : [0, 0];
  const regionStart = hasSelection ? wideStart : cursorBlank ? sel.active.line : sel.active.line + 1;
  const regionEnd = hasSelection ? wideEnd : cursorBlank ? sel.active.line + 1 : sel.active.line + 1;
  const oldLines = regionEnd > regionStart ? Array.from({ length: regionEnd - regionStart }, (_, k) => doc.lineAt(regionStart + k).text) : [];
  const before = doc.getText(new vscode.Range(0, 0, regionStart, 0));
  const after = regionEnd < doc.lineCount ? doc.getText(new vscode.Range(regionEnd, 0, doc.lineCount, 0)) : "";
  const version = doc.version;
  editor.setDecorations(decoBusy, [new vscode.Range(Math.max(0, regionStart - (hasSelection || cursorBlank ? 0 : 1)), 0, Math.max(0, regionStart - (hasSelection || cursorBlank ? 0 : 1)), 0)]);
  let result;
  try {
    result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "A Aurora está editando…", cancellable: true }, async (_p, token) => {
      const abort = new AbortController();
      token.onCancellationRequested(() => abort.abort());
      return client().edit({ instruction: ask, selection: hasSelection ? oldLines.join("\n") : "", before, after, language: doc.languageId, file: doc.fileName }, { signal: abort.signal });
    });
  } catch (error) {
    if (error?.status !== 499) vscode.window.showErrorMessage(`Aurora: ${error.message}`);
    return;
  } finally { editor.setDecorations(decoBusy, []); }
  if (doc.version !== version) { vscode.window.showWarningMessage("O arquivo mudou enquanto a Aurora escrevia: peça de novo."); return; }
  const target = vscode.window.visibleTextEditors.find((e) => e.document === doc) || await vscode.window.showTextDocument(doc);
  const review = await startReview(target, { startLine: regionStart, endLine: regionEnd, oldLines, newText: result.code, title: ask, source: "edit" });
  if (!review) vscode.window.showInformationMessage("A Aurora não mudou nada nesse trecho.");
}

/**
 * "Revisar no editor": the files a chat answer edited, each against its copy from before, reviewed
 * hunk by hunk (Recusar puts the old lines back; the file is saved when all are decided).
 */
async function reviewChanges(changes = []) {
  const fs = require("node:fs");
  let started = 0;
  for (const c of changes.filter((x) => !x.created && x.backup)) {
    let oldText;
    try { oldText = fs.readFileSync(c.backup, "utf8"); } catch { continue; }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(c.file));
    if (doc.isDirty) { vscode.window.showWarningMessage(`${require("node:path").basename(c.file)} tem mudanças não salvas: salve antes de revisar.`); continue; }
    const editor = await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: started > 0 });
    const current = Array.from({ length: doc.lineCount }, (_, k) => doc.lineAt(k).text);
    // The file on disk is already the new one: the review starts from the old lines, toward it.
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount - 1, doc.lineAt(doc.lineCount - 1).text.length), linesOf(oldText).join(eolOf(doc)));
    if (!(await vscode.workspace.applyEdit(edit))) continue;
    const review = await startReview(editor, { startLine: 0, endLine: doc.lineCount, oldLines: linesOf(oldText), newText: current.join("\n"), title: "o que a Aurora mudou", saveAtEnd: true, source: "agent" });
    if (review) started += 1; else await doc.save();
  }
  if (!started) vscode.window.showInformationMessage("Não há mudanças da Aurora para revisar (ou os arquivos já foram mudados depois).");
}

function registerReview(context) {
  decoRemoved = vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: new vscode.ThemeColor("diffEditor.removedLineBackground"), textDecoration: "line-through", opacity: "0.75", overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.deletedForeground"), overviewRulerLane: vscode.OverviewRulerLane.Left });
  decoAdded = vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: new vscode.ThemeColor("diffEditor.insertedLineBackground"), overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.addedForeground"), overviewRulerLane: vscode.OverviewRulerLane.Left });
  decoBusy = vscode.window.createTextEditorDecorationType({ after: { contentText: "  ✦ a Aurora está escrevendo…", color: new vscode.ThemeColor("editorCodeLens.foreground"), fontStyle: "italic" } });
  context.subscriptions.push(decoRemoved, decoAdded, decoBusy, changed);

  context.subscriptions.push(vscode.languages.registerCodeLensProvider({ scheme: "*" }, {
    onDidChangeCodeLenses: changed.event,
    provideCodeLenses(document) {
      const review = reviews.get(document.uri.toString());
      if (!review) return [];
      const lenses = [];
      const top = Math.min(...review.hunks.map((h) => h.line));
      const at = (line) => new vscode.Range(line, 0, line, 0);
      if (review.hunks.length > 1) {
        lenses.push(new vscode.CodeLens(at(top), { title: `✦ Aurora: ${review.hunks.length} trechos (${countText(review.hunks)})`, command: "" }));
        lenses.push(new vscode.CodeLens(at(top), { title: "Aceitar tudo (Ctrl+Enter)", command: "aurora.review.acceptAll" }));
        lenses.push(new vscode.CodeLens(at(top), { title: "Recusar tudo", command: "aurora.review.rejectAll" }));
      }
      for (const h of review.hunks) {
        lenses.push(new vscode.CodeLens(at(h.line), { title: `✓ Aceitar${review.hunks.length === 1 ? " (Ctrl+Enter)" : ""}`, command: "aurora.review.accept", arguments: [document.uri, h] }));
        lenses.push(new vscode.CodeLens(at(h.line), { title: "✗ Recusar", command: "aurora.review.reject", arguments: [document.uri, h] }));
        if (review.hunks.length === 1) lenses.push(new vscode.CodeLens(at(h.line), { title: `${countText([h])} · ${String(review.title).slice(0, 60)}`, command: "" }));
      }
      return lenses;
    },
  }));
  const of = (uri) => reviews.get(String(uri));
  context.subscriptions.push(
    vscode.commands.registerCommand("aurora.review.accept", (uri, h) => of(uri)?.decide(h, true)),
    vscode.commands.registerCommand("aurora.review.reject", (uri, h) => of(uri)?.decide(h, false)),
    vscode.commands.registerCommand("aurora.review.acceptAll", () => activeReview()?.decideAll(true)),
    vscode.commands.registerCommand("aurora.review.rejectAll", () => activeReview()?.decideAll(false)),
    vscode.workspace.onDidChangeTextDocument((e) => reviews.get(e.document.uri.toString())?.onChange(e)),
    vscode.window.onDidChangeActiveTextEditor(() => setContext()),
    vscode.window.onDidChangeVisibleTextEditors(() => { for (const r of reviews.values()) r.decorate(); }),
    // Saving with hunks still open keeps the new lines (the old ones go), so the file never has both.
    vscode.workspace.onWillSaveTextDocument((e) => {
      const review = reviews.get(e.document.uri.toString());
      if (!review) return;
      const edits = [];
      for (const h of review.hunks) if (review.intact(h) && h.removed.length) edits.push(vscode.TextEdit.delete(new vscode.Range(h.line, 0, h.line + h.removed.length, 0)));
      reviews.delete(e.document.uri.toString());
      e.waitUntil(Promise.resolve(edits));
      setTimeout(() => { review.hunks = []; review.decorate(); setContext(); changed.fire(); }, 0);
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => reviews.delete(doc.uri.toString())),
  );
}

module.exports = { registerReview, startReview, inlineEdit, reviewChanges, activeReview, reviews };
