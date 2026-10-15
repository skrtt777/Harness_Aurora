// A real PowerPoint file from the document blocks (13/10/2026: "faça uma apresentação de 3 slides" was
// saved as a .docx, because write_document had no .pptx). Every # or ## heading starts a slide; bullets and
// paragraphs are its text, a table is a table. Master, layout and theme included: PowerPoint opens it.
// Charts are native PowerPoint charts with their data in an embedded workbook ("Editar dados" works), and
// KPI cards with charts on one slide make a dashboard (15/10: asked from the phone for charts and a
// dashboard, the Aurora spent 40 minutes writing tables that "simulate" a chart: it had no way to draw one).
import { makeXlsx, zipStore } from "./sampleDocs.js";
import { cellNumber, chartKind } from "./documentWriter.js";

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const W = 12192000, H = 6858000; // 16:9
const NAVY = "1B2A4A", ACCENT = "2F6FDB", SOFT = "5B6B85";

/** Blocks → slides: [{ title, items: [{ type, text } | { type: "table", rows }] }]. */
export function slidesOf(blocks) {
  const slides = [];
  let cur = null;
  for (const b of blocks) {
    if (b.type === "heading" && b.level <= 2) { cur = { title: b.text, items: [] }; slides.push(cur); continue; }
    if (!cur) { cur = { title: "", items: [] }; slides.push(cur); }
    if (b.type === "heading") cur.items.push({ type: "subhead", text: b.text });
    else cur.items.push(b);
  }
  // "## Gráfico de pizza do orçamento" over a plain table: the table is drawn as the chart the slide names.
  // The 4B wrote the heading and a table instead of the ```grafico block in 3 runs of 4 (15/10).
  for (const s of slides) {
    if (s.items.some((it) => it.type === "chart")) continue;
    const said = [s.title, ...s.items.filter((it) => it.type !== "table").map((it) => it.text)].join(" ");
    const named = fold(said).match(/\bgrafico(?:s)?\s+(?:de\s+)?(barras?|colunas?|linhas?|pizza|rosca|area|setores)\b|\b(pizza|rosca)\b/);
    const at = s.items.findIndex((it) => it.type === "table" && it.rows.length >= 3);
    if (!named || at < 0) continue;
    const rows = s.items[at].rows.filter((r) => !/^total\b/i.test(fold(r[0] ?? "")));
    try { chartData(rows); } catch { continue; }
    s.items[at] = { type: "chart", kind: chartKind(named[1] || named[2]), title: s.items[at].title && s.items[at].title !== s.title ? s.items[at].title : "", rows };
  }
  // A slide with too much text is split, so nothing runs off the page.
  const out = [];
  for (const s of slides) {
    // Charts and KPI cards take the space below the text: up to 4 charts on a slide, and on a slide with
    // a lot of text they go to the next one (a chart squeezed under 8 lines is unreadable).
    const visuals = s.items.filter((it) => it.type === "chart" || it.type === "kpis");
    const rest = s.items.filter((it) => it.type !== "chart" && it.type !== "kpis");
    const textLines = rest.reduce((n, it) => n + (it.type === "table" ? Math.min(it.rows.length, 12) + 1 : Math.ceil(String(it.text || "").length / 90)), 0);
    const groups = [];
    for (const v of visuals) {
      const g = groups.at(-1);
      if (g && (v.type === "kpis" ? !g.some((x) => x.type === "kpis") && !g.some((x) => x.type === "chart") : g.filter((x) => x.type === "chart").length < 4)) g.push(v); else groups.push([v]);
    }
    // With a lot of text, the slide keeps its cards and charts (a dashboard is the visual) and the text
    // goes on to the next one: the other way left a slide of two bullets and the chart one after (15/10).
    let textTitle = s.title, visualsFirst = false;
    if (groups.length && textLines <= 4) { s.items = [...rest, ...groups[0]]; groups.shift(); }
    else { if (groups.length) { out.push({ title: s.title, items: groups.shift() }); textTitle = s.title ? `${s.title} (cont.)` : ""; visualsFirst = true; } s.items = rest; }
    if (visualsFirst && !s.items.length) { for (const g of groups) out.push({ title: s.title ? `${s.title} (cont.)` : "", items: g }); continue; }
    let part = { title: textTitle, items: [] }, lines = 0;
    for (const it of s.items) {
      if (it.type === "chart" || it.type === "kpis") { part.items.push(it); continue; }
      const cost = it.type === "table" ? Math.min(it.rows.length, 12) + 1 : Math.ceil(String(it.text || "").length / 90);
      if (lines && lines + cost > 11) { out.push(part); part = { title: `${s.title} (cont.)`, items: [] }; lines = 0; }
      part.items.push(it.type === "table" ? { ...it, rows: it.rows.slice(0, 13) } : it);
      lines += cost;
    }
    out.push(part);
    for (const g of groups) out.push({ title: s.title ? `${s.title} (cont.)` : "", items: g });
  }
  return out.filter((s) => s.title || s.items.length);
}

