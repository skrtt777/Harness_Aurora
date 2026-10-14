// The model server's memory, as the Harness starts it (and with LLAMA_SERVER_EXTRA_ARGS / LLAMA_SLOTS to
// compare): RAM of the process right after it is ready and after one long prompt.
// node scripts/server-memory.mjs [modelo]
import { execFileSync } from "node:child_process";

process.env.LLAMA_SERVER_PORT ||= "18195";
const { ensureLlamaServer, stopLlamaServer, llamaServerInfo } = await import("../app/llamaServer.js");
const model = process.argv[2] || process.env.LOCAL_MODEL || "qwen3.5:4b";
const ram = () => {
  const out = execFileSync("powershell", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process -Filter "Name='llama-server.exe'" | Where-Object { $_.CommandLine -match '--port ${process.env.LLAMA_SERVER_PORT}' } | ForEach-Object { $p = Get-Process -Id $_.ProcessId; "$($p.WorkingSet64) $($p.PrivateMemorySize64)" }`], { windowsHide: true }).toString().trim();
  const [ws, priv] = out.split(/\s+/).map(Number);
  return `${(ws / 1024 ** 3).toFixed(2)} (privada ${(priv / 1024 ** 3).toFixed(2)})`;
};
const started = Date.now();
const base = await ensureLlamaServer({ model, contextTokens: 16384 });
if (!base) { console.log("O servidor não subiu."); process.exit(1); }
const info = llamaServerInfo();
console.log(`pronto em ${Math.round((Date.now() - started) / 1000)} s | gpu=${info.gpu} vagas=${info.slots} | RAM ${ram()} GB`);
const prompt = "Resuma em uma frase: " + "A Aurora trabalha no computador da pessoa. ".repeat(400);
const t = Date.now();
await fetch(`${base}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 20 }) });
console.log(`um prompt de ~${Math.round(prompt.length / 4)} tokens em ${((Date.now() - t) / 1000).toFixed(1)} s | RAM ${ram()} GB`);
// What it really needs: the pages Windows can take back (the model file, read once) are taken, one more
// prompt runs, and what comes back is the working set a tight machine must have.
const pid = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "Name='llama-server.exe'" | Where-Object { $_.CommandLine -match '--port ${process.env.LLAMA_SERVER_PORT}' }).ProcessId`], { windowsHide: true }).toString().trim();
execFileSync("powershell", ["-NoProfile", "-Command", `Add-Type -Name P -Namespace W -MemberDefinition '[DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(IntPtr h);'; $p = Get-Process -Id ${pid}; [W.P]::EmptyWorkingSet($p.Handle) | Out-Null`], { windowsHide: true });
console.log(`depois de devolver ao Windows o que ele pode tirar | RAM ${ram()} GB`);
const t2 = Date.now();
await fetch(`${base}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, messages: [{ role: "user", content: `${prompt} Agora outra coisa: liste três cores.` }], max_tokens: 60 }) });
console.log(`outro prompt em ${((Date.now() - t2) / 1000).toFixed(1)} s | o que ele precisa de verdade: RAM ${ram()} GB`);
stopLlamaServer();
process.exit(0);
