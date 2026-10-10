import test from "node:test";
import assert from "node:assert/strict";
import { decide } from "../app/agentPolicy.js";
import { BLOCKED_PROGRAMS } from "../app/desktop.js";

test("a program on the computer: asked once per program, never in Plan mode, 'Sempre permitir' kept", async () => {
  const access = { kind: "desktop", program: "MSACCESS" };
  assert.equal((await decide(access, { mode: "plan" })).action, "deny");
  const asked = await decide(access, { mode: "auto" });
  assert.equal(asked.action, "ask");
  assert.equal(asked.rule, "msaccess");
  assert.equal((await decide(access, { mode: "auto", desktopApproved: new Set(["msaccess"]) })).action, "allow", "authorized earlier in the turn");
  assert.equal((await decide(access, { mode: "manual", alwaysAllow: [{ tool: "desktop_type", prefix: "msaccess" }] })).action, "allow", "Sempre permitir");
  assert.equal((await decide({ kind: "desktop", program: "EXCEL" }, { mode: "auto", desktopApproved: new Set(["msaccess"]) })).action, "ask", "another program asks again");
});

test("the Aurora never drives itself, a terminal, the task manager, the registry or the password prompts", () => {
  for (const name of ["Harness Aurora", "WindowsTerminal", "powershell", "cmd", "Taskmgr", "regedit", "consent", "CredentialUIBroker", "AuroraUiaHost-1a2b3c4d5e6f"]) assert.ok(BLOCKED_PROGRAMS.test(name), name);
  for (const name of ["MSACCESS", "EXCEL", "WINWORD", "notepad", "ERPSistema"]) assert.ok(!BLOCKED_PROGRAMS.test(name), name);
});
