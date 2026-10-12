// "O que mudou": o BI do CD aberto no Power BI de teste; a planilha (uma cópia) muda — um caminhão sai da fila
// para uma doca, outro na estrada passa do prazo —; a atualização automática da Aurora percebe, escreve a nota
// em 'Notas da Aurora' e levanta o alerta. Fecha só o que abriu.
// node scripts/powerbi-lab/mudou-lab.mjs <pasta dos dados> <pasta das fotos>
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const { buildReport, openReports, pbiRequest, refreshDue, stopPowerBi } = await import("../../app/powerbi.js");
const { biEvents } = await import("../../app/powerbiChanges.js");
const { readSources } = await import("../../app/powerbiDesign.js");
const { makeXlsx } = await import("../../app/sampleDocs.js");

const [data, shots] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "aurora-mudou-"));
const file = join(work, "operacao_cd.xlsx");
copyFileSync(join(data, "operacao_cd.xlsx"), file);
const plan = { titulo: "Operação dos CDs", estilo: { tema: "claro", cor: "azul", tom: "sobrio" }, paginas: [
  { nome: "Pátio ao vivo", pergunta: "O que está em cada doca agora?", layout: "gemeo_digital", cena: "patio", numeros: ["Caminhões nas docas", "Caminhões na fila", "Atrasados agora"], blocos: [{ tipo: "notas_aurora", medida: "", por: "", titulo: "" }, { tipo: "rastreamento", medida: "", por: "", titulo: "" }] },
] };
if ((await openReports()).length) { console.log("Já há um Power BI aberto: feche-o antes do teste."); process.exit(1); }
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };
const alerts = [];
biEvents.on("alert", (a) => alerts.push(a));
let opened = null;
try {
  const r = await buildReport({ files: [file], folder: mkdtempSync(join(tmpdir(), "aurora-mudou-pbi-")), goal: "", conversationId: "mudou", planner: { ask: async () => ({ ok: true, text: JSON.stringify(plan) }), env: {} } }).catch((e) => { opened = e.opened; throw e; });
  opened = r.opened;
  // The spreadsheet changes: a waiting truck (Contagem) goes to Doca 04; a truck on the road is past due.
  const sheets = readSources(file);
  const t = sheets.find((s) => s.sheet === "Embarques");
  const at = (n) => t.header.indexOf(n);
  const waiting = t.rows.find((row) => row[at("CD")] === "CD Contagem" && row[at("Status")] === "Pedido recebido" && row[at("Placa")] === "OPQ-1S11");
  waiting[at("Status")] = "Carregando"; waiting[at("Doca")] = "Doca 04";
  // One still on time (its forecast ahead): it becomes late now — a new late one.
  const ahead = (v) => { const [d, m, y] = String(v).split("/").map(Number); return new Date(y, m - 1, d).getTime() >= new Date().setHours(0, 0, 0, 0); };
  const road = t.rows.find((row) => row[at("CD")] === "CD Contagem" && row[at("Status")] === "Em trânsito" && ahead(row[at("Previsão de entrega")]));
  const yesterday = new Date(Date.now() - 86_400_000);
  road[at("Previsão de entrega")] = `${String(yesterday.getDate()).padStart(2, "0")}/${String(yesterday.getMonth() + 1).padStart(2, "0")}/${yesterday.getFullYear()}`;
  const num = (v) => (/^-?\d+(\.\d+)?$/.test(String(v)) ? Number(v) : v);
  writeFileSync(file, makeXlsx(Object.fromEntries(sheets.map((s) => [s.sheet, [s.header, ...s.rows.map((row) => row.map(num))]]))));
  const done = await refreshDue(Date.now() + 2 * 60_000);
  const note = done[0]?.note;
  console.log(`  nota: ${note?.text || "(nenhuma)"}`);
  check("a atualização percebeu a planilha", done[0]?.why === "arquivo" && done[0]?.ok);
  check("a nota diz quem mudou de lugar", /OPQ-1S11/.test(note?.text || "") || /OPQ-1S11/.test(JSON.stringify(note || {})));
  const table = await pbiRequest("query", { dax: "EVALUATE 'Notas da Aurora'", max: 10 });
  check("a nota está no relatório (Notas da Aurora)", table.ok && table.text.includes(note?.when || "???"), (table.text || table.error || "").split("\n").slice(2, 4).join(" / "));
  check("o alerta saiu (novo atrasado)", alerts.some((a) => /atrasad/i.test(`${a.title} ${a.body}`)), alerts.map((a) => a.title).join(" | "));
  // The scene: the one who moved has the dashed white ring; the queue shows how long each one waits.
  const scene = r.plan.measureList.find((m) => /^Cena do pátio/.test(m.name)).name;
  const svg = await pbiRequest("query", { dax: `EVALUATE ROW("v", CALCULATE([${scene}], 'Embarques'[CD] = "CD Contagem"))`, max: 2 });
  const text = String(svg.text || "");
  writeFileSync(join(shots, "cena-depois.svg"), decodeURIComponent(text.split("\n").slice(2).join("\n").replace(/^data:image\/svg\+xml;utf8,/, "").replace(/%(?![0-9A-F]{2})/gi, "%25")));
  check("a cena marca quem acabou de mudar (anel tracejado)", /stroke-dasharray='6 4'/.test(text), `${(text.match(/stroke-dasharray='6 4'/g) || []).length} marcados`);
  check("a fila mostra quanto cada um espera", /\d+ (min|h \d\d|d)</.test(text), (text.match(/>(\d+ (min|h \d\d|d))</g) || []).slice(0, 4).join(" "));
  await new Promise((res) => setTimeout(res, 8000));
  execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(import.meta.dirname, "window-shot.ps1"), String(opened.pid), join(shots, "pagina-notas.png")]);
} finally {
  if (opened?.pid) { try { process.kill(opened.pid); } catch { /* closed */ } }
  stopPowerBi();
}
console.log(`\nNota: ${results.filter(Boolean).length}/${results.length}`);
process.exit(0);
