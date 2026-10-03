import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { crc32 } from "node:zlib";
import { createCanvas } from "@napi-rs/canvas";

/**
 * Minimal but valid Office/PDF writers plus a fictitious HR department used by
 * the tests and by the knowledge benchmark. Real files, real formats — the
 * extractor reads them exactly like documents saved by Word/Excel.
 */

export function zipStore(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, "utf8");
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const CT = (overrides) => `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides}</Types>`;
const REL = (type, target) => `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${type}" Target="${target}"/></Relationships>`;
const OFFICE_DOC = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";

/** paragraphs: strings; a string[] entry becomes a table row set (array of rows). */
export function makeDocx(blocks) {
  const body = blocks.map((b) => Array.isArray(b)
    ? `<w:tbl>${b.map((row) => `<w:tr>${row.map((cell) => `<w:tc><w:p><w:r><w:t xml:space="preserve">${esc(cell)}</w:t></w:r></w:p></w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>`
    : `<w:p><w:r><w:t xml:space="preserve">${esc(b)}</w:t></w:r></w:p>`).join("");
  return zipStore({
    "[Content_Types].xml": CT('<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'),
    "_rels/.rels": REL(OFFICE_DOC, "word/document.xml"),
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  });
}

export function makeXlsx(sheets) {
  const strings = [];
  const index = (s) => { const i = strings.indexOf(s); return i >= 0 ? i : strings.push(s) - 1; };
  const col = (i) => String.fromCharCode(65 + i);
  const files = {};
  Object.entries(sheets).forEach(([, rows], s) => {
    files[`xl/worksheets/sheet${s + 1}.xml`] = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => typeof v === "number" ? `<c r="${col(c)}${r + 1}"><v>${v}</v></c>` : `<c r="${col(c)}${r + 1}" t="s"><v>${index(String(v))}</v></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`;
  });
  return zipStore({
    "[Content_Types].xml": CT('<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'),
    "_rels/.rels": REL(OFFICE_DOC, "xl/workbook.xml"),
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${Object.keys(sheets).map((name, i) => `<sheet name="${esc(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    "xl/sharedStrings.xml": `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}</sst>`,
    ...files,
  });
}

export function makePptx(slides) {
  const files = {};
  slides.forEach((lines, i) => { files[`ppt/slides/slide${i + 1}.xml`] = `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody>${lines.map((l) => `<a:p><a:r><a:t>${esc(l)}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`; });
  return zipStore({ "[Content_Types].xml": CT(""), "_rels/.rels": REL(OFFICE_DOC, "ppt/presentation.xml"), "ppt/presentation.xml": "<p:presentation xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\"/>", ...files });
}

/** One-page PDF, Helvetica/WinAnsi (accents encoded as octal bytes). */
export function makePdf(lines) {
  const enc = (s) => [...Buffer.from(String(s), "latin1")].map((b) => (b > 126 || b === 40 || b === 41 || b === 92 ? `\\${b.toString(8).padStart(3, "0")}` : String.fromCharCode(b))).join("");
  const stream = `BT /F1 11 Tf 50 790 Td 14 TL ${lines.map((l) => `(${enc(l)}) Tj T*`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf, "latin1")); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

/**
 * A scanned page: the lines drawn as a JPEG photo inside a PDF, with no text
 * layer at all — only OCR can read it, like a paper signed and scanned.
 */
export function makeScannedPdf(lines) {
  const W = 1240;
  const H = 1754; // A4 at 150 dpi
  const canvas = createCanvas(W, H);
  const g = canvas.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#111"; g.font = "34px sans-serif";
  lines.forEach((line, i) => g.fillText(line, 100, 200 + i * 58));
  const jpeg = canvas.encodeSync("jpeg", 85);
  const content = "q 595 0 0 842 0 0 cm /Im1 Do Q";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>",
    jpeg,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  const parts = [Buffer.from("%PDF-1.4\n", "latin1")];
  const offsets = [];
  let length = parts[0].length;
  objects.forEach((o, i) => {
    offsets.push(length);
    const part = Buffer.isBuffer(o)
      ? Buffer.concat([Buffer.from(`${i + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${o.length} >>\nstream\n`, "latin1"), o, Buffer.from("\nendstream\nendobj\n", "latin1")])
      : Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, "latin1");
    parts.push(part);
    length += part.length;
  });
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF`, "latin1"));
  return Buffer.concat(parts);
}

export const SCANNED_ON_CALL = [
  "COMUNICADO INTERNO - Plantão do RH no recesso",
  "Durante o recesso, de 26/12/2026 a 30/12/2026, o RH",
  "funciona em regime de plantão, das 9h às 15h.",
  "Responsável pelo plantão: Marcos Lima, ramal 2210.",
  "Urgências fora do horário: telefone (11) 4000-1234.",
];

/** A small, fictitious HR department share (names and data invented). */
export const SAMPLE_HR_FILES = {
  "Eventos/Confraternização 2026.docx": () => makeDocx([
    "Programação de Final de Ano 2026",
    "Confraternização dos colaboradores no dia 19 de dezembro de 2026, das 19h às 23h, no Espaço Jardim (Rua das Palmeiras, 120).",
    "Amigo secreto: sorteio em 28/11; valor sugerido do presente: R$ 80.",
    "Recesso coletivo de 24/12/2026 a 02/01/2027; retorno das atividades em 05/01/2027.",
    "Confirmação de presença até 05/12 pelo formulário do RH.",
  ]),
  "Eventos/Calendário de eventos 2026.xlsx": () => makeXlsx({ Eventos: [["Data", "Evento", "Local"], ["15/03/2026", "Workshop de integração", "Auditório"], ["10/10/2026", "Dia das Crianças em família", "Clube Atlético"], ["19/12/2026", "Confraternização de fim de ano", "Espaço Jardim"]] }),
  "Benefícios/Política de Benefícios.pdf": () => makePdf([
    "Política de Benefícios - 2026",
    "Vale-refeição: R$ 42,00 por dia útil, creditado até o 5º dia útil do mês.",
    "Plano de saúde: coparticipação de 20% nas consultas; dependentes legais incluídos.",
    "Auxílio home office: R$ 150,00 mensais para quem trabalha remoto 3 ou mais dias por semana.",
  ]),
  "Procedimentos/Como solicitar férias.docx": () => makeDocx([
    "Procedimento: solicitação de férias",
    "1. Combine o período com o gestor imediato com pelo menos 45 dias de antecedência.",
    "2. Registre o pedido no portal do colaborador, menu Férias > Nova solicitação.",
    "3. O gestor aprova no portal em até 5 dias úteis.",
    "4. O RH confirma e o pagamento das férias é feito até 2 dias antes do início.",
    "As férias podem ser divididas em até 3 períodos, um deles com no mínimo 14 dias.",
  ]),
  "Procedimentos/Admissão - checklist.pptx": () => makePptx([
    ["Admissão de novos colaboradores"],
    ["Documentos: RG, CPF, carteira de trabalho digital, comprovante de residência", "Exame admissional agendado pelo RH"],
    ["Primeiro dia: entrega de crachá e notebook, integração às 9h com a equipe de RH"],
  ]),
  "Eventos/Plantão do recesso (escaneado).pdf": () => makeScannedPdf(SCANNED_ON_CALL),
  "Contatos do RH.txt": () => Buffer.from("Equipe de RH\nRecrutamento: Carla Mendes - ramal 2201\nFolha de pagamento: Diego Santos - ramal 2204\nBenefícios: Júlia Rocha - ramal 2207\nE-mail geral: rh@empresa-exemplo.com.br\n", "utf8"),
};

export function writeSampleHrShare(root) {
  for (const [path, make] of Object.entries(SAMPLE_HR_FILES)) {
    const full = join(root, ...path.split("/"));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, make());
  }
  return root;
}
