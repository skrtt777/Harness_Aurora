import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { inflateRawSync } from "node:zlib";
import { htmlToText } from "./agentTools/web.js";

/**
 * Plain text out of the documents a company actually keeps: Word, Excel,
 * PowerPoint, PDF, plus text formats. Office files are ZIP archives of XML,
 * read with a small central-directory reader (no extra dependency); PDF goes
 * through Mozilla's pdf.js. Scanned pages (a PDF page without a text layer)
 * and images are read by OCR: pdf.js draws the page on a canvas and Tesseract
 * reads it, locally like everything else.
 */
export const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".bmp", ".webp"]);
export const DOC_EXTENSIONS = new Set([".docx", ".xlsx", ".xlsm", ".pptx", ".pdf", ".txt", ".md", ".csv", ".tsv", ".json", ".html", ".htm", ".xml", ".log", ".rtf", ".pbix", ".pbit", ...IMAGE_EXTENSIONS]);
/**
 * Plain text the chat also reads when the person attaches it (code, queries, configuration), but
 * that the knowledge base does not index from a folder (a project folder is not company knowledge).
 */
export const ATTACH_TEXT_EXTENSIONS = new Set([".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".sql", ".dax", ".m", ".pq", ".r", ".ps1", ".bat", ".cmd", ".sh", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".css", ".scss", ".java", ".cs", ".c", ".cpp", ".h", ".go", ".rs", ".php", ".rb", ".kt", ".swift", ".vb", ".bas", ".tex", ".srt", ".vtt", ".ndjson", ".jsonl", ".eml", ".ipynb", ".svg"]);
export const MAX_DOC_BYTES = 40 * 1024 * 1024;
const MAX_PBI_BYTES = 400 * 1024 * 1024;
const MAX_TEXT = 2_000_000;
// A page with less text than this is a scan (or a photo pasted as a page).
const OCR_MIN_CHARS = 20;
const OCR_MAX_PAGES = 40;
// Long side of a rendered page in pixels (~200 dpi on A4): enough for Tesseract.
const OCR_MAX_SIDE = 2400;

/** Entries of a ZIP archive: name → () => Buffer. */
export function readZip(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error("Arquivo ZIP inválido.");
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    entries.set(name, () => {
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const data = buffer.subarray(start, start + size);
      return method === 0 ? data : inflateRawSync(data);
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export const xmlText = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, c) => XML_ENTITIES[c.toLowerCase()] ?? (c[1]?.toLowerCase() === "x" ? String.fromCodePoint(parseInt(c.slice(2), 16)) : String.fromCodePoint(Number(c.slice(1)))));
const entryText = (zip, name) => (zip.has(name) ? zip.get(name)().toString("utf8") : "");
const numbered = (names, prefix) => names.filter((n) => n.startsWith(prefix) && n.endsWith(".xml")).sort((a, b) => Number(a.match(/(\d+)\.xml$/)?.[1]) - Number(b.match(/(\d+)\.xml$/)?.[1]));

export function docxText(buffer) {
  const xml = entryText(readZip(buffer), "word/document.xml");
  return xml
    .replace(/<w:tab\/>/g, "\t").replace(/<w:br[^>]*\/>/g, "\n")
    // A table cell's paragraphs stay on the row's line: "Nome | Ramal".
    .replace(/<w:tc>([\s\S]*?)<\/w:tc>/g, (m, inner) => `${inner.replace(/<\/w:p>(?![\s\S]*<\/w:p>)/, "").replace(/<\/w:p>/g, " ")} | `)
    .replace(/<\/w:tr>/g, "\n").replace(/<\/w:p>/g, "\n")
    .replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g, (m, t) => `\u0000${t}\u0001`)
    .replace(/<[^>]+>/g, "").replace(/\u0000([^\u0001]*)\u0001/g, (m, t) => xmlText(t))
    .replace(/ \| \n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Built-in number formats (ECMA-376 18.8.30) that are dates, and those that are percentages.
const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
const PERCENT_FORMAT_IDS = new Set([9, 10]);

/** Style index → "date" | "percent" | undefined, from xl/styles.xml. */
function cellKinds(stylesXml) {
  const custom = new Map([...stylesXml.matchAll(/<numFmt [^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)].map((m) => [Number(m[1]), xmlText(m[2])]));
  const xfs = stylesXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] || "";
  return [...xfs.matchAll(/<xf ([^>]*?)\/?>/g)].map(([, attrs]) => {
    const id = Number(attrs.match(/numFmtId="(\d+)"/)?.[1] || 0);
    // Quoted text and [colour]/[locale] parts do not count: "R$" #,##0.00 has no date letter.
    const code = (custom.get(id) || "").replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
    if (DATE_FORMAT_IDS.has(id) || /[dy]|m{1,4}(?![^;]*[hs])/i.test(code) && !/^[#0,.\s%-]*$/.test(code)) return "date";
    if (PERCENT_FORMAT_IDS.has(id) || code.includes("%")) return "percent";
    return undefined;
  });
}

/** Excel's serial day (1900 system, with its fake 29/02/1900) as dd/mm/yyyy. */
function serialDate(serial) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

// 8344.639999999999 (a binary float as written by the program) → 8344.64.
const tidyNumber = (n) => String(Number(n.toFixed(6)));

/** Column index (0-based) of a cell reference such as "C12". */
const columnIndex = (ref) => [...ref.replace(/\d+$/, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/**
 * The sheets of an .xlsx as their cells really are: [{ name, rows: [[cell, ...], ...] }] (empty rows
 * left out). A cell holding "A | B | C" stays one cell, as Excel and Power BI see it.
 */
export function xlsxSheets(buffer) {
  const zip = readZip(buffer);
  const shared = [...entryText(zip, "xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText([...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join("")));
  const names = [...entryText(zip, "xl/workbook.xml").matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => xmlText(m[1]));
  const kinds = cellKinds(entryText(zip, "xl/styles.xml"));
  return numbered([...zip.keys()], "xl/worksheets/sheet").map((sheet, index) => {
    const rows = [];
    for (const row of entryText(zip, sheet).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      // Empty cells are not stored at all, so place each value by its reference ("C12").
      const cells = [];
      for (const [, attrs, body = ""] of row[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const raw = body.match(/<v>([^<]*)<\/v>/)?.[1] ?? body.match(/<t[^>]*>([^<]*)<\/t>/)?.[1] ?? "";
        const type = attrs.match(/\bt="(\w+)"/)?.[1];
        const kind = kinds[Number(attrs.match(/\bs="(\d+)"/)?.[1] || 0)];
        const number = raw !== "" && (!type || type === "n") ? Number(raw) : NaN;
        let value = type === "s" ? shared[Number(raw)] ?? "" : xmlText(raw);
        if (Number.isFinite(number)) {
          if (kind === "date" && number > 0 && number < 2958466) value = serialDate(number);
          else if (kind === "percent") value = `${tidyNumber(number * 100)}%`;
          else value = tidyNumber(number);
        }
        const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
        const at = ref ? columnIndex(ref) : cells.length;
        while (cells.length < at) cells.push("");
        cells[at] = value;
      }
      if (cells.some((c) => String(c).trim())) rows.push(cells);
    }
    return { name: names[index] || `Planilha ${index + 1}`, rows };
  });
}

export function xlsxText(buffer) {
  return xlsxSheets(buffer).map((s) => [`## ${s.name}`, ...s.rows.map((cells) => cells.join(" | "))].join("\n")).join("\n");
}

export function pptxText(buffer) {
  const zip = readZip(buffer);
  return numbered([...zip.keys()], "ppt/slides/slide").map((slide, i) => {
    const paragraphs = [...entryText(zip, slide).matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map((p) => xmlText([...p[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join(""))).filter(Boolean);
    return `## Slide ${i + 1}\n${paragraphs.join("\n")}`;
  }).join("\n\n");
}

/** The UTF-16 JSON inside Power BI files (Report/Layout, DataModelSchema), with or without a BOM. */
const utf16Json = (buffer) => JSON.parse((buffer[0] === 0xff && buffer[1] === 0xfe ? buffer.subarray(2) : buffer).toString("utf16le").replace(/^﻿/, ""));

/** A field of a visual: Tabela[Coluna] or Tabela[Medida]; an aggregation or anything else by its queryRef. */
function pbiField(projection) {
  const f = projection?.field || {};
  const named = f.Column || f.Measure || f.Aggregation?.Expression?.Column || f.HierarchyLevel?.Expression?.Hierarchy;
  const entity = named?.Expression?.SourceRef?.Entity;
  const property = named?.Property || f.HierarchyLevel?.Level;
  const agg = f.Aggregation ? ["Soma", "Média", "Contagem", "Mínimo", "Máximo", "Contagem distinta"][f.Aggregation.Function] : null;
  if (entity && property) return `${agg ? `${agg} de ` : ""}${entity}[${property}]`;
  return projection?.nativeQueryRef || projection?.queryRef || null;
}
const literal = (v) => (typeof v === "string" ? v.replace(/^'|'$/g, "") : null);

/**
 * The report in the enhanced format (PBIR, the default of Power BI Desktop since 2025): one page.json
 * per page and one visual.json per visual under Report/definition. The old reader only knew
 * Report/Layout and saw no page at all in these files (28/10).
 */
function pbirPages(zip) {
  const read = (name) => JSON.parse(zip.get(name)().toString("utf8").replace(/^﻿/, ""));
  const names = [...zip.keys()];
  const order = zip.has("Report/definition/pages/pages.json") ? read("Report/definition/pages/pages.json").pageOrder || [] : [];
  const pages = [...new Set(names.map((n) => /^Report\/definition\/pages\/([^/]+)\/page\.json$/.exec(n)?.[1]).filter(Boolean))]
    .sort((a, b) => (order.indexOf(a) + 1 || 1e9) - (order.indexOf(b) + 1 || 1e9));
  return pages.map((id) => {
    const page = read(`Report/definition/pages/${id}/page.json`);
    const visuals = names.filter((n) => n.startsWith(`Report/definition/pages/${id}/visuals/`) && n.endsWith("/visual.json")).map((n) => {
      try {
        const v = read(n).visual || {};
        const title = literal(v.visualContainerObjects?.title?.[0]?.properties?.text?.expr?.Literal?.Value);
        const fields = Object.values(v.query?.queryState || {}).flatMap((role) => (role.projections || []).map(pbiField)).filter(Boolean);
        return { type: v.visualType, title, fields: [...new Set(fields)] };
      } catch { return null; }
    }).filter((v) => v?.type);
    return { name: page.displayName || page.name || id, visuals };
  });
}
/** The legacy report (Report/Layout): pages, visuals, titles and the fields each one shows. */
function layoutPages(zip) {
  return (utf16Json(zip.get("Report/Layout")()).sections || []).map((s) => ({
    name: s.displayName || s.name,
    visuals: (s.visualContainers || []).map((v) => {
      try {
        const single = JSON.parse(v.config || "{}").singleVisual || {};
        const title = literal(single.vcObjects?.title?.[0]?.properties?.text?.expr?.Literal?.Value);
        const fields = (single.prototypeQuery?.Select || []).map((s_) => s_.NativeReferenceName || s_.Name).filter(Boolean);
        return single.visualType ? { type: single.visualType, title, fields: [...new Set(fields)] } : null;
      } catch { return null; }
    }).filter(Boolean),
  }));
}

/**
 * What a Power BI file says without opening Power BI: the report's pages and their visuals with the
 * fields they show (Report/Layout, or Report/definition in the enhanced format) and the model: in a
 * .pbit its tables, columns, measures with their DAX and the relationships (DataModelSchema); in a
 * .pbix it is compressed in a binary DataModel, read by app/pbixModel.js when `model` is given.
 */
export function pbiText(buffer, model = null, modelText = null) {
  const zip = readZip(buffer);
  const out = [];
  if (model && modelText) out.push(modelText(model));
  else if (zip.has("DataModelSchema")) {
    const model = utf16Json(zip.get("DataModelSchema")()).model || {};
    const tables = (model.tables || []).filter((t) => !/^(DateTableTemplate|LocalDateTable)_/.test(t.name));
    out.push(`## Modelo de dados (${tables.length} tabelas)`);
    for (const t of tables) {
      const columns = (t.columns || []).filter((c) => c.type !== "rowNumber").map((c) => c.name);
      out.push(`### ${t.name}${columns.length ? `\nColunas: ${columns.join(", ")}` : ""}`);
      for (const m of t.measures || []) out.push(`Medida [${m.name}] = ${[].concat(m.expression || "").join("\n").trim()}`);
    }
    const relations = (model.relationships || []).map((r) => `${r.fromTable}[${r.fromColumn}] → ${r.toTable}[${r.toColumn}]`);
    if (relations.length) out.push(`## Relacionamentos\n${relations.join("\n")}`);
  } else {
    out.push("O modelo de dados (tabelas e medidas) de um .pbix fica compactado: para consultá-lo, abra o arquivo no Power BI Desktop com a ferramenta powerbi (action=open).");
  }
  const pages = zip.has("Report/Layout") ? layoutPages(zip) : [...zip.keys()].some((n) => n.startsWith("Report/definition/pages/")) ? pbirPages(zip) : [];
  if (pages.length) {
    out.push(`## Relatório (${pages.length} páginas)`);
    for (const p of pages) {
      // The decoration (shapes, logos, labels, page buttons) says nothing about the data.
      const visuals = p.visuals.filter((v) => !/^(shape|image|textbox|actionButton|basicShape|pageNavigator|bookmarkNavigator)$/i.test(v.type));
      out.push(`### ${p.name}${visuals.length ? `\n${visuals.map((v) => `- ${v.type}${v.title ? ` "${v.title}"` : ""}${v.fields.length ? `: ${v.fields.join(", ")}` : ""}`).join("\n")}` : ""}`);
    }
  }
  return out.join("\n");
}

/** Tesseract over an image, through the warm worker of app/ocr.js. */
export async function defaultOcr(image, env = process.env) {
  const { recognizeImage } = await import("./ocr.js");
  return (await recognizeImage(image, env)).text;
}

/** Photos and icons give Tesseract noise; text is a few real words. */
export const readableText = (text) => (String(text).match(/[a-zA-ZÀ-ÿ]{3,}/g) || []).length >= 5;

async function renderPage(page) {
  const { createCanvas } = await import("@napi-rs/canvas");
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(2, OCR_MAX_SIDE / Math.max(base.width, base.height)) });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return canvas.encode("png");
}

/**
 * Text of every page; with `ocr`, pages without a text layer are rendered and
 * read by OCR (only those — a mixed PDF keeps its real text). OCR'd pages are
 * headed "(OCR)". If OCR is unavailable and nothing was read, that error is
 * thrown instead of an empty document.
 */
export async function pdfText(buffer, { ocr, signal } = {}) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: false, isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  const pages = [];
  let ocrPages = 0;
  let ocrError = null;
  try {
    for (let n = 1; n <= doc.numPages; n += 1) {
      if (signal?.aborted) break;
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let line = "";
      const lines = [];
      for (const item of content.items) {
        line += item.str;
        if (item.hasEOL) { lines.push(line); line = ""; }
      }
      if (line) lines.push(line);
      let text = lines.join("\n").trim();
      let scanned = false;
      if (ocr && text.length < OCR_MIN_CHARS && ocrPages < OCR_MAX_PAGES) {
        ocrPages += 1;
        try {
          const read = String(await ocr(await renderPage(page))).trim();
          if (read.length > text.length) { text = read; scanned = true; }
        } catch (error) { ocrError ||= error; }
      }
      pages.push({ text, scanned });
      if (pages.reduce((n, p) => n + p.text.length, 0) > MAX_TEXT) break;
    }
  } finally { await task.destroy(); }
  if (ocrError && !pages.some((p) => p.text)) throw new Error(`Documento escaneado, mas o OCR falhou: ${ocrError.message}`);
  return pages.map((p, i) => (doc.numPages > 1 || p.scanned ? `## Página ${i + 1}${p.scanned ? " (OCR)" : ""}\n${p.text}` : p.text)).join("\n\n");
}

export function isDocument(path) {
  return DOC_EXTENSIONS.has(extname(path).toLowerCase());
}

/**
 * Text of any supported document; throws for unsupported or oversized files.
 * `ocr` (image Buffer → text) reads scans and images; `false` turns it off.
 */
export async function extractText(path, { ocr = defaultOcr, signal, pbixData = false } = {}) {
  const ext = extname(path).toLowerCase();
  if (!DOC_EXTENSIONS.has(ext) && !ATTACH_TEXT_EXTENSIONS.has(ext)) throw new Error(`Formato ${ext || "sem extensão"} não suportado.`);
  // A .pbix carries its data: only the report's layout is unpacked, so a bigger file is fine.
  const limit = ext === ".pbix" || ext === ".pbit" ? MAX_PBI_BYTES : MAX_DOC_BYTES;
  if ((await stat(path)).size > limit) throw new Error(`Documento grande demais (mais de ${Math.round(limit / 1024 / 1024)} MB).`);
  const buffer = await readFile(path);
  let text;
  if (ext === ".docx") text = docxText(buffer);
  else if (ext === ".xlsx" || ext === ".xlsm") text = xlsxText(buffer);
  else if (ext === ".pbix" || ext === ".pbit") {
    // A .pbix's model (tables with data, measures) unpacked without Power BI: only where someone asked
    // to read it (read_file, an attached file), never while indexing folders (it may install Python).
    let model = null, why = "";
    if (pbixData && ext === ".pbix") {
      const reader = await import("./pbixModel.js");
      model = await reader.pbixModel(path, { signal }).catch((error) => { why = String(error.stderr || error.message || "").trim().split(/\r?\n/).pop(); return null; });
      text = pbiText(buffer, model, reader.pbixModelText);
    } else text = pbiText(buffer);
    if (pbixData && ext === ".pbix" && !model && why) text += `\n(Não consegui ler os dados do modelo sem o Power BI: ${why.slice(0, 200)}.)`;
  }
  else if (ext === ".pptx") text = pptxText(buffer);
  else if (ext === ".pdf") text = await pdfText(buffer, { ocr: ocr || undefined, signal });
  else if (IMAGE_EXTENSIONS.has(ext)) {
    const read = ocr ? String(await ocr(buffer)).trim() : "";
    text = readableText(read) ? `## Imagem (OCR)\n${read}` : "";
  }
  else if (ext === ".html" || ext === ".htm") text = htmlToText(buffer.toString("utf8"));
  else if (ext === ".rtf") text = buffer.toString("latin1").replace(/\\par[d]?/g, "\n").replace(/\{\\\*[^}]*\}|\\[a-z]+-?\d* ?|[{}]/g, "").trim();
  else text = buffer.toString("utf8").replace(/^﻿/, "");
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n… (cortado)` : text;
}
