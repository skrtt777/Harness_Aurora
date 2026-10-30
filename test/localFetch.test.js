import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Agent } from "undici";
import { fetchErrorText, localFetch } from "../app/localFetch.js";

// A llama-server reading a long prompt: the first byte comes late.
async function slowServer(ms) {
  const server = http.createServer((req, res) => setTimeout(() => { res.writeHead(200); res.end("ok"); }, ms));
  server.headersTimeout = 0; server.requestTimeout = 0;
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() };
}

test("a late first byte cut by the dispatcher says why, not only 'fetch failed'", async () => {
  const slow = await slowServer(1500);
  try {
    const error = await fetch(slow.url, { dispatcher: new Agent({ headersTimeout: 300 }) }).then(() => null, (e) => e);
    assert.equal(fetchErrorText(error), "fetch failed (UND_ERR_HEADERS_TIMEOUT: Headers Timeout Error)");
  } finally { slow.close(); }
});

test("localFetch waits for the late first byte (the request's own signal is the limit)", async () => {
  const slow = await slowServer(1500);
  try {
    const response = await localFetch(slow.url, { method: "POST", body: "{}", signal: AbortSignal.timeout(10_000) });
    assert.equal(await response.text(), "ok");
  } finally { slow.close(); }
});

test("fetchErrorText leaves other errors as they are", () => {
  assert.equal(fetchErrorText(new Error("HTTP 500")), "HTTP 500");
  assert.equal(fetchErrorText(new TypeError("fetch failed")), "fetch failed");
});
