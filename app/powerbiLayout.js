// The pages of a BI from its plan: each page with its name and question on top, its numbers, its scene and
// its blocks placed by the layout the plan chose — a scene filling the page, a scene with a side column,
// the numbers down the side, a grid, a story from top to bottom, two things side by side, one number in
// focus. The canvas is 1280 x 720. Blocks arrive without positions (app/powerbiPlanner.js builds them).

export const LAYOUTS = {
  gemeo_digital: "a cena é a tela (gêmeo digital): números numa faixa fina em cima, o painel do item escolhido flutuando sobre a cena à direita, um bloco embaixo",
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
  // A scene with click points gets a scatter laid over it, same box: a click on an object filters the page.
  const put = (items, rects) => items.forEach((v, i) => {
    if (!rects[i]) return;
    const { overlay, ...spec } = v;
    let r = rects[i];
    // The picture fills its box exactly (so the clicks line up): the box keeps the drawing's proportion
    // (within 15%), on the left, so an isometric scene is not stretched.
    if (overlay?.w && overlay?.h) {
      const ar = overlay.w / overlay.h; const boxAr = r.w / r.h;
      if (boxAr > ar * 1.15) r = rect(r.x, r.y, Math.round(r.h * ar * 1.1), r.h);
      else if (boxAr < ar / 1.15) r = rect(r.x, r.y, r.w, Math.round(r.w / ar / 1.1));
      spec.fitted = { right: rects[i].x + rects[i].w - (r.x + r.w), box: r };
    }
    visuals.push(place(spec, r));
    if (overlay) visuals.push(place({ type: "scatterChart", category: overlay.category, x_: overlay.x, y_: overlay.y, overlay: { w: overlay.w, h: overlay.h }, pointColor: style.pin || "#4F9BFF" }, r));
  });
  // A scene keeps its drawing's proportion, so in a wide box it leaves a strip free on the right (the map
  // with half the page empty, showcase 11/10): the other blocks go there instead of below it.
  const sceneFirst = (r, others, weights = [1.3, 1]) => {
    const ov = main[0]?.overlay;
    const freeIn = (box) => (ov?.w && ov?.h ? box.w - Math.min(box.w, Math.round(box.h * (ov.w / ov.h) * 1.1)) : 0);
    if (!others.length) return put(main.slice(0, 1), [r]);
    // Few others and room beside the scene at full height: a column on the right.
    if (others.length <= 2 && freeIn(r) >= 320) {
      const w = freeIn(r);
      put(main.slice(0, 1), [rect(r.x, r.y, r.w - w, r.h)]);
      return put(others, split(rect(r.x + r.w - w + G, r.y, w - G, r.h), others.length, false));
    }
    const [top, bottom] = split(r, 2, false, weights);
    const w = freeIn(top);
    if (w >= 320 && others.length >= 2) {
      put(main.slice(0, 1), [rect(top.x, top.y, top.w - w, top.h)]);
      put(others.slice(0, 1), [rect(top.x + top.w - w + G, top.y, w - G, top.h)]);
      return put(others.slice(1), split(bottom, others.length - 1, true));
    }
    put(main.slice(0, 1), [top]);
    return put(others, split(bottom, others.length, true));
  };
  let layout = page.layout in LAYOUTS ? page.layout : "grade";
  // One or two cards down the side stretched each to half the page: they go on top instead.
  if (layout === "cartoes_laterais" && cards.length < 3) layout = cards.length ? "narrativa" : "grade";
  if (layout === "gemeo_digital") {
    // WareTrack-like: a thin strip of numbers, the scene as the page, the chosen item's card floating on it.
    const strip = rect(M, HEAD, RIGHT - M, 64);
    if (cards.length) split(strip, cards.length, true).forEach((c, i) => visuals.push(place({ ...cards[i], fontSize: 18 }, c)));
    const top = cards.length ? HEAD + 64 + G : HEAD;
    const [first, ...rest] = main;
    const bottom = rest.filter((b) => !b.float);
    const floating = rest.filter((b) => b.float).concat(bottom.length > 1 ? bottom.splice(1) : []);
    const sceneH = BOTTOM - top - (bottom.length ? 104 + G : 0);
    if (first) put([first], [rect(M, top, RIGHT - M, sceneH)]);
    // The floating cards: in the strip the scene left free on the right, or over the scene's corner.
    const free = visuals.find((v) => v.fitted)?.fitted?.right || 0;
    const fw = free >= 300 ? free - G : 360;
    const fh = Math.min(240, Math.floor((sceneH - G) / Math.max(1, Math.min(floating.length, 2))) - (free >= 300 ? 0 : 12));
    floating.slice(0, 2).forEach((b, i) => visuals.push(place(b, rect(RIGHT - fw - (free >= 300 ? 0 : 12), top + (free >= 300 ? 0 : 12) + i * (fh + G), fw, fh))));
    for (const v of visuals) delete v.fitted;
    if (bottom.length) visuals.push(place(bottom[0], rect(M, BOTTOM - 104, RIGHT - M, 104)));
  } else if (layout === "cena_inteira") {
    sceneFirst(cardRow(body), main.slice(1, 4), [2.4, 1]);
  } else if (layout === "cena_e_lateral") {
    const rest = cardRow(body);
    const side = main.slice(1, 4);
    if (!side.length) put(main.slice(0, 1), [rest]);
    else { const [left, right] = split(rest, 2, true, [2.05, 1]); put(main.slice(0, 1), [left]); put(side, split(right, side.length, false)); }
  } else if (layout === "cartoes_laterais") {
    const [left, right] = cards.length ? split(body, 2, true, [1, 4.4]) : [null, body];
    if (left) split(left, cards.length, false).forEach((c, i) => visuals.push(place(cards[i], c)));
    sceneFirst(right, main.slice(1, 4), [1.6, 1]);
  } else if (layout === "narrativa") {
    sceneFirst(cardRow(body), main.slice(1, 4), [1.3, 1]);
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
  for (const v of visuals) delete v.fitted;
  return visuals;
}
