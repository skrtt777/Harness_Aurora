import test from 'node:test';
import assert from 'node:assert/strict';
import { needsPatientTimeout } from '../app/local.js';

// A device Vulkan/CUDA can see is not necessarily fast: an integrated chip (Intel UHD, shared
// system RAM) reported gpu:true and still wrote at 6-8 tok/s on a work notebook (30/10/2026),
// the same as plain CPU — the 5-min GPU-tier wait cut a turn in the middle with a bare
// "fetch failed"/abort instead of the 15-min CPU-tier wait the app otherwise gives weak hardware.

test('no GPU reported (plain CPU) always gets the patient wait', () => {
  assert.equal(needsPatientTimeout('qwen3.5:4b', { info: { gpu: false, healthy: true } }), true);
});

test('no server info at all keeps the original short default (a mocked/test env, not a real GPU claim)', () => {
  assert.equal(needsPatientTimeout('qwen3.5:4b', { info: null }), false);
});

test('a GPU Vulkan sees, with no proven speed yet, gets the patient wait (not assumed fast)', () => {
  const info = { model: 'qwen3.5:4b', gpu: true, healthy: true };
  assert.equal(needsPatientTimeout('qwen3.5:4b', { info, samples: [] }), true);
});

test('a GPU that has only shown itself slow (an integrated chip) keeps the patient wait', () => {
  const info = { gpu: true, healthy: true };
  const slowSamples = Array.from({ length: 6 }, () => ({ model: 'qwen3.5:4b', engine: 'llama.cpp', writeTps: 7.6, outTokens: 500 }));
  assert.equal(needsPatientTimeout('qwen3.5:4b', { info, samples: slowSamples }), true);
});

test('a GPU proven genuinely fast gets the shorter default wait', () => {
  const info = { gpu: true, healthy: true };
  const fastSamples = Array.from({ length: 6 }, () => ({ model: 'qwen3.5:4b', engine: 'llama.cpp', writeTps: 60, outTokens: 500 }));
  assert.equal(needsPatientTimeout('qwen3.5:4b', { info, samples: fastSamples }), false);
});

test('a fast reading for a DIFFERENT model never excuses this one from the patient wait', () => {
  const info = { gpu: true, healthy: true };
  const otherModelSamples = Array.from({ length: 6 }, () => ({ model: 'outro-modelo', engine: 'llama.cpp', writeTps: 60, outTokens: 500 }));
  assert.equal(needsPatientTimeout('qwen3.5:4b', { info, samples: otherModelSamples }), true);
});
