import { assertAllowedUrl } from "./netGuard.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#x27": "'" };

export function decodeEntities(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (match, code) => {
    if (ENTITIES[code.toLowerCase()]) return ENTITIES[code.toLowerCase()];
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return match;
  });
}

export function htmlToText(html) {
  return decodeEntities(String(html)
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)\s*>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Parses DuckDuckGo's no-JS results page (html.duckduckgo.com). */
export function parseDuckDuckGo(html, max = 8) {
  const results = [];
  const blocks = String(html).split(/<div[^>]+class="[^"]*result__body/).slice(1);
  for (const block of blocks) {
    const link = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    let url = decodeEntities(link[1]);
    const redirect = url.match(/[?&]uddg=([^&]+)/);
    if (redirect) url = decodeURIComponent(redirect[1]);
    if (url.startsWith("//")) url = `https:${url}`;
    if (/duckduckgo\.com\/y\.js/.test(url)) continue; // ads
    const snippet = block.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(a|div|td)>/);
    results.push({ title: htmlToText(link[2]), url, snippet: snippet ? htmlToText(snippet[1]) : "" });
    if (results.length >= max) break;
  }
  return results;
}

// Redirects are followed by hand so each hop is checked: a public page must
// not be able to bounce the fetch onto Aurora's own local API.
async function get(url, signal, fetchImpl = fetch) {
  const timeout = signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000);
  let current = String(url);
  for (let hop = 0; hop < 6; hop += 1) {
    assertAllowedUrl(current);
    const response = await fetchImpl(current, { headers: { "user-agent": UA, "accept-language": "pt-BR,pt;q=0.9,en;q=0.8" }, signal: timeout, redirect: "manual" });
    const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
    if (location) {
      const next = new URL(location, current);
      if (!["http:", "https:"].includes(next.protocol)) throw new Error("Redirecionamento para um endereço não suportado.");
      current = next.href;
      continue;
    }
    if (!response.ok) throw new Error(`O site respondeu com erro ${response.status}.`);
    return Object.defineProperty(response, "finalUrl", { value: current });
  }
  throw new Error("Redirecionamentos demais.");
}

export const webTools = [
  {
    name: "web_search",
    description: "Pesquisa na internet e devolve os principais resultados em texto (título, link e resumo), sem abrir o navegador. Use para responder perguntas com informação atual: notícias, preços, cotações, clima, fatos que você não sabe. Para mostrar algo ao usuário num site, use browser_navigate.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    risk: "safe",
    stage: (a) => `Pesquisando "${a.query}"…`,
    async run({ query }, ctx) {
      if (!String(query || "").trim()) throw new Error("Informe o que pesquisar.");
      const response = await get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=br-pt`, ctx.signal, ctx.fetch);
      const results = parseDuckDuckGo(await response.text());
      if (!results.length) return `Nenhum resultado para "${query}".`;
      return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n");
    },
  },
  {
    name: "web_fetch",
    description: "Baixa uma página da web e devolve o texto dela (sem abrir o navegador). Use para ler um resultado de pesquisa.",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    risk: "safe",
    stage: (a) => `Lendo ${a.url}…`,
    async run({ url }, ctx) {
      const target = new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`);
      if (!["http:", "https:"].includes(target.protocol)) throw new Error("Só é possível ler páginas HTTP/HTTPS.");
      const response = await get(target.href, ctx.signal, ctx.fetch);
      const type = response.headers.get("content-type") || "";
      const body = await response.text();
      const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const text = /html/i.test(type) ? htmlToText(body) : body;
      return `${title ? `Título: ${htmlToText(title[1])}\n` : ""}URL: ${response.finalUrl || target.href}\n\n${text.slice(0, 7000)}`;
    },
  },
];
