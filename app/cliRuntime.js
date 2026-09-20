import { existsSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);

export async function executeCli(command, args, { signal, timeout, ...options }) {
  if (signal?.aborted) throw Object.assign(new Error("Operação cancelada."), { name: "AbortError" });
  const pending = execFileAsync(command, args, options);
  const child = pending.child;
  child.stdin?.end();
  let timedOut = false;
  const stop = () => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === "win32") {
      // npm CLI wrappers may spawn a native child. Kill only this owned tree.
      execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 5000 }, () => {
        if (child.exitCode === null) child.kill();
      });
    } else child.kill("SIGTERM");
  };
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  const timer = setTimeout(() => { timedOut = true; stop(); }, Number.isFinite(timeout) && timeout > 0 ? timeout : 120000);
  try { return await pending; }
  catch (error) { if (timedOut) error.killed = true; throw error; }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", stop); }
}

// Resolve native Windows executables or npm's JS entry point without shell:true
// (a shell would interpret generated prompts as commands).
export function resolveCli(provider, env = process.env) {
  const configured = env[`${provider.toUpperCase()}_BIN`] || provider;
  const candidates = [];
  if (isAbsolute(configured) || /[\\/]/.test(configured)) candidates.push(configured);
  else for (const directory of (env.PATH || env.Path || process.env.PATH || "").split(delimiter)) {
    if (!directory) continue;
    candidates.push(join(directory, process.platform === "win32" && !/\.exe$/i.test(configured) ? `${configured}.exe` : configured));
    if (process.platform === "win32" && configured === provider) {
      candidates.push(join(directory, "node_modules", provider === "codex" ? "@openai/codex/bin/codex.js" : "@anthropic-ai/claude-code/cli.js"));
    }
  }
  const found = candidates.find(existsSync);
  if (found?.endsWith(".js") || found?.endsWith(".mjs")) return { command: process.execPath, prefix: [found], installed: true, runAsNode: true };
  if (found && !/\.cmd$/i.test(found)) return { command: found, prefix: [], installed: true };
  if (/\.cmd$/i.test(configured)) {
    const script = join(dirname(configured), "node_modules", provider === "codex" ? "@openai/codex/bin/codex.js" : "@anthropic-ai/claude-code/cli.js");
    if (existsSync(script)) return { command: process.execPath, prefix: [script], installed: true, runAsNode: true };
  }
  return { command: configured, prefix: [], installed: false };
}
