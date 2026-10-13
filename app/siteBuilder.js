// A whole website from a little content: the local model writes what the site says (title, the items,
// the text) and this writes a site that looks like one — responsive menu, a 3D hero (Three.js), item
// cards drawn by React with filters, search and a detail panel, sections, a contact form, and, when
// asked, a Java server and a C++ module that use the same data. The 4B model asked for "um website com
// three.js, c++, html, java e react sobre video games" wrote a page with nothing visual in three tries
// (13/10): it is good at content and bad at 600 lines of CSS. Everything opens with a double click
// (classic scripts from cdnjs, no build, no module CORS on file://).
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const SITE_THEMES = {
  neon: { label: "Neon (games, tecnologia)", bg: "#0b0b14", bg2: "#14142a", card: "#191932", text: "#ecebff", soft: "#a6a4c8", accent: "#7c5cff", accent2: "#20e3b2", hot: "#ff4f9a", font: "Orbitron", body: "Inter", dark: true },
  retro: { label: "Retrô (arcade, pixel)", bg: "#1b1035", bg2: "#2a1650", card: "#2f1b5c", text: "#fff4d6", soft: "#cdb9f2", accent: "#ffcc33", accent2: "#ff5e7e", hot: "#36e2ff", font: "Press Start 2P", body: "Inter", dark: true },
  claro: { label: "Claro (empresa, serviços)", bg: "#f6f7fb", bg2: "#ffffff", card: "#ffffff", text: "#151a2d", soft: "#59607a", accent: "#2f5bea", accent2: "#12b886", hot: "#f0545f", font: "Poppins", body: "Inter", dark: false },
  natureza: { label: "Natureza (comida, viagem, saúde)", bg: "#f4f1e8", bg2: "#fffdf7", card: "#ffffff", text: "#23301f", soft: "#5d6b55", accent: "#3f7d3a", accent2: "#d98e2b", hot: "#c4513a", font: "Fraunces", body: "Inter", dark: false },
};

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const slug = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "site";
const javaStr = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** The content, cleaned: what the model sent, with defaults for what it left out. */
export function siteContent(input = {}) {
  const items = (Array.isArray(input.items) ? input.items : []).filter((i) => i && (i.name || i.title)).slice(0, 40).map((i, n) => ({
    id: n + 1,
    name: String(i.name || i.title).slice(0, 80),
    category: String(i.category || i.genre || i.tipo || "Geral").slice(0, 40),
    // The score has its own place: "2018, 9.2/10" in the detail contradicted the card's 9.5 (13/10).
    detail: String(i.detail ?? i.year ?? i.ano ?? "").replace(/[,;·-]?\s*(nota\s*)?\d+([.,]\d+)?\s*\/\s*10\b/gi, "").trim().slice(0, 40),
    score: Number.isFinite(Number(String(i.score ?? i.nota ?? "").replace(",", "."))) && String(i.score ?? i.nota ?? "") !== "" ? Math.max(0, Math.min(10, Number(String(i.score ?? i.nota).replace(",", ".")))) : null,
    description: String(i.description || i.descricao || i.text || "").slice(0, 400),
  }));
  if (items.length < 3) throw new Error(`O site precisa de pelo menos 3 itens em items (${items.length} vieram): cada um com name, category, detail (ex.: o ano), score (0 a 10) e description.`);
  const theme = SITE_THEMES[input.theme] ? input.theme : "neon";
  const features = (Array.isArray(input.features) ? input.features : []).filter((f) => f && f.title).slice(0, 6).map((f) => ({ title: String(f.title).slice(0, 60), text: String(f.text || "").slice(0, 220) }));
  return {
    title: String(input.title || "Meu site").slice(0, 60),
    tagline: String(input.tagline || "").slice(0, 160),
    itemsTitle: String(input.itemsTitle || "Destaques").slice(0, 40),
    about: String(input.about || "").slice(0, 900),
    features,
    contact: String(input.contact || "").slice(0, 120),
    theme, items,
    three: input.three !== false,
    java: Boolean(input.java), cpp: Boolean(input.cpp),
  };
}

