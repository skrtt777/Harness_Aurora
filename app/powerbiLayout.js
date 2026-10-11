// The pages of a BI from its plan: each page with its name and question on top, its numbers, its scene and
// its blocks placed by the layout the plan chose — a scene filling the page, a scene with a side column,
// the numbers down the side, a grid, a story from top to bottom, two things side by side, one number in
// focus. The canvas is 1280 x 720. Blocks arrive without positions (app/powerbiPlanner.js builds them).

export const LAYOUTS = {
  cena_inteira: "a cena ocupa a página; números numa faixa em cima; até 3 blocos numa faixa embaixo",
  cena_e_lateral: "a cena à esquerda (2/3); os blocos numa coluna à direita",
  cartoes_laterais: "os números numa coluna à esquerda; a cena e os blocos no resto",
  grade: "números em cima; cena e blocos numa grade",
  narrativa: "de cima para baixo: números, um destaque largo, depois os demais lado a lado",
  comparacao: "dois destaques lado a lado, do mesmo tamanho",
  foco_unico: "um número grande e um destaque grande; o resto pequeno",
};

const M = 24; const G = 12; const RIGHT = 1256; const BOTTOM = 704; const HEAD = 84; const CARD_H = 88;
const rect = (x, y, w, h) => ({ x, y, w, h });

/** n rectangles across (horizontal) or down a rectangle, with gaps; weights optional. */
export function split(r, n, horizontal, weights = null) {
  if (n <= 0) return [];
  const ws = weights || Array(n).fill(1);
  const total = ws.reduce((a, b) => a + b, 0);
  const free = (horizontal ? r.w : r.h) - G * (n - 1);
  const out = []; let at = horizontal ? r.x : r.y;
  ws.forEach((w, i) => {
    const size = i === n - 1 ? (horizontal ? r.x + r.w : r.y + r.h) - at : Math.floor((free * w) / total);
    out.push(horizontal ? rect(at, r.y, size, r.h) : rect(r.x, at, r.w, size));
    at += size + G;
  });
  return out;
}

/** Items in a grid that fills the rectangle (1 -> whole, 2 -> side by side, 3 -> one wide + two, 4 -> 2x2…). */
function grid(r, n) {
  if (n <= 2) return split(r, n, true);
  if (n === 3) { const [top, bottom] = split(r, 2, false, [1.15, 1]); return [top, ...split(bottom, 2, true)]; }
  const rows = Math.ceil(n / 3) > 1 && n > 4 ? 2 : 2;
  const perRow = Math.ceil(n / rows);
  return split(r, rows, false).flatMap((row, i) => split(row, Math.min(perRow, n - i * perRow), true));
}

// A card's number sized to its card (a narrow one cut "R$ 4.634.27…", 11/10).
const place = (spec, r) => ({ ...spec, x: r.x, y: r.y, w: r.w, h: r.h, ...(spec.type === "card" && !spec.fontSize ? (r.w < 250 ? { fontSize: 20 } : r.w < 330 ? { fontSize: 24 } : {}) : {}) });

/**
 * One page. page: { name, question, layout, cards: [visual], scene: visual|null, blocks: [visual],
 * slicers: [visual] } (visuals without positions); style: { dark, text, soft }.
 */
