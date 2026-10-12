// Aurora XR lab: a bridge of its own (temporary folder, its own port, a fake PC with an operation and an
// echo chat), the web app opened in Chromium as a PC, as a phone and as a Quest 3 emulated by IWER
// (immersive-ar with hands). Screenshots and the console errors go to the output folder.
// node scripts/xr-lab/xr-lab.mjs <out> [--iwer path/to/iwer.min.js]
import http from "node:http";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { XRStore, createXRHandler } from "../../app/xrBridge.js";

const out = resolve(process.argv[2] || "xr-lab-out"); mkdirSync(out, { recursive: true });
const iwerAt = process.argv.indexOf("--iwer"); const iwer = iwerAt > 0 ? readFileSync(process.argv[iwerAt + 1], "utf8") : null;

// A CD operation like the Power BI one: 2 units, 10 docks, trucks served, in line, on the road.
function sampleTwin() {
  const units = []; const entities = []; let n = 0;
  const plate = () => `${String.fromCharCode(65 + (n % 26), 65 + ((n * 7) % 26), 65 + ((n * 3) % 26))}-${1000 + n * 37}`;
  for (const name of ["CD Contagem", "CD Betim"]) {
    const places = []; const queue = []; const road = [];
    for (let d = 1; d <= 10; d++) {
      const serving = []; const waiting = [];
      if (d % 3 !== 0) { const p = plate(); n++; serving.push(p); entities.push({ name: p, id: `EMB-${n}`, status: d % 4 === 0 ? "Separação" : "Carregando", where: "doca", place: `Doca ${String(d).padStart(2, "0")}`, late: d === 5, unit: name, waited: 20 + d * 3 }); }
      if (d % 4 === 1) { const p = plate(); n++; waiting.push(p); entities.push({ name: p, id: `EMB-${n}`, status: "Pedido recebido", where: "filalocal", place: `Doca ${String(d).padStart(2, "0")}`, late: false, unit: name }); }
      places.push({ name: `Doca ${String(d).padStart(2, "0")}`, serving, waiting });
    }
    for (let q = 0; q < 6; q++) { const p = plate(); n++; queue.push(p); entities.push({ name: p, id: `EMB-${n}`, status: "Pedido recebido", where: "fila", late: q === 2, unit: name }); }
    for (let r = 0; r < 3; r++) { const p = plate(); n++; road.push(p); entities.push({ name: p, id: `EMB-${n}`, status: "Em trânsito", where: "estrada", late: false, unit: name }); }
    const mine = entities.filter((e) => e.unit === name);
    units.push({ name, places, queue, road, counts: { total: mine.length, serving: mine.filter((e) => e.where === "doca").length, waiting: queue.length, road: road.length, late: mine.filter((e) => e.late).length } });
  }
  return { version: 1, title: "Operação dos CDs", kind: "operacao", updatedAt: new Date().toISOString(), lastRefresh: new Date().toISOString(), glyph: "veiculo", noun: "caminhões", placeLabel: "Doca", environment: "armazem", colorBy: null,
    stages: [{ key: "fila", label: "Pedido recebido" }, { key: "separacao", label: "Separação" }, { key: "carregando", label: "Carregando" }, { key: "transito", label: "Em trânsito" }],
    units, entities, numbers: { "Caminhões nas docas": "14", "Caminhões na fila": "12", "Atrasados": "4", "No prazo %": "91,3%" },
    highlight: { values: ["Doca 03"], note: "Doca 03 livre há 40 min" }, notes: [{ when: "22:57", text: "OPQ-1S11 saiu da fila para a Doca 04." }] };
}

const serveAt = process.argv.indexOf("--serve");
const conversations = new Map();
const desktop = async (path, method = "GET", body) => {
  if (path === "/powerbi/twin") return sampleTwin();
  if (path === "/projects") return { projects: [{ id: "proj-a", name: "Logística MG", description: "CDs de Contagem e Betim" }] };
  if (path.startsWith("/memories")) return { memories: [{ id: "m1", title: "Prefere respostas curtas", content: "O usuário pede respostas diretas, em pt-BR." }, { id: "m2", title: "Doca 03", content: "A doca 03 está em manutenção às segundas." }] };
  if (path === "/conversations" && method === "POST") { const id = `c${conversations.size + 1}`; conversations.set(id, []); return { id, title: body.title }; }
  let m = path.match(/^\/conversations\/(\w+)\/messages$/);
  if (m) { const list = conversations.get(m[1]) || []; list.push({ role: "user", content: body.message }); await new Promise((r) => setTimeout(r, 600)); const a = { role: "assistant", content: `Hoje há 14 caminhões nas docas e 12 na fila; 4 atrasados. Você disse: “${body.message}”.` }; list.push(a); return { message: a }; }
  m = path.match(/^\/conversations\/(\w+)\/pending$/); if (m) return { stage: "Lendo o Power BI…", partial: "" };
  m = path.match(/^\/conversations\/(\w+)$/); if (m) return { id: m[1], messages: conversations.get(m[1]) || [] };
  if (path.startsWith("/conversations")) return { conversations: [] };
  return {};
};

