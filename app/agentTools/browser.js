import { getBrowserPage, setActivePage } from "../browserBackend.js";
import { normalizeGotoUrl } from "../browserAgent.js";
import { centerOf, findTextBox, recognizeImage } from "../ocr.js";
import { assertAllowedUrl } from "./netGuard.js";
import { CHALLENGE_STOP, challengeFrom, clearWall, countAction, hostOf, isWebSearchUrl, markWall, noteAction, paceDelay, pageSignals, siteSearchUrl, wallAt } from "../browserPace.js";

const MAX_ELEMENTS = 60;

/**
 * Runs inside the page. Tags every visible interactive element with a
 * stable `data-aurora-ref` (kept across snapshots, so a ref the model saw
 * earlier still resolves) and returns a compact role + name list — the
 * model reads the page the way a screen reader would, not through OCR.
 * Elements inside the viewport come first, since those are what a person
 * would act on without scrolling.
 */
function collectElements(max) {
  const selector = 'a[href],button,input:not([type=hidden]),textarea,select,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=option],[role=combobox],[role=searchbox],[role=switch],[contenteditable=""],[contenteditable=true],[onclick],[tabindex]:not([tabindex="-1"])';
  window.__auroraRef ||= 0;
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const nameOf = (el) => {
    const labelled = el.getAttribute("aria-labelledby");
    const byId = labelled ? labelled.split(/\s+/).map((id) => document.getElementById(id)?.innerText).join(" ") : "";
    const label = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText : "";
    return clean(el.getAttribute("aria-label") || byId || label || el.getAttribute("title") || el.innerText || el.getAttribute("placeholder") || el.getAttribute("alt") || el.querySelector?.("img[alt]")?.getAttribute("alt") || (el.type !== "password" ? el.value : "") || el.getAttribute("name")).slice(0, 90);
  };
  const roleOf = (el) => {
    const role = el.getAttribute("role");
    if (role) return role;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "input") return ({ checkbox: "checkbox", radio: "radio", submit: "button", button: "button", search: "searchbox" })[el.type] || "textbox";
    if (tag === "textarea" || el.isContentEditable) return "textbox";
    if (tag === "select") return "combobox";
    return tag === "summary" ? "button" : tag;
  };
  const vh = window.innerHeight;
  const items = [];
  for (const el of document.querySelectorAll(selector)) {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (rect.width < 2 || rect.height < 2 || style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
    const name = nameOf(el);
    const role = roleOf(el);
    if (!name && role !== "textbox" && role !== "searchbox" && role !== "combobox") continue;
    if (!el.dataset.auroraRef) el.dataset.auroraRef = `e${++window.__auroraRef}`;
    const inView = rect.bottom > 0 && rect.top < vh;
    items.push({ ref: el.dataset.auroraRef, role, name, inView, top: rect.top, value: role === "textbox" && el.type !== "password" && el.value ? clean(el.value).slice(0, 60) : "" });
  }
  items.sort((a, b) => (b.inView - a.inView) || (a.top - b.top));
  const seen = new Set();
  const unique = items.filter((item) => { const key = item.role + "|" + item.name; if (seen.has(key) && !item.inView) return false; seen.add(key); return true; });
  return { elements: unique.slice(0, max), total: unique.length, text: clean(document.body?.innerText).slice(0, 1200) };
}

// Single-page apps (YouTube, Gmail…) swap content without a load event:
// wait until the visible text stops changing, not just for DOMContentLoaded.
async function settle(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {});
  let previous = -1;
  let stable = 0;
  for (let i = 0; i < 14 && stable < 2; i += 1) {
    await page.waitForTimeout(300);
    const size = await page.evaluate(() => document.body?.innerText.length || 0).catch(() => -2);
    stable = size === previous ? stable + 1 : 0;
    previous = size;
  }
}

const TYPEABLE = new Set(["textbox", "searchbox", "combobox"]);

/**
 * The address the person wrote, when the model is about to open the same page path ("/contato")
 * on another host: a swapped address, not a different site. null otherwise.
 */
