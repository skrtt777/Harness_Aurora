// Briefings: how a complete delivery looks for each kind of request ("faz um convite pro niver da
// minha filha", "monta um relatório das vendas"). A person who doesn't know how to ask gets what a
// careful assistant would make: the defaults decided, the structure complete, one question only when
// the work would be wasted without it, and adjustment options at the end.
// One briefing per turn, the one whose triggers match best: the 4B model loses quality with more.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const BUNDLED = join(dirname(fileURLToPath(import.meta.url)), "briefs");
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** A briefing file: frontmatter (name, title, triggers, avoid) and the body. */
export function parseBrief(text, file = "") {
  const match = String(text).replace(/^﻿/, "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`${file}: briefing sem frontmatter`);
  const meta = parseDocument(match[1]).toJS() || {};
  const list = (v) => (Array.isArray(v) ? v : String(v || "").split(",")).map((t) => fold(t).trim()).filter(Boolean);
  if (!meta.name || !meta.title) throw new Error(`${file}: briefing precisa de name e title`);
  const options = (Array.isArray(meta.options) ? meta.options : []).map((o) => String(o).trim()).filter(Boolean).slice(0, 3);
  return { name: String(meta.name), title: String(meta.title), triggers: list(meta.triggers), avoid: list(meta.avoid), options, disabled: meta.disabled === true, body: match[2].trim() };
}

let cache = null;
/** The person's own briefings: HARNESS_BRIEFS_DIR, or "briefs" next to the database (the app's data folder). */
export function userBriefsDir(env = process.env) {
  if (env.HARNESS_BRIEFS_DIR) return env.HARNESS_BRIEFS_DIR;
  return env.HARNESS_DB_FILE ? join(dirname(env.HARNESS_DB_FILE), "briefs") : null;
}

/** Every briefing with where it came from; the person's file wins over the bundled one by name. */
export function allBriefs(env = process.env) {
  const own = userBriefsDir(env);
  const dirs = [[BUNDLED, "bundled"], [own, "user"]].filter(([d]) => d && existsSync(d));
  const key = dirs.map(([d]) => d).join("|");
  if (cache?.key === key) return cache.briefs;
  const byName = new Map();
  for (const [dir, source] of dirs) {
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".md")).sort()) {
      try {
        const text = readFileSync(join(dir, name), "utf8");
        const brief = parseBrief(text, name);
        const bundled = byName.get(brief.name)?.source === "bundled";
        byName.set(brief.name, { ...brief, text, source: source === "user" && bundled ? "edited" : source });
      } catch { /* a broken file is skipped */ }
    }
  }
  cache = { key, briefs: [...byName.values()] };
  return cache.briefs;
}

/** The briefings in use (a turned-off one is listed but never picked). */
export function loadBriefs(env = process.env) {
  return allBriefs(env).filter((b) => !b.disabled);
}

/** Saves the person's version of a briefing (a new one, or an edit of a bundled one). */
export function saveBrief(text, env = process.env) {
  const brief = parseBrief(text, "briefing");
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(brief.name)) throw new Error("O nome do briefing usa só letras minúsculas, números e hífen (ex.: proposta-loja).");
  if (!brief.triggers.length) throw new Error("Diga em triggers as palavras que ativam o briefing.");
  if (!/Decida sozinho:/.test(brief.body)) throw new Error("O briefing precisa da parte \"Decida sozinho:\".");
  const dir = userBriefsDir(env);
  if (!dir) throw new Error("Pasta de briefings indisponível.");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${brief.name}.md`), String(text).replace(/\r\n/g, "\n"));
  cache = null;
  return allBriefs(env).find((b) => b.name === brief.name);
}

/** Turns a briefing on or off (a bundled one gets the person's copy with "disabled: true"). */
export function setBriefEnabled(name, enabled, env = process.env) {
  const brief = allBriefs(env).find((b) => b.name === name);
  if (!brief) throw new Error("Briefing não encontrado.");
  const text = brief.text.replace(/^(---\r?\n[\s\S]*?)\r?\ndisabled:.*$/m, "$1").replace(/\r?\n---\r?\n/, enabled ? "\n---\n" : "\ndisabled: true\n---\n");
  return saveBrief(text, env);
}

/** Removes the person's file: a new briefing goes away, an edited one goes back to the bundled text. */
export function deleteBrief(name, env = process.env) {
  const dir = userBriefsDir(env);
  const file = dir && join(dir, `${name}.md`);
  if (!file || !/^[a-z0-9-]+$/.test(name) || !existsSync(file)) throw new Error("Só dá para apagar um briefing seu (os que vêm com a Aurora podem ser desligados).");
  rmSync(file);
  cache = null;
  return allBriefs(env).find((b) => b.name === name) || null;
}

const hits = (text, words) => words.filter((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?(?=[^a-z0-9]|$)`).test(text));

