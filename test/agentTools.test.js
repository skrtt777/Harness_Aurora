import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { executeTool, getTool, toolSchemas, AGENT_TOOLS } = await import("../app/agentTools/index.js");
const { expandPath, isInsideRoots } = await import("../app/agentTools/files.js");
const { parseDuckDuckGo, htmlToText } = await import("../app/agentTools/web.js");
const { matchShortcut, resolveOpenTarget } = await import("../app/agentTools/system.js");

const root = mkdtempSync(join(tmpdir(), "harness-tools-root-"));
const outside = mkdtempSync(join(tmpdir(), "harness-tools-outside-"));
const folders = { desktop: root, documents: join(root, "docs"), downloads: join(root, "dl") };
const ctx = (approve = async () => false, extra = {}) => ({ allowedRoots: [root], workspaceRoots: [root], mode: "auto", knownFolders: folders, env: process.env, approve, ...extra });

test("every tool exposes a valid function schema", () => {
  const names = new Set();
  for (const schema of toolSchemas()) {
    assert.equal(schema.type, "function");
    assert.match(schema.function.name, /^[a-z_]+$/);
    assert.ok(schema.function.description.length > 20);
    assert.equal(schema.function.parameters.type, "object");
    names.add(schema.function.name);
  }
  assert.equal(names.size, AGENT_TOOLS.length);
  for (const name of ["browser_navigate", "browser_click", "web_search", "open", "run_command", "write_file"]) assert.ok(names.has(name), name);
});

test("paths expand folder aliases and stay inside the allowed roots", async () => {
  assert.equal(expandPath("Desktop/notas.txt", folders), join(root, "notas.txt"));
  assert.equal(expandPath("área de trabalho\\a.txt", folders), join(root, "a.txt"));
  assert.equal(expandPath("Documentos/x.md", folders), join(root, "docs", "x.md"));
  assert.equal(expandPath("solto.txt", folders), join(root, "solto.txt"));
  assert.equal(await isInsideRoots(join(root, "sub", "novo.txt"), [root]), true);
  assert.equal(await isInsideRoots(join(root, "..", "fora.txt"), [root]), false);
  assert.equal(await isInsideRoots(join(outside, "x.txt"), [root]), false);
  const link = join(root, "atalho");
  try { symlinkSync(outside, link, "junction"); } catch { /* no link support: covered by the other cases */ }
  if (existsSync(link)) assert.equal(await isInsideRoots(join(link, "segredo.txt"), [root]), false, "a junction must not escape the root");
});

test("files inside the roots need no approval; outside asks and respects a denial", async () => {
  const asked = [];
  const deny = async (request) => { asked.push(request); return false; };
  const written = await executeTool("write_file", { path: "Desktop/sub/nota.txt", content: "oi" }, ctx(deny));
  assert.equal(written.ok, true, written.result);
  assert.equal(readFileSync(join(root, "sub", "nota.txt"), "utf8"), "oi");
  assert.equal(asked.length, 0);

  const edited = await executeTool("edit_file", { path: join(root, "sub", "nota.txt"), before: "oi", after: "olá" }, ctx(deny));
  assert.equal(edited.ok, true);
  assert.equal(readFileSync(join(root, "sub", "nota.txt"), "utf8"), "olá");
  assert.match((await executeTool("read_file", { path: join(root, "sub", "nota.txt") }, ctx(deny))).result, /\n +1  olá\n/);
  assert.match((await executeTool("list_dir", { path: root }, ctx(deny))).result, /\[pasta\] sub/);

  const blocked = await executeTool("write_file", { path: join(outside, "x.txt"), content: "x" }, ctx(deny));
  assert.equal(blocked.ok, false);
  assert.match(blocked.result, /não autorizou/);
  assert.equal(existsSync(join(outside, "x.txt")), false);
  assert.equal(asked.length, 1);

  const allowed = await executeTool("write_file", { path: join(outside, "y.txt"), content: "y" }, ctx(async () => true));
  assert.equal(allowed.ok, true);
  assert.equal(readFileSync(join(outside, "y.txt"), "utf8"), "y");
  assert.match((await executeTool("edit_file", { path: join(root, "sub", "nota.txt"), before: "nada", after: "x" }, ctx(deny))).result, /não existe no arquivo/);
});

