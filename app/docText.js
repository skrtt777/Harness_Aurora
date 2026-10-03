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
export const DOC_EXTENSIONS = new Set([".docx", ".xlsx", ".pptx", ".pdf", ".txt", ".md", ".csv", ".tsv", ".json", ".html", ".htm", ".xml", ".log", ".rtf", ...IMAGE_EXTENSIONS]);
export const MAX_DOC_BYTES = 40 * 1024 * 1024;
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

export function xlsxText(buffer) {
  const zip = readZip(buffer);
  const shared = [...entryText(zip, "xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText([...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join("")));
  const names = [...entryText(zip, "xl/workbook.xml").matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => xmlText(m[1]));
  const out = [];
  numbered([...zip.keys()], "xl/worksheets/sheet").forEach((sheet, index) => {
    out.push(`## ${names[index] || `Planilha ${index + 1}`}`);
    for (const row of entryText(zip, sheet).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [...row[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map(([, attrs, body = ""]) => {
        const value = body.match(/<v>([^<]*)<\/v>/)?.[1] ?? body.match(/<t[^>]*>([^<]*)<\/t>/)?.[1] ?? "";
        return /t="s"/.test(attrs) ? shared[Number(value)] ?? "" : xmlText(value);
      });
      if (cells.some((c) => String(c).trim())) out.push(cells.join(" | "));
    }
  });
  return out.join("\n");
}

export function pptxText(buffer) {
  const zip = readZip(buffer);
  return numbered([...zip.keys()], "ppt/slides/slide").map((slide, i) => {
    const paragraphs = [...entryText(zip, slide).matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map((p) => xmlText([...p[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join(""))).filter(Boolean);
    return `## Slide ${i + 1}\n${paragraphs.join("\n")}`;
  }).join("\n\n");
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
export async function extractText(path, { ocr = defaultOcr, signal } = {}) {
  const ext = extname(path).toLowerCase();
  if (!DOC_EXTENSIONS.has(ext)) throw new Error(`Formato ${ext || "sem extensão"} não suportado.`);
  if ((await stat(path)).size > MAX_DOC_BYTES) throw new Error("Documento grande demais (mais de 40 MB).");
  const buffer = await readFile(path);
  let text;
  if (ext === ".docx") text = docxText(buffer);
  else if (ext === ".xlsx") text = xlsxText(buffer);
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
