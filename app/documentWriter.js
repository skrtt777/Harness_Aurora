/**
 * Real documents from the agent's text: "crie um documento com os valores
 * atualizados" used to end in a claim with no file, or a .docx written as
 * plain text that Word refuses. The model writes simple markdown (headings,
 * lists, tables); this turns it into .docx, .xlsx, .pdf, .md or .csv.
 */

export const DOCUMENT_FORMATS = ["docx", "xlsx", "pdf", "md", "csv", "txt", "html"];

const clean = (text) => String(text).replace(/^>\s?/, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1$2").replace(/__(.+?)__/g, "$1").replace(/`([^`]+)`/g, "$1").trim();
const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => clean(c));
const isTableLine = (line) => /^\s*\|.*\|\s*$/.test(line);
const isSeparator = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

/** Markdown → blocks: {type:"heading",level,text} | {type:"bullet",text} | {type:"paragraph",text} | {type:"table",rows}. */
export function parseBlocks(markdown) {
  const blocks = [];
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // Blank lines and --- separators.
    if (!line.trim() || /^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) continue;
    if (isTableLine(line)) {
      const rows = [];
      for (; i < lines.length && isTableLine(lines[i]); i += 1) if (!isSeparator(lines[i])) rows.push(cells(lines[i]));
      i -= 1;
      blocks.push({ type: "table", rows });
      continue;
    }
    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) { blocks.push({ type: "heading", level: heading[1].length, text: clean(heading[2]) }); continue; }
    const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (bullet) { blocks.push({ type: "bullet", text: clean(bullet[1]) }); continue; }
    blocks.push({ type: "paragraph", text: clean(line) });
  }
  return blocks;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function docxXml(blocks) {
  const run = (text, { bold = false, size = 22 } = {}) => `<w:r><w:rPr>${bold ? "<w:b/>" : ""}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
  const para = (inner, spacing = 120) => `<w:p><w:pPr><w:spacing w:after="${spacing}"/></w:pPr>${inner}</w:p>`;
  const border = '<w:tblBorders>' + ["top", "left", "bottom", "right", "insideH", "insideV"].map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`).join("") + "</w:tblBorders>";
  const body = blocks.map((b) => {
    if (b.type === "heading") return para(run(b.text, { bold: true, size: [36, 30, 26, 24, 22, 22][b.level - 1] }), 160);
    if (b.type === "bullet") return para(run(`• ${b.text}`));
    if (b.type === "table") {
      const rows = b.rows.map((row, r) => `<w:tr>${row.map((cell) => `<w:tc><w:p>${run(cell, { bold: r === 0 })}</w:p></w:tc>`).join("")}</w:tr>`).join("");
      return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${border}</w:tblPr>${rows}</w:tbl>${para("")}`;
    }
    return para(run(b.text));
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;
}

async function makeDocument(blocks) {
  const { zipStore } = await import("./sampleDocs.js");
  return zipStore({
    "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": docxXml(blocks),
  });
}

const NUMBER = /^-?\d+(\.\d+)?$/;
async function makeSheet(blocks) {
  const { makeXlsx } = await import("./sampleDocs.js");
  const tables = blocks.filter((b) => b.type === "table");
  const sheets = tables.length
    ? Object.fromEntries(tables.map((t, i) => [`Tabela ${i + 1}`, t.rows]))
    : { Planilha: blocks.map((b) => [b.text]) };
  for (const rows of Object.values(sheets)) for (const row of rows) row.forEach((v, i) => { if (NUMBER.test(v)) row[i] = Number(v); });
  return makeXlsx(sheets);
}

/** Multi-page A4 PDF with wrapped lines (Helvetica, WinAnsi accents). */
export function makePdfDocument(blocks) {
  const enc = (s) => [...Buffer.from(String(s).replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/•/g, "\x95"), "latin1")].map((b) => (b > 126 || b === 40 || b === 41 || b === 92 ? `\\${b.toString(8).padStart(3, "0")}` : String.fromCharCode(b))).join("");
  const wrap = (text, width) => {
    const out = [];
    let line = "";
    for (const word of String(text).split(/\s+/)) {
      if (line && (line.length + word.length + 1) > width) { out.push(line); line = word; }
      else line = line ? `${line} ${word}` : word;
    }
    if (line) out.push(line);
    return out.length ? out : [""];
  };
  // [font, size, text, gapAfter]
  const lines = [];
  for (const b of blocks) {
    if (b.type === "heading") { const size = [18, 15, 13, 12, 11, 11][b.level - 1]; wrap(b.text, Math.floor(1000 / size)).forEach((t) => lines.push(["F2", size, t, 0])); lines.at(-1)[3] = 6; }
    else if (b.type === "table") {
      const widths = b.rows[0].map((_, c) => Math.min(40, Math.max(...b.rows.map((r) => String(r[c] ?? "").length))));
      b.rows.forEach((row, r) => lines.push([r === 0 ? "F2" : "F1", 10, row.map((cell, c) => String(cell ?? "").padEnd(widths[c])).join("  |  ").slice(0, 110), 0]));
      lines.at(-1)[3] = 8;
    } else wrap(b.type === "bullet" ? `• ${b.text}` : b.text, 95).forEach((t, i, all) => lines.push(["F1", 11, t, i === all.length - 1 ? 4 : 0]));
  }
  const pages = [];
  let y = 0;
  let current = [];
  for (const [font, size, text, gap] of lines) {
    if (!current.length || y - size - 4 < 50) { if (current.length) pages.push(current); current = []; y = 800; }
    y -= size + 4;
    current.push(`BT /${font} ${size} Tf 56 ${y} Td (${enc(text)}) Tj ET`);
    y -= gap;
  }
  if (current.length || !pages.length) pages.push(current);
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"];
  const kids = [];
  for (const page of pages) {
    const stream = page.join("\n");
    objects.push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    const contents = objects.length;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contents} 0 R >>`);
    kids.push(`${objects.length} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf, "latin1")); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

function csvOf(blocks) {
  const rows = blocks.some((b) => b.type === "table") ? blocks.filter((b) => b.type === "table").flatMap((b) => b.rows) : blocks.map((b) => [b.text]);
  return `﻿${rows.map((row) => row.map((c) => (/[;"\n]/.test(c) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(";")).join("\r\n")}\r\n`;
}

/** Bytes of the document in the given format. */
export async function renderDocument(format, markdown) {
  const blocks = parseBlocks(markdown);
  if (!blocks.length) throw new Error("O conteúdo está vazio.");
  if (format === "docx") return makeDocument(blocks);
  if (format === "xlsx") return makeSheet(blocks);
  if (format === "pdf") return makePdfDocument(blocks);
  if (format === "csv") return Buffer.from(csvOf(blocks), "utf8");
  return Buffer.from(String(markdown), "utf8");
}
