// The check of a web page the Aurora made, the way a person would look at it: opened in a hidden
// browser at a computer's and at a phone's size, it reports the console errors, the files that do not
// load, a page wider than the screen, an empty page and broken images, and saves the two pictures. The
// model said "o site carrega corretamente" about a page with nothing visual (13/10): now it is told.
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { installedChannel, isChromiumInstalled } from "./browserAgent.js";

const chromium = process.platform === "android" ? null : (await import("playwright")).chromium;

export const SIZES = [{ name: "computador", width: 1366, height: 860 }, { name: "celular", width: 390, height: 844, mobile: true }];

/** The address of what to check: a URL, or a page of the project (index.html, a folder with one). */
export function pageAddress(target, workspace) {
  const t = String(target || "").trim();
  if (/^(https?|file):\/\//i.test(t)) return t;
  let file = resolve(workspace || ".", t || ".");
  if (existsSync(join(file, "index.html"))) file = join(file, "index.html");
  if (!existsSync(file)) throw new Error(`Não achei ${file}. Diga o caminho do index.html (ou da pasta do site).`);
  return pathToFileURL(file).href;
}

/** The facts of the page that is open, measured in the page. */
function measure() {
  const doc = document.documentElement;
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05; };
  const wide = [...document.body.querySelectorAll("*")].filter((el) => { const r = el.getBoundingClientRect(); return r.right > innerWidth + 4 && r.width > 0 && getComputedStyle(el).position !== "fixed"; }).slice(0, 3).map((el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.className && typeof el.className === "string" ? `.${el.className.split(/\s+/)[0]}` : ""}`);
  const text = (document.body.innerText || "").replace(/\s+/g, " ").trim();
  const sections = [...document.querySelectorAll("section, main, header, article")].filter(visible);
  const emptySections = sections.filter((s) => (s.innerText || "").trim().length < 20 && !s.querySelector("canvas, img, svg, video")).map((s) => s.id || s.className || s.tagName.toLowerCase()).slice(0, 4);
  const brokenImages = [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute("src")).slice(0, 4);
  const bg = getComputedStyle(document.body).backgroundColor;
  return {
    title: document.title, overflow: doc.scrollWidth > innerWidth + 4, wide, textLength: text.length, height: doc.scrollHeight,
    headings: [...document.querySelectorAll("h1, h2")].filter(visible).map((h) => h.innerText.trim()).slice(0, 8),
    links: document.querySelectorAll("a[href], button").length, emptySections, brokenImages,
    canvas: [...document.querySelectorAll("canvas")].filter(visible).length,
    styled: !(bg === "rgba(0, 0, 0, 0)" || bg === "rgb(255, 255, 255)") || document.styleSheets.length > 0,
  };
}

/**
 * Opens `address` at each size and returns { ok, problems: [...], report: text, shots: [paths] }.
 * Pictures go to `shotsDir` (the project's .aurora folder).
 */
export async function checkPage(address, { shotsDir = null, env = process.env } = {}) {
  if (!chromium) throw new Error("A conferência de páginas precisa do Harness desktop.");
  const options = { headless: true };
  if (env.CHROMIUM_EXECUTABLE_PATH) options.executablePath = env.CHROMIUM_EXECUTABLE_PATH;
  else if (!isChromiumInstalled(env)) options.channel = installedChannel(env);
  const browser = await chromium.launch(options);
  const problems = []; const shots = []; const lines = [];
  try {
    for (const size of SIZES) {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: Boolean(size.mobile), hasTouch: Boolean(size.mobile) });
      const page = await context.newPage();
      const errors = []; const failed = [];
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("requestfailed", (r) => failed.push(`${r.url().split("/").slice(-2).join("/")} (${r.failure()?.errorText || "falhou"})`));
      page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.url().split("/").slice(-2).join("/")} (HTTP ${r.status()})`); });
      try { await page.goto(address, { waitUntil: "load", timeout: 25000 }); }
      catch (e) { problems.push(`não abriu: ${e.message.split("\n")[0]}`); await context.close(); break; }
      await page.waitForTimeout(1500);
      const m = await page.evaluate(measure);
      const at = `no ${size.name}`;
      if (errors.length) problems.push(`erro no console ${at}: ${[...new Set(errors)].slice(0, 3).join(" | ").slice(0, 300)}`);
      if (failed.length) problems.push(`arquivos que não carregaram ${at}: ${[...new Set(failed)].slice(0, 5).join(", ")}`);
      if (m.overflow) problems.push(`a página é mais larga que a tela ${at} (rolagem para o lado)${m.wide.length ? `: ${m.wide.join(", ")}` : ""}`);
      if (m.textLength < 80) problems.push(`quase sem conteúdo ${at} (${m.textLength} letras visíveis)`);
      if (m.emptySections.length) problems.push(`seções vazias ${at}: ${m.emptySections.join(", ")}`);
      if (m.brokenImages.length) problems.push(`imagens quebradas ${at}: ${m.brokenImages.join(", ")}`);
      if (!m.styled) problems.push(`sem estilo ${at}: a página está sem CSS (fundo branco padrão)`);
      if (size.name === "computador") lines.push(`Título "${m.title}"; ${m.headings.length} títulos (${m.headings.slice(0, 5).join(" / ")}); ${m.links} links e botões; ${m.canvas ? `${m.canvas} cena(s) desenhada(s) em canvas; ` : ""}altura ${m.height}px.`);
      if (shotsDir) {
        mkdirSync(shotsDir, { recursive: true });
        const shot = join(shotsDir, `conferencia-${size.name}.png`);
        await page.screenshot({ path: shot });
        shots.push(shot);
      }
      await context.close();
    }
  } finally { await browser.close(); }
  const report = [problems.length ? `PROBLEMAS (${problems.length}):\n${problems.map((p) => `- ${p}`).join("\n")}` : "Nenhum problema: abriu sem erros no computador e no celular.", ...lines, ...(shots.length ? [`Fotos: ${shots.join(", ")}`] : [])].join("\n");
  return { ok: !problems.length, problems, report, shots };
}

export const shotsFolder = (address) => { try { const u = new URL(address); return u.protocol === "file:" ? join(dirname(decodeURIComponent(u.pathname).replace(/^\/([a-z]:)/i, "$1")), ".aurora") : null; } catch { return null; } };