/** The briefing for a request, or null. Longer triggers weigh more ("cha de bebe" over "cha"). */
export function pickBrief(request, briefs = loadBriefs()) {
  const text = fold(request);
  // A question about something is not a request to make it ("o que é um currículo?").
  if (/^\s*(o que (e|sao)|qual a diferenca|como funciona|por que)\b/.test(text)) return null;
  // A form on a site ("abra http://… e envie uma mensagem com o nome Rafaela"): the text is given,
  // the e-mail briefing rewrote it (conversation battery, 06/10).
  if (/https?:\/\/|www\.|\.com\b|formulario|no site|na pagina|campo/.test(text)) return null;
  // A question about data ("quantos seguidores ela tem no TikTok?") is not a request to make a post.
  const makes = /\b(faz|faca|fazer|cria|crie|criar|escrev|redij|monta|monte|montar|prepar|elabor|gera|gere|gerar|manda|mande|preciso|quero|queria|gostaria|me ajuda|ajuda a|ajude|responde|responda|sugere|sugira|indica|indique|recomenda|ideia|melhor|vale a pena|comprar)/;
  if (!makes.test(text) && (/\?\s*$/.test(text) || /^\s*(quant|qual|quais|onde|quando|quem|cade)\b/.test(text))) return null;
  let best = null, bestScore = 0;
  for (const brief of briefs) {
    if (hits(text, brief.avoid).length) continue;
    const score = hits(text, brief.triggers).reduce((n, w) => n + 1 + w.split(" ").length, 0);
    if (score > bestScore) { best = brief; bestScore = score; }
  }
  return best;
}

// The same ending everywhere: the app shows the numbered options as buttons.
export const CLOSING = "Entregue completo JÁ nesta resposta, com as decisões tomadas (não devolva perguntas no lugar da entrega). No fim, escreva **Quer ajustar?** e, abaixo, 1 linha dizendo o que você decidiu sozinho e 2 ou 3 opções curtas numeradas (1., 2., 3.), a primeira terminando com \"(recomendado)\".";

/** The block that goes into the prompt. */
export function briefBlock(request, env = process.env) {
  if (env.HARNESS_BRIEFS === "off" || process.env.HARNESS_BRIEFS === "off") return null; // measuring without them
  const brief = pickBrief(request, loadBriefs(env));
  if (!brief) return null;
  const numbered = (options) => options.map((o, i) => `${i + 1}. ${o}${i ? "" : " (recomendado)"}`);
  const suggested = brief.options.length ? ` Opções boas para este tipo (troque por outras se o pedido pedir): ${numbered(brief.options).join(" ")}` : "";
  return { name: brief.name, options: brief.options, block: `COMO ENTREGAR BEM (${brief.title}):\n${brief.body}\n${CLOSING}${suggested}` };
}

/**
 * The answer with its "Quer ajustar?" options: the model forgot them in about a third of the
 * answers or wrote them unnumbered (battery 4, 06/10), so the briefing's own options are added.
 * Not on a short answer that only asks something back.
 */
export function withAdjustOptions(text, brief) {
  const answer = String(text || "");
  if (!brief?.options?.length || answer.trim().length < 120) return answer;
  const at = answer.search(/\*{0,2}Quer ajustar\?\*{0,2}/i);
  if (at >= 0 && (answer.slice(at).match(/^\s*\d[.)]\s+\S/gm) || []).length >= 2) return answer;
  const list = brief.options.map((o, i) => `${i + 1}. ${o}${i ? "" : " (recomendado)"}`).join("\n");
  // A loose "Quer ajustar algum detalhe?" at the end goes: the section replaces it.
  const base = (at >= 0 ? answer.slice(0, at) : answer.replace(/\n[^\n]*\b(quer (que eu )?ajust|prefere|me avisa como prefere)[^\n]*[?!]\s*$/i, "")).trimEnd();
  return `${base}\n\n**Quer ajustar?**\n${list}`;
}
