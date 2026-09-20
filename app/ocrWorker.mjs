import { parentPort, workerData } from "node:worker_threads";
import { createWorker } from "tesseract.js";

// A supervised thread owns Tesseract and its nested worker. Terminating this
// thread also releases a language download stuck during createWorker().
try {
  const worker = await createWorker(workerData.lang, 1, {
    langPath: workerData.langPath,
    cachePath: workerData.cachePath,
    errorHandler: () => {},
  });
  parentPort.postMessage({ ready: true });
  let queue = Promise.resolve();
  parentPort.on("message", ({ id, image }) => {
    queue = queue.then(async () => {
      try {
        const { data } = await worker.recognize(image instanceof Uint8Array ? Buffer.from(image) : image, {}, { text: true, blocks: true });
        parentPort.postMessage({ id, data: { text: data.text, words: data.words, blocks: data.blocks } });
      } catch (error) { parentPort.postMessage({ id, error: error.message || String(error) }); }
    });
  });
} catch (error) { parentPort.postMessage({ error: error.message || String(error) }); }
