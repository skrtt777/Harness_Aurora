// What a GGUF model file says about itself (architecture, layers, MTP/next-token heads), from its header only.
//   node scripts/gguf-info.mjs <arquivo.gguf | modelo do Ollama, ex.: qwen3.5:4b>
import { openSync, readSync, closeSync, existsSync } from "node:fs";
import { ollamaModelBlob } from "../app/llamaServer.js";

const target = process.argv[2] || "qwen3.5:4b";
const file = existsSync(target) ? target : ollamaModelBlob(target);
if (!file) { console.error(`modelo não encontrado: ${target}`); process.exit(1); }
const fd = openSync(file, "r");
let pos = 0;
const read = (n) => { const b = Buffer.alloc(n); readSync(fd, b, 0, n, pos); pos += n; return b; };
const u32 = () => read(4).readUInt32LE(0);
const u64 = () => Number(read(8).readBigUInt64LE(0));
const str = () => read(u64()).toString("utf8");
const TYPES = { 0: () => read(1).readUInt8(0), 1: () => read(1).readInt8(0), 2: () => read(2).readUInt16LE(0), 3: () => read(2).readInt16LE(0), 4: u32, 5: () => read(4).readInt32LE(0), 6: () => read(4).readFloatLE(0), 7: () => read(1).readUInt8(0) !== 0, 8: str, 10: u64, 11: () => Number(read(8).readBigInt64LE(0)), 12: () => read(8).readDoubleLE(0) };
const value = (type) => {
  if (type === 9) { const inner = u32(); const n = u64(); const out = []; for (let i = 0; i < n; i += 1) out.push(value(inner)); return n > 8 ? `[${n} itens]` : out; }
  return TYPES[type]();
};
if (read(4).toString() !== "GGUF") throw new Error("não é um GGUF");
const version = u32(); const tensors = u64(); const kvs = u64();
const meta = {};
for (let i = 0; i < kvs; i += 1) { const key = str(); meta[key] = value(u32()); }
const names = [];
for (let i = 0; i < tensors; i += 1) { const name = str(); const dims = u32(); for (let d = 0; d < dims; d += 1) u64(); u32(); u64(); names.push(name); }
closeSync(fd);
const arch = meta["general.architecture"];
console.log(`arquivo: ${file}\nGGUF v${version}, ${tensors} tensores, arquitetura ${arch}`);
for (const [k, v] of Object.entries(meta)) if (/block_count|nextn|mtp|context_length|embedding_length|full_attention|ssm|linear|expert/i.test(k)) console.log(`  ${k} = ${JSON.stringify(v)}`);
const blocks = new Set(names.map((n) => /^blk\.(\d+)\./.exec(n)?.[1]).filter(Boolean));
const mtp = names.filter((n) => /nextn|mtp/i.test(n));
console.log(`camadas com tensores: ${blocks.size}; tensores de MTP/nextn: ${mtp.length}${mtp.length ? ` (ex.: ${mtp.slice(0, 4).join(", ")})` : ""}`);
