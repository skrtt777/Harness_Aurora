// Qualquer BI com cena, de ponta a ponta: arquivo -> projeto .pbip -> Power BI Desktop de teste aberto e
// atualizado; confere números (--confere "[Medida]=valor"), grava cada imagem que o motor calcula (SVG ->
// PNG) e tira a foto de cada página. Só com nenhum Power BI aberto antes; fecha só o que abriu.
// node scripts/powerbi-lab/scenes-lab.mjs <arquivo .xlsx/.csv> <pasta das fotos> [--goal "…"] [--confere "[M]=v"]…
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const { buildReport, openReports, pbiRequest, stopPowerBi } = await import("../../app/powerbi.js");
const { desktopRequest, stopDesktop } = await import("../../app/desktop.js");
const { localPlanAsk } = await import("../../app/powerbiPlanner.js");
// --modelo: the local model plans the BI (as in the app); without it, the automatic plan.
const planner = process.argv.includes("--modelo") ? { ask: await localPlanAsk(process.env), env: process.env } : null;
// --plano <arquivo.json>: a plan given (as the model would write it), to look at one layout.
const { readFileSync: readPlan } = await import("node:fs");
const { prepare: prep0, finish: finish0 } = await import("../../app/powerbiDesign.js");
const fixedPlan = process.argv.includes("--plano") ? JSON.parse(readPlan(process.argv[process.argv.indexOf("--plano") + 1], "utf8")) : null;

const [file, shots] = process.argv.slice(2);
const flag = (name) => process.argv.flatMap((a, i) => (a === `--${name}` ? [process.argv[i + 1]] : []));
mkdirSync(shots, { recursive: true });
if ((await openReports()).length) { console.log("Já há um Power BI aberto: feche-o antes do teste."); process.exit(1); }
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };
const value = async (dax) => { const r = await pbiRequest("query", { dax: `EVALUATE ROW("v", ${dax})`, max: 2 }); return r.ok ? { text: (r.text || "").split("\n").slice(2).join("\n").trim() } : { error: r.error }; };
const num = (s) => Number(String(s).replace(/R\$\s*/, "").replace(/\./g, "").replace(",", "."));
const out = mkdtempSync(join(tmpdir(), "aurora-cenas-"));
let opened = null;
try {
  const r = await buildReport({ files: [file], folder: out, goal: flag("goal")[0] || "", planner: fixedPlan ? { ask: async () => ({ ok: true, text: JSON.stringify(fixedPlan) }), env: {} } : planner, conversationId: "cenas", onStage: (s) => console.log(`  … ${s}`) }).catch((e) => { opened = e.opened; throw e; });
  opened = r.opened;
  console.log(`  ${r.refreshed}\n  ${r.plan.summary.split("\n").filter((l) => /^Plano/.test(l)).join("\n")}`);
  check("abriu e carregou", /Atualizei os dados/.test(r.refreshed), r.refreshed);
  for (const c of flag("confere")) {
    const [, measure, want] = /^(.+?)=(.+)$/.exec(c);
    const v = await value(`ROUND(${measure}, 2)`);
    check(`confere ${measure}`, !v.error && Math.abs(num(v.text) - Number(want)) < 0.05, v.error || `${v.text} x ${want}`);
  }
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 640 } });
  for (const m of r.plan.measureList.filter((x) => x.category === "ImageUrl")) {
    // A row picture (a bar per row) is drawn for the first item of a table; the scenes, for everything.
    // --filtro "'Tabela'[Coluna]=valor": as the page shows it (the unit chosen in its filter).
    const filters = flag("filtro").map((f) => /^(.+?)=(.+)$/.exec(f)).map(([, ref, val]) => `${ref} = "${val.replace(/"/g, '""')}"`);
    const v = await value(filters.length ? `CALCULATE([${m.name}], ${filters.join(", ")})` : `[${m.name}]`);
    const url = v.text || "";
    const ok = url.startsWith("data:image/svg+xml;utf8,<svg");
    const empty = !v.error && !url;
    check(`imagem ${m.name}`, ok || empty, v.error ? v.error.slice(0, 300) : empty ? "vazia no total (é de linha)" : `${url.length} caracteres`);
    if (!ok) continue;
    const name = m.name.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-");
    writeFileSync(join(shots, `${name}.svg`), decodeURIComponent(url.slice("data:image/svg+xml;utf8,".length).replace(/%(?![0-9A-F]{2})/gi, "%25")));
    await page.setContent(`<body style="margin:0;background:#0B1220"><img id="i" style="width:100%" src="${url.replace(/"/g, "&quot;")}"></body>`);
    const loaded = await page.evaluate(() => document.getElementById("i").naturalWidth > 0);
    check(`imagem ${m.name} abre como SVG`, loaded);
    if (loaded) await (await page.$("#i")).screenshot({ path: join(shots, `${name}.png`) });
    // --selecao "'Tabela'[Coluna]=valor": the same picture with that item chosen (lit, the rest dim).
    for (const sel of flag("selecao")) {
      const [, ref, val] = /^(.+?)=(.+)$/.exec(sel);
      const vs = await value(`CALCULATE([${m.name}], ${ref} = "${val}")`);
      const u = vs.text || "";
      if (!u.startsWith("data:image/svg+xml;utf8,<svg")) continue;
      await page.setContent(`<body style="margin:0;background:#0B1220"><img id="i" style="width:100%" src="${u.replace(/"/g, "&quot;")}"></body>`);
      if (await page.evaluate(() => document.getElementById("i").naturalWidth > 0)) await (await page.$("#i")).screenshot({ path: join(shots, `${name}-selecao.png`) });
    }
  }
  await browser.close();
  await new Promise((res) => setTimeout(res, 6000));
  const windowTitle = (await openReports()).find((x) => x.pid === r.opened.pid)?.title || r.opened.title;
  const shot = (file) => { execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(import.meta.dirname, "window-shot.ps1"), String(r.opened.pid), file]); return createHash("sha1").update(readFileSync(file)).digest("hex"); };
  let previous = null;
  for (const [i, pg] of r.plan.pages.entries()) {
    // The tab is clicked again while the photo is still the previous page's (a lost click, or loading).
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (i > 0) {
        const snap = await desktopRequest("snapshot", { window: windowTitle, max: 700 });
        const ref = new RegExp(`\\[(d\\d+)\\] TabItem "${pg.displayName}"`).exec(snap.text || "")?.[1];
        if (ref) { await desktopRequest("click", { ref }); await new Promise((res) => setTimeout(res, 9000)); }
      }
      const hash = shot(join(shots, `pagina${i + 1}.png`));
      if (hash !== previous) { previous = hash; break; }
    }
    const screen = String((await desktopRequest("snapshot", { window: windowTitle, max: 700 })).text || "");
    const errors = screen.match(/(Não é possível exibir|Corrigir isto|Ver detalhes|campos? que não existe)[^"\n]*/gi) || [];
    check(`página ${pg.displayName} sem erro`, errors.length === 0, errors.slice(0, 3).join(" | "));
    shot(join(shots, `pagina${i + 1}.png`));
  }
} finally {
  stopDesktop();
  if (opened?.pid) { try { process.kill(opened.pid); } catch { /* closed */ } }
  stopPowerBi();
}
console.log(`\nNota: ${results.filter(Boolean).length}/${results.length}`);
process.exit(0);
