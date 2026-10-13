import test from "node:test";
import assert from "node:assert/strict";

const { decodeBody, excerptsOf } = await import("../app/agentTools/web.js");

test("a page in its own encoding (planalto.gov.br is windows-1252), UTF-8 by default", () => {
  const latin = Uint8Array.from([0x50, 0x61, 0x72, 0xe1, 0x67, 0x72, 0x61, 0x66, 0x6f, 0x20, 0xfa, 0x6e, 0x69, 0x63, 0x6f]);   // "Parágrafo único" in windows-1252
  assert.equal(decodeBody(latin, "text/html; charset=ISO-8859-1"), "Parágrafo único");
  assert.equal(decodeBody(latin, "text/html"), "Parágrafo único", "no charset and not UTF-8: windows-1252");
  const meta = new TextEncoder().encode('<meta charset="windows-1252">');
  assert.equal(decodeBody(Uint8Array.from([...meta, 0xe7, 0xe3, 0x6f]), "text/html"), '<meta charset="windows-1252">ção');
  assert.equal(decodeBody(new TextEncoder().encode("ação"), "text/html; charset=utf-8"), "ação");
});

test("the excerpt of a long page around an article (Art. 51, not Art. 510), or words without accents", () => {
  const law = ["Art. 1º A locação…", "x".repeat(3000), "Art. 51. Nas locações de imóveis destinados ao comércio…", "y".repeat(3000), "Art. 510 (outro)"].join("\n");
  const parts = excerptsOf(law, "Art. 51");
  assert.equal(parts.length, 1);
  assert.match(parts[0], /Art\. 51\. Nas locações/);
  assert.doesNotMatch(parts[0], /Art\. 510/);
  assert.equal(excerptsOf("A MULTA é proporcional ao período.", "multa").length, 1);
  assert.deepEqual(excerptsOf("nada aqui", "Art. 9"), []);
});
