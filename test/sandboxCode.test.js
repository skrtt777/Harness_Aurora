import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile as readFileFs } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extractRunnableHtml, materializeSandboxFile, readSandboxFile, sandboxFilePath, slugify } from "../app/sandboxCode.js";

// ---------- extractRunnableHtml ----------

test("extractRunnableHtml prefers a fenced ```html block, used as-is", () => {
  const content = 'Aqui está o jogo:\n\n```html\n<!DOCTYPE html>\n<html><body>oi</body></html>\n```\n\nTestei e funciona.';
  const result = extractRunnableHtml(content);
  assert.equal(result.source, "html-fenced");
  assert.equal(result.html, "<!DOCTYPE html>\n<html><body>oi</body></html>");
});

test("extractRunnableHtml falls back to a raw (unfenced) HTML document", () => {
  const content = "Segue o código:\n<!DOCTYPE html>\n<html><body><h1>Jogo</h1></body></html>\nEspero que ajude.";
  const result = extractRunnableHtml(content);
  assert.equal(result.source, "raw-html");
  assert.match(result.html, /^<!DOCTYPE html/);
  assert.match(result.html, /<\/html>$/i);
  assert.ok(!result.html.includes("Espero que ajude"));
});

test("extractRunnableHtml wraps a fenced JS-only block in a minimal HTML shell", () => {
  const content = "```javascript\nconsole.log('oi');\n```";
  const result = extractRunnableHtml(content);
  assert.equal(result.source, "js-fenced");
  assert.match(result.html, /<script type="module">/);
  assert.match(result.html, /console\.log\('oi'\)/);
  assert.match(result.html, /<\/html>/);
});

test("extractRunnableHtml wraps a bare <script> tag with no html wrapper at all", () => {
  const content = "Aqui está: <script>alert('oi');</script> pronto.";
  const result = extractRunnableHtml(content);
  assert.equal(result.source, "bare-script");
  assert.match(result.html, /alert\('oi'\)/);
});

test("extractRunnableHtml returns null for plain-text answers with no code", () => {
  assert.equal(extractRunnableHtml("Claro, aqui está a explicação em texto normal, sem nenhum código."), null);
  assert.equal(extractRunnableHtml(""), null);
  assert.equal(extractRunnableHtml(null), null);
});

test("extractRunnableHtml ignores a <script src=...> tag with no inline body", () => {
  assert.equal(extractRunnableHtml('Use a lib: <script src="https://cdn.example.com/lib.js"></script>'), null);
});

// ---------- slugify ----------

test("slugify turns a conversation title into a filesystem-safe folder name", () => {
  assert.equal(slugify("Crie um jogo simples em Three.js: um cubo", "fallback"), "crie-um-jogo-simples-em-three-js-um-cubo");
});

test("slugify strips accents and falls back when nothing usable remains", () => {
  assert.equal(slugify("Configuração", "fallback"), "configuracao");
  assert.equal(slugify("!!! 😀 !!!", "conv-123"), "conv-123");
  assert.equal(slugify("", "conv-123"), "conv-123");
});

// ---------- sandboxFilePath / materializeSandboxFile / readSandboxFile ----------

test("materializeSandboxFile writes the file under a slugified conversation subfolder, creating dirs as needed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "harness-sandbox-"));
  const filePath = await materializeSandboxFile(dir, {
    conversationId: "conv-1",
    conversationTitle: "Crie um jogo simples em Three.js",
    messageId: "msg-1",
    html: "<html><body>jogo</body></html>",
  });
  assert.equal(filePath, join(dir, "crie-um-jogo-simples-em-three-js", "msg-1.html"));
  const onDisk = await readFileFs(filePath, "utf8");
  assert.equal(onDisk, "<html><body>jogo</body></html>");
});

test("materializeSandboxFile overwrites on a second run for the same message instead of duplicating", async () => {
  const dir = await mkdtemp(join(tmpdir(), "harness-sandbox-"));
  const args = { conversationId: "conv-1", conversationTitle: "Meu jogo", messageId: "msg-1" };
  await materializeSandboxFile(dir, { ...args, html: "<html>v1</html>" });
  const filePath = await materializeSandboxFile(dir, { ...args, html: "<html>v2</html>" });
  const onDisk = await readFileFs(filePath, "utf8");
  assert.equal(onDisk, "<html>v2</html>");
});

test("sandboxFilePath falls back to the conversation id when the title has nothing slug-worthy", () => {
  const path = sandboxFilePath("/base", { conversationId: "conv-abc", conversationTitle: "😀", messageId: "m1" });
  assert.equal(path, join("/base", "conv-abc", "m1.html"));
});

test("readSandboxFile returns the content written by materializeSandboxFile", async () => {
  const dir = await mkdtemp(join(tmpdir(), "harness-sandbox-"));
  const args = { conversationId: "conv-2", conversationTitle: "Outro jogo", messageId: "msg-2" };
  await materializeSandboxFile(dir, { ...args, html: "<html>conteudo</html>" });
  const content = await readSandboxFile(dir, args);
  assert.equal(content, "<html>conteudo</html>");
});

test("readSandboxFile returns null when nothing was ever materialized for that message", async () => {
  const dir = await mkdtemp(join(tmpdir(), "harness-sandbox-"));
  const content = await readSandboxFile(dir, { conversationId: "conv-3", conversationTitle: "Nada ainda", messageId: "msg-999" });
  assert.equal(content, null);
});
