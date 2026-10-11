// O BI completo de ponta a ponta: planilha -> projeto .pbip -> Power BI Desktop aberto, atualizado e
// conferido (números dos cartões contra os esperados, visuais na tela). Só com nenhum Power BI aberto
// antes; fecha só o que abriu. node scripts/powerbi-lab/build-lab.mjs <pasta dos dados> [vendas|chamados]
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { buildReport, openReports, pbiRequest, stopPowerBi } = await import("../../app/powerbi.js");
const { desktopRequest, stopDesktop } = await import("../../app/desktop.js");

const data = process.argv[2];
const which = process.argv[3] || "vendas";
const expected = JSON.parse(readFileSync(join(data, "esperado.json"), "utf8"));
if ((await openReports()).length) { console.log("Já há um Power BI aberto: feche-o antes do teste."); process.exit(1); }
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };
const num = (s) => Number(String(s).replace(/R\$\s*/, "").replace(/\./g, "").replace(",", "."));
const out = mkdtempSync(join(tmpdir(), "aurora-pbi-"));
let opened = null;
try {
  const started = Date.now();
  const file = which === "vendas" ? join(data, "vendas_padarias.xlsx") : join(data, "chamados_suporte.csv");
  const r = await buildReport({ files: [file], folder: out, conversationId: "lab", onStage: (s) => console.log(`  … ${s}`) });
  opened = r.opened;
  console.log(`  (${((Date.now() - started) / 1000).toFixed(0)} s) ${r.pbip}`);
  check("abriu no Power BI", Boolean(r.opened?.port), r.opened?.title);
  check("carregou os dados", which === "vendas" ? /Vendas 1480/.test(r.refreshed) && /Produtos 10/.test(r.refreshed) && /Calendário \d{3}/.test(r.refreshed) : /Chamados.suporte 300/.test(r.refreshed), r.refreshed);
  const kpi = r.checks.split("\n")[2]?.split(" | ") || [];
  console.log(`  cartões: ${r.checks.split("\n").slice(1, 3).join(" ⏎ ")}`);
  if (which === "vendas") {
    check("faturamento confere", Math.abs(num(kpi[0]) - expected.vendas.total) < 0.05, `${kpi[0]} x ${expected.vendas.total}`);
    check("pedidos conferem", num(kpi[1]) === expected.vendas.orders, `${kpi[1]} x ${expected.vendas.orders}`);
    const extra = await pbiRequest("query", { dax: "EVALUATE ROW(\"lucro\", [Lucro], \"margem\", [Margem %], \"ano\", CALCULATE([Faturamento], 'Calendário'[Ano] = 2026), \"anterior\", CALCULATE([Faturamento ano anterior], 'Calendário'[Ano] = 2026))", max: 2 });
    console.log(`  ${extra.text || extra.error}`);
    const v = (extra.text || "").split("\n")[2]?.split(" | ") || [];
    check("lucro = faturamento - custo", Math.abs(num(v[0]) - (expected.vendas.total - expected.vendas.cost)) < 0.05, `${v[0]}`);
    check("ano anterior funciona", num(v[3]) > 0 && num(v[3]) < num(v[2]) * 2, `${v[2]} x ${v[3]}`);
    const cat = await pbiRequest("query", { dax: "EVALUATE SUMMARIZECOLUMNS(Produtos[Categoria], \"v\", [Faturamento]) ORDER BY [v] DESC", max: 10 });
    check("relação produtos → vendas filtra", (cat.text || "").split("\n").length >= 6 && /Bolos|Pães|Salgados/.test(cat.text), (cat.text || cat.error).replace(/\n/g, " ⏎ ").slice(0, 160));
  } else {
    check("chamados conferem", num(kpi[1]) === expected.chamados.tickets, `${kpi[1]} x ${expected.chamados.tickets}`);
  }
  // The report on screen: the cards and the titles, read from the window.
  await new Promise((res) => setTimeout(res, 5000));
  const windowTitle = (await openReports()).find((x) => x.pid === r.opened.pid)?.title || r.opened.title;
  console.log(`  janela: ${windowTitle}`);
  let snap = await desktopRequest("snapshot", { window: windowTitle, max: 500 });
  const tab = /\[(d\d+)\] TabItem "Exibição de relatório"/.exec(snap.text || "")?.[1];
  if (tab && !/Exibição de relatório" \(selecionado\)/.test(snap.text)) { await desktopRequest("click", { ref: tab }); await new Promise((res) => setTimeout(res, 6000)); snap = await desktopRequest("snapshot", { window: windowTitle, max: 500 }); }
  const screen = String(snap.text || "");
  const titles = r.plan.pages[0].visuals.filter((v) => v.title && v.type !== "slicer").map((v) => v.title);
  const shown = titles.filter((t) => screen.includes(`"${t}`));
  check("visuais da visão geral na tela", shown.length >= titles.length - 1, `${shown.length}/${titles.length}: faltam ${titles.filter((t) => !shown.includes(t)).join(", ") || "nenhum"}`);
  check("título do painel na tela", screen.includes(r.plan.name), r.plan.name);
  const errors = screen.match(/(Não é possível exibir|Erro|Corrigir isto|Ver detalhes|campos? que não existe)[^"\n]*/gi) || [];
  check("sem erro nos visuais", errors.length === 0, errors.slice(0, 3).join(" | "));
  const cards = [...screen.matchAll(/Image "([^"]*R\$[^"]*)"/g)].map((m) => m[1]).slice(0, 4);
  console.log(`  na tela: ${cards.join(" | ")}`);
  if (process.argv.includes("--foto")) {
    // A picture of the test window only, for a look at the design; then it is closed like the rest.
    const { execFileSync } = await import("node:child_process");
    for (const [i, page] of r.plan.pages.entries()) {
      if (i > 0) {
        const s2 = await desktopRequest("snapshot", { window: windowTitle, max: 700 });
        const ref = new RegExp(`\\[(d\\d+)\\] TabItem "${page.displayName}"`).exec(s2.text || "")?.[1];
        if (!ref) console.log(`  (aba ${page.displayName} não encontrada)`);
        if (ref) { await desktopRequest("click", { ref }); await new Promise((res) => setTimeout(res, 5000)); }
      }
      const png = join(process.argv[process.argv.indexOf("--foto") + 1], `pagina${i + 1}.png`);
      execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(import.meta.dirname, "window-shot.ps1"), String(r.opened.pid), png]);
      console.log(`  foto: ${png}`);
    }
  }
} finally {
  stopDesktop();
  // Every Power BI open now was opened by this test (none was open before it started).
  for (const r of await openReports().catch(() => [])) { try { process.kill(r.pid); } catch { /* closed */ } }
  if (opened?.pid) { try { process.kill(opened.pid); } catch { /* closed */ } }
  stopPowerBi();
}
console.log(`\nNota: ${results.filter(Boolean).length}/${results.length}`);
process.exit(0);