const dir = mkdtempSync(join(tmpdir(), "aurora-xr-lab-"));
const store = new XRStore(dir);
const bridge = createXRHandler({ store, desktop, media: {} });
const server = http.createServer(async (req, res) => {
  if (req.url === "/lab/log" && req.method === "POST") {
    let body = ""; for await (const c of req) body += c;
    console.log(new Date().toLocaleTimeString("pt-BR"), body.slice(0, 1500)); res.writeHead(204); return res.end();
  }
  if (serveAt > 0 && !req.url.startsWith("/xr/app/")) console.log(new Date().toLocaleTimeString("pt-BR"), req.method, req.url);
  return bridge.handler(req, res);
}); await new Promise((r) => server.listen(serveAt > 0 ? Number(process.argv[serveAt + 1]) : 0, "127.0.0.1", r));
// --serve <port>: only the test bridge (for a headset on USB: adb reverse tcp:<port> tcp:<port>).
if (serveAt > 0) { console.log(`ponte de teste em http://localhost:${server.address().port}/xr/app/ (Ctrl+C para parar)`); await new Promise(() => {}); }
const base = `http://localhost:${server.address().port}/xr/app/`;
console.log("ponte de teste:", base);
const report = { base, runs: [] };

const browser = await chromium.launch({ executablePath: process.env.XR_LAB_CHROME || undefined, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
async function run(name, contextOptions, steps) {
  const { iwer: emulate, ...options } = contextOptions;
  const ctx = await browser.newContext({ ...options, bypassCSP: !!emulate });
  if (emulate) await ctx.addInitScript({ content: `${iwer}\n;(() => { const d = new IWER.XRDevice(IWER.metaQuest3); d.installRuntime({ forceInstall: true }); window.__xrDevice = d; })();` });
  const page = await ctx.newPage(); const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  const r = { name, errors, checks: {} };
  try { await page.goto(base); await steps(page, r); } catch (e) { r.failed = String(e.message || e).split("\n")[0]; }
  await page.screenshot({ path: join(out, `${name}.png`) }).catch(() => {});
  report.runs.push(r); await ctx.close();
  console.log(name, r.failed ? `FALHOU: ${r.failed}` : "ok", JSON.stringify(r.checks), errors.length ? `erros: ${errors.slice(0, 3).join(" | ")}` : "");
}
const pairHere = async (page) => {
  await page.waitForSelector("#pair[open]", { timeout: 8000 });
  await page.waitForFunction(() => /^\d{6}$/.test(document.getElementById("pairCode").value), null, { timeout: 5000 });
  await page.click("#pairGo");
  await page.waitForFunction(() => document.getElementById("conn").dataset.state === "ok", null, { timeout: 8000 });
};

await run("pc", { viewport: { width: 1440, height: 900 } }, async (page, r) => {
  await pairHere(page); r.checks.paired = true;
  await page.fill(".composer textarea", "Como está a operação?"); await page.keyboard.press("Enter");
  await page.waitForSelector(".msg.assistant", { timeout: 15000 });
  r.checks.answer = (await page.textContent(".msg.assistant")).slice(0, 60);
  await page.click('[data-page="operacao"]'); await page.waitForSelector(".nums", { timeout: 8000 });
  r.checks.seal = await page.textContent("#seal");
  // Pick a truck in the 3D view: where the first one served is drawn on the screen.
  const at = await page.evaluate(() => {
    const { stage } = window.auroraXR; let target = null;
    stage.twin.traverse((o) => { if (!target && o.isMesh && o.userData.entity?.place) target = o; });
    const v = target.getWorldPosition(target.position.clone()).project(stage.camera);
    const r = stage.canvas.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, name: target.userData.entity.name };
  });
  await page.mouse.click(at.x, at.y);
  r.checks.wanted = at.name;
  r.checks.picked = (await page.textContent(".picked h3").catch(() => null)) || "nenhum";
  await page.waitForTimeout(500);
});
await run("celular", { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36" }, async (page, r) => {
  await pairHere(page);
  r.checks.layout = await page.getAttribute("#app", "data-layout");
  await page.click('[data-page="operacao"]'); await page.waitForSelector(".nums", { timeout: 8000 });
  r.checks.motionButton = await page.isVisible("#motion");
  r.checks.noHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  await page.waitForTimeout(500);
});
if (iwer) {
  await run("quest-mr", { viewport: { width: 1280, height: 800 }, iwer: true, userAgent: "Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 OculusBrowser/41.0 Chrome/131 Mobile VR Safari/537.36" }, async (page, r) => {
    await pairHere(page);
    r.checks.modes = await page.textContent("#modes");
    await page.click("#modes button.primary");
    await page.waitForFunction(() => document.querySelector("#modes .exit"), null, { timeout: 8000 });
    r.checks.entered = true;
    await page.waitForTimeout(1200);
    r.checks.panelVisible = await page.evaluate(() => window.auroraXR.stage.panel.object.visible);
    // The right controller aimed at the "Operação" tab of the panel in the room, trigger pressed.
    // The emulated controller's ray is tilted from its grip (as on a real Quest): aim, read where the
    // ray really points, correct, a few times.
    const aim = async (px, py) => {
      let last = null;
      for (let k = 0; k < 4; k++) {
        last = await page.evaluate(([px, py, first]) => {
          const { stage } = window.auroraXR; const d = window.__xrDevice; const mesh = stage.panel.mesh; const g = mesh.geometry.parameters;
          const V = mesh.position.constructor; const Q = mesh.quaternion.constructor;
          const target = mesh.localToWorld(new V((px / 1280 - 0.5) * g.width, (0.5 - py / 960) * g.height, 0));
          const c = d.controllers.right; if (first) { c.position.set(0.15, 1.35, -0.1); c.quaternion.set(0, 0, 0, 1); }
          const input = stage.inputs.find((i) => i.source?.handedness === "right");
          const m = input.ctrl.matrixWorld; const from = new V().setFromMatrixPosition(m);
          const actual = new V(0, 0, -1).transformDirection(m); const wanted = target.clone().sub(from).normalize();
          const fix = new Q().setFromUnitVectors(actual, wanted);
          const q = new Q(c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w).premultiply(fix);
          c.quaternion.set(q.x, q.y, q.z, q.w);
          return { error: +(actual.angleTo(wanted) * 57.3).toFixed(1), target: target.toArray().map((x) => +x.toFixed(2)) };
        }, [px, py, k === 0]);
        await page.waitForTimeout(150);
      }
      return last;
    };
    const press = async () => { await page.evaluate(() => window.__xrDevice.controllers.right.updateButtonValue("trigger", 1)); await page.waitForTimeout(250); await page.evaluate(() => window.__xrDevice.controllers.right.updateButtonValue("trigger", 0)); await page.waitForTimeout(300); };
    const tw = (1280 - 96) / 5;
    r.checks.aimedAt = await aim(48 + tw + tw / 2, 136); await page.waitForTimeout(300); await press();
    r.checks.pageAfterPanelClick = await page.evaluate(() => window.auroraXR.S.page);
    r.checks.debugHit = await page.evaluate(() => { const { stage } = window.auroraXR; const input = stage.inputs.find((i) => i.source?.handedness === "right"); const { origin, dir } = stage.rayOf(input);
      return { origin: origin.toArray().map((x) => +x.toFixed(2)), dir: dir.toArray().map((x) => +x.toFixed(2)), hits: stage.hits(origin, dir).slice(0, 3).map((h) => [h.object.type, h.object === stage.panel.mesh ? "painel" : h.object.userData.grab ? "base" : "outro", +h.distance.toFixed(2)]), panelAt: stage.panel.object.position.toArray().map((x) => +x.toFixed(2)) }; });
    r.checks.rays = await page.evaluate(() => window.auroraXR.stage.inputs.map((i) => ({ src: i.source ? `${i.source.handedness}/${i.source.targetRayMode}` : null, dot: i.dot.visible, at: i.dot.position.toArray().map((x) => +x.toFixed(2)), from: i.ctrl.position.toArray().map((x) => +x.toFixed(2)) })));
    // Hands: IWER's hands; the motion tracking report sees them.
    await page.evaluate(() => { window.__xrDevice.primaryInputMode = "hand"; });
    await page.waitForTimeout(1200);
    r.checks.tracking = await page.evaluate(() => window.auroraXR.S.tracking);
    await page.evaluate(() => window.auroraXR.act("page:ajustes")); await page.waitForTimeout(400);
  });
}
if (iwer) {
  await run("quest-vr", { viewport: { width: 1280, height: 800 }, iwer: true, userAgent: "Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 OculusBrowser/41.0 Chrome/131 Mobile VR Safari/537.36" }, async (page, r) => {
    await pairHere(page);
    await page.evaluate(() => [...document.querySelectorAll("#modes button")].find((b) => /VR/.test(b.textContent))?.click());
    await page.waitForFunction(() => window.auroraXR?.S.mode === "vr", null, { timeout: 8000 });
    await page.waitForTimeout(1000);
    // Grab the miniature with the right controller (aimed at its plate), move the hand 20 cm to the right.
    const aimAt = (pt) => page.evaluate((pt) => {
      const { stage } = window.auroraXR; const d = window.__xrDevice; const V = stage.holder.position.constructor; const Q = stage.holder.quaternion.constructor;
      const input = stage.inputs.find((i) => i.source?.handedness === "right"); const c = d.controllers.right;
      const m = input.ctrl.matrixWorld; const from = new V().setFromMatrixPosition(m);
      const actual = new V(0, 0, -1).transformDirection(m); const wanted = new V(...pt).sub(from).normalize();
      const q = new Q(c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w).premultiply(new Q().setFromUnitVectors(actual, wanted));
      c.quaternion.set(q.x, q.y, q.z, q.w); return +(actual.angleTo(wanted) * 57.3).toFixed(1);
    }, pt);
    const before = await page.evaluate(() => window.auroraXR.stage.holder.position.toArray());
    await page.evaluate(() => window.__xrDevice.controllers.right.position.set(0.1, 1.2, -0.3));
    for (let k = 0; k < 4; k++) { await page.waitForTimeout(150); await aimAt([before[0], before[1], before[2] + 0.12]); }
    r.checks.aimHits = await page.evaluate(() => { const { stage } = window.auroraXR; const i = stage.inputs.find((x) => x.source?.handedness === "right"); const { origin, dir } = stage.rayOf(i); const h = stage.hits(origin, dir)[0]; return h ? (h.object.userData.grab ? "base" : h.object.userData.entity ? "entidade" : h.object.type) : "nada"; });
    await page.evaluate(() => window.__xrDevice.controllers.right.updateButtonValue("trigger", 1)); await page.waitForTimeout(400);
    for (let k = 1; k <= 5; k++) { await page.evaluate((k) => window.__xrDevice.controllers.right.position.set(0.1 + k * 0.04, 1.2, -0.3), k); await page.waitForTimeout(120); }
    await page.evaluate(() => window.__xrDevice.controllers.right.updateButtonValue("trigger", 0)); await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.auroraXR.stage.holder.position.toArray());
    r.checks.movedX = +(after[0] - before[0]).toFixed(3);
    r.checks.keptHeight = Math.abs(after[1] - before[1]) < 0.02;
    r.checks.where = await page.evaluate(() => { const { stage } = window.auroraXR; const V = stage.holder.position.constructor; const h = new V(); stage.renderer.xr.getCamera().getWorldPosition(h);
      const f = (v) => v.toArray().map((x) => +x.toFixed(2)); return { head: f(h), twin: f(stage.holder.position), panel: f(stage.panel.object.position), ref: stage.renderer.xr.getReferenceSpace()?.constructor?.name, twinVisible: stage.twin?.visible, room: stage.room.visible }; });
    if (process.env.XR_LAB_DEBUG) for (const [i, name] of [[0, "chao"], [2, "mesa"], [1, "grade"]]) { await page.evaluate((i) => { window.auroraXR.stage.room.children[i].visible = false; }, i); await page.waitForTimeout(300); await page.screenshot({ path: join(out, `vr-sem-${name}.png`) }); }
    if (!(r.checks.movedX > 0.15 && r.checks.movedX < 0.25)) r.failed = `a maquete não acompanhou o controle (${r.checks.movedX} m)`;
  });
}
await browser.close();
server.close(); rmSync(dir, { recursive: true, force: true });
writeFileSync(join(out, "relatorio.json"), JSON.stringify(report, null, 2));
const bad = report.runs.filter((r) => r.failed || r.errors.length);
console.log(bad.length ? `${bad.length} com problema` : "tudo certo");
process.exit(bad.length ? 1 : 0);
