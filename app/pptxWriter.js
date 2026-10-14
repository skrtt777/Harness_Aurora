// A real PowerPoint file from the document blocks (13/10/2026: "faça uma apresentação de 3 slides" was
// saved as a .docx, because write_document had no .pptx). Every # or ## heading starts a slide; bullets and
// paragraphs are its text, a table is a table. Master, layout and theme included: PowerPoint opens it.
import { zipStore } from "./sampleDocs.js";

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
  // A slide with too much text is split, so nothing runs off the page.
  const out = [];
  for (const s of slides) {
    let part = { title: s.title, items: [] }, lines = 0;
    for (const it of s.items) {
      const cost = it.type === "table" ? Math.min(it.rows.length, 12) + 1 : Math.ceil(String(it.text || "").length / 90);
      if (lines && lines + cost > 11) { out.push(part); part = { title: `${s.title} (cont.)`, items: [] }; lines = 0; }
      part.items.push(it.type === "table" ? { ...it, rows: it.rows.slice(0, 13) } : it);
      lines += cost;
    }
    out.push(part);
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

function slideXml(s, n, total) {
  const parts = [];
  let id = 2;
  // Title bar.
  parts.push(`<p:sp><p:nvSpPr><p:cNvPr id="${id++}" name="Faixa"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${W}" cy="91440"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${ACCENT}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`);
  const first = n === 1 && !s.items.some((i) => i.type === "table");
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
  for (const it of s.items) {
    if (it.type === "table") { flush(); parts.push(tableFrame(id++, it.rows, y)); y += 370840 * it.rows.length + 182880; continue; }
    if (it.type === "bullet") text.push(`<a:p><a:pPr marL="342900" indent="-342900"><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr>${run(it.text)}</a:p>`);
    else if (it.type === "subhead") text.push(`<a:p><a:spcBef><a:spcPts val="600"/></a:spcBef>${run(it.text, { size: 2200, bold: true, color: ACCENT })}</a:p>`);
    else text.push(`<a:p>${run(it.text, { size: first ? 2200 : 2000, color: first ? SOFT : NAVY })}</a:p>`);
  }
  flush();
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
  slides.forEach((s, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] = slideXml(s, i + 1, slides.length);
    files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = rels([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"]]);
  });
  return zipStore(files);
}
