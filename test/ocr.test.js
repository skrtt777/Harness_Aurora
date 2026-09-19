import test from "node:test";
import assert from "node:assert/strict";

const { centerOf, findTextBox } = await import("../app/ocr.js");

// A small hand-built word list, the shape recognizeImage() returns —
// standing in for a real Tesseract result so findTextBox()'s matching logic
// (the part that matters for click targeting) can be tested precisely and
// deterministically, independent of OCR accuracy or network access.
const SAMPLE_WORDS = [
  { text: "Enviar", x0: 10, y0: 10, x1: 60, y1: 30 },
  { text: "Relatório", x0: 65, y0: 10, x1: 140, y1: 30 },
  { text: "Salvar", x0: 10, y0: 60, x1: 55, y1: 80 },
  { text: "Cancelar", x0: 60, y0: 60, x1: 120, y1: 80 },
];

test("centerOf returns the midpoint of a bounding box", () => {
  assert.deepEqual(centerOf({ x0: 0, y0: 0, x1: 10, y1: 20 }), { x: 5, y: 10 });
});

test("findTextBox matches a single word exactly", () => {
  const box = findTextBox(SAMPLE_WORDS, "Salvar");
  assert.deepEqual(box, { x0: 10, y0: 60, x1: 55, y1: 80 });
});

test("findTextBox is case- and accent-insensitive", () => {
  const box = findTextBox(SAMPLE_WORDS, "relatorio");
  assert.deepEqual(box, { x0: 65, y0: 10, x1: 140, y1: 30 });
});

test("findTextBox matches a multi-word phrase across consecutive words, merging their boxes", () => {
  const box = findTextBox(SAMPLE_WORDS, "Enviar Relatório");
  assert.deepEqual(box, { x0: 10, y0: 10, x1: 140, y1: 30 });
});

test("findTextBox returns null when nothing matches, instead of a wrong guess", () => {
  assert.equal(findTextBox(SAMPLE_WORDS, "Excluir"), null);
});

test("findTextBox returns null for empty query or empty word list", () => {
  assert.equal(findTextBox(SAMPLE_WORDS, ""), null);
  assert.equal(findTextBox([], "Salvar"), null);
});

test("findTextBox matches a partial/substring query against a longer word", () => {
  // The model might say "Relat" for a truncated label, or vice versa.
  const box = findTextBox(SAMPLE_WORDS, "Relat");
  assert.deepEqual(box, { x0: 65, y0: 10, x1: 140, y1: 30 });
});

// recognizeImage() itself (the real Tesseract worker) isn't exercised here:
// it fetches trained language data over the network on first use, and this
// sandbox's egress policy blocks that host (cdn.jsdelivr.net) with a 403 —
// the same class of honest limitation already documented for Ollama's own
// installer in PROJECT_LOG.md. Worse, a failed/hanging fetch leaves a
// tesseract.js worker thread alive in a way this file's test runner can't
// cleanly wait out, so a real end-to-end OCR pass is left for manual
// verification on a machine with normal network access (see
// test/fixtures/ocr-sample.png, generated for exactly that purpose) rather
// than risking a hung automated run. findTextBox() above — the part that
// actually decides where to click — is fully covered without it.