test("run_command never runs without the user's approval", async () => {
  const marker = join(outside, "rodou.txt");
  const command = process.platform === "win32" ? `Set-Content -Path '${marker}' -Value ok` : `echo ok > '${marker}'`;
  const denied = await executeTool("run_command", { command }, ctx(async () => false));
  assert.equal(denied.ok, false);
  assert.match(denied.result, /não autorizou/);
  assert.equal(existsSync(marker), false);
  const approved = await executeTool("run_command", { command, cwd: outside }, ctx(async (request) => request.summary === command));
  assert.equal(approved.ok, true, approved.result);
  assert.match(approved.result, /código 0/);
  assert.equal(existsSync(marker), true);
});

test("open resolves links, domains, built-in apps, files and Start Menu shortcuts", async () => {
  writeFileSync(join(root, "relatorio.pdf"), "%PDF");
  assert.deepEqual(await resolveOpenTarget("https://youtube.com", ctx()), { target: "https://youtube.com", kind: "link" });
  assert.deepEqual(await resolveOpenTarget("youtube.com", ctx()), { target: "https://youtube.com", kind: "link" });
  assert.deepEqual(await resolveOpenTarget("Bloco de Notas", ctx()), { target: "notepad.exe", kind: "app" });
  assert.deepEqual(await resolveOpenTarget("Desktop/relatorio.pdf", ctx()), { target: join(root, "relatorio.pdf"), kind: "path" });
  const shortcuts = ["C:\\SM\\Spotify.lnk", "C:\\SM\\Uninstall Spotify.lnk", "C:\\SM\\Microsoft Office\\Word.lnk", "C:\\SM\\Visual Studio Code.lnk"];
  assert.equal(matchShortcut("spotify", shortcuts), "C:\\SM\\Spotify.lnk");
  assert.equal(matchShortcut("word", shortcuts), "C:\\SM\\Microsoft Office\\Word.lnk");
  assert.equal(matchShortcut("vs code", shortcuts), null);
  assert.equal(matchShortcut("visual studio", shortcuts), "C:\\SM\\Visual Studio Code.lnk");
});

test("web results are parsed from DuckDuckGo's HTML and pages become readable text", () => {
  const html = `<div class="result results_links"><div class="links_main links_deep result__body"><h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.bcb.gov.br%2Fconversao&amp;rut=abc">Conversor &amp; Cotação</a></h2><a class="result__snippet" href="#">Dólar <b>hoje</b> R$ 5,18</a></div></div>
  <div class="result"><div class="result__body"><a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Anúncio</a></div></div>`;
  assert.deepEqual(parseDuckDuckGo(html), [{ title: "Conversor & Cotação", url: "https://www.bcb.gov.br/conversao", snippet: "Dólar hoje R$ 5,18" }]);
  assert.equal(htmlToText("<style>x{}</style><h1>Título</h1><p>Um&nbsp;texto &#233; bom</p><script>alert(1)</script>"), "Título\nUm texto é bom");
});

test("unknown tools and bad arguments come back as readable errors", async () => {
  assert.match((await executeTool("apagar_tudo", {}, ctx())).result, /^ERRO: a ferramenta "apagar_tudo" não existe/);
  assert.match((await executeTool("browser_navigate", { url: "file:///C:/Windows/win.ini" }, ctx())).result, /^ERRO: Só é possível navegar em HTTP\/HTTPS/);
  assert.match((await executeTool("web_fetch", { url: "ftp://x" }, ctx())).result, /^ERRO/);
  assert.ok(getTool("browser_click"));
});

const { isChromiumInstalled } = await import("../app/browserAgent.js");
const hasBrowser = isChromiumInstalled(process.env) || ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].some(existsSync);

