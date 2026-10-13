// Runs inside a throwaway VS Code (scripts: code --extensionDevelopmentPath … --extensionTestsPath this
// file, with a temporary profile): the extension activates, its commands exist, the chat API is there.
// Writes the result to AURORA_SMOKE_OUT and closes.
"use strict";
const vscode = require("vscode");
const { writeFileSync } = require("node:fs");

exports.run = async function run() {
  const out = { ok: false };
  try {
    const ext = vscode.extensions.getExtension("harness-aurora.aurora-harness");
    out.found = !!ext;
    await ext.activate();
    out.active = ext.isActive;
    const commands = await vscode.commands.getCommands(true);
    out.commands = ["aurora.approve", "aurora.newConversation", "aurora.openHarness", "aurora.showDiffs", "aurora.undo", "aurora.openChat", "aurora.explain", "aurora.fix", "aurora.tests", "aurora.review", "aurora.fixProblem"].filter((c) => commands.includes(c));
    out.chatApi = typeof vscode.chat?.createChatParticipant === "function";
    out.version = vscode.version;
    out.ok = out.found && out.active && out.commands.length === 11 && out.chatApi;
  } catch (error) { out.error = error.message; }
  writeFileSync(process.env.AURORA_SMOKE_OUT, JSON.stringify(out));
};