function css(t) {
  return `:root {
  --bg: ${t.bg}; --bg2: ${t.bg2}; --card: ${t.card}; --text: ${t.text}; --soft: ${t.soft};
  --accent: ${t.accent}; --accent2: ${t.accent2}; --hot: ${t.hot};
  --line: color-mix(in srgb, var(--text) 12%, transparent);
  --radius: 16px; --shadow: 0 10px 30px color-mix(in srgb, #000 ${t.dark ? 45 : 12}%, transparent);
  --title: "${t.font}", system-ui, sans-serif; --body: "${t.body}", system-ui, sans-serif;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.6 var(--body); }
img { max-width: 100%; }
a { color: inherit; }
.wrap { width: min(1160px, 100% - 32px); margin-inline: auto; }

/* Menu: fixed, glass, a hamburger on phones; the section on screen lights up. */
.nav { position: fixed; inset: 0 0 auto; z-index: 20; backdrop-filter: blur(12px); background: color-mix(in srgb, var(--bg) 72%, transparent); border-bottom: 1px solid var(--line); transition: background .3s; }
.nav.solid { background: color-mix(in srgb, var(--bg) 94%, transparent); }
.nav .wrap { display: flex; align-items: center; justify-content: space-between; height: 68px; gap: 16px; }
.brand { font: 700 18px var(--title); letter-spacing: .04em; text-decoration: none; display: flex; align-items: center; gap: 10px; }
.brand i { width: 28px; height: 28px; border-radius: 8px; background: linear-gradient(135deg, var(--accent), var(--accent2)); box-shadow: 0 0 18px color-mix(in srgb, var(--accent) 60%, transparent); }
.links { display: flex; gap: 6px; list-style: none; margin: 0; padding: 0; }
.links a { display: block; padding: 8px 14px; border-radius: 999px; text-decoration: none; color: var(--soft); font-weight: 600; font-size: 14px; transition: color .2s, background .2s; }
.links a:hover, .links a.on { color: var(--text); background: color-mix(in srgb, var(--accent) 22%, transparent); }
.burger { display: none; background: none; border: 1px solid var(--line); color: var(--text); width: 42px; height: 42px; border-radius: 12px; font-size: 20px; cursor: pointer; }
@media (max-width: 820px) {
  .burger { display: block; }
  .links { position: fixed; inset: 68px 0 auto; flex-direction: column; padding: 12px 16px 20px; background: var(--bg2); border-bottom: 1px solid var(--line); transform: translateY(-120%); transition: transform .35s ease; }
  .links.open { transform: none; }
  .links a { padding: 12px 16px; font-size: 16px; }
}

/* Hero: the 3D scene behind the title. */
.hero { position: relative; min-height: 92vh; display: grid; align-items: center; overflow: hidden; padding-top: 68px; }
#scene { position: absolute; inset: 0; width: 100%; height: 100%; }
.hero::after { content: ""; position: absolute; inset: 0; background: radial-gradient(ellipse at 30% 40%, transparent 20%, var(--bg) 78%); pointer-events: none; }
.hero .wrap { position: relative; z-index: 1; }
.eyebrow { display: inline-block; padding: 6px 12px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--accent2) 50%, transparent); color: var(--accent2); font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.hero h1 { font: 800 clamp(38px, 7vw, 84px)/1.02 var(--title); margin: 18px 0 16px; max-width: 14ch; text-wrap: balance; background: linear-gradient(120deg, var(--text) 30%, var(--accent2)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.hero p { font-size: clamp(17px, 2vw, 21px); color: var(--soft); max-width: 52ch; margin: 0 0 30px; }
.cta { display: flex; flex-wrap: wrap; gap: 12px; }
.btn { display: inline-flex; align-items: center; gap: 8px; padding: 14px 22px; border-radius: 12px; font-weight: 700; text-decoration: none; border: 1px solid var(--line); background: color-mix(in srgb, var(--card) 80%, transparent); color: var(--text); cursor: pointer; transition: transform .15s, box-shadow .2s; font-size: 15px; }
.btn.primary { background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 60%, var(--hot))); border: 0; color: #fff; box-shadow: 0 8px 26px color-mix(in srgb, var(--accent) 45%, transparent); }
.btn:hover { transform: translateY(-2px); }
.stats { display: flex; flex-wrap: wrap; gap: 28px; margin-top: 44px; }
.stats b { display: block; font: 800 30px var(--title); color: var(--accent2); }
.stats span { color: var(--soft); font-size: 14px; }

section.block { padding: 96px 0; }
section.block.alt { background: var(--bg2); }
.head { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 34px; }
.head h2 { font: 800 clamp(28px, 4vw, 44px)/1.1 var(--title); margin: 0; }
.head p { color: var(--soft); margin: 6px 0 0; max-width: 60ch; }

/* The items (React): filters, search, cards, a detail panel. */
.tools { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.chip { border: 1px solid var(--line); background: transparent; color: var(--soft); padding: 8px 14px; border-radius: 999px; cursor: pointer; font-weight: 600; font-size: 14px; transition: all .2s; }
.chip.on, .chip:hover { color: #fff; background: var(--accent); border-color: var(--accent); }
.search { flex: 1 1 220px; max-width: 320px; padding: 10px 14px; border-radius: 12px; border: 1px solid var(--line); background: var(--card); color: var(--text); font: inherit; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 20px; margin-top: 24px; }
.card { display: flex; flex-direction: column; justify-content: flex-start; align-items: stretch; position: relative; background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; cursor: pointer; transition: transform .25s, box-shadow .25s, border-color .25s; text-align: left; color: inherit; font: inherit; padding: 0; animation: rise .5s both; }
.card:hover { transform: translateY(-6px) rotateX(2deg); box-shadow: var(--shadow); border-color: color-mix(in srgb, var(--accent) 60%, transparent); }
.cover { height: 150px; position: relative; display: grid; place-items: center; font: 800 46px var(--title); color: #fff; text-shadow: 0 4px 18px rgba(0,0,0,.35); }
.cover small { position: absolute; top: 12px; left: 12px; font: 700 11px var(--body); letter-spacing: .08em; text-transform: uppercase; background: rgba(0,0,0,.35); padding: 4px 9px; border-radius: 999px; }
.score { position: absolute; top: 10px; right: 10px; width: 46px; height: 46px; border-radius: 50%; display: grid; place-items: center; font: 800 13px var(--title); background: var(--bg); color: var(--accent2); border: 2px solid var(--accent2); }
.card .body { padding: 16px 18px 20px; flex: 1; }
.card h3 { margin: 0 0 4px; font-size: 18px; }
.card .meta { color: var(--soft); font-size: 13px; }
.card p { color: var(--soft); font-size: 14px; margin: 10px 0 0; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.empty { color: var(--soft); padding: 30px 0; }
.panel { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; background: rgba(0,0,0,.6); padding: 16px; animation: fade .2s; }
.panel .box { width: min(560px, 100%); background: var(--bg2); border: 1px solid var(--line); border-radius: 20px; overflow: hidden; box-shadow: var(--shadow); }
.panel .box .body { padding: 22px 24px 26px; }
.panel h3 { margin: 0 0 6px; font: 800 26px var(--title); }
.panel .close { float: right; }
.bar { height: 8px; border-radius: 99px; background: var(--line); overflow: hidden; margin: 14px 0; }
.bar i { display: block; height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent2)); }

.features { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 18px; }
.feature { padding: 24px; border-radius: var(--radius); background: var(--card); border: 1px solid var(--line); }
.feature b { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 12px; margin-bottom: 14px; background: color-mix(in srgb, var(--accent) 22%, transparent); color: var(--accent2); font: 800 18px var(--title); }
.feature h3 { margin: 0 0 6px; font-size: 18px; }
.feature p { margin: 0; color: var(--soft); font-size: 15px; }
.about { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 40px; align-items: center; }
.about p { color: var(--soft); font-size: 17px; }
.ranking { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.ranking li { display: flex; align-items: center; gap: 14px; padding: 12px 16px; border-radius: 12px; background: var(--card); border: 1px solid var(--line); }
.ranking li b { font: 800 18px var(--title); color: var(--accent2); width: 28px; }
.ranking li span { flex: 1; }
.ranking li em { font-style: normal; color: var(--soft); font-variant-numeric: tabular-nums; }
@media (max-width: 820px) { .about { grid-template-columns: minmax(0, 1fr); } }
form.contact { display: grid; gap: 12px; max-width: 560px; }
form.contact input, form.contact textarea { padding: 13px 15px; border-radius: 12px; border: 1px solid var(--line); background: var(--card); color: var(--text); font: inherit; }
.toast { color: var(--accent2); font-weight: 700; min-height: 1.5em; }
footer { padding: 34px 0; border-top: 1px solid var(--line); color: var(--soft); font-size: 14px; }
footer .wrap { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; }
.reveal { opacity: 0; transform: translateY(24px); transition: opacity .7s, transform .7s; }
.reveal.seen { opacity: 1; transform: none; }
@keyframes rise { from { opacity: 0; transform: translateY(16px); } }
@keyframes fade { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } .reveal { opacity: 1; transform: none; } }
`;
}

