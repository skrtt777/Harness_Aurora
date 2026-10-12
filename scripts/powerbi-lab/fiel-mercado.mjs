// A cena do mercado é fiel aos dados, em qualquer momento? Para cada loja, agora e há 2 h: os clientes
// desenhados em atendimento e na fila de cada caixa (classes do SVG) = os cartões = o gabarito calculado
// aqui dos horários da planilha (chegada, início, fim) no mesmo instante do motor. Daqui 1 h: a cena diz
// "PREVISÃO" e mostra fantasmas. Foto da página. Fecha só o que abriu.
// node scripts/powerbi-lab/fiel-mercado.mjs <pasta dos dados> <pasta das fotos>
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const { buildReport, openReports, pbiRequest, stopPowerBi } = await import("../../app/powerbi.js");
const { readSources } = await import("../../app/powerbiDesign.js");

const [data, shots] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
const file = join(data, "caixas_mercado.xlsx");
const plan = { titulo: "Caixas das lojas", estilo: { tema: "claro", cor: "verde", tom: "acolhedor" }, paginas: [
  { nome: "Caixas agora", pergunta: "Quantos clientes em cada caixa e na fila?", layout: "gemeo_digital", cena: "operacao", numeros: ["Clientes nos caixas", "Clientes na fila", "Clientes no local"], blocos: [{ tipo: "rastreamento", medida: "", por: "", titulo: "" }] },
] };
if ((await openReports()).length) { console.log("Já há um Power BI aberto: feche-o antes do teste."); process.exit(1); }
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };
const value = async (dax) => { const r = await pbiRequest("query", { dax: `EVALUATE ROW("v", ${dax})`, max: 2 }); return r.ok ? (r.text || "").split("\n").slice(2).join("\n").trim() : `ERRO ${r.error}`; };
// The spreadsheet's times, read the way the BI reads them (to the minute).
const [sheet] = readSources(file);
const idx = (name) => sheet.header.indexOf(name);
const time = (s) => { const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/.exec(String(s || "")); return m ? new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]).getTime() : null; };
const people = sheet.rows.map((r) => ({ store: r[idx("Loja")], till: r[idx("Caixa")], arrive: time(r[idx("Hora de chegada")]), start: time(r[idx("Início do atendimento")]), end: time(r[idx("Fim do atendimento")]) }));
const answer = (store, at) => {
  const perTill = {}; let serving = 0; let waiting = 0;
  for (const p of people.filter((x) => x.store === store && x.arrive !== null && x.arrive <= at)) {
    if (p.end !== null && p.end <= at) continue;
    const t = (perTill[p.till] ||= { n: 0, f: 0 });
    if (p.start !== null && p.start <= at) { t.n += 1; serving += 1; } else { t.f += 1; waiting += 1; }
  }
  return { serving, waiting, perTill };
};
let opened = null;
try {
  const r = await buildReport({ files: [file], folder: mkdtempSync(join(tmpdir(), "aurora-mercado-")), goal: "", conversationId: "mercado", planner: { ask: async () => ({ ok: true, text: JSON.stringify(plan) }), env: {} } }).catch((e) => { opened = e.opened; throw e; });
  opened = r.opened;
  const scene = r.plan.measureList.find((m) => /^Cena d[oa] (pátio|operação)/.test(m.name)).name;
  for (const offset of [0, -120]) {
    const nowText = await value("FORMAT(NOW(), \"yyyy-mm-dd HH:nn:ss\")");
    const [d, t] = nowText.split(" "); const [Y, M, Dd] = d.split("-").map(Number); const [hh, mm, ss] = t.split(":").map(Number);
    const at = new Date(Y, M - 1, Dd, hh, mm, ss).getTime() + offset * 60_000;
    for (const store of ["Loja Centro", "Loja Bairro"]) {
      const want = answer(store, at);
      const f = `'Atendimentos'[Loja] = "${store}", 'Momento'[Minutos] = ${offset}`;
      const svg = await value(`CALCULATE([${scene}], ${f})`);
      writeFileSync(join(shots, `${store.replace(/\W+/g, "-")}${offset}.svg`), svg);
      const drawn = (where) => (svg.match(new RegExp(`class='v ${where}'`, "g")) || []).length;
      const wantServed = Object.values(want.perTill).reduce((n, x) => n + Math.min(x.n, 3), 0);
      const wantLine = Object.values(want.perTill).reduce((n, x) => n + Math.min(x.f, 4), 0);
      const cards = { caixas: Number(await value(`CALCULATE([Clientes nos caixas], ${f})`)), fila: Number(await value(`CALCULATE([Clientes na fila], ${f})`)) };
      const when = offset ? `há ${-offset / 60} h` : "agora";
      check(`${store} ${when}: cartões = gabarito`, cards.caixas === want.serving && cards.fila === want.waiting, `nos caixas ${cards.caixas}/${want.serving}, na fila ${cards.fila}/${want.waiting}`);
      check(`${store} ${when}: desenhados = dados`, drawn("doca") === wantServed && drawn("filalocal") === wantLine && drawn("fila") === 0, `atendimento ${drawn("doca")}/${wantServed}, filas dos caixas ${drawn("filalocal")}/${wantLine} (o resto escrito como +N)`);
      const extra = Object.values(want.perTill).reduce((n, x) => n + Math.max(0, x.f - 4), 0);
      if (extra) check(`${store} ${when}: o que não cabe está escrito`, /\+\d/.test(svg), `${extra} além das 4 de cada fila`);
      if (offset < 0) check(`${store} ${when}: a cena diz que é reprise`, svg.includes("REPRISE"));
    }
  }
  const ahead = await value(`CALCULATE([${scene}], 'Atendimentos'[Loja] = "Loja Centro", 'Momento'[Minutos] = 60)`);
  check("daqui 1 h: a cena diz previsão e mostra fantasmas", ahead.includes("PREVISÃO") && /opacity='0.5'/.test(ahead));
  await new Promise((res) => setTimeout(res, 9000));
  execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(import.meta.dirname, "window-shot.ps1"), String(opened.pid), join(shots, "pagina1.png")]);
} finally {
  if (opened?.pid) { try { process.kill(opened.pid); } catch { /* closed */ } }
  stopPowerBi();
}
console.log(`\nNota: ${results.filter(Boolean).length}/${results.length}`);
process.exit(0);
