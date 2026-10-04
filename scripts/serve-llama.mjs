// Starts llama-server on the weights Ollama already downloaded (no second copy).
//   node scripts/serve-llama.mjs --model qwen3.6:35b [--n-cpu-moe 99] [--ngl 99] [--ctx 20480] [--port 18080]
// Defaults: F:\Modelos_Aurora\ollama (models) and F:\Modelos_Aurora\llama.cpp\cuda (binaries);
// override with OLLAMA_MODELS / LLAMA_BIN_DIR. Prints the blob path and runs in the foreground.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const modelsDir = process.env.OLLAMA_MODELS || "F:\\Modelos_Aurora\\ollama";
const binDir = process.env.LLAMA_BIN_DIR || "F:\\Modelos_Aurora\\llama.cpp\\cuda";

export function ollamaBlob(model, dir = modelsDir) {
  const [name, tag = "latest"] = model.split(":");
  const manifest = join(dir, "manifests", "registry.ollama.ai", ...(name.includes("/") ? name.split("/") : ["library", name]), tag);
  if (!existsSync(manifest)) throw new Error(`Modelo ${model} não está em ${dir} (falta ${manifest}).`);
  const layer = JSON.parse(readFileSync(manifest, "utf8")).layers.find((l) => l.mediaType === "application/vnd.ollama.image.model");
  return join(dir, "blobs", layer.digest.replace(":", "-"));
}

const model = arg("model");
if (!model) { console.error("Uso: --model <nome:tag> [--n-cpu-moe N] [--ngl N] [--ctx N] [--port N]"); process.exit(2); }
const blob = ollamaBlob(model);
const args = ["-m", blob, "--jinja", "--host", "127.0.0.1", "--port", arg("port", "18080"), "-c", arg("ctx", "20480"), "-ngl", arg("ngl", "99"), "--flash-attn", "on", "--alias", model];
if (arg("n-cpu-moe")) args.push("--n-cpu-moe", arg("n-cpu-moe"));
if (arg("cache-type")) args.push("-ctk", arg("cache-type"), "-ctv", arg("cache-type"));
console.log(`pesos: ${blob}\n${join(binDir, "llama-server.exe")} ${args.join(" ")}`);
spawn(join(binDir, "llama-server.exe"), args, { stdio: "inherit" }).on("exit", (code) => process.exit(code ?? 0));
