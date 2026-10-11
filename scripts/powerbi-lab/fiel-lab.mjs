// A cena é fiel aos dados? Para cada unidade do CD de teste: os caminhões desenhados (contados pelas classes
// do SVG que o motor calcula) = os cartões do modelo = o gabarito do gerador (mesma regra, calculada à
// parte). Com todas as unidades, o pátio não desenha nenhum caminhão. Foto da página. Fecha só o que abriu.
// node scripts/powerbi-lab/fiel-lab.mjs <pasta dos dados> <pasta das fotos>
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const { buildReport, openReports, pbiRequest, stopPowerBi } = await import("../../app/powerbi.js");

const [data, shots] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
const expected = JSON.parse(readFileSync(join(data, "esperado-logistica.json"), "utf8"));
const plan = { titulo: "Operação dos CDs", estilo: { tema: "claro", cor: "azul", tom: "sobrio" }, paginas: [
  { nome: "Pátio ao vivo", pergunta: "O que está em cada doca agora?", layout: "gemeo_digital", cena: "patio", numeros: ["Caminhões nas docas", "Caminhões na fila", "Caminhões em trânsito", "Atrasados agora"], blocos: [{ tipo: "detalhe_selecionado", medida: "", por: "", titulo: "" }, { tipo: "rastreamento", medida: "", por: "", titulo: "" }] },
] };
if ((await openReports()).length) { console.log("Já há um Power BI aberto: feche-o antes do teste."); process.exit(1); }
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };
const value = async (dax) => { const r = await pbiRequest("query", { dax: `EVALUATE ROW("v", ${dax})`, max: 2 }); return r.ok ? (r.text || "").split("\n").slice(2).join("\n").trim() : `ERRO ${r.error}`; };
let opened = null;
try {
  const r = await buildReport({ files: [join(data, "operacao_cd.xlsx")], folder: mkdtempSync(join(tmpdir(), "aurora-fiel-")), goal: "", conversationId: "fiel", planner: { ask: async () => ({ ok: true, text: JSON.stringify(plan) }), env: {} } }).catch((e) => { opened = e.opened; throw e; });
  opened = r.opened;
  const scene = r.plan.measureList.find((m) => /^Cena do pátio/.test(m.name)).name;
  const unit = "'Embarques'[CD]";
  for (const [u, want] of Object.entries(expected.units)) {
    const f = `${unit} = "${u}"`;
    const svg = await value(`CALCULATE([${scene}], ${f})`);
    writeFileSync(join(shots, `${u.replace(/\W+/g, "-")}.svg`), svg);
    const drawn = (where) => (svg.match(new RegExp(`class='v ${where}`, "g")) || []).length;
    const docksDrawn = Object.values(want.perDock).reduce((n, k) => n + Math.min(k, 3), 0);
    const cards = {};
    for (const [k, m] of [["doca", "Caminhões nas docas"], ["fila", "Caminhões na fila"], ["estrada", "Caminhões em trânsito"], ["patio", "Caminhões no pátio"]]) cards[k] = Number(await value(`CALCULATE([${m}], ${f})`));
    check(`${u}: cartões = gabarito`, cards.doca === want.doca && cards.fila === want.fila && cards.estrada === want.estrada && cards.patio === want.doca + want.fila, `docas ${cards.doca}/${want.doca}, fila ${cards.fila}/${want.fila}, estrada ${cards.estrada}/${want.estrada}, pátio ${cards.patio}`);
    check(`${u}: desenhados nas docas = dados`, drawn("doca") === docksDrawn, `${drawn("doca")} desenhados, ${want.doca} nos dados (${JSON.stringify(want.perDock)})`);
    check(`${u}: desenhados na fila = dados`, drawn("fila") === Math.min(want.fila, 10) && (want.fila <= 10 || svg.includes("fora do desenho")), `${drawn("fila")} de ${want.fila}`);
    check(`${u}: desenhados na estrada = dados`, drawn("estrada") === Math.min(want.estrada, 8) && (want.estrada <= 8 || svg.includes("fora do desenho")), `${drawn("estrada")} de ${want.estrada}`);
    // A dock with two trucks says so on the plate ("+1").
    const two = Object.entries(want.perDock).find(([, k]) => k > 1);
    if (two) check(`${u}: ${two[0]} mostra os ${two[1]} caminhões`, svg.includes(` +${two[1] - 1}`), "");
  }
  const all = await value(`CALCULATE([${scene}], REMOVEFILTERS(${unit}))`);
  check("todas as unidades: o pátio pede uma e não desenha caminhões", /Escolha uma CD no filtro/.test(all) && !/class='v /.test(all));
  // The page opens on one unit (the slicer's default) and the picture.
  await new Promise((res) => setTimeout(res, 9000));
  execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(import.meta.dirname, "window-shot.ps1"), String(opened.pid), join(shots, "pagina1.png")]);
} finally {
  if (opened?.pid) { try { process.kill(opened.pid); } catch { /* closed */ } }
  stopPowerBi();
}
console.log(`\nNota: ${results.filter(Boolean).length}/${results.length}`);
process.exit(0);
