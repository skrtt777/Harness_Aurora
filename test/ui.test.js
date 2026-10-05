import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import http from "node:http";

const temp = mkdtempSync(join(tmpdir(), "harness-ui-"));
process.env.HARNESS_DB_FILE = join(temp, "test.db");
process.env.CODEX_BIN = join(temp, "missing-codex.exe");
process.env.CLAUDE_BIN = join(temp, "missing-claude.exe");
process.env.LOCAL_BASE_URL = "http://127.0.0.1:1";
const { createServer } = await import("../app/server.js");
const { createConversation, addMessage, setSetting, createMemory } = await import("../app/store.js");
await setSetting('onboarding_completed', 'true');
const executable = process.env.CHROMIUM_EXECUTABLE_PATH || (process.platform === "win32" && existsSync("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe") ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" : chromium.executablePath());
const skip = !existsSync(executable) || !existsSync(new URL("../frontend/dist/index.html", import.meta.url)) ? "Build do frontend e Chromium necessários para teste de UI." : false;

test('chat shows the supplied animation and dots while pending, then a static assistant logo', {skip,timeout:30000},async()=>{
  const c=await createConversation({title:'Logo animada',provider:'codex'});
  const server=createServer({allowDev:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:executable,headless:true});
  let release;
  const held=new Promise(r=>{release=r;});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:900}});
    const base=`http://127.0.0.1:${server.address().port}`;
    await page.route(`**/api/conversations/${c.id}/messages`,async route=>{
      await held;
      await addMessage({conversationId:c.id,role:'user',content:'Teste da animação'});
      await addMessage({conversationId:c.id,role:'assistant',provider:'Codex',content:'Resposta concluída.'});
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
    });
    await page.goto(base);
    await page.getByRole('textbox',{name:'Mensagem para Aurora'}).fill('Teste da animação');
    await page.getByRole('button',{name:'Enviar mensagem'}).click();
    await page.locator('.pending .typing-dots').waitFor();
    assert.equal(await page.locator('.pending .typing-dots > span').count(),3);
    await page.waitForFunction(()=>document.querySelector('.pending img')?.naturalWidth===560);
    assert.ok((await page.locator('.pending img').evaluate(img=>img.currentSrc)).endsWith('/aurora-thinking.gif'));
    assert.equal((await page.request.get(base+'/brand/aurora-thinking.gif')).headers()['content-type'],'image/gif');
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.waitForFunction(()=>document.querySelector('.pending img')?.currentSrc.endsWith('/aurora-symbol.png'));
    release();
    await page.locator('.pending').waitFor({state:'hidden'});
    await page.getByText('Resposta concluída.',{exact:true}).waitFor();
    assert.equal(await page.locator('.chat-message.assistant .aurora-symbol').getAttribute('src'),'/brand/aurora-symbol.png');
    assert.equal(await page.locator('img[src$=".gif"]').count(),0);
  }finally{release();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('skills catalogue searches, paginates and reviews an inactive import on desktop and mobile', {skip,timeout:30000},async()=>{
  const {replaceCatalog}=await import('../app/skillCatalog.js');
  const {importSkill,listSkills}=await import('../app/skills.js');
  await replaceCatalog({version:1,skills:Array.from({length:35},(_,i)=>({name:`ui-skill-${i}`,description:'catalogui validation '+('long description '.repeat(8)),source:'github',identifier:`sample/repo/${i}`,repo:'sample/repo',path:`skills/ui-skill-${i}`}))});
  const server=createServer({allowDev:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:executable,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/skills/catalog/*/import',async route=>{
      const imported=await importSkill('---\nname: ui-catalog-import\ndescription: catalogui validation\n---\nVerify the output.','catalog:ui-fixture');
      await route.fulfill({status:201,contentType:'application/json',body:JSON.stringify(imported)});
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('button',{name:/Skills e regras/}).click();
    await page.locator('.catalog-grid article').first().waitFor();
    assert.equal(await page.locator('.catalog-grid article').count(),30);
    await page.getByRole('button',{name:'Próxima',exact:true}).click();
    await page.getByText('Página 2 de 2',{exact:true}).waitFor();
    assert.equal(await page.locator('.catalog-grid article').count(),5);
    await page.getByLabel('Buscar no catálogo').fill('ui-skill-34');
    await page.getByRole('button',{name:'Buscar',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.catalog-grid article').length===1);
    await page.locator('.catalog-grid button').click();
    await page.getByRole('heading',{name:'ui-catalog-import',exact:true}).first().waitFor();
    assert.equal((await listSkills()).find(s=>s.name==='ui-catalog-import').enabled,false);
    await page.getByRole('button',{name:'Ativar esta skill',exact:true}).click();
    await page.getByRole('button',{name:'Ativada',exact:true}).waitFor();
    assert.equal((await listSkills()).find(s=>s.name==='ui-catalog-import').enabled,true);
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('long conversations and drafts stay in a readable column, not full-bleed, and expand inline without losing text', { skip, timeout:30000 }, async()=>{
  const c=await createConversation({title:'Layout proporcional',provider:'codex'});
  const paragraph='Este texto comprido verifica o espaço disponível para escrever e ler mensagens na conversa. '.repeat(30);
  await addMessage({conversationId:c.id,role:'user',content:paragraph});
  await addMessage({conversationId:c.id,role:'assistant',provider:'Codex',content:paragraph});
  const server=createServer({allowDev:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:executable,headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1920,height:1080}});
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('article',{name:'Aurora',exact:true}).waitFor();
    const geometry=await page.evaluate(()=>({
      page:document.querySelector('.chat-page').clientWidth,
      message:document.querySelector('.chat-message.assistant').clientWidth,
      user:document.querySelector('.chat-message.user .chat-bubble-wrap').clientWidth,
      composer:document.querySelector('.chat-composer').clientWidth,
    }));
    // At a wide 1920px viewport, the reading column caps at 900px instead of
    // stretching edge-to-edge — a deliberate fix (see the UI/UX audit: long
    // AI replies were unreadable at full viewport width). Still confirms
    // it's using a real chunk of space, not collapsed.
    assert.ok(geometry.message>700 && geometry.message<=902 && geometry.message<geometry.page*.9,JSON.stringify(geometry));
    assert.ok(geometry.user>200 && geometry.user<=902,JSON.stringify(geometry));
    assert.ok(geometry.composer>700 && geometry.composer<=902 && geometry.composer<geometry.page*.9,JSON.stringify(geometry));
    const draft=Array.from({length:40},(_,i)=>`Etapa ${i+1}: ${paragraph.slice(0,150)}`).join('\n');
    const input=page.getByRole('textbox',{name:'Mensagem para Aurora'});
    await input.fill(draft);
    await page.waitForFunction(()=>document.querySelector('.chat-composer textarea').clientHeight>180);
    await page.getByRole('button',{name:'Ampliar campo',exact:true}).click();
    assert.equal(await page.locator('.chat-messages').isVisible(),false);
    assert.ok((await input.boundingBox()).height>800);
    assert.equal(await input.inputValue(),draft);
    await input.press('Escape');
    assert.equal(await page.locator('.chat-messages').isVisible(),true);
    assert.equal(await input.inputValue(),draft);
    await page.setViewportSize({width:390,height:700});
    await page.waitForFunction(()=>document.querySelector('.chat-composer textarea').clientHeight<=window.innerHeight*.52+2);
    await page.getByRole('button',{name:'Ampliar campo',exact:true}).click();
    const mobile=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,bottom:document.querySelector('.chat-composer').getBoundingClientRect().bottom,height:innerHeight}));
    assert.equal(mobile.overflow,false);assert.ok(mobile.bottom<=mobile.height);
    assert.equal(await input.inputValue(),draft);
    await page.getByRole('button',{name:'Recolher campo',exact:true}).click();
    await input.fill('');
    await page.waitForFunction(()=>document.querySelector('.chat-composer textarea').clientHeight<80);
  } finally {await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test("Atlas retains full viewport and real memories after the chat layout changes", { skip, timeout: 30000 }, async () => {
  await createMemory({ title: 'Atlas layout regression', content: 'Memória real para validar a visualização.', env: { EMBEDDINGS_ENABLED: 'false' } });
  const server = createServer({ allowDev: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: executable, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('button', { name: /Memória/ }).click();
    await page.getByRole('button', { name: /Ver no Atlas 3D/ }).click();
    await page.waitForFunction(() => document.querySelector('.result-count')?.textContent?.trim() === '1 / 1');
    for (const width of [1440, 1100, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const geometry = await page.evaluate(() => ({
        atlas: document.querySelector('.atlas-takeover > .shell').getBoundingClientRect().width,
        scene: document.querySelector('.scene-wrap').getBoundingClientRect().width,
      }));
      assert.ok(Math.abs(geometry.atlas - width) < 2, `Atlas must occupy viewport at ${width}px: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.scene > 300, `Scene collapsed at ${width}px: ${JSON.stringify(geometry)}`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: '☷ Lista', exact: true }).click();
    await page.locator('.list-row', { hasText: 'Atlas layout regression' }).waitFor();
    await page.getByRole('button', { name: '← Voltar para o chat', exact: true }).click();
    await page.getByRole('button', { name: /Memória/ }).click();
    await page.getByRole('button', { name: 'Cena de teste', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.result-count')?.textContent?.trim() === '1.000 / 1.000');
    assert.ok((await page.locator('.scene-wrap').boundingBox()).width > 800);
    await page.getByRole('button', { name: '⌗ Vizinhança', exact: true }).click();
    await page.locator('.react-flow').waitFor();
    assert.ok((await page.locator('.react-flow').boundingBox()).width > 800);
    await page.getByRole('button', { name: '← Voltar para o chat', exact: true }).click();
    assert.ok((await page.locator('.sb').boundingBox()).width > 200);
    assert.equal(await page.locator('.chat-composer').isVisible(), true);
  } finally {
    await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});

test("real UI: navigation races, drafts, errors, settings and opaque executable previews", { skip, timeout: 30000 }, async () => {
  const server = createServer({ allowDev: false });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const a = await createConversation({ title: "Audit A", provider: "codex" });
  const b = await createConversation({ title: "Audit B", provider: "codex" });
  await setSetting("sandbox_dir", join(temp, "sandbox"));
  const browser = await chromium.launch({ executablePath: executable, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(base);
    await page.locator(".sb-row-main", { hasText: "Audit B" }).click();
    await page.waitForFunction(() => document.querySelector(".conversation-title")?.textContent === "Audit B");
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await page.route(`**/api/conversations/${a.id}`, async route => { await held; await route.continue(); });
    const requestA = page.waitForRequest(r => r.url().endsWith(`/api/conversations/${a.id}`));
    await page.locator(".sb-row-main", { hasText: "Audit A" }).click(); await requestA;
    await page.locator(".sb-row-main", { hasText: "Audit B" }).click();
    await page.waitForFunction(() => document.querySelector(".conversation-title")?.textContent === "Audit B");
    const responseA = page.waitForResponse(r => r.url().endsWith(`/api/conversations/${a.id}`)); release(); await responseA;
    await page.waitForTimeout(100);
    assert.equal(await page.locator(".conversation-title").textContent(), "Audit B");
    await page.unroute(`**/api/conversations/${a.id}`);

    const composer = page.locator(".chat-composer textarea");
    await page.locator(".sb-row-main", { hasText: "Audit A" }).click(); await composer.fill("Rascunho A");
    await page.locator(".sb-row-main", { hasText: "Audit B" }).click(); await composer.fill("Rascunho B");
    await page.locator(".sb-row-main", { hasText: "Audit A" }).click();
    await page.waitForFunction(() => document.querySelector(".chat-composer textarea")?.value === "Rascunho A");
    await page.getByRole("button", { name: "Enviar mensagem" }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await composer.inputValue(), "Rascunho A");

    await page.getByRole("button", { name: /Configurações/ }).click();
    await page.getByRole('button', { name: 'IA local', exact: true }).click();
    await page.getByText('Escolha manual avançada', {exact:true}).click();
    const custom = page.getByRole('textbox', { name: 'Modelo avançado do Ollama', exact: true });
    await custom.fill("qwen:custom-test"); assert.equal(await custom.inputValue(), "qwen:custom-test");

    const html = `<html><body><script>(async()=>{let parentReadable=false,apiReadable=false,bridge=false;try{parentReadable=Boolean(parent.document.body)}catch{}try{bridge=Boolean(parent.harness)}catch{}try{const r=await fetch('/api/projects');apiReadable=r.ok}catch{}document.body.textContent=JSON.stringify({parentReadable,apiReadable,bridge});})();</script></body></html>`;
    await addMessage({ conversationId: b.id, role: "assistant", content: `\`\`\`html\n${html}\n\`\`\``, provider: "Codex" });
    await page.locator(".sb-row-main", { hasText: "Audit B" }).click();
    await page.locator(".artifact-card").click();
    const frame = page.frameLocator(".artifact-surface iframe");
    await frame.locator("body").filter({ hasText: "parentReadable" }).waitFor();
    const result = JSON.parse(await frame.locator("body").textContent());
    assert.deepEqual(result, { parentReadable: false, apiReadable: false, bridge: false });
    assert.equal(await page.locator(".artifact-surface iframe").getAttribute("sandbox"), "allow-scripts allow-pointer-lock");
    await page.getByRole("button", { name: "Código", exact: true }).click();
    assert.ok((await page.locator(".artifact-surface pre").innerText()).includes("parentReadable"));
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Baixar", exact: true }).click();
    assert.equal((await downloadEvent).suggestedFilename(), "arquivo.html");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".artifact-panel").count(), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".artifact-card").click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole("button", { name: "Fechar arquivos" }).click();
    assert.equal(await composer.isVisible(), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test("local setup finishes once without reconnecting or restarting downloads", { skip, timeout: 15000 }, async () => {
  let pulled = false, downloads = 0, setups = 0;
  const ollama = http.createServer(async (req, res) => {
    if (req.url === "/api/version") return res.end('{"version":"test"}');
    if (req.url === "/api/tags") return res.end(JSON.stringify({ models: pulled ? [{ name: "ui-test:latest" }] : [] }));
    if (req.url === "/api/pull") {
      for await (const _ of req) { /* drain */ }
      downloads++; pulled = true;
      return res.end('{"status":"success"}');
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => ollama.listen(0, "127.0.0.1", resolve));
  const previous = process.env.LOCAL_BASE_URL;
  process.env.LOCAL_BASE_URL = `http://127.0.0.1:${ollama.address().port}`;
  await setSetting("local_model", "ui-test:latest");
  await createConversation({ title: "Setup UI", provider: "local" });
  const server = createServer({ allowDev: false });
  server.on("request", req => { if (req.url === "/api/local/setup") setups++; });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath: executable, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator(".conversation-title", { hasText: "Setup UI" }).waitFor();
    await page.locator(".local-setup-panel").waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Ajustes da conversa" }).click();
    await page.locator(".local-setup-panel.ready").waitFor();
    await page.waitForTimeout(3500); // EventSource's old default retry would already have fired.
    assert.equal(setups, 1); assert.equal(downloads, 1);
  } finally {
    process.env.LOCAL_BASE_URL = previous;
    await browser.close();
    server.closeAllConnections(); ollama.closeAllConnections();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => ollama.close(resolve))]);
  }
});

