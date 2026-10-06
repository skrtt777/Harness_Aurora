import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeTool } from "../app/agentTools/index.js";

test("organize_folder only runs when organizing was asked", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aurora-organize-"));
  writeFileSync(join(dir, "boleto.pdf"), "x");
  writeFileSync(join(dir, "foto.jpg"), "x");
  const ctx = (request) => ({ mode: "auto", workspace: dir, workspaceRoots: [dir], approve: async () => true, env: process.env, request });
  const refused = await executeTool("organize_folder", { path: dir }, ctx("tem algum arquivo repetido aqui?"));
  assert.equal(refused.ok, false);
  assert.match(refused.result, /não pediu para organizar/);
  assert.ok(existsSync(join(dir, "boleto.pdf")), "nothing moved");
  const done = await executeTool("organize_folder", { path: dir }, ctx("Organize esta pasta por tipo de arquivo"));
  assert.equal(done.ok, true, done.result);
  assert.ok(!existsSync(join(dir, "boleto.pdf")));
});

test("an agent's own run may organize without the word in the day's request (its mission says so)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aurora-organize-agent-"));
  writeFileSync(join(dir, "nota.pdf"), "x");
  const out = await executeTool("organize_folder", { path: dir }, { mode: "auto", workspace: dir, workspaceRoots: [dir], approve: async () => true, env: { ...process.env, AGENT_RUN_TRIGGER: "schedule" }, request: "Faça a sua rotina de hoje." });
  assert.equal(out.ok, true, out.result);
});
