// O estado do gêmeo (o JSON que o VR/Unreal lê) bate com o gerador: por unidade, quantos nas docas, na
// fila e na estrada, e quem está em cada doca. No Power BI de teste; fecha só o que abriu.
// node scripts/powerbi-lab/gemeo-lab.mjs <pasta dos dados> <saída.json>
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { buildReport, openReports, stopPowerBi, twinNow } = await import("../../app/powerbi.js");

const [data, out] = process.argv.slice(2);
const expected = JSON.parse(readFileSync(join(data, "esperado-logistica.json"), "utf8"));
const plan = { titulo: "Operação dos CDs", estilo: { tema: "claro", cor: "azul", tom: "sobrio" }, paginas: [
  { nome: "Pátio ao vivo", pergunta: "O que está em cada doca agora?", layout: "gemeo_digital", cena: "patio", numeros: ["Caminhões nas docas", "Caminhões na fila"], blocos: [] },
] };
if ((await openReports()).length) { console.log("Já há um Power BI aberto: feche-o antes do teste."); process.exit(1); }
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };
let opened = null;
try {
  const r = await buildReport({ files: [join(data, "operacao_cd.xlsx")], folder: mkdtempSync(join(tmpdir(), "aurora-gemeo-")), goal: "", conversationId: "gemeo", planner: { ask: async () => ({ ok: true, text: JSON.stringify(plan) }), env: {} } }).catch((e) => { opened = e.opened; throw e; });
  opened = r.opened;
  const state = await twinNow();
  writeFileSync(out, JSON.stringify(state, null, 2));
  check("estado de operação", state?.kind === "operacao" && state.version === 1, `${state?.units.length} unidades, ${state?.entities.length} entidades`);
  for (const [unit, e] of Object.entries(expected.units)) {
    const u = state.units.find((x) => x.name === unit);
    if (!u) { check(`${unit} no estado`, false); continue; }
    check(`${unit}: nas docas`, u.counts.serving === e.doca, `${u.counts.serving} de ${e.doca}`);
    check(`${unit}: na fila`, u.counts.waiting === e.fila, `${u.counts.waiting} de ${e.fila}`);
    check(`${unit}: na estrada`, u.counts.road === e.estrada, `${u.counts.road} de ${e.estrada}`);
    const per = Object.fromEntries(u.places.filter((p) => p.serving.length).map((p) => [p.name, p.serving.length]));
    check(`${unit}: quem em cada doca`, JSON.stringify(per) === JSON.stringify(e.perDock), JSON.stringify(per));
    check(`${unit}: docas livres também`, u.places.some((p) => !p.serving.length && !p.waiting.length), `${u.places.length} docas`);
  }
} finally {
  if (opened?.pid) { try { process.kill(opened.pid); } catch { /* closed */ } }
  stopPowerBi();
}
console.log(`\nNota: ${results.filter(Boolean).length}/${results.length}`);
process.exit(0);
