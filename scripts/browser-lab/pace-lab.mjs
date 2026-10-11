// O navegador preciso, num Chromium de perfil temporário e páginas de teste locais (nenhum site real):
// busca pela caixa do site numa ação, formulário inteiro numa ação, sem recarregar a página aberta,
// ritmo humano entre ações, pesquisa geral recusada no Google, parada total num "não sou um robô".
// node scripts/browser-lab/pace-lab.mjs
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.BROWSER_AGENT_PROFILE_DIR = mkdtempSync(join(tmpdir(), "aurora-browser-"));
process.env.BROWSER_AGENT_HEADLESS = "1";
const { executeTool } = await import("../../app/agentTools/index.js");

const hits = new Map();
const received = [];
let wallSolved = false;
const html = (title, body) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  hits.set(url.pathname, (hits.get(url.pathname) || 0) + 1);
  res.setHeader("content-type", "text/html; charset=utf-8");
  if (url.pathname === "/") return res.end(html("Loja do Bairro", `<form action="/busca"><input type="search" name="q" placeholder="O que você procura?"><button>Buscar</button></form><a href="/contato">Contato</a>`));
  if (url.pathname === "/busca") return res.end(html("Resultados", `<h1>Resultados para ${url.searchParams.get("q")}</h1><p>Pão de fermentação natural — R$ 18,00</p>`));
  if (url.pathname === "/contato") return res.end(html("Contato", `<form action="/enviado" method="get"><label for="n">Nome</label><input id="n" name="nome"><label for="e">E-mail</label><input id="e" name="email"><label for="a">Assunto</label><select id="a" name="assunto"><option>Dúvida</option><option>Orçamento</option></select><label for="c">Quero receber novidades</label><input id="c" type="checkbox" name="novidades"><label for="m">Mensagem</label><textarea id="m" name="mensagem"></textarea><button type="submit">Enviar</button></form>`));
  if (url.pathname === "/enviado") { received.push(Object.fromEntries(url.searchParams)); return res.end(html("Obrigado", "<h1>Mensagem enviada</h1>")); }
  if (url.pathname === "/protegido") return res.end(wallSolved ? html("Área do cliente", "<h1>Seus pedidos</h1>") : html("Just a moment...", `<p>Verificando se a conexão é segura</p><iframe src="https://challenges.cloudflare.com/turnstile/v0/x"></iframe>`));
  res.statusCode = 404; res.end("não existe");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const ctx = { mode: "auto", request: "procura pão na loja do bairro e manda uma mensagem pelo contato", approve: async () => true, alwaysAllow: [], env: process.env };
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

try {
  const searched = await executeTool("browser_navigate", { url: base, search: "pão" }, ctx);
  check("busca pela caixa do site numa ação", searched.ok && /Resultados para pão/.test(searched.result), String(searched.result || searched.error).split("\n")[0]);
  const t0 = Date.now();
  const again = await executeTool("browser_navigate", { url: `${base}/busca?q=p%C3%A3o` }, ctx);
  check("a página aberta não é recarregada", again.ok && /já está aberta/.test(again.result) && hits.get("/busca") === 1, `${hits.get("/busca")} acesso(s)`);
  await executeTool("browser_navigate", { url: `${base}/contato` }, ctx);
  check("ritmo humano entre ações no mesmo site", Date.now() - t0 >= 1150, `${Date.now() - t0} ms`);
  const filled = await executeTool("browser_fill", { fields: [{ field: "Nome", value: "Maria Souza" }, { field: "E-mail", value: "maria@exemplo.com" }, { field: "Assunto", value: "Orçamento" }, { field: "Quero receber novidades", value: "sim" }, { field: "Mensagem", value: "Quero 20 pães para sábado." }], submit: "Enviar" }, ctx);
  const sent = received[0] || {};
  check("formulário inteiro numa ação", filled.ok && sent.nome === "Maria Souza" && sent.assunto === "Orçamento" && sent.novidades === "on" && /20 pães/.test(sent.mensagem || ""), JSON.stringify(sent));
  const google = await executeTool("browser_navigate", { url: "https://www.google.com/search?q=padaria" }, ctx);
  check("pesquisa geral vai para web_search", !google.ok && /web_search/.test(google.result || google.error || ""));
  const wall = await executeTool("browser_navigate", { url: `${base}/protegido` }, ctx);
  check("captcha: para e pede à pessoa", !wall.ok && /PAROU/.test(wall.result || wall.error || "") && /resolver a verificação/.test(wall.result || wall.error || ""));
  const before = hits.get("/protegido");
  const retry = await executeTool("browser_click", { text: "Verificando" }, ctx);
  check("não tenta de novo no site bloqueado", !retry.ok && /PAROU/.test(retry.result || retry.error || "") && hits.get("/protegido") === before);
  wallSolved = true; // the person solved it in the window
  // The site lets the person in after the check: the page changes by itself (not an action of the Aurora).
  const { getBrowserPage } = await import("../../app/browserBackend.js");
  await (await getBrowserPage({ env: process.env })).page.reload();
  const look = await executeTool("browser_snapshot", {}, ctx);
  check("depois de a pessoa resolver, continua", look.ok && /Seus pedidos/.test(look.result), String(look.result || look.error).split("\n")[0]);
} finally {
  const { closeBrowserContext } = await import("../../app/browserAgent.js");
  await closeBrowserContext().catch(() => {});
  server.close();
}
console.log(`\nNota: ${results.filter(Boolean).length}/${results.length}`);
process.exit(0);
