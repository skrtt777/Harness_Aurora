// Quanto cada cena e cada cartão demora com dados grandes (o Power BI desenha a cena a cada filtro: mais de
// alguns segundos e a página fica lenta). No Power BI de teste; fecha só o que abriu.
// node scripts/powerbi-lab/tempo-lab.mjs <arquivo> "<'Tabela'[Coluna]=valor>" [limite em s]
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { buildReport, openReports, pbiRequest, stopPowerBi } = await import("../../app/powerbi.js");

const [file, filter, limit = "5"] = process.argv.slice(2);
const [, ref, val] = /^(.+?)=(.+)$/.exec(filter);
if ((await openReports()).length) { console.log("Já há um Power BI aberto: feche-o antes do teste."); process.exit(1); }
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };
let opened = null;
try {
  const t0 = Date.now();
  const r = await buildReport({ files: [file], folder: mkdtempSync(join(tmpdir(), "aurora-tempo-")), goal: "", conversationId: "tempo" }).catch((e) => { opened = e.opened; throw e; });
  opened = r.opened;
  console.log(`  montado e carregado em ${((Date.now() - t0) / 1000).toFixed(0)} s — ${r.refreshed}`);
  const timed = async (name, dax) => {
    const t = Date.now();
    const q = await pbiRequest("query", { dax: `EVALUATE ROW("v", CALCULATE(${dax}, ${ref} = "${val}"))`, max: 2 }, 300_000);
    const s = (Date.now() - t) / 1000;
    check(`${name}`, q.ok && s <= Number(limit), q.ok ? `${s.toFixed(1)} s` : q.error.slice(0, 200));
  };
  for (const m of r.plan.measureList.filter((x) => x.category === "ImageUrl" && /^Cena|^Rastreamento|^Mapa|^Planta/.test(x.name))) await timed(m.name, `[${m.name}]`);
  for (const m of r.plan.measureList.filter((x) => /na fila|nas docas|nos caixas|no pátio|em trânsito|Atrasados agora/.test(x.name)).slice(0, 4)) await timed(m.name, `[${m.name}]`);
  // The parts: who is where (vehicleVars), against the whole picture.
  if (r.plan.flow?.place) {
    const { vehicleVars } = await import("../../app/powerbiScene.js");
    const { MOMENT } = await import("../../app/powerbiStory.js");
    const base = `FILTER(ALL('${r.plan.fact}'), ${ref} = "${val}")`;
    const t = Date.now();
    const q = await pbiRequest("query", { dax: `EVALUATE ROW("n", ${vehicleVars(r.plan.flow, base, r.plan.flow.timeline ? MOMENT : null).join("\n")}\nRETURN COUNTROWS(Veiculos))`, max: 2 }, 300_000);
    console.log(`  (quem está onde: ${((Date.now() - t) / 1000).toFixed(1)} s — ${q.ok ? q.text.split("\n")[2] : q.error.slice(0, 150)})`);
  }
  const px = r.plan.measureList.find((x) => x.name === "Posição X na cena");
  if (px) {
    const key = r.plan.flow?.asset || r.plan.flow?.id;
    const t = Date.now();
    const q = await pbiRequest("query", { dax: `EVALUATE CALCULATETABLE(FILTER(ADDCOLUMNS(VALUES('${r.plan.fact}'[Na cena]), "x", [Posição X na cena]), NOT ISBLANK([x])), ${ref} = "${val}")`, max: 200 }, 300_000);
    const s = (Date.now() - t) / 1000;
    check("pontos de clique (um por desenhado)", q.ok && s <= Number(limit) * 2, q.ok ? `${s.toFixed(1)} s` : q.error.slice(0, 200));
  }
} finally {
  if (opened?.pid) { try { process.kill(opened.pid); } catch { /* closed */ } }
  stopPowerBi();
}
console.log(`\nNota: ${results.filter(Boolean).length}/${results.length}`);
process.exit(0);
