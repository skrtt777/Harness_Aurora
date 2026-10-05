import { getBrowserPage, setActivePage } from "../browserBackend.js";
import { normalizeGotoUrl } from "../browserAgent.js";
import { centerOf, findTextBox, recognizeImage } from "../ocr.js";
import { assertAllowedUrl } from "./netGuard.js";

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

// Snapshot of whichever tab is active afterwards: a click may open a new tab.
async function after(ctx, page, message) {
  await settle(page);
  const active = (await current(ctx)).page;
  if (active !== page) await settle(active);
  return `${message}\n\n${await snapshotText(active)}`;
}

export const browserTools = [
  {
    name: "browser_navigate",
    description: "Abre um site no navegador controlado pela Aurora (janela visível para o usuário). Aceita URL completa ou domínio, ex.: \"youtube.com\". Devolve os elementos da página já carregada.",
    parameters: { type: "object", properties: { url: { type: "string", description: "URL ou domínio" } }, required: ["url"] },
    risk: "safe",
    stage: (a) => `Abrindo ${a.url}…`,
    async run({ url }, ctx) {
      let target = String(url || "").trim();
      if (!target) throw new Error("Informe a URL.");
      if (!/[.:/]/.test(target)) target = `${target}.com`;
      const destination = new URL(normalizeGotoUrl(target));
      if (!["http:", "https:"].includes(destination.protocol)) throw new Error("Só é possível navegar em HTTP/HTTPS.");
      assertAllowedUrl(destination.href);
      const { page } = await current(ctx);
      await page.bringToFront().catch(() => {});
      await page.goto(destination.href, { timeout: 30000, waitUntil: "domcontentloaded" });
      return after(ctx, page, `Abri ${page.url()}.`);
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
      let locator = ref || field ? await locate(page, { ref, text: field }) : null;
      if (!ref && !field) {
        // No field named: the focused one, else the first visible text field
        // (usually the site's search box) — what a person would type into.
        const focused = await page.evaluate(() => { const el = document.activeElement; return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA"].includes(el.tagName)); }).catch(() => false);
        if (!focused) {
          const data = await page.evaluate(collectElements, MAX_ELEMENTS).catch(() => ({ elements: [] }));
          const first = data.elements.find((e) => TYPEABLE.has(e.role) && e.inView) || data.elements.find((e) => TYPEABLE.has(e.role));
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
      if (submit) {
        await page.keyboard.press("Enter");
        // Closes autocomplete dropdowns so the snapshot shows the results.
        await page.evaluate(() => document.activeElement?.blur?.()).catch(() => {});
      }
      return after(ctx, page, `Digitei "${text}"${submit ? " e apertei Enter" : ""}.`);
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