function html(c, t) {
  const fonts = [t.font, t.body].map((f) => `family=${f.replace(/ /g, "+")}:wght@400;600;700;800`).join("&");
  const nav = [["inicio", "Início"], ["itens", c.itemsTitle], ...(c.features.length ? [["recursos", "Recursos"]] : []), ["sobre", "Sobre"], ["contato", "Contato"]];
  const categories = [...new Set(c.items.map((i) => i.category))];
  const scored = c.items.filter((i) => i.score !== null);
  const avg = scored.length ? (scored.reduce((n, i) => n + i.score, 0) / scored.length).toFixed(1) : null;
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(c.title)}</title>
  <meta name="description" content="${esc(c.tagline)}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fonts}&display=swap">
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <nav class="nav" id="nav">
    <div class="wrap">
      <a class="brand" href="#inicio"><i></i>${esc(c.title)}</a>
      <button class="burger" id="burger" aria-label="Abrir o menu" aria-expanded="false">☰</button>
      <ul class="links" id="links">
${nav.map(([id, label]) => `        <li><a href="#${id}">${esc(label)}</a></li>`).join("\n")}
      </ul>
    </div>
  </nav>

  <header class="hero" id="inicio">
    <canvas id="scene" aria-hidden="true"></canvas>
    <div class="wrap">
      <span class="eyebrow">${esc(categories.slice(0, 3).join(" · "))}</span>
      <h1>${esc(c.title)}</h1>
      <p>${esc(c.tagline)}</p>
      <div class="cta">
        <a class="btn primary" href="#itens">Ver ${esc(c.itemsTitle.toLowerCase())} →</a>
        <a class="btn" href="#sobre">Saiba mais</a>
      </div>
      <div class="stats">
        <div><b>${c.items.length}</b><span>${esc(c.itemsTitle.toLowerCase())}</span></div>
        <div><b>${categories.length}</b><span>categorias</span></div>
