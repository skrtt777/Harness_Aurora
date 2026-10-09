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
      const response = await get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=br-pt`, ctx.signal, ctx.fetch);
      const results = parseDuckDuckGo(await response.text());
      const internal = await companyFirst(query, ctx).catch(() => "");
      if (!results.length) return `${internal}Nenhum resultado para "${query}".`;
      return internal + results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n");
    },
  },
  {
    name: "web_fetch",
    description: "Baixa uma página da web e devolve o texto dela (sem abrir o navegador). Use para ler um resultado de pesquisa.",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    risk: "safe",
    stage: (a) => `Lendo ${a.url}…`,
    async run({ url }, ctx) {
      // "F:\EmpresaIA\...\Tabela de Preços.pdf" sent here failed as "fetch failed" (empresa eval, 06/10).
      if (/^([a-z]:[\\/]|\\\\|file:)/i.test(String(url || "").trim())) throw new Error(`"${url}" é um arquivo do computador, não um site: leia com read_file usando esse caminho em path.`);
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
