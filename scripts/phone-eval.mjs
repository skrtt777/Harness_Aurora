// O celular (Telegram) contra o modelo local, com uma API do Telegram falsa: a pessoa manda o PDF
// de um boleto com a legenda "quanto é esse boleto e quando vence?" e a resposta que volta ao celular
// precisa trazer o valor e o vencimento; depois pede "faça uma planilha com isso" e o arquivo volta.
//   node scripts/phone-eval.mjs [--runs 3]
import "./evalSandbox.mjs";
import http from "node:http";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const runs = Math.max(1, Number(arg("runs", 3)) || 3);
const base = mkdtempSync(join(tmpdir(), "aurora-celular-"));
process.env.HARNESS_DB_FILE = join(base, "harness.db");
// The phone conversation works in the person folders: evalSandbox.mjs makes them fake ones.
process.env.AGENT_APPROVAL_TIMEOUT_MS ||= "1000";
setInterval(() => {}, 60_000);

const { makePdfDocument, parseBlocks } = await import("../app/documentWriter.js");
const pdf = makePdfDocument(parseBlocks("# Boleto - Coelba Energia\n\nPagador: Rafaela Souza\n\nValor do documento: R$ 230,45\n\nVencimento: 10/10/2026\n\nLinha digitável: 23790.12345 60000.123456 78901.234567 8 98760000023045"));

const sent = [];
const server = http.createServer((req, res) => {
  let body = Buffer.alloc(0);
  req.on("data", (d) => { body = Buffer.concat([body, d]); });
  req.on("end", () => {
    if (req.url.startsWith("/file/")) return res.end(pdf);
    const method = req.url.split("/").pop();
    const json = /json/.test(req.headers["content-type"] || "") ? JSON.parse(body.toString() || "{}") : { raw: body.toString("latin1").slice(0, 400) };
    sent.push({ method, body: json });
    const result = method === "getMe" ? { username: "aurora_bot" } : method === "getUpdates" ? [] : method === "getFile" ? { file_path: "documents/boleto.pdf" } : true;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, result }));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));

const store = await import("../app/store.js");
const tg = await import("../app/telegram.js");
const { handleChatTurn } = await import("../app/server.js");
await store.setSetting("teacher_mode", "off");
let passed = 0, total = 0;
for (let run = 1; run <= runs; run += 1) {
  const env = { ...process.env, TELEGRAM_API_BASE: `http://127.0.0.1:${server.address().port}` };
  await store.setSetting("telegram_token", "123456789:ABCdefGhIJKlmNoPQRsTUVwxyz0123456789");
  await store.setSetting("telegram_chat_id", "555");
  await store.setSetting("telegram_conversation_id", "");
  const reply = () => sent.filter((s) => s.method === "sendMessage").at(-1)?.body.text || "";
  let started = Date.now();
  await tg.handleUpdate({ update_id: run * 10, message: { message_id: run, chat: { id: 555 }, caption: "quanto é esse boleto e quando vence?", document: { file_id: "f", file_name: "boleto_coelba.pdf", file_size: pdf.length } } }, { env, handleChatTurn });
  const first = reply();
  const ok1 = /230[,.]45/.test(first) && /10\/10(\/2026)?|10 de outubro/i.test(first);
  console.log(`${ok1 ? "✓" : "✗"} rodada ${run}, boleto (${((Date.now() - started) / 1000).toFixed(1)} s): ${first.slice(0, 160).replace(/\n/g, " | ")}`);
  const docs = sent.filter((s) => s.method === "sendDocument").length;
  started = Date.now();
  await tg.handleUpdate({ update_id: run * 10 + 1, message: { message_id: run + 100, chat: { id: 555 }, text: "faça uma planilha com o valor e o vencimento desse boleto" } }, { env, handleChatTurn });
  const ok2 = sent.filter((s) => s.method === "sendDocument").length > docs && /\.xlsx/i.test(sent.filter((s) => s.method === "sendDocument").at(-1)?.body.raw || "");
  console.log(`${ok2 ? "✓" : "✗"} rodada ${run}, planilha devolvida (${((Date.now() - started) / 1000).toFixed(1)} s): ${reply().slice(0, 120).replace(/\n/g, " | ")}`);
  passed += Number(ok1) + Number(ok2); total += 2;
}
console.log(`Nota: ${passed}/${total}`);
server.close();
process.exit(0);
