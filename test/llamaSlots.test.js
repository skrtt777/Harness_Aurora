import test from "node:test";
import assert from "node:assert/strict";
import { slotsFor } from "../app/llamaServer.js";
import { recordModelSpeed, resetModelSpeed } from "../app/modelSpeed.js";

// An integrated GPU's "VRAM" is shared system RAM, not isolated memory: two slots side by side
// (each its own 16k-token KV cache) crashed llama-server under memory pressure on a work notebook
// (Intel UHD "8 GB", 6-8 tok/s — CPU speed) while the browser, Outlook and the antivirus were also
// open ("terminated", 01/11/2026). More than one slot needs the model to have proven itself fast.
const llama = (writeTps) => [{ model: "qwen3.5:4b", engine: "llama.cpp", outputTokensPerSecond: writeTps, cachedInputTokens: 0 }, { input_tokens: 3000, output_tokens: 200 }];

test("no GPU is always one slot, whatever the reported memory", () => {
  assert.equal(slotsFor({ gpu: false, device: { memoryGb: 24 } }, {}), 1);
});

test("LLAMA_SLOTS always wins, even over an unproven GPU", () => {
  assert.equal(slotsFor({ gpu: true, device: { memoryGb: 24 } }, { LLAMA_SLOTS: "3" }), 3);
});

test("a GPU with no model given (the old call shape) keeps deciding from memory alone", () => {
  assert.equal(slotsFor({ gpu: true, device: { memoryGb: 8 } }, {}), 2);
  assert.equal(slotsFor({ gpu: true, device: { memoryGb: 24 } }, {}), 4);
});

test("a GPU that hasn't proven itself fast for this model gets one slot regardless of its claimed memory", () => {
  resetModelSpeed();
  assert.equal(slotsFor({ gpu: true, device: { memoryGb: 24 } }, {}, "qwen3.5:4b"), 1, "no history yet");
  for (const w of [6, 7, 8, 7.5, 6.5]) recordModelSpeed(...llama(w));
  assert.equal(slotsFor({ gpu: true, device: { memoryGb: 24 } }, {}, "qwen3.5:4b"), 1, "proven slow (an integrated chip)");
});

test("a GPU proven genuinely fast for this model gets slots from its memory, as before", () => {
  resetModelSpeed();
  for (const w of [60, 65, 70, 68, 62]) recordModelSpeed(...llama(w));
  assert.equal(slotsFor({ gpu: true, device: { memoryGb: 24 } }, {}, "qwen3.5:4b"), 4);
  assert.equal(slotsFor({ gpu: true, device: { memoryGb: 8 } }, {}, "qwen3.5:4b"), 2);
  assert.equal(slotsFor({ gpu: true, device: { memoryGb: 2 } }, {}, "qwen3.5:4b"), 1);
});

test("a different model's proven speed never lends its GPU trust to this one", () => {
  resetModelSpeed();
  for (const w of [60, 65, 70, 68, 62]) recordModelSpeed(...[{ ...llama(w)[0], model: "outro-modelo" }, llama(w)[1]]);
  assert.equal(slotsFor({ gpu: true, device: { memoryGb: 24 } }, {}, "qwen3.5:4b"), 1);
});