test("Atlas: inspector shows usage, the health filter finds failing memories and archiving takes one off the map", { skip, timeout: 30000 }, async () => {
  const { getDb } = await import("../app/db.js");
  const keep = await createMemory({ title: "Memória que atrapalha", content: "Sempre usar caminho fixo C:\\temp.", env: { EMBEDDINGS_ENABLED: "false" } });
  (await getDb()).prepare("UPDATE memories SET uses = 5, helped = 0, failed = 4 WHERE id = ?").run(keep.id);
  const server = createServer({ allowDev: false });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath: executable, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole("button", { name: /Memória/ }).first().click();
    await page.getByRole("button", { name: /Ver no Atlas 3D/ }).click();
    await page.getByRole("button", { name: /Mais falham/ }).click();
    await page.getByRole("button", { name: "☷ Lista", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".list-row").length === 1);
    await page.locator(".list-row", { hasText: "Memória que atrapalha" }).click();
    await page.locator(".usage-numbers").waitFor();
    assert.match(await page.locator(".usage").innerText(), /5\s*usos[\s\S]*0\s*ajudou[\s\S]*4\s*falhou[\s\S]*atrapalha/);
    await page.getByRole("button", { name: "Arquivar", exact: true }).click();
    await page.getByText(/Memória arquivada/).waitFor();
    assert.equal(await page.locator(".list-row", { hasText: "Memória que atrapalha" }).count(), 0, "archived leaves the atlas");
    const row = (await getDb()).prepare("SELECT status FROM memories WHERE id = ?").get(keep.id);
    assert.equal(row.status, "archived", "kept, not deleted");
  } finally {
    await browser.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  }
});

