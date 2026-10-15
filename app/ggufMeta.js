import { closeSync, openSync, readSync } from "node:fs";

/**
 * Reads string keys from a GGUF file's metadata (the header before the weights), without loading
 * the weights. Used to know whether a model brings its own chat template (14/10: ministral-3 and
 * gpt-oss from Ollama come without one, and llama-server fell back to a template with no tools).
 */
export function ggufStrings(file, wanted) {
  const want = new Set(wanted);
  const found = {};
  const fd = openSync(file, "r");
  let buf = Buffer.alloc(0);
  let pos = 0;
  let filePos = 0;
  const need = (n) => {
    if (buf.length - pos >= n) return;
    const rest = buf.subarray(pos);
    const chunk = Buffer.alloc(Math.max(n - rest.length, 1 << 20));
    const read = readSync(fd, chunk, 0, chunk.length, filePos);
    filePos += read;
    buf = Buffer.concat([rest, chunk.subarray(0, read)]);
    pos = 0;
    if (buf.length < n) throw new Error("GGUF cortado");
  };
  const u32 = () => { need(4); const v = buf.readUInt32LE(pos); pos += 4; return v; };
  const u64 = () => { need(8); const v = Number(buf.readBigUInt64LE(pos)); pos += 8; return v; };
  const str = () => { const n = u64(); need(n); const v = buf.toString("utf8", pos, pos + n); pos += n; return v; };
  const SIZE = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
  const skip = (type) => {
    if (type === 8) { const n = u64(); need(n); pos += n; return; }
    if (type === 9) { const inner = u32(); const count = u64(); for (let i = 0; i < count; i++) skip(inner); return; }
    const size = SIZE[type];
    if (!size) throw new Error(`tipo GGUF ${type} desconhecido`);
    need(size); pos += size;
  };
  try {
    need(4);
    if (buf.toString("latin1", 0, 4) !== "GGUF") return found;
    pos = 4;
    const version = u32();
    if (version < 2) return found;
    u64(); // tensors
    const kvs = u64();
    for (let i = 0; i < kvs && Object.keys(found).length < want.size; i++) {
      const key = str();
      const type = u32();
      if (want.has(key) && type === 8) found[key] = str();
      else skip(type);
    }
  } finally {
    closeSync(fd);
  }
  return found;
}
