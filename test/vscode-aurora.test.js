import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createClient, composeMessage, filesIn, HarnessError } = require("../vscode/aurora/lib/client.js");

// A fake Harness: the same routes the extension uses, the token checked like app/httpSecurity.js.
async function fakeHarness(t) {
  const seen = []; let token = "t1"; const projects = [];
  let pending = { stage: null, steps: [], approval: null };
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    const send = (status, data) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
    seen.push(`${req.method} ${req.url}`);
    if (req.url === "/api/session") return send(200, { token });
    if (req.headers["x-harness-token"] !== token) return send(401, { error: "Sessão local inválida." });
    if (req.url === "/api/projects" && req.method === "GET") return send(200, { projects });
    if (req.url === "/api/projects" && req.method === "POST") { const p = { id: `p${projects.length + 1}`, ...body }; projects.push(p); return send(201, p); }
    if (req.url === "/api/conversations" && req.method === "POST") return send(201, { id: "c1", ...body });
    if (req.url === "/api/conversations/c1/pending") return send(200, pending);
    if (req.url === "/api/conversations/c1/approval") return send(200, { resolved: body.id === "a1" });
    if (req.url === "/api/conversations/c1/messages") {
      pending = { stage: "Lendo src/app.js…", steps: [{ tool: "read_file", status: "running", summary: "" }], approval: null };
      await new Promise((r) => setTimeout(r, 60));
      pending = { stage: "Aguardando sua autorização…", steps: [{ tool: "read_file", ok: true, status: "done", summary: "Lendo src/app.js" }], approval: { id: "a1", tool: "run_command", summary: "npm test" } };
      await new Promise((r) => setTimeout(r, 60));
      return send(200, { ok: true, message: { content: `Corrigi a função em C:\\proj\\src\\app.js. Eco: ${body.message.split("\n")[0]}`, execution: { toolSteps: [{ tool: "edit_file", ok: true, summary: "Editei C:\\proj\\src\\app.js." }] } } });
    }
    send(404, { error: "?" });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  return { base: `http://127.0.0.1:${server.address().port}`, seen, projects, rotate: () => { token = "t2"; } };
}

test("VS Code: the open folder becomes a Harness project (reused), the message goes with its progress and permission", async (t) => {
  const h = await fakeHarness(t);
  const client = createClient({ base: h.base, pollMs: 15 });
  const p1 = await client.projectFor("C:\\proj\\", "VS Code: proj");
  const p2 = await client.projectFor("c:\\proj", "VS Code: proj");
  assert.equal(p1.id, p2.id); assert.equal(h.projects.length, 1); assert.equal(h.projects[0].workspaceDir, "C:\\proj\\");
  const c = await client.newConversation({ projectId: p1.id, title: "VS Code: proj" });
  assert.equal(c.provider, "local");
  const progress = [];
  const r = await client.send(c.id, "corrige essa função", { onProgress: (p) => progress.push(p) });
  assert.match(r.content, /Eco: corrige essa função/);
  assert.ok(progress.some((p) => p.stage === "Lendo src/app.js…"));
  assert.ok(progress.some((p) => p.approval?.summary === "npm test"));
  assert.deepEqual(r.files, ["C:\\proj\\src\\app.js"]);
  assert.equal((await client.approve(c.id, "a1", true)).resolved, true);
  // The desktop restarted (a new session token): the call goes again once with it.
  h.rotate(); assert.equal((await client.newConversation({})).id, "c1");
});

test("VS Code: only this computer's Harness; a closed Harness says to open it; the editor's context goes with the words", async () => {
  assert.throws(() => createClient({ base: "http://192.168.0.5:8787" }), /só conversa com o Harness deste computador/);
  assert.throws(() => createClient({ base: "https://127.0.0.1:8787" }), HarnessError);
  await assert.rejects(createClient({ base: "http://127.0.0.1:9" }).newConversation({}), (e) => e.status === 503 && /Abra o Harness/.test(e.message));
  const m = composeMessage("explica isso", { file: "C:\\proj\\a.js", selection: "const x = 1;", language: "javascript", references: [{ path: "C:\\proj\\b.md", text: "# B" }] });
  assert.match(m, /^explica isso\n\n\[Contexto do VS Code\]/);
  assert.match(m, /Arquivo aberto no VS Code: C:\\proj\\a\.js/); assert.match(m, /```javascript\nconst x = 1;\n```/); assert.match(m, /Arquivo anexado C:\\proj\\b\.md/);
  assert.equal(composeMessage("oi"), "oi");
  assert.deepEqual(filesIn("Salvei em C:\\Users\\x\\Documentos\\rel.docx.", []), ["C:\\Users\\x\\Documentos\\rel.docx"]);
});
