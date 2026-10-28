// The gray suggestion while the person types: the code before and after the cursor go to the Harness
// (/api/code/complete), where the local model fills the middle; Tab accepts. Waits for a short pause,
// is cancelled by the next key, reuses the last answer while the person types what it says, and never
// runs on secrets (.env, keys) or when the Harness is closed.
"use strict";
const vscode = require("vscode");
const path = require("node:path");

const SECRET = /(^|[\\/])(\.env(\..*)?|.*\.(pem|key|pfx|p12|kdbx)|id_rsa.*|credentials.*|secrets?\..*)$/i;
const PREFIX_CHARS = 4000, SUFFIX_CHARS = 1500;

/**
 * What is left of an earlier suggestion when the person typed part of it: the prefix grew by `typed`
 * and the suggestion starts with it -> the rest; otherwise null.
 */
function reuse(last, prefix) {
  if (!last || !prefix.startsWith(last.prefix)) return null;
  const typed = prefix.slice(last.prefix.length);
  if (!typed || typed.includes("\n") || !last.text.startsWith(typed)) return null;
  const rest = last.text.slice(typed.length);
  return rest ? rest : null;
}

function registerCompletion(context, { client, config, onState = () => {} }) {
  let last = null;           // { file, prefix, text }
  let offlineUntil = 0;      // after the Harness did not answer, wait before asking again
  const provider = {
    async provideInlineCompletionItems(document, position, ctx, token) {
      if (!config().get("autocomplete", true)) return [];
      if (document.uri.scheme !== "file" && document.uri.scheme !== "untitled") return [];
      if (SECRET.test(document.fileName) || (["plaintext", "markdown", "log", "dotenv"].includes(document.languageId) && !config().get("autocompleteText", false))) return [];
      if (Date.now() < offlineUntil) return [];
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document === document && !editor.selection.isEmpty) return [];
      const line = document.lineAt(position.line).text;
      const after = line.slice(position.character);
      // In the middle of a word: nothing (the editor's own suggestions are better there).
      if (/^\w/.test(after)) return [];
      const start = document.offsetAt(position);
      const text = document.getText();
      const prefix = text.slice(Math.max(0, start - PREFIX_CHARS), start);
      const suffix = text.slice(start, start + SUFFIX_CHARS);
      if (!prefix.trim()) return [];
      const again = last && last.file === document.fileName ? reuse(last, prefix) : null;
      if (again) return [new vscode.InlineCompletionItem(again, new vscode.Range(position, position))];
      // A short pause first: typing on cancels it.
      await new Promise((r) => setTimeout(r, Number(config().get("autocompleteDelayMs", 350)) || 350));
      if (token.isCancellationRequested) return [];
      const abort = new AbortController();
      const sub = token.onCancellationRequested(() => abort.abort());
      onState("pensando");
      try {
        const r = await client().complete({ prefix, suffix, language: document.languageId, file: path.basename(document.fileName) }, { signal: abort.signal });
        if (token.isCancellationRequested || !r?.text) return [];
        last = { file: document.fileName, prefix, text: r.text };
        return [new vscode.InlineCompletionItem(r.text, new vscode.Range(position, position))];
      } catch (error) {
        if (error?.status === 503) offlineUntil = Date.now() + 30_000;
        return [];
      } finally { sub.dispose(); onState(null); }
    },
  };
  context.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, provider));
  return provider;
}

module.exports = { registerCompletion, reuse, SECRET };
