import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { chromium } from "playwright";

const { buildAgentPrompt, normalizeGotoUrl, parseAction, executeAction, runBrowserAgent } = await import("../app/browserAgent.js");

// This sandbox's pre-installed Chromium (see the environment notes) is a
// slightly older revision than the `playwright` npm version this project
// depends on, so Playwright's own auto-resolved executablePath() doesn't
// match it — pointing at it explicitly is what the project's own dev
// environment already does for this kind of test, not something a real
// user's machine needs (there, Playwright's normally-downloaded browser
// matches its own revision).
const CHROMIUM_PATH = process.env.CHROMIUM_EXECUTABLE_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

// ---------- Pure logic: parseAction ----------

test("parseAction parses a plain JSON action", () => {
  assert.deepEqual(parseAction('{"action":"click","target":"Salvar"}'), { action: "click", target: "Salvar" });
});

test("parseAction strips a markdown code fence around the JSON", () => {
  const raw = 'Aqui está a ação:\n```json\n{"action":"type","text":"oi"}\n```\nEspero que ajude.';
  assert.deepEqual(parseAction(raw), { action: "type", text: "oi" });
});

test("parseAction extracts JSON even with prose before/after it", () => {
  const raw = 'Vou clicar no botão. {"action":"click","target":"Enviar"} Isso deve funcionar.';
  assert.deepEqual(parseAction(raw), { action: "click", target: "Enviar" });
});

test("parseAction returns null for an unrecognized action name", () => {
  assert.equal(parseAction('{"action":"destroy_computer"}'), null);
});

test("parseAction returns null for malformed JSON, empty, or non-object input", () => {
  assert.equal(parseAction("{not valid json"), null);
  assert.equal(parseAction(""), null);
  assert.equal(parseAction(null), null);
  assert.equal(parseAction("[1,2,3]"), null);
});

// ---------- Pure logic: normalizeGotoUrl ----------

test("normalizeGotoUrl adds https:// to a bare domain, and leaves an already-schemed URL alone", () => {
  assert.equal(normalizeGotoUrl("powerapps.microsoft.com"), "https://powerapps.microsoft.com");
  assert.equal(normalizeGotoUrl("https://example.com"), "https://example.com");
  assert.equal(normalizeGotoUrl("http://example.com"), "http://example.com");
});

// ---------- Pure logic: buildAgentPrompt ----------

test("buildAgentPrompt includes the goal, current URL, OCR text, and recent history", () => {
  const prompt = buildAgentPrompt({
    goal: "Enviar o relatório mensal",
    url: "https://powerapps.example.com/app",
    ocrText: "Enviar Relatório\nSalvar",
    history: [{ action: { action: "click", target: "Salvar" }, execResult: { ok: false, error: "não encontrado" } }],
  });
  assert.match(prompt, /Enviar o relatório mensal/);
  assert.match(prompt, /powerapps\.example\.com/);
  assert.match(prompt, /Enviar Relatório/);
  assert.match(prompt, /clicar em "Salvar"/);
  assert.match(prompt, /falhou: não encontrado/);
});

test("buildAgentPrompt handles no history and no OCR text gracefully", () => {
  const prompt = buildAgentPrompt({ goal: "abrir o site", url: "", ocrText: "", history: [] });
  assert.match(prompt, /nenhuma ação ainda/);
  assert.match(prompt, /nenhum texto detectado/);
});

// ---------- Real browser: executeAction against a real (headless) page ----------

async function withPage(run) {
  const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_PATH });
  try {
    const page = await browser.newPage();
    await run(page);
  } finally {
    await browser.close();
  }
}

const TEST_PAGE_HTML = `data:text/html,${encodeURIComponent(`
  <html><body style="margin:0">
    <button id="save" onclick="document.getElementById('out').textContent='clicked'"
            style="position:absolute;left:10px;top:10px;width:80px;height:30px;">Salvar</button>
    <input id="name" style="position:absolute;left:10px;top:60px;width:200px;height:30px;" />
    <div id="out"></div>
  </body></html>
`)}`;

test("executeAction: click resolves the target text to real coordinates and clicks it", async () => {
  await withPage(async (page) => {
    await page.goto(TEST_PAGE_HTML);
    // A hand-built word box matching where "Salvar" is actually rendered
    // (see the button's inline style above) — standing in for what OCR
    // would have reported for this screenshot.
    const words = [{ text: "Salvar", x0: 10, y0: 10, x1: 90, y1: 40 }];
    const result = await executeAction(page, { action: "click", target: "Salvar" }, words);
    assert.equal(result.ok, true);
    assert.equal(await page.locator("#out").textContent(), "clicked");
  });
});

test("executeAction: click returns a clear error when the target text isn't in the OCR word list", async () => {
  await withPage(async (page) => {
    await page.goto(TEST_PAGE_HTML);
    const result = await executeAction(page, { action: "click", target: "Excluir" }, []);
    assert.equal(result.ok, false);
    assert.match(result.error, /Excluir/);
  });
});

test("executeAction: type sends keystrokes to whatever currently has focus", async () => {
  await withPage(async (page) => {
    await page.goto(TEST_PAGE_HTML);
    await page.locator("#name").click();
    const result = await executeAction(page, { action: "type", text: "Abraão" }, []);
    assert.equal(result.ok, true);
    assert.equal(await page.locator("#name").inputValue(), "Abraão");
  });
});

