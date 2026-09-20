import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";

// Default: English + Portuguese, since this app is used in Portuguese but
// the screens it looks at (browser UIs, PowerApps, ...) are frequently in
// English. OCR_LANG overrides (Tesseract language codes, "+"-joined).
const DEFAULT_LANG = "eng+por";

let workerPromise = null;

/**
 * Tesseract workers are expensive to start (loads the WASM core + trained
 * language data, ~1-3s and a real download the first time) — kept warm and
 * reused across recognizeImage() calls instead of recreated per screenshot,
 * the same "keep the expensive thing warm" pattern startOllamaServer() uses
 * for the chat model itself. A failed start clears the cached promise so the
 * next call gets a fresh attempt instead of a permanently broken worker.
 */
async function getWorker(env = process.env) {
  if (env.OCR_CACHE_PATH) await mkdir(env.OCR_CACHE_PATH, { recursive: true });
  if (!workerPromise) {
    const file = fileURLToPath(new URL("./ocrWorker.mjs", import.meta.url)).replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
    const thread = new Worker(file, { execArgv: [], workerData: {
      lang: env.OCR_LANG || DEFAULT_LANG,
      langPath: env.OCR_LANG_PATH || undefined,
      cachePath: env.OCR_CACHE_PATH || undefined,
    } });
    activeThread = thread;
    workerPromise = new Promise((resolve, reject) => {
      const pending = new Map();
      let sequence = 0;
      const fail = error => {
        clearTimeout(timer);
        reject(error);
        for (const job of pending.values()) job.reject(error);
        pending.clear();
        if (activeThread === thread) { activeThread = null; workerPromise = null; stopWorker = null; }
        void thread.terminate();
      };
      const timer = setTimeout(() => fail(new Error("Tempo esgotado preparando o OCR.")), Number(env.OCR_START_TIMEOUT_MS) || 45000);
      stopWorker = fail;
      thread.on("error", fail);
      thread.on("exit", code => {
        if (activeThread === thread) fail(new Error(`OCR encerrado (código ${code}).`));
      });
      thread.on("message", message => {
        if (message.ready) {
          clearTimeout(timer);
          resolve({
            recognize(image) {
              return new Promise((resolve, reject) => {
                const id = ++sequence;
                pending.set(id, { resolve, reject });
                thread.postMessage({ id, image });
              });
            },
            terminate: () => { fail(new Error("OCR encerrado.")); return thread.terminate(); },
          });
        } else if (message.id) {
          const job = pending.get(message.id);
          pending.delete(message.id);
          if (message.error) job?.reject(new Error(message.error));
          else job?.resolve({ data: message.data });
        } else if (message.error) fail(new Error(message.error));
      });
    });
  }
  return workerPromise;
}
let activeThread = null;
let stopWorker = null;

/**
 * Runs OCR on a screenshot (Buffer, data URL, or file path — anything
 * tesseract.js's recognize() accepts) and returns both the full text and
 * each recognized word's bounding box, in the pixel coordinates of the
 * image itself — exactly what's needed both to give the local model
 * something to read and to translate "click the text X" into real
 * page.mouse.click(x, y) coordinates in app/browserAgent.js.
 */
export async function recognizeImage(image, env = process.env) {
  const worker = await getWorker(env);
  let timer;
  let data;
  try {
    ({ data } = await Promise.race([
      worker.recognize(image, {}, { text: true, blocks: true }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Tempo esgotado lendo a imagem.")), Number(env.OCR_TIMEOUT_MS) || 45000); }),
    ]));
  } catch (error) { workerPromise = null; await worker.terminate(); throw error; }
  finally { clearTimeout(timer); }
  return mapOcrData(data);
}

export function mapOcrData(data) {
  const words = data.words || (data.blocks || []).flatMap(b => b.paragraphs || []).flatMap(p => p.lines || []).flatMap(l => l.words || []);
  return {
    text: data.text || "",
    words: words
      .filter((w) => w.text && w.text.trim() && w.bbox)
      .map((w) => ({
        text: w.text,
        confidence: w.confidence,
        x0: w.bbox.x0,
        y0: w.bbox.y0,
        x1: w.bbox.x1,
        y1: w.bbox.y1,
      })),
  };
}

/** Releases the Tesseract worker. Call on app shutdown, not between screenshots. */
export async function terminateOcr() {
  const thread = activeThread;
  stopWorker?.(new Error("OCR encerrado."));
  activeThread = null;
  workerPromise = null;
  if (thread) await thread.terminate();
}

export function resetOcrWorkerForTests() {
  workerPromise = null;
}

// ---------- Pure matching logic (no Tesseract, no network — independently testable) ----------

/**
 * Lowercases and strips accents so "Relatório" matches a query of
 * "relatorio" — the local model won't reliably reproduce Portuguese
 * diacritics exactly, and OCR itself sometimes drops them too.
 */
function normalize(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function centerOf(box) {
  return { x: Math.round((box.x0 + box.x1) / 2), y: Math.round((box.y0 + box.y1) / 2) };
}

function mergeBoxes(boxes) {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

/**
 * Finds the on-screen location of a text target the model asked to click,
 * given the word list recognizeImage() returned. Tries, in order: (1) a
 * single word that equals or contains the (normalized) query — covers most
 * button/link labels; (2) a sliding window over consecutive words (as
 * Tesseract returns them, left-to-right/top-to-bottom reading order) whose
 * joined text contains the query — covers multi-word labels like "Enviar
 * Relatório". Returns the merged bounding box of the match, or null.
 *
 * This is a heuristic, not a real accessibility tree: reading order isn't
 * always visual order for complex layouts, and a repeated label ("Salvar"
 * appearing twice) resolves to whichever occurrence comes first. Good
 * enough for the flat, mostly-linear screens (forms, buttons, menus) this
 * agent is built for; not a substitute for a real DOM-aware locator.
 */
export function findTextBox(words, query) {
  const target = normalize(query);
  if (!target || !words.length) return null;
  const targetWordCount = target.split(/\s+/).length;

  // A multi-word query is tried as a phrase first — checking single-word
  // substring containment first would let e.g. "Enviar" (contained in the
  // query "Enviar Relatório") match and return early with only half the
  // label's box.
  if (targetWordCount > 1) {
    for (let i = 0; i <= words.length - targetWordCount; i += 1) {
      const slice = words.slice(i, i + targetWordCount);
      const joined = normalize(slice.map((w) => w.text).join(" "));
      if (joined === target || joined.includes(target)) return mergeBoxes(slice);
    }
  }

  for (const word of words) {
    if (normalize(word.text) === target) return { x0: word.x0, y0: word.y0, x1: word.x1, y1: word.y1 };
  }
  for (const word of words) {
    const w = normalize(word.text);
    if (w && (w.includes(target) || target.includes(w))) return { x0: word.x0, y0: word.y0, x1: word.x1, y1: word.y1 };
  }
  return null;
}
