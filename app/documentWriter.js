/**
 * Real documents from the agent's text: "crie um documento com os valores
 * atualizados" used to end in a claim with no file, or a .docx written as
 * plain text that Word refuses. The model writes simple markdown (headings,
 * lists, tables); this turns it into .docx, .xlsx, .pdf, .md or .csv.
 */

export const DOCUMENT_FORMATS = ["docx", "xlsx", "pptx", "pdf", "md", "csv", "txt", "html"];

const clean = (text) => String(text).replace(/^>\s?/, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1$2").replace(/__(.+?)__/g, "$1").replace(/`([^`]+)`/g, "$1").trim();
const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => clean(c));
const isTableLine = (line) => /^\s*\|.*\|\s*$/.test(line);
const isSeparator = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

/**
 * A run of lines that is a table written without the markdown pipes at the ends ("Nome | Cargo",
 * 12/10: a whole spreadsheet became one text column and its Power BI came out empty) or, for a
 * spreadsheet, as delimited text (";" "," or tab): at least two lines of two cells or more.
 * Returns how many lines it takes and the delimiter, or null.
 */
function delimitedRun(lines, i, delimiters) {
  for (const d of delimiters) {
    const count = (line) => (line.trim() ? line.split(d).length : 0);
    const n = count(lines[i]);
    if (n < 2) continue;
    // Lines of other widths stay in the run: the table check then says which one is wrong.
    let j = i; while (j < lines.length && count(lines[j]) >= 2) j += 1;
    if (j - i >= 2) return { length: j - i, delimiter: d };
  }
  return null;
}

/**
 * Markdown → blocks: {type:"heading",level,text} | {type:"bullet",text} | {type:"paragraph",text} | {type:"table",rows,title}.
 * sheet: for a spreadsheet (.xlsx/.csv) a delimited run of lines is a table too.
 */
export function parseBlocks(markdown, { sheet = false } = {}) {
  const blocks = [];
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  let lastHeading = "";
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // Blank lines and --- separators.
    if (!line.trim() || /^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) continue;
    const run = !isTableLine(line) && delimitedRun(lines, i, sheet ? ["|", "\t", ";", ","] : ["|"]);
    if (run) {
      const rows = lines.slice(i, i + run.length).filter((l) => !isSeparator(l)).map((l) => l.split(run.delimiter).map((c) => clean(c.replace(/^"(.*)"$/, "$1"))));
      blocks.push({ type: "table", rows, title: lastHeading });
      i += run.length - 1;
      continue;
    }
    if (isTableLine(line)) {
      const rows = [];
      for (; i < lines.length && isTableLine(lines[i]); i += 1) if (!isSeparator(lines[i])) rows.push(cells(lines[i]));
      i -= 1;
      blocks.push({ type: "table", rows, title: lastHeading });
      continue;
    }
    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) { lastHeading = clean(heading[2]); blocks.push({ type: "heading", level: heading[1].length, text: lastHeading }); continue; }
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

/**
 * A cell's number as a Brazilian writes it: "385000", "1.5", "8.500.000,00", "R$ 1.234,56", "12,5%"
 * (as 12.5); null when it is not a plain number (a date, a code, a CNPJ, "0001").
 */
export function cellNumber(value) {
  const s = String(value ?? "").replace(/^R\$\s*/i, "").replace(/\s+/g, "").replace(/%$/, "");
  if (!s || /^-?0\d/.test(s)) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return Number(s.replace(/\./g, "").replace(",", "."));
  if (/^-?\d+,\d+$/.test(s)) return Number(s.replace(",", "."));
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return null;
}
/** A table that is a table: a header, rows, the same columns in each; the error says what to fix. */
function checkTable(rows, name) {
  if (rows.length < 2) throw new Error(`A tabela "${name}" só tem o cabeçalho: grave as linhas de dados abaixo dele.`);
  const width = rows[0].length;
  const bad = rows.findIndex((r) => r.length !== width);
  if (bad > 0) throw new Error(`A tabela "${name}" tem ${width} colunas no cabeçalho, mas a linha ${bad + 1} tem ${rows[bad].length}: cada linha com uma célula por coluna (uma planilha assim chega quebrada no Power BI).`);
}
async function makeSheet(blocks) {
  const { makeXlsx } = await import("./sampleDocs.js");
  const tables = blocks.filter((b) => b.type === "table");
  // A spreadsheet is tables: text alone (a report written as markdown) is refused, not stored as one
  // column of sentences (12/10: such a file opened in Power BI with no data).
  if (!tables.length) throw new Error("Uma planilha .xlsx precisa de tabela: uma linha de cabeçalho e as linhas de dados, com as células separadas por | (ex.: \"Departamento | Funcionários\\nVendas | 345\"). Para texto, use .docx.");
  const sheets = {};
  tables.forEach((t, i) => {
    let name = String(t.title || `Tabela ${i + 1}`).replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || `Tabela ${i + 1}`;
    while (sheets[name]) name = `${name.slice(0, 28)} ${i + 1}`;
    checkTable(t.rows, name);
    sheets[name] = t.rows.map((row, r) => (r === 0 ? row : row.map((v) => cellNumber(v) ?? v)));
  });
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

function csvOf(blocks, { plain = false } = {}) {
  const tables = blocks.filter((b) => b.type === "table");
  // A .csv is one table (a "Fonte:" line or a title after it would be a row of garbage in Power BI).
  if (tables.length) checkTable(tables[0].rows, tables[0].title || "CSV");
  const rows = tables.length ? tables[0].rows : blocks.map((b) => [b.text]);
  // For a program: commas, no BOM, \n. For Excel in Portuguese: semicolons and the BOM.
  if (plain) return `${rows.map((row) => row.map((c) => (/[,"\n]/.test(c) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(",")).join("\n")}\n`;
  return `﻿${rows.map((row) => row.map((c) => (/[;"\n]/.test(c) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(";")).join("\r\n")}\r\n`;
}

/** Bytes of the document in the given format. */
export async function renderDocument(format, markdown, { plainCsv = false } = {}) {
  const blocks = parseBlocks(markdown, { sheet: format === "xlsx" || format === "csv" });
  if (!blocks.length) throw new Error("O conteúdo está vazio.");
  if (format === "docx") return makeDocument(blocks);
  if (format === "xlsx") return makeSheet(blocks);
  if (format === "pdf") return makePdfDocument(blocks);
  if (format === "pptx") return (await import("./pptxWriter.js")).makePresentation(blocks);
  if (format === "csv") return Buffer.from(csvOf(blocks, { plain: plainCsv }), "utf8");
  return Buffer.from(String(markdown), "utf8");
}
