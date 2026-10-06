import test from "node:test";
import assert from "node:assert/strict";
import { parseToolArguments } from "../app/localLlama.js";

test("tool arguments with raw line breaks inside a string are repaired", () => {
  const raw = '{"path":"cobranca.xlsx","content":"# Cobrança\n\n| Cliente | Valor |\n|---|---|\n| Alfa\t| 10 |"}';
  const args = parseToolArguments(raw, "stop");
  assert.equal(args.path, "cobranca.xlsx");
  assert.match(args.content, /\| Alfa\t\| 10 \|/);
});

test("broken tool arguments are marked: cut at the limit, or bad JSON with its start", () => {
  assert.deepEqual(parseToolArguments('{"path":"a.docx","content":"# Rel', "length"), { __cut: true });
  const bad = parseToolArguments('{"path":"a.docx","content":"ele disse "oi" e saiu"}', "stop");
  assert.equal(bad.__badjson, true);
  assert.match(bad.__raw, /^\{"path":"a\.docx"/);
  assert.deepEqual(parseToolArguments({ path: "x" }), { path: "x" }, "already an object");
  assert.deepEqual(parseToolArguments(""), {});
});

test("a document call cut at the limit keeps its whole lines, without rows said twice", async () => {
  const { salvageCut } = await import("../app/localLlama.js");
  const row = "| Alfa | Duplicata 1 | 10 |";
  const raw = `{"path":"cobranca.xlsx","content":"# Cobrança\n\n| Cliente | Título | Valor |\n|---|---|---|\n${row}\n| Beta | Duplicata 2 | 20 |\n${row}\n${row}\n| Gam`;
  const args = parseToolArguments(raw, "length");
  assert.equal(args.__salvaged, true);
  assert.equal(args.path, "cobranca.xlsx");
  assert.equal(args.content.split("\n").filter((l) => l === row).length, 1);
  assert.match(args.content, /Duplicata 2/);
  assert.doesNotMatch(args.content, /Gam/);
  assert.equal(salvageCut('{"path":"a.md","content":"sem quebra'), null);
});
