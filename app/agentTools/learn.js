// Learning on her own: when the Aurora does not know how to do something (an error she cannot fix, a
// library she never used), `learn` searches the documentation, reads the best pages, writes a short
// lesson with an example and keeps it as a memory, so the next time it comes up by itself. A small model
// had web_search, web_fetch and memory_save and never chained them (13/10): one action does all three.
import { createMemory, selectRelevantMemories } from "../store.js";
import { htmlToText, webTools } from "./web.js";

/**
 * Answers from Stack Overflow (its public API: questions with an accepted answer, the answer's text) and
 * pages of MDN: documentation that a search engine's robot check does not block.
 */
export async function docsFor(topic, ctx = {}) {
  const fetchImpl = ctx.fetch || fetch;
  const out = [];
  const json = async (url) => { const r = await fetchImpl(url, { signal: AbortSignal.timeout(15000), headers: { "accept-encoding": "gzip" } }); return r.ok ? r.json() : null; };
  const q = encodeURIComponent(String(topic).slice(0, 140));
  const words = topicWords(topic);
  const so = await json(`https://api.stackexchange.com/2.3/similar?order=desc&sort=relevance&title=${q}&site=stackoverflow&pagesize=8`).catch(() => null);
  for (const item of so?.items || []) {
    // Only questions about the topic (a search for node:test brought one about git push).
    if (!item.accepted_answer_id || overlap(`${item.title} ${(item.tags || []).join(" ")}`, words) < Math.min(2, words.length)) continue;
    const answer = await json(`https://api.stackexchange.com/2.3/answers/${item.accepted_answer_id}?site=stackoverflow&filter=withbody`).catch(() => null);
    const body = answer?.items?.[0]?.body;
    if (body) out.push({ url: item.link, text: `PERGUNTA: ${htmlToText(item.title)}\nRESPOSTA ACEITA:\n${htmlToText(body.replace(/<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/g, (_, c) => `\n\`\`\`\n${c}\n\`\`\`\n`)).slice(0, 2500)}` });
    if (out.length >= 2) break;
  }
  const mdn = await json(`https://developer.mozilla.org/api/v1/search?q=${q}&locale=en-US&size=2`).catch(() => null);
  for (const d of mdn?.documents || []) if (overlap(`${d.title} ${d.summary}`, words) >= Math.min(2, words.length)) out.push({ url: `https://developer.mozilla.org${d.mdn_url}`, text: `${d.title}: ${d.summary}` });
  return out;
}

const tool = (name) => webTools.find((t) => t.name === name);
// Documentation first: the sites that explain with examples.
const GOOD = /developer\.mozilla\.org|nodejs\.org|docs\.python\.org|threejs\.org|react\.dev|learn\.microsoft\.com|docs\.oracle\.com|en\.cppreference\.com|cplusplus\.com|stackoverflow\.com|github\.com|w3schools\.com|typescriptlang\.org|vitejs\.dev|expressjs\.com|pandas\.pydata\.org|docs\.spring\.io|dev\.java/i;
const BAD = /youtube\.com|facebook\.com|instagram\.com|tiktok\.com|pinterest\./i;