export function requestedUrl(request, destination) {
  const path = (u) => u.pathname.replace(/\/+$/, "") || "/";
  for (const raw of String(request || "").match(/https?:\/\/[^\s"'<>)\]]+/g) || []) {
    let asked;
    try { asked = new URL(raw.replace(/[.,;:!?]+$/, "")); } catch { continue; }
    if (asked.host === destination.host) return null;
    if (path(asked) !== "/" && path(asked) === path(destination)) return asked;
  }
  return null;
}

async function typeableFields(page) {
  const data = await page.evaluate(collectElements, MAX_ELEMENTS).catch(() => ({ elements: [] }));
  return data.elements.filter((e) => TYPEABLE.has(e.role)).map((e) => `[${e.ref}] ${e.role} "${e.name}"`).join(", ") || "nenhum";
}

export async function snapshotText(page) {
  const data = await page.evaluate(collectElements, MAX_ELEMENTS).catch(() => ({ elements: [], total: 0, text: "" }));
  const lines = data.elements.map((e) => `[${e.ref}] ${e.role} "${e.name}"${e.value ? ` (valor: "${e.value}")` : ""}${e.inView ? "" : " (fora da tela)"}`);
  return [
    `Página: ${(await page.title().catch(() => "")) || "(sem título)"}`,
    `URL: ${page.url()}`,
    `Elementos interativos (${data.total > data.elements.length ? `${data.elements.length} de ${data.total}` : data.elements.length}):`,
    lines.join("\n") || "(nenhum)",
    `Texto visível (início): ${data.text || "(vazio)"}`,
  ].join("\n");
}

function watchNewTabs(context) {
  if (context.__auroraWatch) return;
  context.__auroraWatch = true;
  context.on("page", (page) => setActivePage(page));
}

async function current(ctx) {
  const { context, page } = await getBrowserPage({ backend: ctx.browserBackend, env: ctx.env });
  watchNewTabs(context);
  return { context, page };
}

async function locate(page, { ref, text }) {
  if (ref) {
    const locator = page.locator(`[data-aurora-ref="${String(ref).replace(/[^a-z0-9]/gi, "")}"]`);
    if (await locator.count()) return locator.first();
  }
  const query = String(text || (ref && !/^e\d+$/.test(ref) ? ref : "")).trim();
  if (!query) return null;
  for (const candidate of [
    page.getByRole("link", { name: query }), page.getByRole("button", { name: query }),
    page.getByPlaceholder(query), page.getByLabel(query), page.getByText(query, { exact: false }),
  ]) {
    const visible = candidate.filter({ visible: true });
    if (await visible.count().catch(() => 0)) return visible.first();
  }
  // The name the snapshot showed: a field listed as "email" (its name attribute) under the label
  // "E-mail" was asked for by that name and not found (05/10/2026).
  const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const data = await page.evaluate(collectElements, MAX_ELEMENTS).catch(() => ({ elements: [] }));
  const match = data.elements.find((e) => fold(e.name) === fold(query)) || data.elements.find((e) => fold(query).length >= 3 && fold(e.name).includes(fold(query)));
  if (match) {
    const locator = page.locator(`[data-aurora-ref="${match.ref}"]`);
    if (await locator.count().catch(() => 0)) return locator.first();
  }
  return null;
}

/** An "are you human?" check on the page: the site is marked and the Aurora stops (app/browserPace.js). */
async function checkWall(page) {
  const signals = await page.evaluate(pageSignals).catch(() => null);
  const what = signals && challengeFrom(signals);
  if (what) { markWall(page.url(), what); throw new Error(CHALLENGE_STOP(what, hostOf(page.url()))); }
  clearWall(page.url());
}

/**
 * Before an action that changes the page: a site that asked for a check stays untouched until the check
 * is gone; a ceiling per site per request; a human pace between actions on the same site.
 */
async function gate(ctx, page, url = page.url()) {
  const wall = wallAt(url);
  if (wall) {
    // The person may have solved it since: the page on that site no longer shows it.
    if (hostOf(page.url()) === hostOf(url)) await checkWall(page);
    else throw new Error(CHALLENGE_STOP(wall.what, hostOf(url)));
  }
  countAction(ctx, url);
  const delay = paceDelay(url);
  if (delay) await page.waitForTimeout(delay);
  noteAction(url);
}

// Snapshot of whichever tab is active afterwards: a click may open a new tab.
async function after(ctx, page, message) {
  await settle(page);
  const active = (await current(ctx)).page;
  if (active !== page) await settle(active);
  await checkWall(active);
  noteAction(active.url());
  return `${message}\n\n${await snapshotText(active)}`;
}

/** Types into the first search box of the page and presses Enter (a site with no known results address). */
async function searchInPage(page, query) {
  const data = await page.evaluate(collectElements, MAX_ELEMENTS).catch(() => ({ elements: [] }));
  const box = data.elements.find((e) => e.role === "searchbox") || data.elements.find((e) => TYPEABLE.has(e.role) && /busca|pesquis|search|procur|o que voc/i.test(e.name)) || data.elements.find((e) => TYPEABLE.has(e.role) && e.inView);
  if (!box) return false;
  const locator = page.locator(`[data-aurora-ref="${box.ref}"]`).first();
  await locator.click({ timeout: 5000 }).catch(() => {});
  await locator.fill(String(query), { timeout: 5000 });
  await page.keyboard.press("Enter");
  return true;
}

export const browserTools = [
  {
    name: "browser_navigate",
    description: "Abre um site no navegador controlado pela Aurora (janela visível para o usuário). Aceita URL completa ou domínio, ex.: \"youtube.com\". Para buscar algo dentro do site, mande também search (ex.: url \"mercadolivre.com.br\", search \"geladeira frost free\"): abre direto os resultados, numa ação só. Para pesquisar na internet em geral, use web_search, não o Google no navegador. Devolve os elementos da página já carregada.",
    parameters: { type: "object", properties: { url: { type: "string", description: "URL ou domínio" }, search: { type: "string", description: "o que buscar dentro do site (opcional)" } }, required: ["url"] },
    risk: "safe",
    stage: (a) => (a.search ? `Buscando "${String(a.search).slice(0, 40)}" em ${a.url}…` : `Abrindo ${a.url}…`),
    async run({ url, search }, ctx) {
      let target = String(url || "").trim();
      if (!target) throw new Error("Informe a URL.");
      if (!/[.:/]/.test(target)) target = `${target}.com`;
      // A search inside a known site: straight to its results (open + type + Enter were three actions).
      const results = search ? siteSearchUrl(target, search) : null;
      if (results) target = results;
      let destination = new URL(normalizeGotoUrl(target));
      // Web searches in the browser: the engines ask "are you a robot?" fast. web_search reads results
      // with no browser at all; the browser only when the person asked for that engine.
      if ((isWebSearchUrl(destination.href) || (search && /(^|\.)(google|bing)\.[a-z.]+$/.test(destination.host))) && !/\b(google|bing)\b/i.test(String(ctx.request || ""))) {
        throw new Error(`Para pesquisar "${search || destination.searchParams.get("q") || ""}" na internet, use web_search (lê os resultados sem abrir o navegador e sem verificação de robô). Depois, se precisar, abra o site escolhido com browser_navigate.`);
      }
      // Asked to open http://127.0.0.1:…/contato, the model opened an invented
      // loja-teclas-web.vercel.app/contato and sent the person's data there (battery, 05/10/2026).
      // Same page path on another host than the one the person gave: the person's address wins.
      const asked = requestedUrl(ctx.request, destination);
      let note = "";
      if (asked) { note = ` (Abri o endereço do pedido, ${asked.href}, em vez de ${destination.host}.)`; destination = asked; }
      if (!["http:", "https:"].includes(destination.protocol)) throw new Error("Só é possível navegar em HTTP/HTTPS.");
      assertAllowedUrl(destination.href);
      const { page } = await current(ctx);
      await page.bringToFront().catch(() => {});
      // The page already open: no reload (a reload is one more request the site counts).
      const same = (a, b) => a.replace(/#.*$/, "").replace(/\/$/, "") === b.replace(/#.*$/, "").replace(/\/$/, "");
      if (same(page.url(), destination.href) && !search) return `${note}A página ${page.url()} já está aberta (não recarreguei).\n\n${await snapshotText(page)}`;
      await gate(ctx, page, destination.href);
      await page.goto(destination.href, { timeout: 30000, waitUntil: "domcontentloaded" });
      // An unknown site: its own search box, typed and sent in this same action.
      if (search && !results) {
        await settle(page);
        await checkWall(page);
        if (await searchInPage(page, search)) return after(ctx, page, `Abri ${destination.host} e busquei "${search}".${note}`);
        return after(ctx, page, `Abri ${page.url()}, mas não achei caixa de busca: veja os elementos e use browser_type.${note}`);
      }
      return after(ctx, page, `${results ? `Abri os resultados de "${search}" em ${destination.host}` : `Abri ${page.url()}`}.${note}`);
    },
  },
  {
    name: "browser_fill",
    description: "Preenche um formulário inteiro numa ação só: fields é a lista de campos ({field: rótulo/placeholder ou ref, value: o que escrever; numa lista de opções, a opção; numa caixa de marcar, \"sim\"/\"não\"}); submit (opcional) é o botão a clicar no fim (texto ou ref). Prefira a vários browser_type seguidos.",
    parameters: { type: "object", properties: {
      fields: { type: "array", items: { type: "object", properties: { field: { type: "string" }, value: { type: "string" } } } },
      submit: { type: "string", description: "botão para enviar no fim (texto ou ref)" },
    }, required: ["fields"] },
    risk: "safe",
    stage: (a) => `Preenchendo ${[a.fields].flat().length} campo(s)…`,
    async run({ fields, submit }, ctx) {
      const { page } = await current(ctx);
      await gate(ctx, page);
      const done = [];
      const missing = [];
      for (const f of [fields].flat().filter(Boolean)) {
        const name = String(f.field || f.ref || "");
        const locator = await locate(page, /^e\d+$/.test(name) ? { ref: name } : { text: name });
        if (!locator) { missing.push(name); continue; }
        const kind = await locator.evaluate((el) => (el.tagName === "SELECT" ? "select" : el.type === "checkbox" || el.getAttribute("role") === "checkbox" ? "checkbox" : el.type === "radio" ? "radio" : "text")).catch(() => "text");
        const value = String(f.value ?? f.text ?? "");
        await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        if (kind === "select") await locator.selectOption({ label: value }).catch(() => locator.selectOption(value));
        else if (kind === "checkbox") { if (/^(sim|true|marcar|marcado|x|1)$/i.test(value)) await locator.check({ timeout: 5000 }); else await locator.uncheck({ timeout: 5000 }); }
        else if (kind === "radio") await locator.check({ timeout: 5000 });
        else { await locator.fill(value, { timeout: 5000 }); }
        // A person fills one field after the other, not all in the same millisecond.
        await page.waitForTimeout(120 + Math.floor(Math.random() * 180));
        done.push(name);
      }
      if (missing.length && !done.length) throw new Error(`Não achei os campos ${missing.join(", ")}. Campos nesta página: ${await typeableFields(page)}.`);
      let sent = "";
      if (submit) {
        const button = await locate(page, /^e\d+$/.test(String(submit)) ? { ref: submit } : { text: submit });
        if (!button) throw new Error(`Preenchi ${done.join(", ")}, mas não achei o botão "${submit}" para enviar.`);
        await button.click({ timeout: 6000 });
        sent = ` e cliquei em "${submit}"`;
      }
      return after(ctx, page, `Preenchi ${done.length} campo(s) (${done.join(", ")})${sent}.${missing.length ? ` Não achei: ${missing.join(", ")}.` : ""}`);
    },
  },
  {
    name: "browser_snapshot",
    description: "Mostra a página atual do navegador: título, URL, elementos clicáveis/digitáveis com refs (ex.: e12) e o início do texto. Use antes de clicar ou digitar.",
    parameters: { type: "object", properties: {} },
    risk: "safe",
    stage: () => "Olhando a página…",
    async run(_args, ctx) {
      const { page } = await current(ctx);
      await checkWall(page);
      return snapshotText(page);
    },
  },
  {
    name: "browser_click",
    description: "Clica em um elemento da página pelo ref do snapshot (preferível) ou pelo texto visível.",
    parameters: { type: "object", properties: { ref: { type: "string", description: "ref do snapshot, ex.: e12" }, text: { type: "string", description: "texto visível do elemento, se não houver ref" } } },
    risk: "safe",
    stage: (a) => `Clicando em ${a.text || a.ref}…`,
    async run(args, ctx) {
      const { page } = await current(ctx);
      await gate(ctx, page);
      const locator = await locate(page, args);
      if (locator) {
        await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        await locator.click({ timeout: 6000 });
        return after(ctx, page, `Cliquei em ${args.ref || args.text}.`);
      }
      // Canvas-drawn or image-only UIs have no DOM text: fall back to OCR.
      const ocr = await recognizeImage(await page.screenshot(), ctx.env);
      const box = findTextBox(ocr.words, args.text || args.ref || "");
      if (!box) throw new Error(`Não encontrei "${args.text || args.ref}" na página. Veja o snapshot e use um ref.`);
      const { x, y } = centerOf(box);
      await page.mouse.click(x, y);
      return after(ctx, page, `Cliquei em "${args.text || args.ref}" (pela imagem da tela).`);
    },
  },
  {
    name: "browser_type",
    description: "Digita texto em um campo (ref do snapshot ou texto/placeholder do campo). Com submit=true aperta Enter depois, ex.: para pesquisar.",
    parameters: { type: "object", properties: { ref: { type: "string" }, field: { type: "string", description: "placeholder ou rótulo do campo, se não houver ref" }, text: { type: "string" }, submit: { type: "boolean" } }, required: ["text"] },
    risk: "safe",
    stage: (a) => `Digitando "${String(a.text).slice(0, 40)}"…`,
    async run({ ref, field, text, submit }, ctx) {
      const { page } = await current(ctx);
      if (submit) await gate(ctx, page);
      let locator = ref || field ? await locate(page, { ref, text: field }) : null;
      if (!ref && !field) {
        // No field named: the focused one, else the first visible text field
        // (usually the site's search box) — what a person would type into.
        // The focused field only if it is still empty: after "nome" and "email", a third call with
        // no field typed the message over the e-mail (battery, intermittent, 05/10/2026).
        const focused = await page.evaluate(() => { const el = document.activeElement; return !!el && (el.isContentEditable ? !el.textContent.trim() : ["INPUT", "TEXTAREA"].includes(el.tagName) && !el.value); }).catch(() => false);
        if (!focused) {
          const data = await page.evaluate(collectElements, MAX_ELEMENTS).catch(() => ({ elements: [] }));
          const typeable = data.elements.filter((e) => TYPEABLE.has(e.role));
          const first = typeable.find((e) => e.inView && !e.value) || typeable.find((e) => !e.value) || typeable.find((e) => e.inView) || typeable[0];
          if (!first) throw new Error("Não há campo de texto nesta página. Use browser_snapshot para ver a página.");
          locator = page.locator(`[data-aurora-ref="${first.ref}"]`).first();
        }
      }
      if ((ref || field) && !locator) throw new Error(`Não encontrei o campo "${ref || field}". Campos nesta página: ${await typeableFields(page)}.`);
      if (locator) {
        const editable = await locator.evaluate((el) => el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || ["textbox", "searchbox", "combobox"].includes(el.getAttribute("role"))).catch(() => false);
        if (!editable) throw new Error(`"${ref || field}" não é um campo de texto. Campos nesta página: ${await typeableFields(page)}.`);
        await locator.click({ timeout: 5000 }).catch(() => {});
        try { await locator.fill(String(text), { timeout: 5000 }); }
        catch { await page.keyboard.press("Control+A"); await page.keyboard.type(String(text)); }
      } else await page.keyboard.type(String(text));
      // Enter in a multi-line field (the message box of a contact form) only adds a line: the form
      // was never sent while the tool said "apertei Enter" (battery, 05/10/2026). Its form is sent
      // as a click on its button would; with no form, the model is told to click.
      let sent = "";
      if (submit) {
        const multiline = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || !(el.tagName === "TEXTAREA" || el.isContentEditable)) return null;
          if (el.form) { el.form.requestSubmit(); return "form"; }
          return "none";
        }).catch(() => null);
        if (multiline === "form") sent = " e enviei o formulário (o campo tem várias linhas: Enter não envia)";
        else if (multiline === "none") sent = ". Este campo tem várias linhas e Enter não envia: clique no botão de enviar (browser_click)";
        else {
          await page.keyboard.press("Enter");
          sent = " e apertei Enter";
        }
        // Closes autocomplete dropdowns so the snapshot shows the results.
        await page.evaluate(() => document.activeElement?.blur?.()).catch(() => {});
      }
      return after(ctx, page, `Digitei "${text}"${sent}.`);
    },
  },
  {
    name: "browser_key",
    description: "Aperta uma tecla ou atalho no navegador, ex.: Enter, Escape, Tab, ArrowDown, Control+L, k (pausar vídeo no YouTube).",
    parameters: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
    risk: "safe",
    stage: (a) => `Apertando ${a.key}…`,
    async run({ key }, ctx) {
      const { page } = await current(ctx);
      await gate(ctx, page);
      await page.keyboard.press(String(key));
      return after(ctx, page, `Apertei ${key}.`);
    },
  },
  {
    name: "browser_scroll",
    description: "Rola a página. direction: down ou up.",
    parameters: { type: "object", properties: { direction: { type: "string", enum: ["down", "up"] } } },
    risk: "safe",
    stage: () => "Rolando a página…",
    async run({ direction = "down" }, ctx) {
      const { page } = await current(ctx);
      await page.mouse.wheel(0, direction === "up" ? -700 : 700);
      return after(ctx, page, `Rolei para ${direction === "up" ? "cima" : "baixo"}.`);
    },
  },
  {
    name: "browser_read",
    description: "Lê o texto principal da página atual (artigo, resultados, descrição). Use para responder perguntas sobre o conteúdo.",
    parameters: { type: "object", properties: {} },
    risk: "safe",
    stage: () => "Lendo a página…",
    async run(_args, ctx) {
      const { page } = await current(ctx);
      const text = await page.evaluate(() => (document.querySelector("main, article, [role=main]") || document.body)?.innerText || "");
      return `Página: ${await page.title()}\nURL: ${page.url()}\n\n${text.replace(/\n{3,}/g, "\n\n").slice(0, 6000)}`;
    },
  },
  {
    name: "browser_tabs",
    description: "Gerencia abas: action=list, new (com url opcional), switch (index) ou close (index).",
    parameters: { type: "object", properties: { action: { type: "string", enum: ["list", "new", "switch", "close"] }, index: { type: "integer" }, url: { type: "string" } }, required: ["action"] },
    risk: "safe",
    stage: (a) => `Abas: ${a.action}…`,
    async run({ action, index, url }, ctx) {
      const { context, page } = await current(ctx);
      const pages = () => context.pages().filter((p) => !p.isClosed());
      if (action === "new") {
        const tab = await context.newPage();
        setActivePage(tab);
        if (url) {
          const destination = new URL(normalizeGotoUrl(url));
          if (!["http:", "https:"].includes(destination.protocol)) throw new Error("Só é possível navegar em HTTP/HTTPS.");
          assertAllowedUrl(destination.href);
          await tab.goto(destination.href, { timeout: 30000, waitUntil: "domcontentloaded" });
        }
        return after(ctx, tab, "Abri uma nova aba.");
      }
      if (action === "switch" || action === "close") {
        const target = pages()[Number(index)];
        if (!target) throw new Error(`Aba ${index} não existe.`);
        if (action === "close") {
          await target.close();
          const rest = pages();
          if (target === page && rest.length) setActivePage(rest.at(-1));
        } else { setActivePage(target); await target.bringToFront().catch(() => {}); }
      }
      const active = (await current(ctx)).page;
      const list = await Promise.all(pages().map(async (p, i) => `${i}${p === active ? " (ativa)" : ""}: ${await p.title().catch(() => "")} — ${p.url()}`));
      return `Abas:\n${list.join("\n")}`;
    },
  },
];
