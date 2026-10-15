import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { ggufStrings } = await import("../app/ggufMeta.js");
const { chatTemplateFor } = await import("../app/llamaServer.js");

/** A tiny GGUF v3 header: an array (skipped), the architecture and, if given, a chat template. */
function fakeGguf(arch, template) {
  const parts = [];
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); parts.push(b); };
  const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); parts.push(b); };
  const str = (s) => { const b = Buffer.from(s, "utf8"); u64(b.length); parts.push(b); };
  const kvs = [["tokenizer.ggml.tokens", ["<s>", "olá", "</s>"]], ["general.architecture", arch], ...(template ? [["tokenizer.chat_template", template]] : [])];
  parts.push(Buffer.from("GGUF", "latin1")); u32(3); u64(0); u64(kvs.length);
  for (const [key, value] of kvs) {
    str(key);
    if (Array.isArray(value)) { u32(9); u32(8); u64(value.length); value.forEach(str); } else { u32(8); str(value); }
  }
  const file = join(mkdtempSync(join(tmpdir(), "gguf-")), "modelo.gguf");
  writeFileSync(file, Buffer.concat(parts));
  return file;
}

test("reads string keys from a GGUF header, skipping arrays", () => {
  const file = fakeGguf("qwen35", "{% if tools %}…{% endif %}");
  assert.deepEqual(ggufStrings(file, ["general.architecture", "tokenizer.chat_template"]), { "general.architecture": "qwen35", "tokenizer.chat_template": "{% if tools %}…{% endif %}" });
  assert.deepEqual(ggufStrings(fakeGguf("mistral3"), ["tokenizer.chat_template"]), {}, "no template key: nothing found");
});

test("chat template: the GGUF's own, the official one for its architecture, or stay on Ollama", () => {
  const dir = mkdtempSync(join(tmpdir(), "templates-"));
  writeFileSync(join(dir, "mistral3.jinja"), "{{ tools }}");
  assert.deepEqual(chatTemplateFor(fakeGguf("qwen35", "{% if tools %}x{% endif %}"), { dir, env: {} }), { args: [] }, "a template with tools is kept");
  assert.deepEqual(chatTemplateFor(fakeGguf("mistral3"), { dir, env: {} }), { args: ["--chat-template-file", join(dir, "mistral3.jinja")], arch: "mistral3" });
  assert.deepEqual(chatTemplateFor(fakeGguf("mistral3", "{{ messages }}"), { dir, env: {} }).args[0], "--chat-template-file", "a template without tools is replaced too");
  assert.deepEqual(chatTemplateFor(fakeGguf("lfm2moe"), { dir, env: {} }), { args: [], arch: "lfm2moe", missing: true });
  assert.deepEqual(chatTemplateFor(fakeGguf("lfm2moe"), { dir, env: { LLAMA_SERVER_EXTRA_ARGS: "--chat-template-file x.jinja" } }), { args: [] }, "a template given by hand wins");
  assert.ok(chatTemplateFor(fakeGguf("gptoss")).args[1].endsWith("gptoss.jinja"), "the app ships gpt-oss's template");
});
