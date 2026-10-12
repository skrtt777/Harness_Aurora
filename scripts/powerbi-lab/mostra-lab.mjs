// "Aurora, mostra a doca 3": a ferramenta escreve o destaque no modelo aberto e a cena desenha o anel e a
// nota; uma atualização não apaga; um show vazio apaga. No Power BI de teste; fecha só o que abriu.
// node scripts/powerbi-lab/mostra-lab.mjs <pasta dos dados> <pasta das fotos>
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const { buildReport, openReports, pbiRequest, stopPowerBi } = await import("../../app/powerbi.js");
const { executeTool } = await import("../../app/agentTools/index.js");

const [data, shots] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
const plan = { titulo: "Operação dos CDs", estilo: { tema: "claro", cor: "azul", tom: "sobrio" }, paginas: [
  { nome: "Pátio ao vivo", pergunta: "O que está em cada doca agora?", layout: "gemeo_digital", cena: "patio", numeros: ["Caminhões nas docas", "Caminhões na fila"], blocos: [{ tipo: "rastreamento", medida: "", por: "", titulo: "" }] },
] };
if ((await openReports()).length) { console.log("Já há um Power BI aberto: feche-o antes do teste."); process.exit(1); }
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };
const value = async (dax) => { const r = await pbiRequest("query", { dax: `EVALUATE ROW("v", ${dax})`, max: 2 }); return r.ok ? (r.text || "").split("\n").slice(2).join("\n").trim() : `ERRO ${r.error}`; };
const ctx = { conversationId: "mostra", mode: "auto", approve: async () => true, request: "mostra a doca 3 no power bi", env: process.env };
let opened = null;
try {
  const r = await buildReport({ files: [join(data, "operacao_cd.xlsx")], folder: mkdtempSync(join(tmpdir(), "aurora-mostra-")), goal: "", conversationId: "mostra", planner: { ask: async () => ({ ok: true, text: JSON.stringify(plan) }), env: {} } }).catch((e) => { opened = e.opened; throw e; });
  opened = r.opened;
  const scene = r.plan.measureList.find((m) => /^Cena do pátio/.test(m.name)).name;
  const at = `CALCULATE([${scene}], 'Embarques'[CD] = "CD Contagem")`;
  const before = await value(at);
  check("sem destaque: nenhum anel da Aurora", !before.includes("B04BFF"));
  const shown = await executeTool("powerbi", { action: "show", values: ["Doca 03"], note: "Doca 03 com dois caminhões" }, ctx);
  check("a ferramenta destacou", shown.ok, String(shown.result || "").slice(0, 120));
  const svg = await value(at);
  writeFileSync(join(shots, "destaque.svg"), svg);
  check("a cena desenha o anel e a nota", (svg.match(/B04BFF/g) || []).length >= 2 && svg.includes("Aurora: Doca 03 com dois caminhões"));
  await pbiRequest("refresh", {}, 300_000);
  check("uma atualização não apaga o destaque", (await value(at)).includes("Aurora: Doca 03"));
  await new Promise((res) => setTimeout(res, 7000));
  execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(import.meta.dirname, "window-shot.ps1"), String(opened.pid), join(shots, "pagina-destaque.png")]);
  const cleared = await executeTool("powerbi", { action: "show", values: [] }, ctx);
  check("show vazio apaga", cleared.ok && !(await value(at)).includes("Aurora:"));
} finally {
  if (opened?.pid) { try { process.kill(opened.pid); } catch { /* closed */ } }
  stopPowerBi();
}
console.log(`\nNota: ${results.filter(Boolean).length}/${results.length}`);
process.exit(0);
