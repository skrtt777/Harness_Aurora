// The terminal as context: with VS Code's shell integration, each command the person runs in the
// integrated terminal is kept with its exit code and the end of its output. The last one that failed
// goes with "corrigir" (panel chip, /corrigir, the status bar's "Corrigir com a Aurora").
"use strict";
const vscode = require("vscode");

const KEEP = 5, OUTPUT_CHARS = 20000, FRESH_MS = 15 * 60 * 1000;
// Colors, cursor moves and the shell integration's own marks (OSC 633/133) out of the output.
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
const clean = (text) => String(text).replace(ANSI, "").replace(/\r(?!\n)/g, "\n");

function watchTerminal(context) {
  const runs = [];
  const outputs = new Map();     // execution -> text read so far
  const changed = new vscode.EventEmitter();
  if (typeof vscode.window.onDidStartTerminalShellExecution === "function") {
    context.subscriptions.push(vscode.window.onDidStartTerminalShellExecution(async (event) => {
      const execution = event.execution;
      outputs.set(execution, "");
      try {
        for await (const data of execution.read()) {
          const text = (outputs.get(execution) || "") + data;
          outputs.set(execution, text.length > OUTPUT_CHARS * 2 ? text.slice(-OUTPUT_CHARS) : text);
        }
      } catch { /* the terminal closed */ }
    }));
    context.subscriptions.push(vscode.window.onDidEndTerminalShellExecution((event) => {
      const execution = event.execution;
      const command = String(execution.commandLine?.value || "").trim();
      // The stream may still be flushing: read what came a moment later.
      setTimeout(() => {
        const output = clean(outputs.get(execution) || "").slice(-OUTPUT_CHARS);
        outputs.delete(execution);
        if (!command) return;
        runs.push({ command, exitCode: event.exitCode, output, cwd: execution.cwd?.fsPath || "", at: Date.now(), terminal: event.terminal?.name || "" });
        while (runs.length > KEEP) runs.shift();
        changed.fire(runs.at(-1));
      }, 300);
    }));
  }
  context.subscriptions.push(changed);
  return {
    onDidChange: changed.event,
    runs: () => runs.slice(),
    /** The last command, when it failed in the last 15 minutes and nothing ran well after it. */
    lastFailure() {
      const last = runs.at(-1);
      return last && typeof last.exitCode === "number" && last.exitCode !== 0 && Date.now() - last.at < FRESH_MS ? last : null;
    },
    /** For tests: a run as if the terminal had finished it. */
    record(run) { runs.push({ at: Date.now(), output: "", cwd: "", ...run }); changed.fire(runs.at(-1)); },
  };
}

module.exports = { watchTerminal, clean };