test('an answer that created a file shows it with Abrir and Mostrar na pasta', {skip,timeout:30000},async()=>{
  const c=await createConversation({title:'Arquivo entregue',provider:'local'});
  const file=join(temp,'Kit_Midia_atualizado.docx');
  await addMessage({conversationId:c.id,role:'user',content:'crie um novo documento'});
  await addMessage({conversationId:c.id,role:'assistant',provider:'Local',content:'Criei o documento com os valores atualizados.',execution:{toolSteps:[{tool:'read_file',ok:true,summary:'C:/x.pdf'},{tool:'write_document',ok:true,summary:`Criei ${file} (DOCX, 900 bytes).`,args:{path:file}}]}});
  const server=createServer({allowDev:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:executable,headless:true});
  try{
    for (const viewport of [{width:1280,height:800},{width:390,height:800}]) {
      const page=await browser.newPage({viewport});
      await page.addInitScript(()=>{window.__opened=[];window.harness={openFile:async(f)=>{window.__opened.push(['open',f]);return true;},showInFolder:async(f)=>{window.__opened.push(['show',f]);return true;}};});
      await page.goto(`http://127.0.0.1:${server.address().port}/#/conversations/${c.id}`);
      const card=page.locator('.delivered-file');
      await card.waitFor();
      assert.equal(await card.locator('strong').textContent(),'Kit_Midia_atualizado.docx');
      await card.getByRole('button',{name:'Abrir'}).click();
      await card.getByRole('button',{name:'Mostrar na pasta'}).click();
      assert.deepEqual(await page.evaluate(()=>window.__opened),[['open',file],['show',file]]);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'no horizontal scroll');
      if (process.env.UI_SHOTS) await page.screenshot({path:join(process.env.UI_SHOTS,`arquivo-${viewport.width}.png`)});
      await page.close();
    }
  }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('agents page: a run with its delivered file, creating an agent with a schedule, on desktop and mobile', {skip,timeout:60000},async()=>{
  const agents=await import('../app/agents.js');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const workDir=join(temp,'agente-fin');mkdirSync(workDir,{recursive:true});
  const agent=await agents.createAgent({name:'Agente Financeiro',kind:'setor',department:'Financeiro',mission:'Gerar a lista de cobrança.',workDir});
  const file=join(workDir,'cobranca.xlsx');writeFileSync(file,'x');
  await agents.runAgent(agent.id,{request:'Gere a planilha de títulos com mais de 30 dias',handleChatTurn:async({conversationId})=>({ok:true,message:{conversationId,content:'Criei cobranca.xlsx.',execution:{toolSteps:[{tool:'write_document',ok:true,summary:`Criei ${file} (XLSX, 900 bytes).`,args:{path:file}}]}}})});
  const server=createServer({allowDev:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:executable,headless:true});
  try{
    for (const viewport of [{width:1280,height:900},{width:390,height:900}]) {
      const page=await browser.newPage({viewport});
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      if (viewport.width<600) await page.locator('.mobile-menu-button, [aria-label="Abrir menu"]').first().click().catch(()=>{});
      await page.getByRole('button',{name:'Agentes'}).click();
      const card=page.getByRole('article',{name:'Agente Financeiro'});
      await card.waitFor();
      await page.waitForFunction(()=>!document.querySelector('.sb.mobile-open'));
      await page.waitForTimeout(300);
      await card.getByText('Concluída').waitFor();
      assert.equal(await card.locator('.delivered-file strong').first().textContent(),'cobranca.xlsx');
      assert.equal(await page.locator('.sb-project').filter({hasText:'Agente: Agente Financeiro'}).count(),0,'agent projects stay off the sidebar');
      if (viewport.width>600) {
        const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Exportar histórico'}).click()]);
        const csv=(await import('node:fs')).readFileSync(await download.path(),'utf8');
        assert.match(csv,/^﻿Início;Fim;Agente;Gatilho;Situação;Pedido;Arquivos entregues;Passos;Erro/);
        assert.match(csv,/Agente Financeiro;manual;done;Gere a planilha de títulos com mais de 30 dias;.*cobranca.xlsx/);
      }
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'no horizontal scroll');
      if (process.env.UI_SHOTS) await page.screenshot({path:join(process.env.UI_SHOTS,`agentes-${viewport.width}.png`),fullPage:true});
      if (viewport.width>600) {
        await page.getByRole('button',{name:'Novo agente'}).click();
        const form=page.getByRole('form',{name:'Novo agente'});
        await form.getByRole('button',{name:'Organizar Downloads'}).click();
        assert.equal(await form.getByLabel('Nome').inputValue(),'Organizador de Downloads');
        assert.equal(await form.getByLabel('Tipo de gatilho').inputValue(),'at');
        await form.getByText('Escolha a sua pasta Downloads').waitFor();
        if (process.env.UI_SHOTS) await page.screenshot({path:join(process.env.UI_SHOTS,'agentes-modelo.png'),fullPage:true});
        await form.getByLabel('Nome').fill('Organizador de downloads');
        await form.getByLabel('Missão').fill('Organizar a pasta Downloads por tipo de arquivo.');
        await form.getByLabel('Pasta de trabalho').fill(join(temp,'agente-downloads'));
        await form.getByLabel('Tipo de gatilho').selectOption('at');
        await form.getByLabel('O que fazer').fill('Organize os arquivos novos.');
        if (process.env.UI_SHOTS) await page.screenshot({path:join(process.env.UI_SHOTS,'agentes-novo.png'),fullPage:true});
        await form.getByRole('button',{name:'Criar agente'}).click();
        const created=page.getByRole('article',{name:'Organizador de downloads'});
        await created.waitFor();
        assert.match(await created.locator('.agent-meta').textContent(),/Às 09:00 \(Seg\)/, 'the template\'s Monday 9:00');
      }
      await page.close();
    }
    const saved=(await agents.listAgents()).find(a=>a.name==='Organizador de downloads');
    assert.deepEqual(saved.trigger,{type:'schedule',at:'09:00',weekdays:[1],request:'Organize os arquivos novos.'});
  }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('team request: the plan is shown, edited and sent as edited', {skip,timeout:60000},async()=>{
  const agents=await import('../app/agents.js');
  for (const d of ['RH','Controladoria']) await agents.createAgent({name:`Agente ${d}`,kind:'setor',department:d,mission:`Rotinas de ${d}.`,workDir:join(temp,`equipe-${d}`)});
  const all=await agents.listAgents();
  const rh=all.find(a=>a.name==='Agente RH'),ctrl=all.find(a=>a.name==='Agente Controladoria');
  const server=createServer({allowDev:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:executable,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:1000}});
    let sent=null;
    await page.route('**/api/agents/plan',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({planner:'modelo',tasks:[{agentId:rh.id,agentName:'Agente RH',request:'Gere a planilha de férias de outubro.'},{agentId:ctrl.id,agentName:'Agente Controladoria',request:'Relatório em Word dos desvios acima de 5%.'}]})}));
    await page.route('**/api/agents/orchestrate',async route=>{sent=JSON.parse(route.request().postData());await route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({id:'x'})});});
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole('button',{name:'Agentes'}).click();
    const team=page.getByRole('region',{name:'Pedido para a equipe'});
    await team.getByRole('textbox',{name:'Pedido para a equipe'}).fill('Feche o mês de setembro para a diretoria');
    await team.getByRole('button',{name:'Montar plano'}).click();
    const task=team.getByRole('textbox',{name:'Tarefa de Agente RH'});
    await task.waitFor();
    await task.fill('Gere a planilha de quem começa as férias em outubro.');
    if (process.env.UI_SHOTS) await page.screenshot({path:join(process.env.UI_SHOTS,'equipe-plano.png'),fullPage:true});
    await team.getByRole('button',{name:'Executar plano'}).click();
    await page.waitForFunction(()=>!document.querySelector('[aria-label="Plano"]'));
    assert.equal(sent.request,'Feche o mês de setembro para a diretoria');
    assert.deepEqual(sent.tasks.map(t=>t.request),['Gere a planilha de quem começa as férias em outubro.','Relatório em Word dos desvios acima de 5%.']);
  }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('a working agent shows its stage and steps live on its card', {skip,timeout:60000},async()=>{
  const agents=await import('../app/agents.js');
  const pending=await import('../app/pendingTurns.js');
  const agent=await agents.createAgent({name:'Agente Ao Vivo',kind:'pessoal',mission:'Organizar.',workDir:join(temp,'ao-vivo')});
  let release;const gate=new Promise(r=>{release=r;});
  const done=agents.runAgent(agent.id,{request:'Organize a pasta',handleChatTurn:async({conversationId})=>{
    const controller=pending.startTurn(conversationId);
    pending.setStage(conversationId,'Movendo arquivos…');
    pending.pushTurnStep(conversationId,{tool:'move_file',args:{path:'relatorio.pdf'},status:'done',ok:true});
    await gate;pending.endTurn(conversationId,controller);
    return {ok:true,message:{conversationId,content:'Organizei.',execution:{toolSteps:[]}}};
  }});
  const server=createServer({allowDev:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:executable,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:900}});
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole('button',{name:'Agentes'}).click();
    const card=page.getByRole('article',{name:'Agente Ao Vivo'});
    const live=card.getByRole('generic',{name:'Andamento'}).or(card.locator('.agent-live'));
    await live.first().waitFor();
    await card.getByText('Movendo arquivos…').waitFor();
    await card.getByText(/Moveu arquivo relatorio\.pdf/).waitFor();
  }finally{release();await done;await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('a run that moved files can be undone from its card', {skip,timeout:60000},async()=>{
  const agents=await import('../app/agents.js');
  const {mkdirSync,writeFileSync,existsSync}=await import('node:fs');
  const workDir=join(temp,'desfazer');mkdirSync(join(workDir,'Documentos'),{recursive:true});
  writeFileSync(join(workDir,'Documentos','nota.pdf'),'x');
  const agent=await agents.createAgent({name:'Agente Desfazer',kind:'pessoal',mission:'Organizar.',workDir});
  await agents.runAgent(agent.id,{request:'Organize',handleChatTurn:async({conversationId})=>({ok:true,message:{conversationId,content:'Organizei.',execution:{toolSteps:[],moves:[{from:join(workDir,'nota.pdf'),to:join(workDir,'Documentos','nota.pdf')}]}}})});
  const server=createServer({allowDev:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:executable,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:900}});
    page.on('dialog',d=>void d.accept());
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole('button',{name:'Agentes'}).click();
    const card=page.getByRole('article',{name:'Agente Desfazer'});
    await card.getByText('Moveu 1 arquivo(s).').waitFor();
    await card.getByRole('button',{name:'Desfazer'}).click();
    await card.getByText(/Mudanças desfeitas em/).waitFor();
    assert.ok(existsSync(join(workDir,'nota.pdf')),'the file is back');
  }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('a chat answer that moved files can be undone under the message', {skip,timeout:60000},async()=>{
  const {mkdirSync,writeFileSync,existsSync}=await import('node:fs');
  const dir=join(temp,'chat-desfazer');mkdirSync(join(dir,'Imagens'),{recursive:true});
  writeFileSync(join(dir,'Imagens','foto.jpg'),'x');
  const c=await createConversation({title:'Organizar fotos',provider:'local'});
  await addMessage({conversationId:c.id,role:'user',content:'organize a pasta'});
  await addMessage({conversationId:c.id,role:'assistant',provider:'Local',content:'Movi a foto para Imagens.',execution:{toolSteps:[{tool:'move_file',ok:true,status:'done',args:{from:'foto.jpg',to:'Imagens/'},summary:`Movi ${join(dir,'foto.jpg')} para ${join(dir,'Imagens','foto.jpg')}.`}],moves:[{from:join(dir,'foto.jpg'),to:join(dir,'Imagens','foto.jpg')}]}});
  const server=createServer({allowDev:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:executable,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:900}});
    page.on('dialog',d=>void d.accept());
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByText('Organizar fotos').first().click();
    await page.getByText('Moveu 1 arquivo(s).').waitFor();
    await page.getByRole('button',{name:'Desfazer'}).click();
    await page.getByText(/Mudanças desfeitas: 1 voltaram/).waitFor();
    assert.ok(existsSync(join(dir,'foto.jpg')),'the file is back');
    await page.reload();
    await page.getByText('Organizar fotos').first().click();
    await page.getByText('Mudanças desfeitas.').waitFor();
  }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('an MCP extension is added from Settings and shows its tools', {skip,timeout:60000},async()=>{
  const {fileURLToPath}=await import('node:url');
  const {stopMcpServers}=await import('../app/mcp.js');
  const fake=fileURLToPath(new URL('./fixtures/fake-mcp.mjs',import.meta.url));
  const server=createServer({allowDev:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:executable,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:900}});
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole('button',{name:/Configurações/}).click();
    await page.getByRole('button',{name:'Agente',exact:true}).click();
    const panel=page.getByLabel('Extensões (MCP)');
    await panel.getByRole('textbox',{name:'Nome da extensão'}).fill('Agenda');
    await panel.getByRole('textbox',{name:'Comando da extensão'}).fill(`"${process.execPath}" "${fake}"`);
    await panel.getByRole('button',{name:'Adicionar'}).click();
    await panel.getByText('2 ferramenta(s)').waitFor();
    await panel.getByText(/ler_agenda, criar_evento/).waitFor();
    await panel.getByRole('button',{name:'Desligar'}).click();
    await panel.getByText('desligado').waitFor();
    if (process.env.UI_SHOTS) await page.screenshot({path:join(process.env.UI_SHOTS,'mcp.png')});
  }finally{stopMcpServers();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('with no agents yet, the ready templates are one click away', {skip,timeout:60000},async()=>{
  const agents=await import('../app/agents.js');
  for (const a of await agents.listAgents()) await agents.deleteAgent(a.id);
  const server=createServer({allowDev:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:executable,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:900}});
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole('button',{name:'Agentes'}).click();
    await page.getByRole('group',{name:'Começar por um modelo'}).getByRole('button',{name:'Organizar Downloads'}).click();
    const form=page.getByRole('form',{name:'Novo agente'});
    assert.equal(await form.getByLabel('Nome').inputValue(),'Organizador de Downloads');
    await form.getByText('Escolha a sua pasta Downloads').waitFor();
  }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('a working agent that needs a yes gets it from its card', {skip,timeout:60000},async()=>{
  const agents=await import('../app/agents.js');
  const pending=await import('../app/pendingTurns.js');
  const agent=await agents.createAgent({name:'Agente Pede',kind:'pessoal',mission:'Organizar.',workDir:join(temp,'pede')});
  let answer;
  const done=agents.runAgent(agent.id,{request:'Organize',handleChatTurn:async({conversationId})=>{
    const controller=pending.startTurn(conversationId);
    pending.setStage(conversationId,'Aguardando sua autorização…');
    answer=await pending.requestApproval(conversationId,{tool:'run_command',summary:'Remove-Item lixo.tmp',detail:'Comando que apaga arquivos'},{timeoutMs:30000}).catch(()=>'expirou');
    pending.endTurn(conversationId,controller);
    return {ok:true,message:{conversationId,content:'Feito.',execution:{toolSteps:[]}}};
  }});
  const server=createServer({allowDev:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:executable,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:900}});
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole('button',{name:'Agentes'}).click();
    const card=page.getByRole('article',{name:'Agente Pede'});
    const ask=card.getByRole('alertdialog',{name:'Autorização necessária'});
    await ask.getByText('Remove-Item lixo.tmp').waitFor();
    await ask.getByRole('button',{name:'Permitir'}).click();
    await done;
    assert.equal(answer,true);
  }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
