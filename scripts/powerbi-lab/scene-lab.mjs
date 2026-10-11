// O BI com cena de ponta a ponta: dados do CD -> projeto .pbip -> Power BI Desktop de teste aberto e
// atualizado; confere os números da operação, grava cada cena que o motor calculou (SVG -> PNG) e tira a
// foto de cada página. Só com nenhum Power BI aberto antes; fecha só o que abriu.
// node scripts/powerbi-lab/scene-lab.mjs <pasta dos dados> <pasta das fotos> [--manter]
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const { buildReport, openReports, pbiRequest, stopPowerBi } = await import("../../app/powerbi.js");
const { desktopRequest, stopDesktop } = await import("../../app/desktop.js");

const [data, shots] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
const expected = JSON.parse(readFileSync(join(data, "esperado-logistica.json"), "utf8"));
if ((await openReports()).length) { console.log("Já há um Power BI aberto: feche-o antes do teste."); process.exit(1); }
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };
const value = async (dax) => { const r = await pbiRequest("query", { dax: `EVALUATE ROW("v", ${dax})`, max: 2 }); if (!r.ok) return { error: r.error }; return { text: (r.text || "").split("\n").slice(2).join("\n").trim() }; };
const out = mkdtempSync(join(tmpdir(), "aurora-cena-"));
let opened = null;
try {
  const started = Date.now();
  const r = await buildReport({ files: [join(data, "operacao_cd.xlsx")], folder: out, name: "Operação do CD Contagem", goal: "acompanhar o pátio do CD: caminhões nas docas, rastreamento das entregas e atrasos", conversationId: "cena", onStage: (s) => console.log(`  … ${s}`) }).catch((e) => { opened = e.opened; throw e; });
  opened = r.opened;
  console.log(`  (${((Date.now() - started) / 1000).toFixed(0)} s) ${r.pbip}\n  ${r.refreshed}`);
  check("abriu e carregou", /Embarques 533/.test(r.refreshed), r.refreshed);
  const num = (s) => Number(String(s).replace(/\./g, "").replace(",", "."));
  const checks = [
    ["em andamento", "[Em andamento]", expected.active],
    ["caminhões no pátio", "[Caminhões no pátio]", expected.atDocks + expected.waiting],
    ["entregas no prazo (x10000)", "ROUND([Entregas no prazo %] * 10000, 0)", Math.round(expected.onTimePct * 10000)],
  ];
  for (const [name, dax, want] of checks) { const v = await value(dax); check(name, !v.error && Math.abs(num(v.text) - want) < 0.0001, v.error || `${v.text} x ${want}`); }
  // Each picture as the engine draws it, to a file, and to PNG through the browser.
  const pictures = [["cena", "[Cena do pátio]"], ["rastreamento", "[Rastreamento]"], ["detalhe-vazio", "[Detalhe selecionado]"],
    ["detalhe-caminhao", "CALCULATE([Detalhe selecionado], 'Embarques'[Placa] = \"RTA-4B21\")"], ["rastreamento-caminhao", "CALCULATE([Rastreamento], 'Embarques'[Placa] = \"RTA-4B21\")"],
    ["progresso", "CALCULATE([Progresso], 'Embarques'[Placa] = \"RTA-4B21\")"]];
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 640 } });
  for (const [name, dax] of pictures) {
    const v = await value(dax);
    const url = v.text || "";
    const ok = url.startsWith("data:image/svg+xml;utf8,<svg");
    check(`imagem ${name}`, ok, v.error ? v.error.slice(0, 300) : `${url.length} caracteres`);
    if (!ok) continue;
    const svg = decodeURIComponent(url.slice("data:image/svg+xml;utf8,".length).replace(/%(?![0-9A-F]{2})/gi, "%25"));
    writeFileSync(join(shots, `${name}.svg`), svg);
    await page.setContent(`<body style="margin:0;background:#0B1220"><img id="i" style="width:100%" src="${url.replace(/"/g, "&quot;")}"></body>`);
    const box = await page.$("#i");
    const loaded = await page.evaluate(() => document.getElementById("i").naturalWidth > 0);
    check(`imagem ${name} abre como SVG`, loaded);
    if (loaded) await box.screenshot({ path: join(shots, `${name}.png`) });
  }
  await browser.close();
  // The report on screen: no visual in error; a picture of each page.
  await new Promise((res) => setTimeout(res, 6000));
  const windowTitle = (await openReports()).find((x) => x.pid === r.opened.pid)?.title || r.opened.title;
  for (const [i, pg] of r.plan.pages.entries()) {
    const snap = await desktopRequest("snapshot", { window: windowTitle, max: 700 });
    if (i > 0) {
      const ref = new RegExp(`\\[(d\\d+)\\] TabItem "${pg.displayName}"`).exec(snap.text || "")?.[1];
      if (ref) { await desktopRequest("click", { ref }); await new Promise((res) => setTimeout(res, 6000)); }
    }
    const screen = String((await desktopRequest("snapshot", { window: windowTitle, max: 700 })).text || "");
    const errors = screen.match(/(Não é possível exibir|Corrigir isto|Ver detalhes|campos? que não existe)[^"\n]*/gi) || [];
    check(`página ${pg.displayName} sem erro`, errors.length === 0, errors.slice(0, 3).join(" | "));
    execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(import.meta.dirname, "window-shot.ps1"), String(r.opened.pid), join(shots, `pagina${i + 1}.png`)]);
    if (i === 0) {
      // A click on a truck of the table: the detail and the tracker follow it (cross-filtering).
      const cell = /\[(d\d+)\] [A-Za-z]+ "FGH-7D34"/.exec(screen)?.[1];
      check("caminhão na tabela", Boolean(cell));
      if (cell) {
        await desktopRequest("click", { ref: cell });
        await new Promise((res) => setTimeout(res, 5000));
        execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(import.meta.dirname, "window-shot.ps1"), String(r.opened.pid), join(shots, "pagina1-selecao.png")]);
        await desktopRequest("click", { ref: cell });
        await new Promise((res) => setTimeout(res, 2000));
      }
    }
  }
  if (process.argv.includes("--manter")) { console.log(`  Power BI de teste aberto (pid ${r.opened.pid}, porta ${r.opened.port}).`); opened = null; }
} finally {
  stopDesktop();
  if (opened?.pid) { try { process.kill(opened.pid); } catch { /* closed */ } }
  stopPowerBi();
}
console.log(`\nNota: ${results.filter(Boolean).length}/${results.length}`);
process.exit(0);
