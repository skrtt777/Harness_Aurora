// The code model of the gray suggestion (app/codeModel.js): the folder chosen in the settings, on/off,
// and a download that does not match its SHA-256 deleted, never kept. A temporary database and folder;
// nothing is downloaded (a fake fetch).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "aurora-code-model-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
const { codeModelStatus, setCodeModelDir, setCodeModelEnabled, startCodeModelDownload, codeModelPath, CODE_MODEL } = await import("../app/codeModel.js");

test("code model: folder and on/off kept in the settings; no file, not installed", async () => {
  const dir = join(temp, "modelos");
  const s = await setCodeModelDir(dir);
  assert.equal(s.dir, dir);
  assert.equal(existsSync(dir), true);
  assert.equal(s.installed, false);
  assert.equal(codeModelPath({ OLLAMA_MODELS: join(temp, "nada", "models") }, dir), null);
  assert.equal((await setCodeModelEnabled(false)).enabled, false);
  assert.equal((await setCodeModelEnabled(true)).enabled, true);
  await assert.rejects(setCodeModelDir("  "), /Escolha uma pasta/);
});

test("code model: a download whose SHA-256 does not match is deleted and says so", async () => {
  const dir = join(temp, "baixar");
  await setCodeModelDir(dir);
  const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("não é o modelo")); c.close(); } });
  const fetchImpl = async () => new Response(body, { status: 200, headers: { "content-length": "16" } });
  await startCodeModelDownload({ fetchImpl });
  let s;
  for (let i = 0; i < 50; i += 1) { s = await codeModelStatus(); if (s.download?.error || s.download?.done) break; await new Promise((r) => setTimeout(r, 20)); }
  assert.match(s.download.error, /SHA-256/);
  assert.equal(s.installed, false);
  assert.deepEqual(readdirSync(dir).filter((f) => f.startsWith(CODE_MODEL.file)), [], "neither the file nor its .part is left");
});

test("code model: the 'forte' profile without its file falls back (Ctrl+I on the chat model)", async () => {
  const { setCodeModelProfile, modelFor } = await import("../app/codeModel.js");
  await assert.rejects(setCodeModelProfile("turbo"), /Perfil inválido/);
  const s = await setCodeModelProfile("forte");
  assert.equal(s.profile, "forte");
  assert.equal(s.models.strong.installed, false);
  const env = { OLLAMA_MODELS: join(temp, "nada", "models") };
  assert.equal(await modelFor("edit", env), null);
  assert.equal(await modelFor("fim", env), null);
  assert.equal((await setCodeModelProfile("padrao")).profile, "padrao");
});
