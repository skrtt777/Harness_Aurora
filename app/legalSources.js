// The official page of a Brazilian law on planalto.gov.br, from how it is cited ("Lei nº 8.245/1991",
// "Código Civil", "CLT"). The model searched ten times and opened invented addresses (404) instead of
// the law's page (13/10); the Recepção and the Conferência now hand it the address.

const PLANALTO = "https://www.planalto.gov.br/ccivil_03";
/** The codes people name without a number. */
const NAMED = [
  [/\bc[oó]digo civil\b|\blei\s+(?:n[ºo°.]*\s*)?10\.?406\b/i, "Código Civil (Lei 10.406/2002)", `${PLANALTO}/leis/2002/l10406compilada.htm`],
  [/\b(clt|consolida[cç][aã]o das leis do trabalho)\b/i, "CLT (Decreto-Lei 5.452/1943)", `${PLANALTO}/decreto-lei/del5452.htm`],
  [/\b(cdc|c[oó]digo de defesa do consumidor)\b/i, "Código de Defesa do Consumidor (Lei 8.078/1990)", `${PLANALTO}/leis/l8078.htm`],
  [/\blei do inquilinato\b|\bloca[cç][aã]o (residencial|de im[oó]vel|urbana)|\bcontrato de loca[cç][aã]o\b|\baluguel\b/i, "Lei do Inquilinato (Lei 8.245/1991)", `${PLANALTO}/leis/l8245.htm`],
  [/\bconstitui[cç][aã]o( federal)?\b|\bcf\/88\b/i, "Constituição Federal", `${PLANALTO}/constituicao/constituicao.htm`],
  [/\bc[oó]digo penal\b/i, "Código Penal (Decreto-Lei 2.848/1940)", `${PLANALTO}/decreto-lei/del2848compilado.htm`],
  [/\bc[oó]digo de processo civil\b|\bcpc\b/i, "Código de Processo Civil (Lei 13.105/2015)", `${PLANALTO}/_ato2015-2018/2015/lei/l13105.htm`],
  [/\blgpd\b|\bprote[cç][aã]o de dados\b/i, "LGPD (Lei 13.709/2018)", `${PLANALTO}/_ato2015-2018/2018/lei/l13709.htm`],
];

/** The page of a numbered law or decree-law: { name, url } (null when the address cannot be known). */
export function lawPage(kind, number, year = null) {
  const n = String(number).replace(/\D/g, "");
  if (!n) return null;
  if (kind === "decreto-lei") return { name: `Decreto-Lei ${Number(n).toLocaleString("pt-BR")}`, url: `${PLANALTO}/decreto-lei/del${n}.htm` };
  if (kind !== "lei") return null;
  if (Number(n) < 10000) return { name: `Lei ${Number(n).toLocaleString("pt-BR")}`, url: `${PLANALTO}/leis/l${n}.htm` };
  // From 10.000 on the address has the year and the period in it and varies: searched, not guessed.
  return null;
}

/** The official pages a text speaks of (named codes and numbered laws), unique, at most `max`. */
export function officialPages(text, max = 4) {
  const t = String(text || "");
  const out = [];
  const add = (p) => { if (p && !out.some((o) => o.url === p.url)) out.push(p); };
  for (const [re, name, url] of NAMED) if (re.test(t)) add({ name, url });
  for (const m of t.matchAll(/\b(decreto-lei|lei)\s+(?:complementar\s+)?(?:n[ºo°.]*\s*)?(\d{1,2}\.?\d{3})(?:\s*\/\s*|,?\s+de\s+[^,;]{0,30}?)?((?:19|20)\d{2})?/gi)) {
    add(lawPage(m[1].toLowerCase(), m[2], m[3] || null));
  }
  return out.slice(0, max);
}

/** One line for the prompt or a guard: where to read each law ("Lei do Inquilinato: https://…"). */
export function pagesLine(pages) {
  return pages.length ? `Páginas oficiais: ${pages.map((p) => `${p.name}: ${p.url}`).join("; ")} (web_fetch com find="Art. N" traz o artigo).` : "";
}