test("browser tools drive a real page through DOM refs, typing, clicks and new tabs", { skip: hasBrowser ? false : "Nenhum navegador disponível." }, async () => {
  const { closeBrowserContext, resetBrowserContextForTests } = await import("../app/browserAgent.js");
  const { resetBrowserBackendForTests } = await import("../app/browserBackend.js");
  const page = `<!doctype html><title>Loja Teste</title><main><input placeholder="Buscar produtos" id="q"><button onclick="document.getElementById('out').textContent='Resultados para '+document.getElementById('q').value">Buscar</button>
    <p id="out"></p><a href="/detalhe">Ver detalhes</a> <a href="/detalhe" target="_blank">Abrir em nova aba</a><canvas width="10" height="10"></canvas></main>`;
  const server = http.createServer((req, res) => { res.setHeader("content-type", "text/html; charset=utf-8"); res.end(req.url === "/detalhe" ? "<title>Detalhe</title><h1>Produto 42</h1>" : page); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const env = { ...process.env, BROWSER_AGENT_HEADLESS: "1", BROWSER_AGENT_PROFILE_DIR: mkdtempSync(join(tmpdir(), "harness-agent-browser-")) };
  const c = ctx(async () => false, { env, browserBackend: "aurora" });
  resetBrowserContextForTests(); resetBrowserBackendForTests();
  try {
    const opened = await executeTool("browser_navigate", { url }, c);
    assert.equal(opened.ok, true, opened.result);
    assert.match(opened.result, /Página: Loja Teste/);
    const ref = opened.result.match(/\[(e\d+)\] textbox "Buscar produtos"/)?.[1];
    assert.ok(ref, opened.result);
    assert.match(opened.result, /\[e\d+\] button "Buscar"/);
    assert.match(opened.result, /\[e\d+\] link "Ver detalhes"/);

    const typed = await executeTool("browser_type", { ref, text: "tênis" }, c);
    assert.equal(typed.ok, true, typed.result);
    assert.match(typed.result, /valor: "tênis"/);
    const clicked = await executeTool("browser_click", { text: "Buscar" }, c);
    assert.match(clicked.result, /Resultados para tênis/);
    const read = await executeTool("browser_read", {}, c);
    assert.match(read.result, /Resultados para tênis/);

    const again = await executeTool("browser_snapshot", {}, c);
    assert.ok(again.result.includes(`[${ref}] textbox`), "refs stay stable across snapshots");

    const tab = await executeTool("browser_click", { text: "Abrir em nova aba" }, c);
    assert.match(tab.result, /Página: Detalhe/, "the snapshot follows the tab the click opened");
    const tabs = await executeTool("browser_tabs", { action: "list" }, c);
    assert.match(tabs.result, /1 \(ativa\): Detalhe/);
    await executeTool("browser_tabs", { action: "close", index: 1 }, c);
    assert.match((await executeTool("browser_snapshot", {}, c)).result, /Página: Loja Teste/);

    const missing = await executeTool("browser_type", { field: "campo que não existe", text: "x" }, c);
    assert.equal(missing.ok, false);
  } finally {
    await closeBrowserContext();
    resetBrowserBackendForTests();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("the agent can't reach Aurora's own API/UI, Ollama or the XR bridge, even through redirects", async () => {
  const { isProtectedUrl, protectPort } = await import("../app/agentTools/netGuard.js");
  for (const url of ["http://127.0.0.1:8787/api/session", "http://localhost:8787/", "http://[::1]:11434/api/tags", "https://0.0.0.0:8788/", "http://app.localhost:8787/", "http://127.1.2.3:8787", "http://127.0.0.1:18181/v1/chat/completions"]) assert.equal(isProtectedUrl(url), true, url);
  for (const url of ["http://localhost:3000/", "https://youtube.com/", "http://192.168.0.10:8787/", "not a url"]) assert.equal(isProtectedUrl(url), false, url);
  protectPort(9999);
  assert.equal(isProtectedUrl("http://127.0.0.1:9999/"), true);

  assert.match((await executeTool("browser_navigate", { url: "http://127.0.0.1:8787/api/session" }, ctx())).result, /bloqueado/);
  assert.match((await executeTool("web_fetch", { url: "http://localhost:11434/api/tags" }, ctx())).result, /bloqueado/);
  assert.match((await executeTool("open", { target: "http://127.0.0.1:8787/" }, ctx())).result, /bloqueado/);
  const redirecting = async (url) => url.startsWith("https://evil.example") ? new Response(null, { status: 302, headers: { location: "http://127.0.0.1:8787/api/session" } }) : new Response("token");
  const bounced = await executeTool("web_fetch", { url: "https://evil.example/x" }, ctx(async () => false, { fetch: redirecting }));
  assert.equal(bounced.ok, false);
  assert.match(bounced.result, /bloqueado/);
});

test("opening anything that can run code asks first; documents and folders open directly", async () => {
  for (const name of ["atalho.lnk", "app.hta", "site.url", "chave.reg", "script.ps1"]) writeFileSync(join(root, name), "x");
  for (const name of ["atalho.lnk", "app.hta", "site.url", "chave.reg", "script.ps1"]) assert.equal((await resolveOpenTarget(join(root, name), ctx())).kind, "executable", name);
  assert.equal((await resolveOpenTarget(join(root, "relatorio.pdf"), ctx())).kind, "path");
  assert.equal((await resolveOpenTarget(root, ctx())).kind, "path");
  const denied = await executeTool("open", { target: join(root, "app.hta") }, ctx(async () => false));
  assert.match(denied.result, /não autorizou/);
});

test("a link on a page can't take the controlled browser to Aurora's API", { skip: hasBrowser ? false : "Nenhum navegador disponível." }, async () => {
  const { closeBrowserContext, resetBrowserContextForTests } = await import("../app/browserAgent.js");
  const { resetBrowserBackendForTests } = await import("../app/browserBackend.js");
  const { protectPort } = await import("../app/agentTools/netGuard.js");
  const api = http.createServer((req, res) => res.end('{"token":"segredo"}'));
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  protectPort(api.address().port);
  const site = http.createServer((req, res) => { res.setHeader("content-type", "text/html"); res.end(`<title>Isca</title><a href="http://127.0.0.1:${api.address().port}/api/session">Clique aqui</a>`); });
  await new Promise((resolve) => site.listen(0, "127.0.0.1", resolve));
  const env = { ...process.env, BROWSER_AGENT_HEADLESS: "1", BROWSER_AGENT_PROFILE_DIR: mkdtempSync(join(tmpdir(), "harness-agent-guard-")) };
  const c = ctx(async () => false, { env, browserBackend: "aurora" });
  resetBrowserContextForTests(); resetBrowserBackendForTests();
  try {
    assert.equal((await executeTool("browser_navigate", { url: `http://127.0.0.1:${site.address().port}/` }, c)).ok, true);
    const clicked = await executeTool("browser_click", { text: "Clique aqui" }, c);
    assert.doesNotMatch(clicked.result, /segredo/);
    assert.doesNotMatch((await executeTool("browser_read", {}, c)).result, /segredo/);
  } finally {
    await closeBrowserContext();
    resetBrowserBackendForTests();
    await new Promise((resolve) => api.close(resolve));
    await new Promise((resolve) => site.close(resolve));
  }
});

test("a refused write outside the project says where saving needs no approval", async () => {
  const refused = await executeTool("write_file", { path: join(outside, "z.txt"), content: "z" }, ctx(async () => false, { workspace: root }));
  assert.equal(refused.ok, false);
  assert.ok(refused.result.includes(`Na pasta do projeto (${root}) você pode salvar sem pedir`), refused.result);
  const read = await executeTool("read_file", { path: join(outside, "nada.txt") }, ctx(async () => false, { workspace: root }));
  assert.doesNotMatch(read.result, /pode salvar/, "only writes get the hint");
});

test("write_file refuses Office formats and points to write_document", async () => {
  const out = await executeTool("write_file", { path: join(root, "lista.xlsx"), content: "a;b" }, ctx());
  assert.equal(out.ok, false);
  assert.match(out.result, /use write_document/);
  assert.equal(existsSync(join(root, "lista.xlsx")), false);
});

test("move_file moves and renames inside the project, never overwrites, and needs the exact path", async () => {
  const dir = join(root, "organizar");
  mkdirSync(dir, { recursive: true });
  for (const f of ["a.pdf", "b.pdf", "foto.jpg"]) writeFileSync(join(dir, f), f);
  const c = ctx(async () => false, { workspace: dir, workspaceRoots: [dir] });
  // "Documentos/" is a subfolder of the project, not the user's Documents.
  assert.ok((await executeTool("move_file", { from: "a.pdf", to: "Documentos/" }, c)).result.includes(join(dir, "Documentos", "a.pdf")));
  assert.match((await executeTool("move_file", { from: "b.pdf", to: "Documentos/a.pdf" }, c)).result, /a \(2\)\.pdf/, "never overwrites");
  assert.equal(readFileSync(join(dir, "Documentos", "a.pdf"), "utf8"), "a.pdf");
  assert.ok((await executeTool("move_file", { from: "foto.jpg", to: "Imagens/ferias.jpg" }, c)).result.includes(join(dir, "Imagens", "ferias.jpg")));
  const gone = await executeTool("move_file", { from: "a.pdf", to: "x/" }, c);
  assert.equal(gone.ok, false, "a name that only exists in a subfolder is not guessed");
  assert.match(gone.result, /não existe/);
  const outsideMove = await executeTool("move_file", { from: "Imagens/ferias.jpg", to: join(outside, "ferias.jpg") }, c);
  assert.equal(outsideMove.ok, false);
  assert.ok(existsSync(join(dir, "Imagens", "ferias.jpg")));
});

test("move_file: a target without extension for a file with one is a folder, even before it exists", async () => {
  const dir = join(root, "organizar-sem-barra");
  mkdirSync(dir, { recursive: true });
  for (const f of ["relatorio.pdf", "contrato.docx"]) writeFileSync(join(dir, f), f);
  const c = ctx(async () => false, { workspace: dir, workspaceRoots: [dir] });
  await executeTool("move_file", { from: "relatorio.pdf", to: join(dir, "Documentos") }, c);
  await executeTool("move_file", { from: "contrato.docx", to: "Documentos" }, c);
  assert.equal(readFileSync(join(dir, "Documentos", "relatorio.pdf"), "utf8"), "relatorio.pdf");
  assert.equal(readFileSync(join(dir, "Documentos", "contrato.docx"), "utf8"), "contrato.docx");
  // A rename keeps working: the target has an extension.
  await executeTool("move_file", { from: "Documentos/contrato.docx", to: "Documentos/contrato 2026.docx" }, c);
  assert.ok(existsSync(join(dir, "Documentos", "contrato 2026.docx")));
});

test("a path relative to the company folder (as knowledge_map shows it) is read from there, %20 included", async () => {
  const company = join(root, "empresa");
  mkdirSync(join(company, "Jurídico"), { recursive: true });
  writeFileSync(join(company, "Jurídico", "Contratos Vigentes.csv"), "Contratado;Término\nA;31/10/2026\n");
  const work = join(root, "agente-juridico");
  mkdirSync(work, { recursive: true });
  const c = ctx(async () => false, { workspace: work, workspaceRoots: [work], knowledgeRoots: [company], allowedRoots: [root] });
  for (const path of ["Jurídico/Contratos Vigentes.csv", "Jurídico/Contratos%20Vigentes.csv", join(work, "Jurídico", "Contratos Vigentes.csv")]) {
    const out = await executeTool("read_file", { path }, c);
    assert.equal(out.ok, true, `${path}: ${out.result}`);
    assert.match(out.result, /31\/10\/2026/);
  }
});

test("a date filter is corrected by the request once; asked again as written, it is obeyed", async () => {
  const dir = join(root, "compras");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "pedidos.csv"), "Pedido;Entrega\nPC-1;10/10/2026\nPC-2;15/10/2026\n");
  const c = ctx(async () => false, { workspace: dir, workspaceRoots: [dir], request: "pedidos com entrega até 15/10/2026" });
  const first = await executeTool("read_file", { path: "pedidos.csv", filter: "Entrega=15/10/2026" }, c);
  assert.match(first.result, /PC-1[\s\S]*Usei Entrega<=15\/10\/2026/);
  const again = await executeTool("read_file", { path: "pedidos.csv", filter: "Entrega=15/10/2026" }, c);
  assert.doesNotMatch(again.result, /PC-1/, "the model insisted: exactly the 15th");
  assert.match(again.result, /PC-2/);
});
