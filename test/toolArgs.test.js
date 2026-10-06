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
