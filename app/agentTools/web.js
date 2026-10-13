import { sensitiveFindings } from "../sensitive.js";
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

/**
 * The excerpts of a text around what is looked for: "Art. 51" matches "Art. 51." and "Art. 51º" but not
 * "Art. 510"; words match without accents or case. Up to 3 excerpts of ~1,200 characters.
 */
export function excerptsOf(text, find, { size = 1200, max = 3 } = {}) {
  const fold = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const t = fold(text);
  const art = fold(find).match(/^art(?:igo)?\.?\s*(\d+)/);
  const re = art ? new RegExp(`\\bart(?:igo)?\\.?\\s*${art[1]}(?!\\d)`, "g") : new RegExp(fold(find).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
  const out = []; let last = -Infinity;
  for (const m of t.matchAll(re)) {
    if (m.index < last + size) continue;
    const from = Math.max(0, m.index - 150);
    out.push(String(text).slice(from, from + size).trim());
    last = m.index;
    if (out.length >= max) break;
  }
  return out;
}

/**
 * A page's text in its own encoding: the header's charset, else the page's <meta charset>, else UTF-8
 * (and windows-1252 when UTF-8 does not fit). planalto.gov.br's laws are windows-1252: read as UTF-8,
 * "Parágrafo único" became "Par�grafo �nico" (13/10).
 */
export function decodeBody(bytes, contentType = "") {
  const declared = /charset=["']?([\w-]+)/i.exec(contentType)?.[1]
    || /<meta[^>]+charset=["']?([\w-]+)/i.exec(new TextDecoder("latin1").decode(bytes.slice(0, 4096)))?.[1];
  const tryDecode = (label, fatal = false) => { try { return new TextDecoder(label, { fatal }).decode(bytes); } catch { return null; } };
  if (declared && !/^utf-?8$/i.test(declared)) { const text = tryDecode(declared.toLowerCase() === "iso-8859-1" ? "windows-1252" : declared); if (text !== null) return text; }
  return tryDecode("utf-8", true) ?? tryDecode("windows-1252") ?? tryDecode("utf-8");
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

/**
 * Bing's results page: DuckDuckGo answered every search with its "anomaly" robot page (13/10) and the
 * Aurora had no internet. The links are Bing redirects (…/ck/a?…&u=a1<base64url>); the real address is
 * in u.
 */
export function parseBing(html, max = 8) {
  const results = [];
  for (const block of String(html).split(/<li class="b_algo"/).slice(1)) {
    const link = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    let url = decodeEntities(link[1]);
    const u = url.match(/[?&]u=a1([^&]+)/);
    if (u) { try { url = Buffer.from(u[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); } catch { continue; } }
    if (!/^https?:\/\//.test(url) || /bing\.com\//.test(url)) continue;
    const snippet = block.match(/<p[^>]*>([\s\S]*?)<\/p>/) || block.match(/class="b_caption"[^>]*>([\s\S]*?)<\/div>/);
    results.push({ title: htmlToText(link[2]), url, snippet: snippet ? htmlToText(snippet[1]).slice(0, 300) : "" });
    if (results.length >= max) break;
  }
  return results;
}

/** The results of a search: DuckDuckGo, and Bing when DuckDuckGo blocks or finds nothing. */
export async function searchWeb(query, ctx = {}) {
  let results = [];
  try {
    const response = await get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=br-pt`, ctx.signal, ctx.fetch);
    results = parseDuckDuckGo(await response.text());
  } catch {}
  if (!results.length) {
    try {
      const response = await get(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=pt-br`, ctx.signal, ctx.fetch);
      results = parseBing(await response.text());
    } catch {}
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

const SEARCH_FILLER = new Set(["qual", "quais", "quem", "como", "onde", "quando", "mais", "menos", "para", "pela", "pelo", "sobre", "esse", "este", "essa", "esta", "isso", "ano", "anos", "anual", "anuais", "atual", "hoje", "brasil"]);
/**
 * "Quem é o vendedor que mais vendeu no ano?" went to the internet (empresa eval comercial-1, 06/10):
 * the company's documents had the sales sheet. When they have a passage sharing two or more of the
 * query's words, it comes first. Only for the local model (company documents never go to a paid one
 * from here) and only when there are company sources.
 */
async function companyFirst(query, ctx) {
  if (ctx.provider && ctx.provider !== "local") return "";
  const { listSources, searchKnowledge } = await import("../knowledge.js");
  if (!(await listSources()).length) return "";
  const fold = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const words = [...new Set(fold(query).match(/[a-z]{4,}/g) || [])].filter((w) => !SEARCH_FILLER.has(w)).map((w) => w.slice(0, 6));
  if (words.length < 2) return "";
  const [hit] = await searchKnowledge(String(query), { env: ctx.env, signal: ctx.signal, sourceIds: ctx.knowledgeSourceIds });
  if (!hit || words.filter((w) => fold(hit.text).includes(w)).length < 2) return "";
  const sheet = /\.(xlsx|csv|tsv)$/i.test(hit.path) ? ` Para listar ou ordenar, leia com read_file path="${hit.path}" (filter/sort).` : "";
  return `Nos documentos da EMPRESA (antes da internet; a internet não tem os dados internos):\nFonte: ${hit.path}\n${String(hit.text).slice(0, 700)}\n(Se a pergunta é sobre a empresa, responda com isto.${sheet})\n\nNa internet:\n`;
}

// The person's own papers: "meu extrato", "a conta de luz", "o boleto", "o contrato do apartamento".
const PERSONAL_DOCS = ["extrato", "boleto", "conta de luz", "conta de agua", "luz", "agua", "aluguel", "iptu", "cartao", "fatura", "contrato", "recibo", "comprovante", "holerite", "contracheque", "curriculo", "condominio", "nota fiscal", "receita", "declaracao"];
/**
 * "Qual o saldo do meu extrato de agosto?" went to the internet and answered R$ 0,93 from someone
 * else's PDF (usage tests, 06/10). When the request is about the person's own paper and a file with
 * that name is in their folders, the files come first.
 */
async function personalFirst(ctx) {
  const text = String(ctx.request || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (!/\b(meu|minha|meus|minhas|o|a)\b/.test(text)) return "";
  const nouns = PERSONAL_DOCS.filter((n) => text.includes(n));
  if (!nouns.length) return "";
  const { personalFolders } = await import("../fileAccess.js");
  const { readdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const stems = nouns.map((n) => n.split(" ").pop().replace(/[^a-z]/g, ""));
  const found = [];
  const walk = async (dir, depth) => {
    if (depth > 3 || found.length >= 6) return;
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith(".")) continue;
      const full = join(dir, e.name);
      const name = e.name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (stems.some((s) => name.includes(s))) found.push(full);
    }
  };
  for (const folder of personalFolders(ctx.env || process.env)) await walk(folder.path, 0);
  if (!found.length) return "";
  return `Arquivos da PESSOA com esse nome (é um documento dela, não da internet: leia com read_file):\n${found.map((f) => `- ${f}`).join("\n")}\n\nNa internet (provavelmente não serve):\n`;
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
      // LGPD: a CPF, CNPJ, e-mail, phone or account in a search goes to the search engine. Refused.
      const identifiers = sensitiveFindings(query).filter((f) => ["CPF", "CNPJ", "e-mail", "telefone", "conta bancária", "cartão", "senha ou chave", "data de nascimento"].includes(f));
      if (identifiers.length) throw new Error(`Não pesquiso na internet com dado pessoal (${identifiers.join(", ")}): ele iria para o buscador. Pesquise sem esse dado ou use os documentos (knowledge_search).`);
      // The person's own paper: only their files (the web results led to an "average" light bill).
      const personal = await personalFirst(ctx).catch(() => "");
      if (personal) return personal.replace(/\n\nNa internet \(provavelmente não serve\):\n$/, "\n(A internet não tem os documentos da pessoa: leia estes arquivos com read_file.)");
      const results = await searchWeb(query, ctx);
      const internal = await companyFirst(query, ctx).catch(() => "");
      if (!results.length) return `${internal}Nenhum resultado para "${query}".`;
      return internal + results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n");
    },
  },
  {
    name: "web_fetch",
    description: "Baixa uma página da web e devolve o texto dela (sem abrir o navegador). Use para ler um resultado de pesquisa. Numa página longa (uma lei inteira), use find para trazer o trecho do que procura, ex.: find=\"Art. 51\".",
    parameters: { type: "object", properties: { url: { type: "string" }, find: { type: "string", description: "o trecho a procurar na página (ex.: Art. 51, multa)" } }, required: ["url"] },
    risk: "safe",
    stage: (a) => `Lendo ${a.url}…`,
    async run({ url, find }, ctx) {
      // "F:\EmpresaIA\...\Tabela de Preços.pdf" sent here failed as "fetch failed" (empresa eval, 06/10).
      if (/^([a-z]:[\\/]|\\\\|file:)/i.test(String(url || "").trim())) throw new Error(`"${url}" é um arquivo do computador, não um site: leia com read_file usando esse caminho em path.`);
      const target = new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`);
      if (!["http:", "https:"].includes(target.protocol)) throw new Error("Só é possível ler páginas HTTP/HTTPS.");
      const response = await get(target.href, ctx.signal, ctx.fetch);
      const type = response.headers.get("content-type") || "";
      const body = decodeBody(new Uint8Array(await response.arrayBuffer()), type);
      const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const text = /html/i.test(type) ? htmlToText(body) : body;
      const head = `${title ? `Título: ${htmlToText(title[1])}\n` : ""}URL: ${response.finalUrl || target.href}\n\n`;
      // The part of a long page about what is looked for (the article of a law of 90 articles).
      if (find && String(find).trim()) {
        const parts = excerptsOf(text, String(find));
        if (parts.length) return `${head}Trechos com "${find}":\n\n${parts.join("\n\n[…]\n\n")}`;
        return `${head}Não achei "${find}" nesta página. Começo da página:\n${text.slice(0, 2500)}`;
      }
      return `${head}${text.slice(0, 7000)}`;
    },
  },
];
