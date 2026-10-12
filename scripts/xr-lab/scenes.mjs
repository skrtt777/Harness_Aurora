// Composes recipes with the real object library in the browser and screenshots each (visual check).
// Needs the test bridge: node scripts/xr-lab/xr-lab.mjs <dir> --serve 8799; then
// node scripts/xr-lab/scenes.mjs <out-dir> fazenda,cidade,...
import { chromium } from "playwright";
const out = process.argv[2]; const which = (process.argv[3] || "fazenda,cidade,praia,espaco,dinossauro,floresta").split(",");
const browser = await chromium.launch({ executablePath: process.env.XR_LAB_CHROME, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto("http://localhost:8799/xr/app/");
await page.waitForFunction(() => window.auroraXR?.stage);
await page.waitForSelector("#pair[open]"); await page.evaluate(() => { const d = document.getElementById("pair"); d.close(); d.remove(); document.querySelector(".panel").style.display = "none"; document.getElementById("app").style.gridTemplateColumns = "1fr"; });
for (const w of which) {
  const t0 = Date.now();
  const info = await page.evaluate(async (w) => {
    const sc = await import("/xr/app/lib/scene.js"); const cp = await import("/xr/app/lib/compose.js");
    const { stage } = window.auroraXR; const cat = await stage.assets.load();
    const spec = sc.sceneFromPrompt(w, (x) => cp.resolveType(cat, x)); const L = cp.compose(spec, cat, w);
    await stage.setScene(L); stage.frameTwin();
    return { title: L.title, things: L.things.length, decor: L.decor.length, fences: L.fences.length, missing: L.missing, bodies: stage.bodies.length, anim: stage.bodies.filter((b) => b.obj.userData.anim).length };
  }, w);
  await page.waitForTimeout(1500);
  await page.locator("#stage").screenshot({ path: `${out}/cena-${w}.png` });
  console.log(w, JSON.stringify(info), `${Date.now() - t0}ms`);
}
console.log("erros:", errors.length ? errors.slice(0, 5).join(" | ") : "nenhum");
await browser.close();
