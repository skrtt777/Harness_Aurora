import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "aurora-agentclis-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
const { runHermesAgent, runOpenClawAgent, openClawText, HERMES_TOOLSETS } = await import("../app/agentClis.js");
const { ENGINES, engineStatus } = await import("../app/engine.js");

// A fake CLI: prints its arguments (and the folder it ran in) the way each real one answers.
const fake = (name, body) => { const file = join(temp, `${name}.mjs`); writeFileSync(file, body); return file; };
const hermesBin = fake("hermes", `console.log("feito: " + JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }));`);
const openclawBin = fake("openclaw", `const a = process.argv.slice(2); if (!a.includes("--local") && process.env.FAKE_NO_GATEWAY) { console.error("gateway not running (ECONNREFUSED)"); process.exit(1); } console.log(JSON.stringify({ result: { payloads: [{ text: "pronto: " + JSON.stringify(a) }] } }));`);

test("Hermes works one-shot in the folder, with files and code only (no memory, browser, computer use)", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "mirror-"));
  const out = await runHermesAgent("faça o gráfico", { cwd, env: { ...process.env, HERMES_BIN: hermesBin } });
  assert.equal(out.ok, true, out.error);
  const { args, cwd: ran } = JSON.parse(out.text.replace(/^feito: /, ""));
  assert.deepEqual(args.slice(0, 4), ["-z", "faça o gráfico", "--in", cwd]);
  assert.equal(args[args.indexOf("-t") + 1], HERMES_TOOLSETS);
  assert.ok(!/memory|browser|computer_use|web/.test(HERMES_TOOLSETS));
  assert.ok(args.includes("--ignore-rules"));
  assert.equal(ran.toLowerCase(), cwd.toLowerCase());
});

test("OpenClaw runs a session of its own, never delivered to a channel; embedded when no Gateway", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "mirror-"));
  const env = { ...process.env, OPENCLAW_BIN: openclawBin };
  const out = await runOpenClawAgent("faça o gráfico", { cwd, env });
  assert.equal(out.ok, true, out.error);
  const args = JSON.parse(out.text.replace(/^pronto: /, ""));
  assert.equal(args[0], "agent");
  assert.match(args[args.indexOf("--message") + 1], new RegExp(`Trabalhe somente na pasta ${cwd.replace(/[\\]/g, "\\\\")}`));
  assert.match(args[args.indexOf("--session-id") + 1], /^aurora-/);
  assert.ok(!args.includes("--deliver"), "the reply never goes to WhatsApp/Telegram");
  const local = await runOpenClawAgent("x", { cwd, env: { ...env, FAKE_NO_GATEWAY: "1" } });
  assert.equal(local.ok, true, local.error);
  assert.ok(JSON.parse(local.text.replace(/^pronto: /, "")).includes("--local"));
});

test("OpenClaw's JSON reply: the text, whatever its shape", () => {
  assert.equal(openClawText(JSON.stringify({ reply: "oi" })), "oi");
  assert.equal(openClawText(JSON.stringify({ result: { payloads: [{ text: "curto" }, { text: "o texto mais longo" }] }, meta: { model: "x" } })), "o texto mais longo");
  assert.equal(openClawText("texto puro"), "texto puro");
});

test("Hermes and OpenClaw are strong engines after Claude and Codex", async () => {
  assert.deepEqual(Object.keys(ENGINES).slice(0, 4), ["claude", "codex", "hermes", "openclaw"]);
  const status = await engineStatus({ env: { ...process.env, HERMES_BIN: hermesBin, OPENCLAW_BIN: openclawBin } });
  assert.equal(status.hermes.installed, true);
  assert.equal(status.openclaw.label, "OpenClaw");
});

test("a provider failure printed as the answer is a failure (connection, credits, key)", async () => {
  const { providerFailure } = await import("../app/agentClis.js");
  assert.equal(providerFailure("API call failed after 3 retries: Connection error.").status, 503);
  assert.equal(providerFailure("OpenRouter reported that billing, credits, or account entitlement is exhausted").status, 429);
  assert.equal(providerFailure("Gemini HTTP 400 (INVALID_ARGUMENT): API key not valid.").status, 401);
  assert.equal(providerFailure("Gravei aurora_tarefa.py com o gráfico de barras."), null);
});
