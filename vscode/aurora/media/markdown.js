// The Aurora's answers as HTML in the panel: a small markdown (headings, bold, italics, code, lists,
// tables, links, quotes) where every piece of text is escaped first, so an answer can never put its own
// HTML or scripts in the panel. The comprovante's numbers come marked (<mark data-proof="i">), and a
// Windows or Unix path becomes a link that opens the file. Runs in the webview and in Node (tests).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AuroraMarkdown = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  // Private-use characters around each proven number: put in the source, turned into <mark> at the end.
  const OPEN = "", CLOSE = "";
  const PATH = /(?:[A-Za-z]:\\|\/(?:Users|home|tmp|var|opt|mnt)\/)(?:[^\s`'"<>|*?\n]+[\\/])*[^\s`'"<>|*?\n]+\.[A-Za-z0-9]{1,6}/g;

  /** Bold, italics, code, links and paths of one line of text (already without block syntax). */
  function inline(text) {
    const codes = [];
    let s = String(text).replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `${codes.length - 1}`; });
    s = esc(s);
    s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
      const safe = /^(https?:|file:|[A-Za-z]:\\|\/)/i.test(href) ? href : "#";
      return `<a href="#" data-href="${esc(safe)}">${label}</a>`;
    });
    s = s.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>").replace(/__([^_\n]+?)__/g, "<strong>$1</strong>");
    s = s.replace(/(^|[\s(])\*([^*\n]+?)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>").replace(/(^|[\s(])_([^_\n]+?)_(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
    s = s.replace(/~~([^~\n]+?)~~/g, "<s>$1</s>");
    // A path outside a link: opens the file.
    s = s.split(/(<a [^>]*>.*?<\/a>)/).map((part) => (part.startsWith("<a ") ? part : part.replace(PATH, (p) => `<a href="#" data-open="${p}">${p}</a>`))).join("");
    s = s.replace(/(\d+)/g, (_, i) => {
      const c = codes[Number(i)];
      return new RegExp(`^${PATH.source}$`).test(c) ? `<code><a href="#" data-open="${esc(c)}">${esc(c)}</a></code>` : `<code>${esc(c)}</code>`;
    });
    return s;
  }

  const isTableSep = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
  const cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

  /** Markdown -> HTML (block level). */
  function render(md) {
    const lines = String(md || "").replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const fence = /^\s*(```+|~~~+)\s*([\w+#.-]*)/.exec(line);
      if (fence) {
        const body = [];
        i += 1;
        while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
        i += 1;
        const code = body.join("\n").replace(/[]/g, "");
        out.push(`<div class="code"><div class="code-bar"><span>${esc(fence[2] || "código")}</span><button class="copy" data-copy>Copiar</button><button class="insert" data-insert>Inserir no editor</button></div><pre><code>${esc(code)}</code></pre></div>`);
        continue;
      }
      if (!line.trim()) { i += 1; continue; }
      const h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) { out.push(`<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>`); i += 1; continue; }
      if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { out.push("<hr>"); i += 1; continue; }
      if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
        out.push(`<div class="table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
        continue;
      }
      if (/^\s*>/.test(line)) {
        const body = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
        out.push(`<blockquote>${render(body.join("\n"))}</blockquote>`);
        continue;
      }
      const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
      if (item) {
        const ordered = /\d/.test(item[2]);
        const items = [];
        while (i < lines.length) {
          const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
          if (m && m[1].length <= item[1].length) { items.push([m[3]]); i += 1; continue; }
          // A deeper item or a continuation line belongs to the last item.
          if (lines[i].trim() && items.length && /^\s+/.test(lines[i])) { items.at(-1).push(lines[i].replace(/^\s{2,4}/, "")); i += 1; continue; }
          break;
        }
        out.push(`<${ordered ? "ol" : "ul"}>${items.map((parts) => `<li>${parts.length > 1 ? `${inline(parts[0])}${render(parts.slice(1).join("\n"))}` : inline(parts[0])}</li>`).join("")}</${ordered ? "ol" : "ul"}>`);
        continue;
      }
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^\s*(```|~~~|#{1,4}\s|>|[-*+]\s|\d+[.)]\s)/.test(lines[i]) && !(lines[i].includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1]))) para.push(lines[i++]);
      if (!para.length) { out.push(`<p>${inline(lines[i++])}</p>`); continue; }
      out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    }
    return out.join("\n");
  }

  /**
   * The answer with the comprovante: each claim's text (claims[i].start/end in the content) marked,
   * from the last to the first so the offsets hold. Claims "pedido" (a number the person gave) are not.
   */
  function renderAnswer(content, proof) {
    let text = String(content || "");
    const claims = (proof?.claims || []).map((c, i) => ({ c, i })).filter(({ c }) => c.status !== "pedido" && Number.isInteger(c.start) && text.slice(c.start, c.end) === c.raw).sort((a, b) => b.c.start - a.c.start);
    for (const { c, i } of claims) text = `${text.slice(0, c.start)}${OPEN}${i}:${text.slice(c.start, c.end)}${CLOSE}${text.slice(c.end)}`;
    return render(text).replace(/(\d+):([^]*)/g, (_, i, raw) => `<mark class="proof" data-proof="${i}">${raw}</mark>`).replace(/[]/g, "");
  }

  return { render, renderAnswer, inline, esc };
});
