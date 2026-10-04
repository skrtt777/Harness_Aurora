import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "harness-access-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.LOCAL_BASE_URL = "http://127.0.0.1:1";

const { departmentOf, discoverCompanyFolders, isSensitivePath } = await import("../app/fileAccess.js");
const { decide } = await import("../app/agentPolicy.js");
const { executeTool } = await import("../app/agentTools/index.js");
const knowledge = await import("../app/knowledge.js");

test("folder names are read as the sector they stand for", () => {
  assert.equal(departmentOf("RH"), "RH");
  assert.equal(departmentOf("02 - Recursos Humanos"), "RH");
  assert.equal(departmentOf("Pasta do RH"), "RH");
  assert.equal(departmentOf("Financeiro 2026"), "Financeiro");
  assert.equal(departmentOf("SESMT"), "SSMA");
  assert.equal(departmentOf("Tributário"), "Fiscal");
  assert.equal(departmentOf("Tecnologia da Informação"), "TI");
  for (const name of ["Fotos", "Notas pessoais", "Projetos", "Tiago"]) assert.equal(departmentOf(name), null, name);
});

test("secrets and the system always ask, even with full computer access", () => {
  for (const p of ["C:\\Users\\a\\.ssh\\id_rsa", "C:\\Windows\\System32\\x.dll", "F:\\senhas.kdbx", "C:\\Users\\a\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Login Data", "D:\\app\\.env"]) assert.equal(isSensitivePath(p), true, p);
  for (const p of ["C:\\Users\\a\\Documents\\contrato.pdf", "F:\\Fotos\\praia.jpg", "D:\\Projetos\\site\\index.html"]) assert.equal(isSensitivePath(p), false, p);
});

test("full computer access reads anywhere without asking, except sensitive places", async () => {
  const ctx = { mode: "auto", workspaceRoots: [join(temp, "projeto")], readRoots: [temp] };
  const outside = join(temp, "outra", "nota.txt");
  assert.equal((await decide({ kind: "read", paths: [outside] }, ctx)).action, "allow");
  assert.equal((await decide({ kind: "read", paths: [join(temp, ".ssh", "id_rsa")] }, ctx)).action, "ask");
  assert.equal((await decide({ kind: "read", paths: [outside] }, { ...ctx, readRoots: [] })).action, "ask", "off by default");
  assert.equal((await decide({ kind: "write", paths: [outside] }, ctx)).action, "ask", "writing outside the project still asks");
});

test("company folders are discovered under a folder the person names, and added only with consent", async () => {
  const root = join(temp, "Empresa");
  for (const dir of ["01 - RH/Férias", "Financeiro", "Jurídico", "Fotos da festa", "Departamentos/Compras"]) mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, "01 - RH", "Férias", "controle.xlsx"), "x");
  writeFileSync(join(root, "Financeiro", "contas.pdf"), "x");
  const found = await discoverCompanyFolders({ roots: [root] });
  assert.deepEqual(found.map((f) => f.department).sort(), ["Compras", "Financeiro", "Jurídico", "RH"]);
  assert.equal(found.find((f) => f.department === "RH").documents, 1);

  const asked = [];
  const ctx = { mode: "auto", workspaceRoots: [temp], knowledgeRoots: [], approve: async (request) => { asked.push(request.summary); return true; } };
  const discovered = await executeTool("knowledge_setup", { action: "discover", root }, ctx);
  assert.match(discovered.result, /RH: .*01 - RH/);
  assert.equal(asked.length, 0, "looking needs no consent");
  const folders = found.filter((f) => ["RH", "Financeiro"].includes(f.department)).map((f) => ({ path: f.path, department: f.department }));
  const added = await executeTool("knowledge_setup", { action: "add", folders }, ctx);
  assert.match(added.result, /Cadastradas 2 pasta/);
  assert.match(asked[0], /Cadastrar 2 pasta\(s\).*RH/);
  assert.deepEqual((await knowledge.listSources()).map((s) => s.department).sort(), ["Financeiro", "RH"]);
  assert.match((await executeTool("knowledge_setup", { action: "add", folders }, ctx)).result, /já estavam/);
  const refused = await executeTool("knowledge_setup", { action: "add", folders: [{ path: join(root, "Jurídico"), department: "Jurídico" }] }, { ...ctx, approve: async () => false });
  assert.equal(refused.ok, false);
  assert.equal((await knowledge.listSources()).length, 2);
});