${avg ? `        <div><b>${avg}</b><span>nota média</span></div>\n` : ""}      </div>
    </div>
  </header>

  <section class="block" id="itens">
    <div class="wrap">
      <div class="head reveal">
        <div><h2>${esc(c.itemsTitle)}</h2><p>Filtre por categoria, busque pelo nome e clique para ver os detalhes.</p></div>
      </div>
      <div id="catalogo"></div>
    </div>
  </section>
${c.features.length ? `
  <section class="block alt" id="recursos">
    <div class="wrap">
      <div class="head reveal"><div><h2>Recursos</h2></div></div>
      <div class="features">
${c.features.map((f, i) => `        <article class="feature reveal"><b>${i + 1}</b><h3>${esc(f.title)}</h3><p>${esc(f.text)}</p></article>`).join("\n")}
      </div>
    </div>
  </section>
` : ""}
  <section class="block${c.features.length ? "" : " alt"}" id="sobre">
    <div class="wrap about">
      <div class="reveal">
        <h2 class="head" style="display:block;margin:0 0 14px"><span style="font:800 clamp(28px,4vw,44px)/1.1 var(--title)">Sobre</span></h2>
        <p>${esc(c.about || c.tagline)}</p>
      </div>
      <div class="reveal">
        <h3>Ranking</h3>
        <ol class="ranking" id="ranking"></ol>
      </div>
    </div>
  </section>

  <section class="block alt" id="contato">
    <div class="wrap">
      <div class="head reveal"><div><h2>Contato</h2><p>${esc(c.contact || "Mande sua sugestão ou pergunta.")}</p></div></div>
      <form class="contact reveal" id="contact">
        <input name="nome" placeholder="Seu nome" required>
        <input name="email" type="email" placeholder="Seu e-mail" required>
        <textarea name="mensagem" rows="4" placeholder="Mensagem" required></textarea>
        <button class="btn primary" type="submit">Enviar</button>
        <p class="toast" id="toast" role="status"></p>
      </form>
    </div>
  </section>

  <footer><div class="wrap"><span>© ${new Date().getFullYear()} ${esc(c.title)}</span><span>Feito pela Aurora</span></div></footer>

  <script src="js/data.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
