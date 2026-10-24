import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { INSTALLERS, installCommand, startInstall, installJob, openSetup } = await import("../app/harnessInstall.js");

test("the official installers, without their wizards (the account is set up after)", () => {
  assert.match(installCommand("hermes", {}), /irm 'https:\/\/hermes-agent\.nousresearch\.com\/install\.ps1'.*-SkipSetup/);
  assert.match(installCommand("openclaw", {}), /irm 'https:\/\/openclaw\.ai\/install\.ps1'.*-NoOnboard/);
  assert.equal(installCommand("outro", {}), null);
  assert.throws(() => startInstall("outro"), /desconhecido/);
  assert.throws(() => startInstall("hermes", { platform: "linux" }), /pelo terminal/);
});

test("an install runs in the background and its progress is polled", { skip: process.platform !== "win32" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "aurora-install-"));
  const script = join(dir, "fake-install.ps1");
  writeFileSync(script, "param([switch]$SkipSetup)\nWrite-Output 'Instalando o Hermes...'\nif ($SkipSetup) { Write-Output 'sem assistente' }\nWrite-Output 'Pronto.'\n");
  const job = startInstall("hermes", { env: { ...process.env, INSTALL_SCRIPT_HERMES: script } });
  assert.equal(job.state, "instalando");
  let now = job;
  for (let i = 0; i < 100 && now.state === "instalando"; i += 1) { await new Promise((r) => setTimeout(r, 200)); now = installJob(job.jobId); }
  assert.equal(now.state, "instalado", now.lines.join("\n"));
  assert.deepEqual(now.lines.slice(-3), ["Instalando o Hermes...", "sem assistente", "Pronto."]);
});

test("their own setup wizard opens in a terminal window the person answers", () => {
  const calls = [];
  const out = openSetup("openclaw", { platform: "win32", launch: (cmd, args) => { calls.push([cmd, args]); return { unref() {} }; } });
  assert.equal(out.command, INSTALLERS.openclaw.setup);
  assert.deepEqual(calls[0][1].slice(-3), ["-NoExit", "-Command", "openclaw onboard"]);
});
