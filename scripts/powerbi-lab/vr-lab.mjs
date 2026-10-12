// O gêmeo em 3D: o CD aberto no Power BI de teste, o servidor do gêmeo só neste computador, a página aberta
// num navegador sem janela; a foto e o selo (quantos desenhados) conferem com a cena do Power BI.
// node scripts/powerbi-lab/vr-lab.mjs <pasta dos dados> <pasta das fotos>
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { buildReport, openReports, stopPowerBi, twinNow } = await import("../../app/powerbi.js");
const { startTwinServer, stopTwinServer } = await import("../../app/twinServer.js");

const [data, shots] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
const plan = { titulo: "Operação dos CDs", estilo: { tema: "escuro", cor: "azul", tom: "tecnico" }, paginas: [{ nome: "Pátio ao vivo", pergunta: "Onde está cada caminhão?", layout: "gemeo_digital", cena: "patio", numeros: [], blocos: [] }] };
if ((await openReports()).length) { console.log("Já há um Power BI aberto: feche-o antes do teste."); process.exit(1); }
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };
let opened = null;
try {
  const r = await buildReport({ files: [join(data, "operacao_cd.xlsx")], folder: mkdtempSync(join(tmpdir(), "aurora-vr-")), goal: "", conversationId: "vr", planner: { ask: async () => ({ ok: true, text: JSON.stringify(plan) }), env: {} } }).catch((e) => { opened = e.opened; throw e; });
  opened = r.opened;
  const info = await startTwinServer({ getState: () => twinNow(), lan: false, port: 0 });
  const state = await (await fetch(`${info.local}state`)).json();
  const other = state.units[1];
  check("estado do gêmeo com as duas unidades", state.units.length === 2, state.units.map((u) => `${u.name}: ${u.counts.total}`).join(", "));
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 820 } });
  await page.goto(info.local);
  await page.waitForFunction(() => /desenhados/.test(document.getElementById("seal")?.textContent || ""), null, { timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(shots, "gemeo-3d.png") });
  const seal = await page.textContent("#seal");
  const first = state.units[0];
  check("a página 3D desenha todos", new RegExp(`✓ ${first.counts.total} de ${first.counts.total}`).test(seal), seal);
  // The Aurora XR app in read-only mode: the operation page (MR/VR buttons appear where the browser has WebXR).
  check("Aurora XR na página da operação", await page.evaluate(() => window.auroraXR?.S.page === "operacao" && !!document.querySelector(".nums")));
  // The other unit, chosen on the page.
  if (other) {
    // (The scene animates without stopping: a click through the page, not one waiting for it to settle.)
    await page.evaluate((name) => [...document.querySelectorAll('[data-act="unit"]')].find((b) => b.textContent === name)?.click(), other.name);
    await page.waitForTimeout(1500);
    check("trocar de unidade na página", new RegExp(`${other.counts.total} de ${other.counts.total}`).test(await page.textContent("#seal")), await page.textContent("#seal"));
    await page.screenshot({ path: join(shots, "gemeo-3d-outra.png") });
  }
  await browser.close();
} finally {
  stopTwinServer();
  if (opened?.pid) { try { process.kill(opened.pid); } catch { /* closed */ } }
  stopPowerBi();
}
console.log(`\nNota: ${results.filter(Boolean).length}/${results.length}`);
process.exit(0);