${c.three ? `  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>\n  <script src="js/scene.js"></script>\n` : ""}  <script src="js/catalog.js"></script>
  <script src="js/menu.js"></script>
</body>
</html>
`;
}

const dataJs = (c) => `// O conteúdo do site: mude aqui e recarregue a página.
window.SITE = ${JSON.stringify({ title: c.title, itemsTitle: c.itemsTitle, items: c.items }, null, 2)};
`;

const menuJs = () => `// Menu: abre e fecha no celular, fica sólido ao rolar, acende a seção na tela; entradas animadas; formulário.
(function () {
  var nav = document.getElementById("nav"), burger = document.getElementById("burger"), links = document.getElementById("links");
  burger.addEventListener("click", function () { var open = links.classList.toggle("open"); burger.setAttribute("aria-expanded", open); burger.textContent = open ? "✕" : "☰"; });
  links.addEventListener("click", function (e) { if (e.target.tagName === "A") { links.classList.remove("open"); burger.textContent = "☰"; burger.setAttribute("aria-expanded", false); } });
  addEventListener("scroll", function () { nav.classList.toggle("solid", scrollY > 40); }, { passive: true });
  var anchors = Array.prototype.slice.call(links.querySelectorAll("a"));
  var spy = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) anchors.forEach(function (a) { a.classList.toggle("on", a.getAttribute("href") === "#" + e.target.id); }); });
  }, { rootMargin: "-45% 0px -50% 0px" });
  anchors.forEach(function (a) { var s = document.querySelector(a.getAttribute("href")); if (s) spy.observe(s); });
  var reveal = new IntersectionObserver(function (entries) { entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("seen"); reveal.unobserve(e.target); } }); }, { threshold: .15 });
  document.querySelectorAll(".reveal").forEach(function (el) { reveal.observe(el); });
  var ranking = document.getElementById("ranking");
  if (ranking) window.SITE.items.filter(function (i) { return i.score !== null; }).sort(function (a, b) { return b.score - a.score; }).slice(0, 5).forEach(function (i, n) {
    var li = document.createElement("li"); li.innerHTML = "<b>" + (n + 1) + "</b><span></span><em></em>";
    li.querySelector("span").textContent = i.name; li.querySelector("em").textContent = i.score.toFixed(1); ranking.appendChild(li);
  });
  var form = document.getElementById("contact"), toast = document.getElementById("toast");
  form.addEventListener("submit", function (e) { e.preventDefault(); toast.textContent = "Obrigado, " + (form.nome.value.split(" ")[0] || "") + "! Mensagem recebida."; form.reset(); });
})();
`;

// React without a build step: React.createElement (h), so it runs from a double click.
const catalogJs = () => `// O catálogo em React: filtros por categoria, busca, ordenação e um painel com os detalhes.
(function () {
  var h = React.createElement, useState = React.useState, useMemo = React.useMemo, useEffect = React.useEffect;
  var data = window.SITE.items;
  var palette = ["#7c5cff", "#20e3b2", "#ff4f9a", "#ffb020", "#36a3ff", "#ff6b3d", "#9be15d", "#c86bfa"];
  var colorOf = function (cat) { var n = 0; for (var i = 0; i < cat.length; i++) n = (n * 31 + cat.charCodeAt(i)) >>> 0; return palette[n % palette.length]; };
  var initials = function (name) { return name.split(/\\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join("").toUpperCase(); };

  function Card(props) {
    var i = props.item, c = colorOf(i.category);
    return h("button", { className: "card", style: { animationDelay: (props.n * 40) + "ms" }, onClick: function () { props.open(i); } },
      h("div", { className: "cover", style: { background: "linear-gradient(135deg, " + c + ", #111 140%)" } },
        h("small", null, i.category), initials(i.name),
        i.score !== null ? h("span", { className: "score" }, i.score.toFixed(1)) : null),
      h("div", { className: "body" },
        h("h3", null, i.name),
        h("div", { className: "meta" }, [i.category, i.detail].filter(Boolean).join(" · ")),
        i.description ? h("p", null, i.description) : null));
  }

  function Detail(props) {
    var i = props.item; if (!i) return null; var c = colorOf(i.category);
    useEffect(function () { var k = function (e) { if (e.key === "Escape") props.close(); }; addEventListener("keydown", k); return function () { removeEventListener("keydown", k); }; }, []);
    return h("div", { className: "panel", onClick: props.close, role: "dialog", "aria-label": i.name },
      h("div", { className: "box", onClick: function (e) { e.stopPropagation(); } },
        h("div", { className: "cover", style: { height: "180px", background: "linear-gradient(135deg, " + c + ", #111 140%)" } }, h("small", null, i.category), initials(i.name)),
        h("div", { className: "body" },
          h("button", { className: "btn close", onClick: props.close }, "Fechar"),
          h("h3", null, i.name),
          h("div", { className: "meta" }, [i.category, i.detail].filter(Boolean).join(" · ")),
          i.score !== null ? h("div", null, h("div", { className: "bar" }, h("i", { style: { width: (i.score * 10) + "%" } })), h("strong", null, "Nota " + i.score.toFixed(1) + " de 10")) : null,
          h("p", null, i.description || "Sem descrição."))));
  }

  function Catalog() {
    var cats = useMemo(function () { var s = []; data.forEach(function (i) { if (s.indexOf(i.category) < 0) s.push(i.category); }); return s; }, []);
    var st = useState("Todos"), cat = st[0], setCat = st[1];
    var sq = useState(""), q = sq[0], setQ = sq[1];
    var so = useState("nota"), sort = so[0], setSort = so[1];
    var sd = useState(null), open = sd[0], setOpen = sd[1];
    var shown = data.filter(function (i) { return (cat === "Todos" || i.category === cat) && i.name.toLowerCase().indexOf(q.toLowerCase()) >= 0; })
      .slice().sort(function (a, b) { return sort === "nota" ? (b.score || 0) - (a.score || 0) : a.name.localeCompare(b.name); });
    return h("div", null,
      h("div", { className: "tools" },
        ["Todos"].concat(cats).map(function (c) { return h("button", { key: c, className: "chip" + (c === cat ? " on" : ""), onClick: function () { setCat(c); }, "aria-pressed": c === cat }, c); }),
        h("input", { className: "search", placeholder: "Buscar…", value: q, onChange: function (e) { setQ(e.target.value); }, "aria-label": "Buscar" }),
        h("button", { className: "chip", onClick: function () { setSort(sort === "nota" ? "nome" : "nota"); } }, sort === "nota" ? "Ordem: maior nota" : "Ordem: A–Z")),
      shown.length ? h("div", { className: "grid" }, shown.map(function (i, n) { return h(Card, { key: i.id + cat + q, item: i, n: n, open: setOpen }); }))
        : h("p", { className: "empty" }, "Nada encontrado com esse filtro."),
      open ? h(Detail, { item: open, close: function () { setOpen(null); } }) : null);
  }

  ReactDOM.createRoot(document.getElementById("catalogo")).render(h(Catalog));
})();
`;

// The 3D hero: floating shapes in the theme's colours, turning with the mouse and the scroll.
const sceneJs = (t) => `// A cena 3D do topo (Three.js): formas flutuando nas cores do tema, seguindo o mouse.
(function () {
  var canvas = document.getElementById("scene"); if (!canvas || !window.THREE) return;
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  var scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.position.set(0, 0, 14);
  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  var key = new THREE.PointLight(${"0x" + t.accent.slice(1)}, 2.2, 60); key.position.set(6, 6, 10); scene.add(key);
  var rim = new THREE.PointLight(${"0x" + t.accent2.slice(1)}, 1.6, 60); rim.position.set(-8, -4, 6); scene.add(rim);
  var colors = [${[t.accent, t.accent2, t.hot].map((c) => "0x" + c.slice(1)).join(", ")}];
  var geos = [new THREE.IcosahedronGeometry(1, 0), new THREE.TorusKnotGeometry(0.7, 0.24, 90, 12), new THREE.OctahedronGeometry(1, 0), new THREE.TorusGeometry(0.8, 0.28, 16, 40), new THREE.BoxGeometry(1.3, 1.3, 1.3)];
  var group = new THREE.Group(); scene.add(group);
  var shapes = [];
  for (var i = 0; i < 26; i++) {
    var m = new THREE.Mesh(geos[i % geos.length], new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.35, metalness: 0.55, flatShading: true, wireframe: i % 5 === 0 }));
    var r = 4 + Math.random() * 7, a = Math.random() * Math.PI * 2;
    m.position.set(Math.cos(a) * r + 3, (Math.random() - 0.5) * 9, -Math.random() * 10);
    var s = 0.4 + Math.random() * 0.9; m.scale.setScalar(s);
    m.userData = { spin: (Math.random() - 0.5) * 0.02, float: Math.random() * Math.PI * 2, y: m.position.y };
    group.add(m); shapes.push(m);
  }
  var stars = new THREE.BufferGeometry(), pts = [];
  for (var j = 0; j < 600; j++) pts.push((Math.random() - 0.5) * 60, (Math.random() - 0.5) * 40, -Math.random() * 30 - 5);
  stars.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: 0xffffff, size: 0.06, transparent: true, opacity: 0.7 })));
  var mx = 0, my = 0;
  addEventListener("pointermove", function (e) { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; });
  function size() { var w = canvas.clientWidth, h = canvas.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  addEventListener("resize", size); size();
  var still = matchMedia("(prefers-reduced-motion: reduce)").matches, t0 = performance.now();
  (function frame(now) {
    var t = (now - t0) / 1000;
    shapes.forEach(function (m) { m.rotation.x += m.userData.spin; m.rotation.y += m.userData.spin * 1.3; m.position.y = m.userData.y + Math.sin(t + m.userData.float) * 0.35; });
    group.rotation.y += ((mx * 0.6) - group.rotation.y) * 0.04; group.rotation.x += ((my * 0.3) - group.rotation.x) * 0.04;
    camera.position.y = -scrollY * 0.004;
    renderer.render(scene, camera);
    if (!still) requestAnimationFrame(frame);
  })(t0);
})();
`;

// The Java server: serves the site and the items as JSON (/api/itens), with no dependencies.
const javaServer = (c) => `import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Servidor do site ${javaStr(c.title)}: entrega as páginas e os itens em JSON em /api/itens.
 * Rodar (na pasta do site):  javac server/Servidor.java -d server/out  e  java -cp server/out Servidor
 * Depois abra http://localhost:8080
 */
