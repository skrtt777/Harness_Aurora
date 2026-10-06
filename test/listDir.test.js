import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { likelyCopies } from "../app/agentTools/files.js";
import { executeTool } from "../app/agentTools/index.js";

test("list_dir shows sizes and dates, sorts by size or date, and points out likely copies", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aurora-listdir-"));
  writeFileSync(join(dir, "video_ferias.mp4"), Buffer.alloc(3 * 1024 * 1024));
  writeFileSync(join(dir, "boleto.pdf"), Buffer.alloc(2048));
  writeFileSync(join(dir, "boleto (1).pdf"), Buffer.alloc(2048));
  writeFileSync(join(dir, "nota.txt"), "x");
  const old = (Date.now() - 30 * 86_400_000) / 1000;
  utimesSync(join(dir, "video_ferias.mp4"), old, old);
  const ctx = { mode: "auto", workspace: dir, workspaceRoots: [dir], approve: async () => false, env: process.env };
  const bySize = (await executeTool("list_dir", { path: dir, sort: "tamanho" }, ctx)).result;
  assert.match(bySize, /maiores primeiro/);
  assert.ok(bySize.indexOf("video_ferias.mp4") < bySize.indexOf("boleto.pdf"), bySize);
  assert.match(bySize, /video_ferias\.mp4 — 3,0 MB/);
  assert.match(bySize, /Cópias prováveis[^\n]*"boleto \(1\)\.pdf" = "boleto\.pdf"/);
  const byDate = (await executeTool("list_dir", { path: dir, sort: "data" }, ctx)).result;
  assert.ok(byDate.indexOf("video_ferias.mp4") > byDate.indexOf("nota.txt"), "the old video comes last");
});

test("a 'planilha' typed as CSV text is refused with the way to an .xlsx", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aurora-csv-"));
  const ctx = { mode: "auto", workspace: dir, workspaceRoots: [dir], approve: async () => true, env: process.env, request: "Gere uma planilha com os títulos em atraso" };
  const out = await executeTool("write_file", { path: "titulos.csv", content: "Cliente,Valor\nAlfa,R$ 1.000,00" }, ctx);
  assert.equal(out.ok, false);
  assert.match(out.result, /write_document em \.xlsx \(titulos\.xlsx\)/);
  // A CSV asked for by name is written.
  const asked = await executeTool("write_file", { path: "dados.csv", content: "a;b\n1;2" }, { ...ctx, request: "salve os dados num arquivo csv" });
  assert.equal(asked.ok, true, asked.result);
});

test("likely copies need the same size, not just a similar name", () => {
  assert.deepEqual(likelyCopies([{ name: "foto.jpg", size: 10 }, { name: "foto (1).jpg", size: 10 }, { name: "foto - Cópia.jpg", size: 10 }, { name: "relatorio (1).docx", size: 5 }, { name: "relatorio.docx", size: 6 }]),
    [["foto.jpg", "foto (1).jpg"], ["foto.jpg", "foto - Cópia.jpg"]]);
});
