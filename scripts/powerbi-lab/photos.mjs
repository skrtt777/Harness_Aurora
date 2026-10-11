// Fotos de cada página de um projeto .pbip gerado pela Aurora, para conferir o design: abre o projeto com
// cada página ativa, atualiza, fotografa a janela e fecha (só o Power BI que abriu).
// node scripts/powerbi-lab/photos.mjs <pasta do projeto> <pasta das fotos>
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const { openInDesktop, openReports, pbiRequest, stopPowerBi } = await import("../../app/powerbi.js");

const [project, photos] = process.argv.slice(2);
if ((await openReports()).length) { console.log("Já há um Power BI aberto: feche-o antes."); process.exit(1); }
const pbip = readdirSync(project).find((f) => f.endsWith(".pbip"));
const pagesFile = join(project, pbip.replace(/\.pbip$/, ".Report"), "definition", "pages", "pages.json");
const pages = JSON.parse(readFileSync(pagesFile, "utf8"));
const original = pages.activePageName;
try {
  for (const [i, name] of pages.pageOrder.entries()) {
    writeFileSync(pagesFile, JSON.stringify({ ...pages, activePageName: name }, null, 2));
    const report = await openInDesktop(join(project, pbip));
    try {
      for (let t = 0; t < 30; t += 1) { if ((await pbiRequest("connect", { port: report.port })).ok) break; await new Promise((r) => setTimeout(r, 3000)); }
      await pbiRequest("refresh", {}, 300_000);
      await new Promise((r) => setTimeout(r, 15000));
      const png = join(photos, `pagina${i + 1}.png`);
      execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(import.meta.dirname, "window-shot.ps1"), String(report.pid), png]);
      console.log(`foto: ${png}`);
    } finally {
      for (const r of await openReports().catch(() => [])) { try { process.kill(r.pid); } catch { /* closed */ } }
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
} finally {
  writeFileSync(pagesFile, JSON.stringify({ ...pages, activePageName: original }, null, 2));
  stopPowerBi();
}
process.exit(0);
