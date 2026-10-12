// O clique num caminhão da cena: cada um desenhado tem o seu ponto (no lugar em que está), um ponto por
// desenhado; clicar nele seleciona o caminhão e o cartão de detalhe mostra ele. No Power BI de teste.
// node scripts/powerbi-lab/clique-lab.mjs <pasta dos dados> <pasta das fotos>
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const { buildReport, openReports, pbiRequest, stopPowerBi } = await import("../../app/powerbi.js");
const { desktopRequest, stopDesktop } = await import("../../app/desktop.js");

const [data, shots] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
const plan = { titulo: "Operação dos CDs", estilo: { tema: "escuro", cor: "azul", tom: "tecnico" }, paginas: [
  { nome: "Pátio ao vivo", pergunta: "Onde está cada caminhão?", layout: "gemeo_digital", cena: "patio", numeros: ["Caminhões nas docas", "Caminhões na fila"], blocos: [{ tipo: "detalhe_selecionado" }, { tipo: "tabela_andamento" }] },
] };
if ((await openReports()).length) { console.log("Já há um Power BI aberto: feche-o antes do teste."); process.exit(1); }
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };
const rows = async (dax) => { const r = await pbiRequest("query", { dax, max: 200 }); return r.ok ? r.text.split("\n").slice(2).filter(Boolean).map((l) => l.split(" | ")) : (console.log(r.error), []); };
let opened = null;
try {
  const r = await buildReport({ files: [join(data, "operacao_cd.xlsx")], folder: mkdtempSync(join(tmpdir(), "aurora-clique-")), goal: "", conversationId: "clique", planner: { ask: async () => ({ ok: true, text: JSON.stringify(plan) }), env: {} } }).catch((e) => { opened = e.opened; throw e; });
  opened = r.opened;
  const pts = await rows(`EVALUATE CALCULATETABLE(FILTER(ADDCOLUMNS(VALUES('Embarques'[Na cena]), "x", [Posição X na cena], "y", [Posição Y na cena]), NOT ISBLANK([x])), 'Embarques'[CD] = "CD Betim")`);
  const drawn = await rows(`EVALUATE ROW("n", CALCULATE([Caminhões nas docas] + [Caminhões na fila] + [Caminhões em trânsito], 'Embarques'[CD] = "CD Betim"))`);
  check("um ponto em cada caminhão desenhado", pts.length === Number(drawn[0]?.[0]), `${pts.length} pontos, ${drawn[0]?.[0]} caminhões`);
  check("cada ponto num lugar diferente", new Set(pts.map(([, x, y]) => `${x},${y}`)).size === pts.length);
  // The card with one truck chosen (as a click does).
  const plate = pts[0]?.[0] || "";
  const card = await rows(`EVALUATE ROW("v", CALCULATE([Detalhe selecionado], 'Embarques'[Placa] = "${plate}", 'Embarques'[CD] = "CD Betim"))`);
  check(`o cartão mostra o caminhão escolhido (${plate})`, String(card[0]?.[0] || "").includes(plate));
  // A real click on one truck's point, through the accessibility tree of the window (the test's own window).
  await new Promise((res) => setTimeout(res, 8000));
  const title = (await openReports()).find((x) => x.pid === opened.pid)?.title;
  const snap = String((await desktopRequest("snapshot", { window: title, max: 2500 })).text || "");
  const ref = new RegExp(`\\[(d\\d+)\\][^\\n]*${plate.replace(/[-]/g, "\\-")}`).exec(snap)?.[1];
  console.log(`  ponto do ${plate} na janela: ${ref || "não achado"}`);
  // Without the point in the accessibility tree: the scene's box on the screen (Windows says where the
  // visual is), and the point's place in it (the picture's units, y from the bottom).
  if (!ref) {
    const scene = r.plan.pages[0];
    const found = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(import.meta.dirname, "window-find.ps1"), String(opened.pid), "Docas e caminhões"], { encoding: "utf8" });
    console.log(`  ${found.trim().split("\n").join("\n  ")}`);
    const box = found.trim().split("\n").map((l) => l.split(" | ")[0].split(" ").map(Number)).sort((a, b) => b[2] * b[3] - a[2] * a[3])[0];
    const w = Number(r.plan.measureList.length ? 0 : 0) || null; void w; void scene;
    const num = (v) => Number(String(v).replace(/\./g, '').replace(',', '.'));
    const [px, py] = [num(pts[0][1]), num(pts[0][2])];
    const dims = await rows(`EVALUATE ROW("w", 1)`); void dims;
    const vb = /viewBox='([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)'/.exec(String((await rows(`EVALUATE ROW("v", CALCULATE([Cena do pátio], 'Embarques'[CD] = "CD Betim"))`))[0]?.[0] || ""));
    if (box && vb) {
      // The visual's title takes the top of the box: the picture is below it.
      const [bx, by, bw, bh] = box; const title = 34;
      const sx = Math.round(bx + (Number(px) / Number(vb[3])) * bw);
      const sy = Math.round(by + title + (1 - Number(py) / Number(vb[4])) * (bh - title));
      console.log(`  clicando em ${sx},${sy} (caixa ${box.join(" ")})`);
      execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(import.meta.dirname, "window-click.ps1"), String(opened.pid), String(sx), String(sy)]);
      await new Promise((res) => setTimeout(res, 2500));
      execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(import.meta.dirname, "window-click.ps1"), String(opened.pid), String(sx), String(sy)]);
      await new Promise((res) => setTimeout(res, 5000));
      execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(import.meta.dirname, "window-shot.ps1"), String(opened.pid), join(shots, "depois-do-clique.png")]);
      const after = String((await desktopRequest("snapshot", { window: title, max: 2500 })).text || "");
      const card2 = String((await rows(`EVALUATE ROW("v", 1)`))[0] || ""); void card2;
      check("depois do clique a janela mostra o caminhão escolhido", after.includes(plate), "(veja depois-do-clique.png)");
    }
  }
  if (ref) {
    await desktopRequest("click", { ref });
    await new Promise((res) => setTimeout(res, 5000));
    execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(import.meta.dirname, "window-shot.ps1"), String(opened.pid), join(shots, "depois-do-clique.png")]);
    const after = String((await desktopRequest("snapshot", { window: title, max: 2500 })).text || "");
    check("depois do clique a página está filtrada no caminhão", new RegExp(`${plate}`).test(after) && !/Clique num caminhão/.test(after), "(veja depois-do-clique.png)");
  }
} finally {
  stopDesktop();
  if (opened?.pid) { try { process.kill(opened.pid); } catch { /* closed */ } }
  stopPowerBi();
}
console.log(`\nNota: ${results.filter(Boolean).length}/${results.length}`);
process.exit(0);