export function composePage(page, style, reportTitle) {
  const visuals = [];
  const slicers = page.slicers.slice(0, 3);
  const headW = RIGHT - M - slicers.length * 192 - 8;
  visuals.push({ type: "textbox", x: M, y: 6, w: headW, h: 72, paragraphs: [
    { textRuns: [{ value: page.name, textStyle: { fontWeight: "bold", fontSize: "20pt", color: style.text } }] },
    { textRuns: [{ value: [reportTitle, page.question].filter(Boolean).join(" · "), textStyle: { fontSize: "10pt", color: style.soft } }] },
  ] });
  slicers.forEach((s, i) => visuals.push(place(s, rect(RIGHT - (slicers.length - i) * 192 + G, 12, 180, 60))));
  const cards = page.cards.slice(0, 6);
  const main = [page.scene, ...page.blocks].filter(Boolean);
  const body = rect(M, HEAD, RIGHT - M, BOTTOM - HEAD);
  const cardRow = (r) => { if (!cards.length) return r; split(rect(r.x, r.y, r.w, CARD_H), cards.length, true).forEach((c, i) => visuals.push(place(cards[i], c))); return rect(r.x, r.y + CARD_H + G, r.w, r.h - CARD_H - G); };
  const put = (items, rects) => items.forEach((v, i) => rects[i] && visuals.push(place(v, rects[i])));
  let layout = page.layout in LAYOUTS ? page.layout : "grade";
  // One or two cards down the side stretched each to half the page: they go on top instead.
  if (layout === "cartoes_laterais" && cards.length < 3) layout = cards.length ? "narrativa" : "grade";
  if (layout === "cena_inteira") {
    const rest = cardRow(body);
    const below = main.slice(1, 4);
    if (!below.length) put(main.slice(0, 1), [rest]);
    else { const [top, bottom] = split(rest, 2, false, [2.4, 1]); put(main.slice(0, 1), [top]); put(below, split(bottom, below.length, true)); }
  } else if (layout === "cena_e_lateral") {
    const rest = cardRow(body);
    const side = main.slice(1, 4);
    if (!side.length) put(main.slice(0, 1), [rest]);
    else { const [left, right] = split(rest, 2, true, [2.05, 1]); put(main.slice(0, 1), [left]); put(side, split(right, side.length, false)); }
  } else if (layout === "cartoes_laterais") {
    const [left, right] = cards.length ? split(body, 2, true, [1, 4.4]) : [null, body];
    if (left) split(left, cards.length, false).forEach((c, i) => visuals.push(place(cards[i], c)));
    if (main.length <= 1) put(main, [right]);
    else { const [top, bottom] = split(right, 2, false, [1.6, 1]); put(main.slice(0, 1), [top]); const rest = main.slice(1, 4); put(rest, split(bottom, rest.length, true)); }
  } else if (layout === "narrativa") {
    const rest = cardRow(body);
    const others = main.slice(1, 4);
    if (!others.length) put(main.slice(0, 1), [rest]);
    else { const [top, bottom] = split(rest, 2, false, [1.3, 1]); put(main.slice(0, 1), [top]); put(others, split(bottom, others.length, true)); }
  } else if (layout === "comparacao") {
    const rest = cardRow(body);
    const pair = main.slice(0, 2); const extra = main.slice(2, 4);
    if (!extra.length) put(pair, split(rest, pair.length, true));
    else { const [top, bottom] = split(rest, 2, false, [2, 1]); put(pair, split(top, pair.length, true)); put(extra, split(bottom, extra.length, true)); }
  } else if (layout === "foco_unico") {
    const [left, right] = split(body, 2, true, [1, 2.3]);
    const [big, ...small] = cards;
    if (big) {
      const [bigR, smallR] = small.length ? split(left, 2, false, [1.3, 1]) : [left, null];
      visuals.push(place({ ...big, fontSize: 40 }, small.length ? bigR : rect(bigR.x, bigR.y, bigR.w, Math.min(bigR.h, 260))));
      if (smallR) split(smallR, Math.min(small.length, 3), false).forEach((c, i) => visuals.push(place(small[i], c)));
    }
    const target = big ? right : body;
    if (main.length <= 1) put(main, [target]);
    else { const [top, bottom] = split(target, 2, false, [1.8, 1]); put(main.slice(0, 1), [top]); const rest = main.slice(1, 3); put(rest, split(bottom, rest.length, true)); }
  } else {
    const rest = cardRow(body);
    put(main.slice(0, 6), grid(rest, Math.min(main.length, 6)));
  }
  return visuals;
}