const run = (text, { size = 2000, bold = false, color = NAVY } = {}) => `<a:r><a:rPr lang="pt-BR" sz="${size}"${bold ? ' b="1"' : ""} dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Segoe UI"/></a:rPr><a:t>${esc(text)}</a:t></a:r>`;
const shape = (id, name, x, y, w, h, body) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" rIns="0"><a:normAutofit/></a:bodyPr><a:lstStyle/>${body}</p:txBody></p:sp>`;

function tableFrame(id, rows, y) {
  const cols = Math.max(...rows.map((r) => r.length));
  const colW = Math.floor((W - 1219200) / cols);
  const rowH = 370840;
  const cell = (text, head) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p>${run(text, { size: 1400, bold: head, color: head ? "FFFFFF" : NAVY })}</a:p></a:txBody><a:tcPr><a:lnL w="6350"><a:solidFill><a:srgbClr val="D5DBE5"/></a:solidFill></a:lnL><a:lnR w="6350"><a:solidFill><a:srgbClr val="D5DBE5"/></a:solidFill></a:lnR><a:lnT w="6350"><a:solidFill><a:srgbClr val="D5DBE5"/></a:solidFill></a:lnT><a:lnB w="6350"><a:solidFill><a:srgbClr val="D5DBE5"/></a:solidFill></a:lnB><a:solidFill><a:srgbClr val="${head ? ACCENT : "FFFFFF"}"/></a:solidFill></a:tcPr></a:tc>`;
  const body = rows.map((r, i) => `<a:tr h="${rowH}">${Array.from({ length: cols }, (_, j) => cell(r[j] ?? "", i === 0)).join("")}</a:tr>`).join("");
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Tabela ${id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="609600" y="${y}"/><a:ext cx="${colW * cols}" cy="${rowH * rows.length}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"/><a:tblGrid>${Array.from({ length: cols }, () => `<a:gridCol w="${colW}"/>`).join("")}</a:tblGrid>${body}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

const SERIES = [ACCENT, "1E9E62", "E8772E", "7A4FD6", "0F9AA0", "C99A2E", "D9467A", "5B6B85"];
const C_NS = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const colName = (j) => String.fromCharCode(65 + j);
const textProps = (size, color = SOFT) => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Segoe UI"/></a:defRPr></a:pPr><a:endParaRPr lang="pt-BR"/></a:p></c:txPr>`;

/** A chart's table as categories (first column) and numeric series (the other columns that hold numbers). */
export function chartData(input) {
  // The names in a column that is not the first ("| Funcionários | Departamento |"): moved to the front.
  const isNum = (v) => cellNumber(String(v ?? "").replace(/\s*[a-zA-Z%]+$/, "")) !== null;
  const textCol = input[0].findIndex((_, j) => input.slice(1).every((r) => !isNum(r[j])));
  const rows = textCol > 0 ? input.map((r) => [r[textCol], ...r.filter((_, j) => j !== textCol)]) : input;
  const [head, ...body] = rows;
  const categories = body.map((r) => String(r[0] ?? ""));
  const series = head.slice(1).map((name, k) => ({ name: String(name || `Série ${k + 1}`), values: body.map((r) => cellNumber(String(r[k + 1] ?? "").replace(/\s*[a-zA-Z%]+$/, "")) ?? cellNumber(r[k + 1]) ) }))
    .filter((s) => s.values.some((v) => v !== null));
  if (!categories.length || !series.length) throw new Error(`O gráfico precisa de uma tabela com a primeira coluna de nomes e pelo menos uma coluna de números (ex.: "| Mês | Vendas |\\n| Jan | 120 |"). Recebi: ${rows.slice(0, 3).map((r) => `| ${r.join(" | ")} |`).join(" ") || "(nenhuma linha de tabela dentro do bloco)"}.`);
  return { categories, series: series.map((s) => ({ ...s, values: s.values.map((v) => v ?? 0) })) };
}

/** The chart part (c:chartSpace) for a chart block; its data also goes to the embedded workbook Plan1. */
function chartXml({ kind, title }, { categories, series }) {
  const n = categories.length;
  const strCache = (vals) => `<c:strCache><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join("")}</c:strCache>`;
  const numCache = (vals) => `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join("")}</c:numCache>`;
  const pie = kind === "pie" || kind === "doughnut";
  // Whole numbers of thousands with the separator ("2.800.000"); the rest as written ("98,3"). "#,##0.##"
  // left a comma on whole numbers in Portuguese ("56,").
  const fmt = series.every((s) => s.values.every(Number.isInteger)) && series.some((s) => s.values.some((v) => Math.abs(v) >= 1000)) ? "#,##0" : "General";
  const fill = (color) => `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>${kind === "line" ? `<a:ln w="31750"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln>` : ""}</c:spPr>`;
  const labels = `<c:dLbls><c:numFmt formatCode="${fmt}" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${textProps(1100, NAVY)}${kind === "pie" ? '<c:dLblPos val="bestFit"/>' : kind === "line" ? '<c:dLblPos val="t"/>' : ""}<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>`;
  const ser = (s, k) => {
    const col = colName(k + 1);
    const points = pie ? s.values.map((_, i) => `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="${SERIES[i % SERIES.length]}"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt>`).join("") : "";
    return `<c:ser><c:idx val="${k}"/><c:order val="${k}"/><c:tx><c:strRef><c:f>Plan1!$${col}$1</c:f>${strCache([s.name])}</c:strRef></c:tx>${pie ? "" : fill(SERIES[k % SERIES.length])}${kind === "bar" || kind === "barh" ? '<c:invertIfNegative val="0"/>' : ""}${kind === "line" ? `<c:marker><c:symbol val="circle"/><c:size val="7"/>${fill(SERIES[k % SERIES.length])}</c:marker>` : ""}${points}${labels}<c:cat><c:strRef><c:f>Plan1!$A$2:$A$${n + 1}</c:f>${strCache(categories)}</c:strRef></c:cat><c:val><c:numRef><c:f>Plan1!$${col}$2:$${col}$${n + 1}</c:f>${numCache(s.values)}</c:numRef></c:val>${kind === "line" ? '<c:smooth val="0"/>' : ""}</c:ser>`;
  };
  const shown = pie ? series.slice(0, 1) : series;
  const axes = '<c:axId val="50010"/><c:axId val="50020"/>';
  const plot = pie
    ? (kind === "doughnut" ? `<c:doughnutChart><c:varyColors val="1"/>${shown.map(ser).join("")}<c:firstSliceAng val="0"/><c:holeSize val="55"/></c:doughnutChart>` : `<c:pieChart><c:varyColors val="1"/>${shown.map(ser).join("")}<c:firstSliceAng val="0"/></c:pieChart>`)
    : kind === "line" ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${shown.map(ser).join("")}<c:marker val="1"/>${axes}</c:lineChart>`
    : kind === "area" ? `<c:areaChart><c:grouping val="standard"/><c:varyColors val="0"/>${shown.map(ser).join("")}${axes}</c:areaChart>`
    : `<c:barChart><c:barDir val="${kind === "barh" ? "bar" : "col"}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${shown.map(ser).join("")}<c:gapWidth val="70"/><c:overlap val="-10"/>${axes}</c:barChart>`;
  const line = (color) => `<c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln></c:spPr>`;
  const axesXml = pie ? "" : `<c:catAx><c:axId val="50010"/><c:scaling><c:orientation val="${kind === "barh" ? "maxMin" : "minMax"}"/></c:scaling><c:delete val="0"/><c:axPos val="${kind === "barh" ? "l" : "b"}"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${line("C9D1DD")}${textProps(1100)}<c:crossAx val="50020"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx><c:valAx><c:axId val="50020"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${kind === "barh" ? "b" : "l"}"/><c:majorGridlines>${line("E6EAF0")}</c:majorGridlines><c:numFmt formatCode="${fmt}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${textProps(1000)}<c:crossAx val="50010"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`;
  const heading = title ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1400" b="1"><a:solidFill><a:srgbClr val="${NAVY}"/></a:solidFill><a:latin typeface="Segoe UI"/></a:defRPr></a:pPr><a:r><a:rPr lang="pt-BR" sz="1400" b="1"><a:solidFill><a:srgbClr val="${NAVY}"/></a:solidFill><a:latin typeface="Segoe UI"/></a:rPr><a:t>${esc(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>` : '<c:autoTitleDeleted val="1"/>';
  const legend = shown.length > 1 || pie ? `<c:legend><c:legendPos val="b"/><c:overlay val="0"/>${textProps(1100)}</c:legend>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace ${C_NS}><c:lang val="pt-BR"/><c:roundedCorners val="0"/><c:chart>${heading}<c:plotArea><c:layout/>${plot}${axesXml}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`;
}

/** A row of KPI cards: the value large, the name above, a note below (green when it starts with + or ↑). */
function kpiCards(firstId, items, y, h) {
  const shown = items.slice(0, 4);
  const gap = 182880, w = Math.floor((W - 1219200 - gap * (shown.length - 1)) / shown.length);
  return shown.map((k, i) => {
    const x = 609600 + i * (w + gap);
    const up = /^\s*[+↑▲]/.test(k.note), down = /^\s*[-−↓▼]/.test(k.note);
    const body = `<a:p>${run(k.label, { size: 1200, color: SOFT })}</a:p><a:p>${run(k.value, { size: 2800, bold: true, color: NAVY })}</a:p>${k.note ? `<a:p>${run(k.note, { size: 1100, color: up ? "1E9E62" : down ? "C0392B" : SOFT })}</a:p>` : ""}`;
    return `<p:sp><p:nvSpPr><p:cNvPr id="${firstId + i}" name="Indicador ${i + 1}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 8000"/></a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="F3F6FA"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="D5DBE5"/></a:solidFill></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="182880" tIns="91440" rIns="182880" bIns="91440" anchor="ctr"><a:normAutofit/></a:bodyPr><a:lstStyle/>${body}</p:txBody></p:sp>`;
  }).join("");
}

const chartFrame = (id, rid, x, y, w, h) => `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Gráfico ${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${rid}"/></a:graphicData></a:graphic></p:graphicFrame>`;

function slideXml(s, n, total, chartRids = []) {
  const parts = [];
  let id = 2;
  // Title bar.
  parts.push(`<p:sp><p:nvSpPr><p:cNvPr id="${id++}" name="Faixa"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${W}" cy="91440"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${ACCENT}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`);
  const first = n === 1 && !s.items.some((i) => i.type === "table" || i.type === "chart" || i.type === "kpis");
  if (s.title) parts.push(shape(id++, "Título", 609600, first ? 2286000 : 457200, W - 1219200, first ? 1143000 : 868680, `<a:p>${run(s.title, { size: first ? 4000 : 3000, bold: true })}</a:p>`));
  let y = first ? 3474720 : 1463040;
  const text = [];
  const flush = () => {
    if (!text.length) return;
    const h = Math.min(H - y - 548640, text.length * 457200 + 91440);
    parts.push(shape(id++, "Texto", 609600, y, W - 1219200, h, text.join("")));
    y += h + 91440;
    text.length = 0;
  };
  const charts = s.items.filter((it) => it.type === "chart");
  const kpis = s.items.filter((it) => it.type === "kpis").flatMap((it) => it.items);
  for (const it of s.items) {
    if (it.type === "chart" || it.type === "kpis") continue;
    if (it.type === "table") { flush(); parts.push(tableFrame(id++, it.rows, y)); y += 370840 * it.rows.length + 182880; continue; }
    if (it.type === "bullet") text.push(`<a:p><a:pPr marL="342900" indent="-342900"><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr>${run(it.text)}</a:p>`);
    else if (it.type === "subhead") text.push(`<a:p><a:spcBef><a:spcPts val="600"/></a:spcBef>${run(it.text, { size: 2200, bold: true, color: ACCENT })}</a:p>`);
    else text.push(`<a:p>${run(it.text, { size: first ? 2200 : 2000, color: first ? SOFT : NAVY })}</a:p>`);
  }
  flush();
  // The dashboard: the KPI cards in a row, then the charts in the space left (1 wide, 2 side by side, 3–4 in a grid).
  const bottom = H - 548640;
  if (kpis.length) { const h = 1005840; parts.push(kpiCards(id, kpis, y, h)); id += Math.min(4, kpis.length); y += h + 182880; }
  if (charts.length) {
    const shown = charts.slice(0, 4), cols = shown.length === 1 ? 1 : 2, rows = Math.ceil(shown.length / cols);
    const gap = 182880, w = Math.floor((W - 1219200 - gap * (cols - 1)) / cols), h = Math.max(1371600, Math.floor((bottom - y - gap * (rows - 1)) / rows));
    shown.forEach((_, i) => parts.push(chartFrame(id++, chartRids[i], 609600 + (i % cols) * (w + gap), y + Math.floor(i / cols) * (h + gap), w, h)));
  }
  parts.push(shape(id++, "Número", W - 1524000, H - 457200, 914400, 274320, `<a:p><a:pPr algn="r"/>${run(`${n} / ${total}`, { size: 1100, color: SOFT })}</a:p>`));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${parts.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Aurora"><a:themeElements><a:clrScheme name="Aurora"><a:dk1><a:srgbClr val="${NAVY}"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1B2A4A"/></a:dk2><a:lt2><a:srgbClr val="EEF2F7"/></a:lt2><a:accent1><a:srgbClr val="${ACCENT}"/></a:accent1><a:accent2><a:srgbClr val="1E9E62"/></a:accent2><a:accent3><a:srgbClr val="E8772E"/></a:accent3><a:accent4><a:srgbClr val="7A4FD6"/></a:accent4><a:accent5><a:srgbClr val="0F9AA0"/></a:accent5><a:accent6><a:srgbClr val="C99A2E"/></a:accent6><a:hlink><a:srgbClr val="2F6FDB"/></a:hlink><a:folHlink><a:srgbClr val="7A4FD6"/></a:folHlink></a:clrScheme><a:fontScheme name="Aurora"><a:majorFont><a:latin typeface="Segoe UI"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Segoe UI"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Aurora"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
const MASTER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="3000"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2000"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
const LAYOUT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Em branco"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
const rels = (list) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`).join("")}</Relationships>`;

/** The .pptx bytes for the blocks of parseBlocks. */
export function makePresentation(blocks) {
  const slides = slidesOf(blocks);
  if (!slides.length) throw new Error("O conteúdo está vazio.");
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")}</Types>`,
    "_rels/.rels": rels([["rId1", "officeDocument", "ppt/presentation.xml"]]),
    "ppt/presentation.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": rels([["rId1", "slideMaster", "slideMasters/slideMaster1.xml"], ["rId2", "theme", "theme/theme1.xml"], ...slides.map((_, i) => [`rId${i + 3}`, "slide", `slides/slide${i + 1}.xml`])]),
    "ppt/slideMasters/slideMaster1.xml": MASTER,
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": rels([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"], ["rId2", "theme", "../theme/theme1.xml"]]),
    "ppt/slideLayouts/slideLayout1.xml": LAYOUT,
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": rels([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]]),
    "ppt/theme/theme1.xml": THEME,
  };
  let chartNo = 0;
  const chartTypes = [];
  slides.forEach((s, i) => {
    // Each chart: its part, its workbook (Plan1: categories in A, one series per column) and the rels.
    const rids = [];
    const slideRels = [["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"]];
    for (const c of s.items.filter((it) => it.type === "chart").slice(0, 4)) {
      const data = chartData(c.rows);
      chartNo += 1;
      const rid = `rId${slideRels.length + 1}`;
      slideRels.push([rid, "chart", `../charts/chart${chartNo}.xml`]);
      rids.push(rid);
      files[`ppt/charts/chart${chartNo}.xml`] = chartXml(c, data);
      files[`ppt/charts/_rels/chart${chartNo}.xml.rels`] = rels([["rId1", "package", `../embeddings/Microsoft_Excel_Worksheet${chartNo}.xlsx`]]);
      files[`ppt/embeddings/Microsoft_Excel_Worksheet${chartNo}.xlsx`] = makeXlsx({ Plan1: [[" ", ...data.series.map((x) => x.name)], ...data.categories.map((cat, r) => [cat, ...data.series.map((x) => x.values[r])])] });
      chartTypes.push(`<Override PartName="/ppt/charts/chart${chartNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
    }
    files[`ppt/slides/slide${i + 1}.xml`] = slideXml(s, i + 1, slides.length, rids);
    files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = rels(slideRels);
  });
  if (chartNo) files["[Content_Types].xml"] = files["[Content_Types].xml"].replace("</Types>", `<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>${chartTypes.join("")}</Types>`);
  return zipStore(files);
}
