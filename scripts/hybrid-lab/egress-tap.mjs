// Egress tap for the hybrid battery: stands in for the Claude/Codex CLI, logs every prompt that would leave
// the computer (and the folder the CLI would run in), then runs the real CLI with the same arguments and
// input. TAP_LOG: the log file (one JSON per call). TAP_REAL: the real CLI as resolveCli returns it.
import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
let stdin = "";
if (!process.stdin.isTTY) for await (const chunk of process.stdin) stdin += chunk;
const real = JSON.parse(process.env.TAP_REAL || "{}");
appendFileSync(process.env.TAP_LOG, JSON.stringify({ at: new Date().toISOString(), cwd: process.cwd(), args, prompt: stdin }) + "\n");
const env = { ...process.env, ...(real.runAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}) };
delete env.TAP_REAL;
const child = spawn(real.command, [...(real.prefix || []), ...args], { cwd: process.cwd(), env, stdio: ["pipe", "inherit", "inherit"], windowsHide: true, shell: /\.(cmd|bat)$/i.test(real.command || "") });
child.stdin.end(stdin);
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (error) => { console.error(error.message); process.exit(1); });
