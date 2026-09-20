import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Pulls a runnable HTML document out of an assistant message so it can be
 * saved to a real file and actually opened/previewed — not just read as
 * text. Tries, in order of how confident the result is:
 *  1. A fenced ```html code block (what the local model's own game-building
 *     prompts already ask for, per app/localRefine.js) — used as-is, it's
 *     already a complete document.
 *  2. A raw (unfenced) HTML document somewhere in the text, from its
 *     `<!DOCTYPE html>`/`<html` tag onward — some smaller local models drop
 *     the fence but still write real HTML.
 *  3. A fenced ```javascript/```js block, or a bare `<script>` tag with no
 *     surrounding <html> at all — wrapped in a minimal HTML shell so a
 *     script-only answer can still run in a real page.
 * Returns null when nothing that looks executable is found (a plain-text
 * answer, an explanation with no code, etc.) — the caller uses that to
 * decide whether to offer "Executar" at all.
 */
export function extractRunnableHtml(content) {
  const text = String(content || "");

  const htmlFence = text.match(/```html\s*\n([\s\S]*?)```/i);
  if (htmlFence && htmlFence[1].trim()) {
    return { html: htmlFence[1].trim(), source: "html-fenced" };
  }

  const rawHtmlStart = text.match(/<!DOCTYPE html[^>]*>|<html[\s>]/i);
  if (rawHtmlStart) {
    const start = rawHtmlStart.index;
    const closeMatch = text.slice(start).match(/<\/html\s*>/i);
    const end = closeMatch ? start + closeMatch.index + closeMatch[0].length : text.length;
    const html = text.slice(start, end).trim();
    if (html) return { html, source: "raw-html" };
  }

  const jsFence = text.match(/```(?:javascript|js)\s*\n([\s\S]*?)```/i);
  if (jsFence && jsFence[1].trim()) {
    return { html: wrapScriptInHtml(jsFence[1].trim()), source: "js-fenced" };
  }

  const bareScript = text.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/i);
  if (bareScript && bareScript[1].trim()) {
    return { html: wrapScriptInHtml(bareScript[1].trim()), source: "bare-script" };
  }

  return null;
}

function wrapScriptInHtml(js) {
  return [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8" /></head><body>',
    '<script type="module">',
    js,
    "</script>",
    "</body></html>",
  ].join("\n");
}

/**
 * Turns free text (a conversation title, which can contain anything) into a
 * filesystem-safe folder name — kept short and readable rather than hashed,
 * so the user actually recognizes it in their file explorer. Falls back to
 * the id when the title is empty or reduces to nothing usable (e.g. only
 * punctuation/emoji).
 */
export function slugify(text, fallback) {
  const slug = String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || fallback;
}

/**
 * Where a given message's sandbox file would live — a pure, deterministic
 * function of (sandboxDir, conversation, message), so both "materialize it"
 * and "serve whatever was last materialized" compute the exact same path
 * without needing any extra database table to remember it.
 */
export function sandboxFilePath(sandboxDir, { conversationId, conversationTitle, messageId }) {
  if (![conversationId, messageId].every(id => typeof id === "string" && /^[a-zA-Z0-9_-]+$/.test(id))) throw new Error("Identificador de sandbox inválido.");
  const folder = `conversation-${conversationId}`;
  return join(sandboxDir, folder, `${messageId}.html`);
}

/**
 * Writes the extracted HTML to disk, creating the conversation's subfolder
 * as needed. Re-running this for the same message overwrites the previous
 * file instead of piling up duplicates — "Executar" always reflects the
 * message's current content.
 */
export async function materializeSandboxFile(sandboxDir, { conversationId, conversationTitle, messageId, html }) {
  const filePath = sandboxFilePath(sandboxDir, { conversationId, conversationTitle, messageId });
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, html, "utf8");
  return filePath;
}

/** Re-reads a previously materialized file, or null if "Executar" hasn't been run yet (or the file was moved/deleted since). */
export async function readSandboxFile(sandboxDir, { conversationId, conversationTitle, messageId }) {
  const filePath = sandboxFilePath(sandboxDir, { conversationId, conversationTitle, messageId });
  try {
    return await readFile(filePath, "utf8");
  } catch {
    // Read legacy title-based paths without moving or deleting user artifacts.
    try { return await readFile(join(sandboxDir, slugify(conversationTitle, conversationId), `${messageId}.html`), "utf8"); }
    catch { return null; }
  }
}
