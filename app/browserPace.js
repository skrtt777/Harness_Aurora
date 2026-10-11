// Fewer, more precise browser actions — the way a person uses a site, so sites do not take the Aurora for a
// robot: searches by the site's own results address (one action, not open + type + Enter), whole forms in
// one action, a human pace between actions on the same site, a ceiling per request, no reload of the page
// already open, web searches without the browser, and a full stop at any "are you human?" check — the
// person solves it in the window; the Aurora never tries to get around it.

// ---- Site searches by address ---------------------------------------------------------------------
const slug = (q) => encodeURIComponent(String(q).trim()).replace(/%20/g, "+");
const dashed = (q) => String(q).trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const SITE_SEARCH = [
  [/(^|\.)youtube\.com$/, (q) => `https://www.youtube.com/results?search_query=${slug(q)}`],
  [/(^|\.)mercadolivre\.com\.br$/, (q) => `https://lista.mercadolivre.com.br/${dashed(q)}`],
  [/(^|\.)amazon\.com\.br$/, (q) => `https://www.amazon.com.br/s?k=${slug(q)}`],
  [/(^|\.)wikipedia\.org$/, (q) => `https://pt.wikipedia.org/w/index.php?search=${slug(q)}`],
  [/(^|\.)magazineluiza\.com\.br$/, (q) => `https://www.magazineluiza.com.br/busca/${encodeURIComponent(String(q).trim())}/`],
  [/(^|\.)olx\.com\.br$/, (q) => `https://www.olx.com.br/brasil?q=${slug(q)}`],
  [/(^|\.)shopee\.com\.br$/, (q) => `https://shopee.com.br/search?keyword=${slug(q)}`],
  [/(^|\.)github\.com$/, (q) => `https://github.com/search?q=${slug(q)}`],
  [/(^|\.)reclameaqui\.com\.br$/, (q) => `https://www.reclameaqui.com.br/busca/?q=${slug(q)}`],
  [/(^|\.)ifood\.com\.br$/, (q) => `https://www.ifood.com.br/busca?q=${slug(q)}`],
  [/(^|\.)google\.[a-z.]+$/, null], // web searches: web_search; maps below
  [/(^|\.)maps\.google\.[a-z.]+$/, (q) => `https://www.google.com/maps/search/${slug(q)}`],
];