public class Servidor {
    static final String ITENS = "${javaStr(JSON.stringify(c.items))}";

    public static void main(String[] args) throws IOException {
        int porta = args.length > 0 ? Integer.parseInt(args[0]) : 8080;
        Path raiz = Paths.get(".").toAbsolutePath().normalize();
        HttpServer server = HttpServer.create(new InetSocketAddress(porta), 0);
        server.createContext("/api/itens", troca -> {
            byte[] corpo = ITENS.getBytes(StandardCharsets.UTF_8);
            troca.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
            troca.sendResponseHeaders(200, corpo.length);
            try (OutputStream out = troca.getResponseBody()) { out.write(corpo); }
        });
        server.createContext("/", troca -> {
            String caminho = troca.getRequestURI().getPath();
            Path arquivo = raiz.resolve(caminho.equals("/") ? "index.html" : caminho.substring(1)).normalize();
            if (!arquivo.startsWith(raiz) || !Files.isRegularFile(arquivo)) { troca.sendResponseHeaders(404, -1); return; }
            String tipo = caminho.endsWith(".css") ? "text/css" : caminho.endsWith(".js") ? "text/javascript" : "text/html";
            byte[] corpo = Files.readAllBytes(arquivo);
            troca.getResponseHeaders().set("Content-Type", tipo + "; charset=utf-8");
            troca.sendResponseHeaders(200, corpo.length);
            try (OutputStream out = troca.getResponseBody()) { out.write(corpo); }
        });
        server.start();
        System.out.println("Site em http://localhost:" + porta);
    }
}
`;

// The C++ module: the ranking and the averages by category, from the same items.
const cppModule = (c) => `// Módulo C++ do site ${c.title}: o ranking e a média por categoria dos itens.
// Compilar e rodar:  g++ -std=c++17 -O2 -o ranking cpp/ranking.cpp  e  ./ranking
#include <algorithm>
#include <iomanip>
#include <iostream>
#include <map>
#include <string>
#include <vector>

