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
  if (m) {
    const list = conversations.get(m[1]) || []; list.push({ role: "user", content: body.message }); await new Promise((r) => setTimeout(r, 600));
    // A scene asked from the app: the answer the Aurora gives (a sentence and the ```cena block).
    const scene = { titulo: "Fazenda da Aurora", chao: "grama", itens: [{ tipo: "vaca", qtd: 3 }, { tipo: "trator", comportamento: "rodar" }, { tipo: "celeiro", x: -0.6, z: -0.5 }, { tipo: "arvore", qtd: 4 }, { tipo: "carro", qtd: 2, cor: "azul" }, { tipo: "lago" }] };
    const a = { role: "assistant", content: body.message.includes("[Aurora XR]") ? `Montei uma fazenda com vacas e um trator.\n\`\`\`cena\n${JSON.stringify(scene)}\n\`\`\`` : `Hoje há 14 caminhões nas docas e 12 na fila; 4 atrasados. Você disse: “${body.message}”.` };
    list.push(a); return { message: a };
  }
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
  // A scene asked to the Aurora: the draft at once, hers when she answers.
  await page.click('[data-page="cenarios"]');
  await page.fill('form[data-act="scene"] textarea', "faz uma fazenda com vacas e um trator"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.auroraXR.S.view === "cenario" && !window.auroraXR.S.sceneBusy, null, { timeout: 15000 });
  r.checks.scene = await page.evaluate(() => { const { S, stage } = window.auroraXR; return { title: S.scene.title, items: S.scene.items.length, bodies: stage.bodies.length, saved: S.scenes.length }; });
  if (r.checks.scene.title !== "Fazenda da Aurora" || r.checks.scene.bodies !== r.checks.scene.items) r.failed = "o cenário da Aurora não apareceu inteiro";
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(out, "pc-cenario.png") });
  // Drag a cow with the mouse; let go: it goes back to where it walks.
  const cow = await page.evaluate(() => {
    const { stage } = window.auroraXR; const b = stage.bodies.find((x) => x.obj.userData.dyn.label === "Vaca");
    const v = stage.twin.localToWorld(new b.obj.position.constructor(b.pose.x, b.pose.y + b.height / 2, b.pose.z)).project(stage.camera); const r = stage.canvas.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  });
  await page.mouse.move(cow.x, cow.y); await page.mouse.down();
  for (let k = 1; k <= 8; k++) { await page.mouse.move(cow.x + k * 12, cow.y - k * 6); await page.waitForTimeout(30); }
  r.checks.dragged = await page.evaluate(() => { const { stage } = window.auroraXR; const m = stage.mouse; return m ? { moved: m.moved, away: +Math.hypot(m.obj.position.x - m.body.pose.x, m.obj.position.z - m.body.pose.z).toFixed(3) } : null; });
  await page.mouse.up(); await page.waitForTimeout(1100);
  r.checks.cowBack = await page.evaluate(() => { const { stage } = window.auroraXR; const b = stage.bodies.find((x) => x.obj.userData.dyn.label === "Vaca"); return { onPlate: b.obj.parent === stage.twin, off: +Math.hypot(b.obj.position.x - b.pose.x, b.obj.position.z - b.pose.z).toFixed(4), held: b.held }; });
  if (!r.checks.dragged?.moved || r.checks.dragged.away < 0.01) r.failed = "a vaca não foi arrastada";
  else if (!r.checks.cowBack.onPlate || r.checks.cowBack.off > 0.003) r.failed = "a vaca não voltou para o lugar";
  // Back to the operation.
  await page.evaluate(() => window.auroraXR.act("view:operacao")); await page.waitForTimeout(300);
  r.checks.backToOperation = await page.evaluate(() => window.auroraXR.stage.bodies.length);
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
    const tw = (1280 - 96) / 6;
    r.checks.aimedAt = await aim(48 + tw + tw / 2, 136); await page.waitForTimeout(300); await press();
    r.checks.pageAfterPanelClick = await page.evaluate(() => window.auroraXR.S.page);
    r.checks.debugHit = await page.evaluate(() => { const { stage } = window.auroraXR; const input = stage.inputs.find((i) => i.source?.handedness === "right"); const { origin, dir } = stage.rayOf(input);
      return { origin: origin.toArray().map((x) => +x.toFixed(2)), dir: dir.toArray().map((x) => +x.toFixed(2)), hits: stage.hits(origin, dir).slice(0, 3).map((h) => [h.object.type, h.object === stage.panel.mesh ? "painel" : h.object.userData.grab ? "base" : "outro", +h.distance.toFixed(2)]), panelAt: stage.panel.object.position.toArray().map((x) => +x.toFixed(2)) }; });
    r.checks.rays = await page.evaluate(() => window.auroraXR.stage.inputs.map((i) => ({ src: i.source ? `${i.source.handedness}/${i.source.targetRayMode}` : null, dot: i.dot.visible, at: i.dot.position.toArray().map((x) => +x.toFixed(2)), from: i.ctrl.position.toArray().map((x) => +x.toFixed(2)) })));
    // Hold a truck: the controller right at it, grip pressed; it grows; brought up to the eyes; let go: back home.
    const thing = await page.evaluate(() => {
      const { stage } = window.auroraXR; const b = stage.bodies.find((x) => !x.fixed && x.obj.userData.entity?.place);
      window.__thing = b; const p = stage.twin.localToWorld(new b.obj.position.constructor(b.pose.x, b.pose.y + b.height / 2, b.pose.z));
      return { at: p.toArray(), name: b.obj.userData.dyn.label, s: b.obj.getWorldScale(p.clone()).x };
    });
    // The grip (where a controller holds) is not where the device puts the controller: move, read, correct.
    const gripAt = async (at) => {
      await page.evaluate((at) => window.__xrDevice.controllers.right.position.set(at[0], at[1], at[2]), at);
      for (let k = 0; k < 3; k++) {
        await page.waitForTimeout(120);
        await page.evaluate((at) => { const { stage } = window.auroraXR; const i = stage.inputs.find((x) => x.source?.handedness === "right"); const g = stage.handPoint(i); const c = window.__xrDevice.controllers.right; c.position.set(c.position.x + at[0] - g.x, c.position.y + at[1] - g.y, c.position.z + at[2] - g.z); }, at);
      }
      await page.waitForTimeout(120);
    };
    await gripAt(thing.at);
    r.checks.reach = await page.evaluate(() => { const { stage } = window.auroraXR; const i = stage.inputs.find((x) => x.source?.handedness === "right"); return { near: stage.nearest(stage.handPoint(i))?.userData.dyn.label || null, hover: !!stage.hoverRing.visible, grip: stage.handPoint(i).toArray().map((x) => +x.toFixed(3)) }; });
    await page.evaluate(() => window.__xrDevice.controllers.right.updateButtonValue("squeeze", 1)); await page.waitForTimeout(500);
    const held = await page.evaluate(() => { const { stage, S } = window.auroraXR; const o = window.__thing.obj; return { inHand: o.parent === stage.scene, scale: o.getWorldScale(o.position.clone()).x, picked: S.picked?.name || null }; });
    r.checks.held = { ...held, grew: +(held.scale / thing.s).toFixed(1) };
    for (let k = 1; k <= 6; k++) { await page.evaluate(([at, k]) => window.__xrDevice.controllers.right.position.set(at[0], at[1] + k * 0.05, at[2] + k * 0.04), [thing.at, k]); await page.waitForTimeout(80); }
    await page.waitForTimeout(200);
    r.checks.follows = await page.evaluate(() => { const { stage } = window.auroraXR; const i = stage.inputs.find((x) => x.source?.handedness === "right"); const o = window.__thing.obj; const h = [...stage.holds.values()][0]; return h ? +stage.handPoint(i).distanceTo(o.localToWorld(h.centre.clone())).toFixed(3) : -1; });
    if (process.env.XR_LAB_DEBUG) await page.screenshot({ path: join(out, "quest-segurando.png") });
    await page.evaluate(() => window.__xrDevice.controllers.right.updateButtonValue("squeeze", 0)); await page.waitForTimeout(1100);
    r.checks.back = await page.evaluate(() => { const { stage } = window.auroraXR; const b = window.__thing; return { onPlate: b.obj.parent === stage.twin, off: +Math.hypot(b.obj.position.x - b.home.x, b.obj.position.z - b.home.z).toFixed(4), scale: +(b.obj.scale.x / b.s0).toFixed(3), held: b.held }; });
    if (!r.checks.held.inHand || r.checks.held.grew < 2) r.failed = `o caminhão não veio para a mão (${JSON.stringify(r.checks.held)})`;
    else if (!(r.checks.follows >= 0 && r.checks.follows < 0.05)) r.failed = `o caminhão não acompanhou a mão (${r.checks.follows} m)`;
    else if (!r.checks.back.onPlate || r.checks.back.off > 0.002 || Math.abs(r.checks.back.scale - 1) > 0.01) r.failed = `o caminhão não voltou para a doca (${JSON.stringify(r.checks.back)})`;
    // Push one with the controller (no button): it moves aside, then the spring brings it back.
    const other = await page.evaluate(() => { const { stage } = window.auroraXR; const b = stage.bodies.find((x) => !x.fixed && x !== window.__thing && !x.obj.userData.entity?.place); window.__other = b; const p = stage.twin.localToWorld(new b.obj.position.constructor(b.pose.x + 0.01, b.pose.y + b.height / 2, b.pose.z)); return p.toArray(); });
    await gripAt(other); await page.waitForTimeout(300);
    r.checks.pushed = await page.evaluate(() => +Math.hypot(window.__other.ox, window.__other.oz).toFixed(4));
    if (process.env.XR_LAB_DEBUG) r.checks.pushDebug = await page.evaluate(() => { const { stage } = window.auroraXR; const i = stage.inputs.find((x) => x.source?.handedness === "right"); const b = window.__other; const W = stage.twin.getWorldScale(b.obj.position.clone()).x; const l = stage.twin.worldToLocal(stage.handPoint(i)); return { gripVisible: i.grip.visible, hand: !!i.source.hand, W, local: l.toArray().map((x) => +x.toFixed(3)), pose: [b.pose.x, b.pose.y, b.pose.z].map((x) => +x.toFixed(3)), r: b.radius, h: b.height, held: b.held, fixed: b.fixed, n: stage.bodies.length }; });
    await page.evaluate(() => window.__xrDevice.controllers.right.position.set(0.15, 1.35, -0.1)); await page.waitForTimeout(1500);
    r.checks.settled = await page.evaluate(() => +Math.hypot(window.__other.ox, window.__other.oz).toFixed(4));
    if (!r.failed && !(r.checks.pushed > 0.003 && r.checks.settled < 0.001)) r.failed = `empurrar não funcionou (${r.checks.pushed} → ${r.checks.settled})`;
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