const fold = (s) => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const STOP = new Set(["como", "para", "com", "sem", "uma", "the", "and", "with", "how", "que", "docs", "example", "exemplo", "documentacao", "erro", "error"]);
/** The words of a topic that tell its pages apart ("node:test http server port 0" → node, test, http, server, port). */
export const topicWords = (topic) => [...new Set(fold(topic).split(/[^a-z0-9+#]+/).filter((w) => w.length > 2 && !STOP.has(w)))];
/** How many of the topic's words a text has. */
export const overlap = (text, words) => { const t = fold(text); return words.filter((w) => t.includes(w)).length; };

/**
 * The result links of web_search's text: the ones whose title and address share the topic's words,
 * documentation first (nodejs.org's home page is not the page about node:test).
 */
export function pickPages(results, max = 2, topic = "") {
  const words = topicWords(topic);
  const entries = [...String(results).matchAll(/^\d+\.\s+(.*)\n\s+(https?:\/\/\S+)(?:\n\s+(.*))?/gm)].map((m) => ({ title: m[1], url: m[2], snippet: m[3] || "" })).filter((e) => !BAD.test(e.url));
  const scored = entries.map((e, i) => ({ ...e, i, s: (words.length ? overlap(`${e.title} ${e.url.slice(e.url.indexOf("//") + 2)} ${e.snippet}`, words) : 0) * 2 + (GOOD.test(e.url) ? 1.5 : 0) - (new URL(e.url).pathname.length <= 1 ? 2 : 0) }));
  const need = words.length >= 3 ? 2 : 1;
  return scored.filter((e) => !words.length || overlap(`${e.title} ${e.url.slice(e.url.indexOf("//") + 2)} ${e.snippet}`, words) >= need).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, max).map((e) => e.url);
}

/** The part of a page about the topic: paragraphs and code that share its words. */
export function relevantText(text, topic, max = 2500) {
  const words = String(topic).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9+#.]+/).filter((w) => w.length > 2);
  const blocks = String(text).split(/\n{2,}/).map((b) => b.trim()).filter((b) => b.length > 30);
  const score = (b) => { const t = b.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); return words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0) + (/[{};()=<>]/.test(b) ? 1 : 0); };
  const ranked = blocks.map((b, i) => ({ b, i, s: score(b) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 8).sort((a, b) => a.i - b.i);
  let out = "";
  for (const { b } of ranked) { if (out.length + b.length > max) break; out += `${b}\n\n`; }
  return out.trim() || String(text).slice(0, max);
}

const LESSON = "Você escreve lições curtas para uma IA que programa e trabalha no computador. Com o material abaixo, escreva a lição em português: 1) a regra ou a solução em 2 a 4 frases diretas (o que fazer, o que evitar); 2) um exemplo mínimo de código ou comando que funciona, se couber; 3) a fonte (o link). Só o que o material diz. Até 900 caracteres.";

export const learnTools = [
  {
    name: "learn",
    description: "Aprende sozinha algo que você não sabe: pesquisa a documentação na internet, lê as melhores páginas, escreve uma lição curta com exemplo e GUARDA na memória (da próxima vez ela já aparece). Use quando um erro se repete e você não sabe corrigir, ou antes de usar uma biblioteca, linguagem ou ferramenta que você não domina (ex.: topic=\"three.js importmap OrbitControls sem build\", topic=\"Python csv UnicodeDecodeError utf-8\").",
    parameters: { type: "object", properties: { topic: { type: "string", description: "o que aprender, com o nome da tecnologia e o erro ou objetivo" }, why: { type: "string", description: "para que você precisa (opcional)" } }, required: ["topic"] },
    risk: "safe",
    describe: () => ({ kind: "browse" }),
    stage: (a) => `Aprendendo: ${String(a.topic).slice(0, 60)}…`,
    async run({ topic, why }, ctx) {
      const subject = String(topic || "").trim();
      if (!subject) throw new Error("Diga o que aprender em topic.");
      // Already learned: the lesson is in the memory.
      const known = (await selectRelevantMemories(subject, { projectId: ctx.projectId }, 3, ctx.env).catch(() => [])).filter((m) => String(m.title || "").startsWith("Aprendi:"));
      if (known.length && !/de novo|outra vez|atualiz/i.test(String(why || ""))) return `Você já aprendeu isto (memória "${known[0].title}"):\n${known[0].content}\n\nSe não resolveu, chame learn de novo com why="de novo" e o erro exato.`;
      ctx.onStage?.(`Pesquisando a documentação de ${subject.slice(0, 50)}…`);
      const results = await tool("web_search").run({ query: `${subject} documentação exemplo` }, ctx).catch((e) => `ERRO ${e.message}`);
      let pages = pickPages(results, 2, subject);
      if (!pages.length) {
        const english = await tool("web_search").run({ query: `${subject} docs example` }, ctx).catch(() => "");
        pages = pickPages(english, 2, subject);
      }
      const material = [];
      // Stack Overflow's accepted answers and MDN, by their own APIs.
      ctx.onStage?.("Consultando Stack Overflow e MDN…");
      for (const d of await docsFor(subject, ctx).catch(() => [])) { material.push(`FONTE: ${d.url}\n${d.text}`); pages.push(d.url); }
      if (!pages.length) throw new Error(`Não achei páginas sobre "${subject}". Tente outras palavras (o nome da biblioteca e o erro exato, em inglês).`);
      for (const url of pages.filter((u) => !/stackoverflow\.com\/questions|developer\.mozilla\.org/.test(u) || !material.some((m) => m.startsWith(`FONTE: ${u}`))).slice(0, 2)) {
        ctx.onStage?.(`Lendo ${url.slice(0, 70)}…`);
        const page = await tool("web_fetch").run({ url }, ctx).catch(() => "");
        if (page) material.push(`FONTE: ${url}\n${relevantText(page, subject)}`);
      }
      if (!material.length) throw new Error(`Achei ${pages.join(", ")} mas não consegui ler. Use web_fetch numa delas.`);
      let lesson = null;
      if (ctx.ask) {
        ctx.onStage?.("Escrevendo a lição…");
        const answer = await ctx.ask([{ role: "system", content: LESSON }, { role: "user", content: `ASSUNTO: ${subject}${why ? `\nPARA QUÊ: ${why}` : ""}\n\n${material.join("\n\n---\n\n").slice(0, 6000)}` }]).catch(() => null);
        lesson = String(answer?.text || answer || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim() || null;
      }
      // No model to write it: the most relevant excerpt is the lesson.
      if (!lesson) { const words = topicWords(subject); lesson = [...material].sort((a, b) => overlap(b, words) - overlap(a, words))[0].slice(0, 850); }
      const memory = await createMemory({
        scope: "global", title: `Aprendi: ${subject.slice(0, 70)}`, content: lesson.slice(0, 1200), tags: ["aprendizado", ...subject.toLowerCase().split(/\s+/).filter((w) => w.length > 3).slice(0, 4)],
        kind: "extracted", source: `Aprendido pela Aurora (${pages.join(", ")})`, env: ctx.env,
      }).catch(() => null);
      return `${lesson}\n\n(${memory ? "Guardei esta lição na memória" : "Não consegui guardar na memória"}; fontes: ${pages.join(", ")}.) Agora aplique: corrija ou faça o que precisava com isso.`;
    },
  },
];