test("executeAction: goto navigates to a real URL", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<h1>ok</h1>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await withPage(async (page) => {
      const result = await executeAction(page, { action: "goto", url: `http://127.0.0.1:${server.address().port}` }, []);
      assert.equal(result.ok, true);
      assert.match(page.url(), /^http:\/\/127\.0\.0\.1:\d+\/$/);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("executeAction: goto without a URL fails clearly instead of navigating nowhere", async () => {
  await withPage(async (page) => {
    const result = await executeAction(page, { action: "goto", url: "" }, []);
    assert.equal(result.ok, false);
  });
});

test("executeAction: key and scroll run without error against a real page", async () => {
  await withPage(async (page) => {
    await page.goto(TEST_PAGE_HTML);
    assert.equal((await executeAction(page, { action: "key", key: "Tab" }, [])).ok, true);
    assert.equal((await executeAction(page, { action: "scroll", dy: 200 }, [])).ok, true);
  });
});

test("executeAction: wait respects an explicit 0ms instead of falling back to the 1000ms default", async () => {
  await withPage(async (page) => {
    const start = Date.now();
    const result = await executeAction(page, { action: "wait", ms: 0 }, []);
    assert.equal(result.ok, true);
    assert.ok(Date.now() - start < 500, "an explicit ms:0 should not wait a full second");
  });
});

test("executeAction: finish is a no-op that reports finished", async () => {
  await withPage(async (page) => {
    await page.goto(TEST_PAGE_HTML);
    const result = await executeAction(page, { action: "finish", reason: "pronto" }, []);
    assert.deepEqual(result, { ok: true, finished: true });
  });
});

// ---------- Orchestration: runBrowserAgent's loop ----------

// A minimal fake page for loop-level tests (step counting, history, the
// finish/cancel/step-limit exits) — executeAction's own real-browser
// behavior is already covered above, so this only needs to satisfy the
// methods the loop actually calls.
function fakePage(url = "https://example.com") {
  return {
    url: () => url,
    screenshot: async () => Buffer.from("fake-screenshot"),
    mouse: { click: async () => {}, wheel: async () => {} },
    keyboard: { type: async () => {}, press: async () => {} },
    goto: async () => {},
  };
}

test("runBrowserAgent stops as soon as the model calls finish", async () => {
  const page = fakePage();
  const steps = [];
  const result = await runBrowserAgent({
    page,
    goal: "tarefa de teste",
    recognize: async () => ({ text: "algo na tela", words: [] }),
    ask: async () => ({ ok: true, text: '{"action":"finish","reason":"tudo pronto"}' }),
    onStep: (event) => steps.push(event),
  });
  assert.equal(result.ok, true);
  assert.equal(result.done, true);
  assert.equal(result.reason, "tudo pronto");
  assert.equal(result.history.length, 1);
  assert.ok(steps.some((s) => s.stage === "finished"));
});

test("runBrowserAgent executes a click action, records it in history, and feeds the result back next step", async () => {
  const page = fakePage();
  let call = 0;
  const asked = [];
  const result = await runBrowserAgent({
    page,
    goal: "clicar em salvar",
    recognize: async () => ({ text: "Salvar", words: [{ text: "Salvar", x0: 0, y0: 0, x1: 10, y1: 10 }] }),
    ask: async (prompt) => {
      call += 1;
      asked.push(prompt);
      if (call === 1) return { ok: true, text: '{"action":"click","target":"Salvar"}' };
      return { ok: true, text: '{"action":"finish","reason":"cliquei"}' };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.history.length, 2);
  assert.equal(result.history[0].action.action, "click");
  assert.equal(result.history[0].execResult.ok, true);
  // The second prompt should mention the first (successful) action, so the
  // model doesn't repeat work it already did.
  assert.match(asked[1], /clicar em "Salvar" → ok/);
});

test("runBrowserAgent treats an unparsable model reply as a step that failed, without crashing the loop", async () => {
  const page = fakePage();
  let call = 0;
  const result = await runBrowserAgent({
    page,
    goal: "teste",
    recognize: async () => ({ text: "", words: [] }),
    ask: async () => {
      call += 1;
      return call === 1 ? { ok: true, text: "desculpe, não sei o que fazer" } : { ok: true, text: '{"action":"finish","reason":"desisto"}' };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.history.length, 2);
  assert.equal(result.history[0].execResult.ok, false);
});

test("runBrowserAgent stops and reports an error when the model call itself fails", async () => {
  const page = fakePage();
  const result = await runBrowserAgent({
    page,
    goal: "teste",
    recognize: async () => ({ text: "", words: [] }),
    ask: async () => ({ ok: false, error: "Ollama fora do ar" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Ollama fora do ar");
});

test("runBrowserAgent gives up after maxSteps without a finish, instead of looping forever", async () => {
  const page = fakePage();
  const result = await runBrowserAgent({
    page,
    goal: "tarefa impossível",
    maxSteps: 3,
    recognize: async () => ({ text: "", words: [] }),
    ask: async () => ({ ok: true, text: '{"action":"wait","ms":0}' }),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Limite de passos/);
  assert.equal(result.history.length, 3);
});

test("runBrowserAgent stops immediately when the signal is already aborted", async () => {
  const page = fakePage();
  const controller = new AbortController();
  controller.abort();
  const result = await runBrowserAgent({
    page,
    goal: "teste",
    signal: controller.signal,
    recognize: async () => ({ text: "", words: [] }),
    ask: async () => ({ ok: true, text: '{"action":"finish"}' }),
  });
  assert.equal(result.cancelled, true);
  assert.equal(result.history.length, 0);
});