struct Item { std::string nome; std::string categoria; double nota; };

int main() {
    std::vector<Item> itens = {
${c.items.map((i) => `        {"${javaStr(i.name)}", "${javaStr(i.category)}", ${i.score ?? 0}},`).join("\n")}
    };
    std::sort(itens.begin(), itens.end(), [](const Item& a, const Item& b) { return a.nota > b.nota; });
    std::cout << "Ranking\\n";
    for (size_t i = 0; i < itens.size() && i < 5; ++i)
        std::cout << std::setw(2) << i + 1 << ". " << itens[i].nome << " (" << std::fixed << std::setprecision(1) << itens[i].nota << ")\\n";
    std::map<std::string, std::pair<double, int>> porCategoria;
    for (const auto& item : itens) { porCategoria[item.categoria].first += item.nota; porCategoria[item.categoria].second++; }
    std::cout << "\\nMedia por categoria\\n";
    for (const auto& [categoria, soma] : porCategoria)
        std::cout << "  " << categoria << ": " << std::fixed << std::setprecision(1) << soma.first / soma.second << "\\n";
    return 0;
}
`;

const readme = (c, t) => `# ${c.title}

${c.tagline}

## Ver o site
Dê dois cliques em \`index.html\`.${c.java ? " Ou rode o servidor Java (abaixo) e abra http://localhost:8080." : ""}

## O que tem
- **HTML + CSS** (\`index.html\`, \`css/style.css\`): menu fixo que vira hambúrguer no celular, seções, tema ${t.label}.
- **React** (\`js/catalog.js\`): ${c.items.length} ${c.itemsTitle.toLowerCase()} em cartões, com filtro por categoria, busca, ordenação e um painel de detalhes.
${c.three ? "- **Three.js** (`js/scene.js`): a cena 3D do topo, que segue o mouse.\n" : ""}- **Conteúdo** (\`js/data.js\`): mude aqui os itens e recarregue.
${c.java ? "- **Java** (`server/Servidor.java`): servidor do site e dos itens em JSON (`/api/itens`).\n  `javac server/Servidor.java -d server/out` e `java -cp server/out Servidor`\n" : ""}${c.cpp ? "- **C++** (`cpp/ranking.cpp`): ranking e média por categoria.\n  `g++ -std=c++17 -O2 -o ranking cpp/ranking.cpp` e `./ranking`\n" : ""}`;

/** Writes the site in `dir`; returns the files written (relative paths). */
export async function buildSite(dir, input, { write = null } = {}) {
  const c = siteContent(input); const t = SITE_THEMES[c.theme];
  const files = {
    "index.html": html(c, t), "css/style.css": css(t), "js/data.js": dataJs(c), "js/catalog.js": catalogJs(), "js/menu.js": menuJs(),
    ...(c.three ? { "js/scene.js": sceneJs(t) } : {}),
    ...(c.java ? { "server/Servidor.java": javaServer(c) } : {}),
    ...(c.cpp ? { "cpp/ranking.cpp": cppModule(c) } : {}),
    "README.md": readme(c, t),
  };
  for (const [rel, text] of Object.entries(files)) {
    const file = join(dir, rel);
    if (write) { await write(file, text); continue; }
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, text, "utf8");
  }
  return { content: c, files: Object.keys(files), slug: slug(c.title) };
}
