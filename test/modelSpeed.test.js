import test from "node:test";
import assert from "node:assert/strict";
import { memoryEvents } from "../app/memoryEvents.js";
import { modelSpeedState, normalSpeed, recordModelSpeed, resetModelSpeed, speedSample } from "../app/modelSpeed.js";

const llama = (write, read, out = 200, input = 3000, cached = 2500) => [{ model: "qwen3.5:4b", engine: "llama.cpp", promptTokensPerSecond: read, outputTokensPerSecond: write, cachedInputTokens: cached, wallMs: 2000 }, { input_tokens: input, output_tokens: out }];

test("a call's speed from llama.cpp's timings and from Ollama's durations", () => {
  const a = speedSample(...llama(150.04, 2400));
  assert.equal(a.engine, "llama.cpp"); assert.equal(a.writeTps, 150); assert.equal(a.readTps, 2400);
  assert.equal(a.cacheShare, 2500 / 3000);
  // Ollama: durations in nanoseconds; reading counts only what was not in the cache.
  const b = speedSample({ model: "qwen3.5:4b", eval_duration: 2e9, prompt_eval_duration: 0.5e9, cachedInputTokens: 1000 }, { input_tokens: 2000, output_tokens: 300 });
  assert.equal(b.engine, "ollama"); assert.equal(b.writeTps, 150); assert.equal(b.readTps, 2000);
});

test("normal is the faster half of the model's measurable calls; a call far below it is flagged slow and streamed", () => {
  resetModelSpeed();
  const seen = [];
  const on = (e) => { if (e.type === "speed") seen.push(e); };
  memoryEvents.on("event", on);
  for (const w of [140, 150, 155, 160, 158, 152]) recordModelSpeed(...llama(w, 2400));
  // A short answer says nothing about speed: never slow, never in normal.
  recordModelSpeed(...llama(20, 2400, 5));
  const slow = recordModelSpeed(...llama(64, 900));
  memoryEvents.off("event", on);
  assert.equal(seen.length, 8);
  assert.equal(seen[6].slow, false);
  assert.equal(slow.slow, true);
  assert.ok(slow.normal >= 152 && slow.normal <= 158, `normal ${slow.normal}`);
  assert.equal(normalSpeed([], "x", "llama.cpp"), null);
  const state = modelSpeedState();
  assert.equal(state.calls.length, 8);
  assert.ok(state.normal.writeTps > 140);
  assert.equal(recordModelSpeed(null), null);
});