/** The results address of a known site for a search, or null (then the site's search box is used). */
export function siteSearchUrl(site, query) {
  if (!query) return null;
  let host;
  try { host = new URL(/^[a-z]+:\/\//i.test(site) ? site : `https://${site}`).host.replace(/^www\./, ""); } catch { return null; }
  if (/(^|\.)google\.[a-z.]+$/.test(host) && /\bmaps?\b/i.test(String(site))) return SITE_SEARCH.at(-1)[1](query);
  const hit = SITE_SEARCH.find(([re]) => re.test(host));
  return hit && hit[1] ? hit[1](query) : null;
}

/** A results page of a web search engine (opened in the browser, they ask "are you a robot?" fast). */
export function isWebSearchUrl(url) {
  try {
    const u = new URL(url);
    return (/(^|\.)google\.[a-z.]+$/.test(u.host) && /^\/search/.test(u.pathname))
      || (/(^|\.)bing\.com$/.test(u.host) && /^\/search/.test(u.pathname))
      || (/(^|\.)duckduckgo\.com$/.test(u.host) && u.searchParams.has("q"))
      || (/(^|\.)search\.yahoo\.com$/.test(u.host));
  } catch { return false; }
}

// ---- "Are you human?" checks ----------------------------------------------------------------------
const CHALLENGE_TEXT = /n[ãa]o sou um rob[ôo]|i'?m not a robot|verify (that )?you are (a )?human|confirme que voc[êe] (é|e) humano|verifique se voc[êe] [ée] humano|unusual traffic|tr[áa]fego incomum|checking (if the site connection is secure|your browser)|verificando (se a conex[ãa]o|seu navegador)|press (and|&) hold|pressione e segure|complete the security check|attention required|access denied.{0,40}(bot|automat)|we detected (unusual|suspicious) activity|detectamos (uma )?atividade (incomum|suspeita)/i;
const CHALLENGE_TITLE = /^(just a moment|um momento|attention required|verifica[çc][ãa]o|security check|are you a robot|access denied|acesso negado)\b/i;
const CHALLENGE_FRAME = /recaptcha\/(api2|enterprise)\/(anchor|bframe)|hcaptcha\.com\/captcha|challenges\.cloudflare\.com|turnstile|arkoselabs|funcaptcha|geo\.captcha-delivery|perimeterx|px-captcha/i;

/** What the page shows, as signals gathered inside it ({ url, title, text, frames }) -> a check or null. */
export function challengeFrom({ url = "", title = "", text = "", frames = [] } = {}) {
  if (/google\.[a-z.]+\/sorry\//i.test(url) || /[?&](captcha|challenge)=/i.test(url)) return "a página de verificação do site";
  if (frames.some((f) => CHALLENGE_FRAME.test(f))) return "um captcha (\"não sou um robô\")";
  if (CHALLENGE_TITLE.test(String(title).trim())) return `a verificação "${String(title).trim().slice(0, 60)}"`;
  // Short pages only: an article that mentions "unusual traffic" is not a wall.
  if (String(text).length < 2500 && CHALLENGE_TEXT.test(text)) return "uma verificação de que você é humano";
  return null;
}

/** Runs inside the page: the signals for challengeFrom. */
export function pageSignals() {
  return {
    url: location.href,
    title: document.title,
    text: (document.body?.innerText || "").slice(0, 3000),
    frames: [...document.querySelectorAll("iframe")].map((f) => f.src || f.getAttribute("title") || "").slice(0, 30),
  };
}

// Sites that asked: no more actions there until the check is gone from the page (the person solved it).
const walls = new Map();
export const hostOf = (url) => { try { return new URL(url).host.replace(/^www\./, ""); } catch { return ""; } };
export function markWall(url, what) { const host = hostOf(url); if (host) walls.set(host, { what, at: Date.now() }); }
export function clearWall(url) { walls.delete(hostOf(url)); }
export function wallAt(url) { return walls.get(hostOf(url)) || null; }
export const CHALLENGE_STOP = (what, host) => `PAROU: ${host} mostrou ${what}. A Aurora não tenta passar por isso nem repete a ação. Diga à pessoa, em uma frase, para resolver a verificação na janela do navegador e avisar quando terminar; depois continue de onde parou.`;

// ---- Pace and ceiling ------------------------------------------------------------------------------
const lastAction = new Map();
export const PACE_MS = 1200;
export const PACE_JITTER_MS = 900;
export const MAX_ACTIONS_PER_SITE = 18;

/** How long to wait before the next action on this site, for a human pace (0 when enough time passed). */
export function paceDelay(url, now = Date.now(), random = Math.random) {
  const last = lastAction.get(hostOf(url));
  if (!last) return 0;
  const gap = PACE_MS + Math.floor(random() * PACE_JITTER_MS);
  return Math.max(0, last + gap - now);
}
export function noteAction(url, now = Date.now()) { const host = hostOf(url); if (host) lastAction.set(host, now); }

/** One more action on this site in this request: an error past the ceiling. */
export function countAction(ctx, url) {
  const host = hostOf(url);
  if (!host) return;
  ctx.__browserActions ||= new Map();
  const n = (ctx.__browserActions.get(host) || 0) + 1;
  ctx.__browserActions.set(host, n);
  if (n > MAX_ACTIONS_PER_SITE) throw new Error(`Já foram ${MAX_ACTIONS_PER_SITE} ações em ${host} neste pedido: pare aqui, mostre à pessoa o que já encontrou e pergunte se deve continuar (muitas ações seguidas fazem o site pedir verificação de robô).`);
}

export function resetPaceForTests() { lastAction.clear(); walls.clear(); }
