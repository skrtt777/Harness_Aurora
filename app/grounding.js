/**
 * Cheap checks (no paid call) that a local answer about the company stays on
 * what the documents say — the two slips left in the long-conversation
 * battery (docs/CONHECIMENTO_EMPRESA.md):
 * - a company question answered with a generic "sim" without consulting
 *   anything ("a empresa paga curso de inglês?");
 * - names and numbers copied wrong or made up ("Marcoa Lima", a ramal that
 *   is in no document).
 */

const fold = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// The question is about the company itself (not "quanto é 17 x 3").
const COMPANY = /\b(empresa|companhia|rh|recursos humanos|departamento|setor|pol[íi]tica|benef[íi]cios?|colaborador(es)?|funcion[áa]rios?|gestor|holerite|folha|f[ée]rias|admiss[ãa]o|demiss[ãa]o|reembolso|aux[íi]lio|vale|plano de sa[úu]de|nossa|nosso)\b/i;
export const asksAboutCompany = (text) => COMPANY.test(String(text));

export const NOT_FOUND = /n[ãa]o (encontrei|achei|localizei|h[áa]|existe|consta|tenho|identifiquei|cont[ée]m|menciona|aparece|constam?|(est[áa]|[ée]|s[ãa]o) mencionad|foi (poss[íi]vel )?(encontrad|localizad|encontrar|localizar))|nenhum(a)? (documento|informa[çc][ãa]o|pol[íi]tica|men[çc][ãa]o|refer[êe]ncia|registro)|n[ãa]o possui (um|uma|nenhum|nenhuma) (documento|pol[íi]tica|registro|norma)/i;

// Numbers worth copying exactly: 4+ digits once separators are dropped
// (ramal 2210, (11) 4000-1234, 26/12/2026, R$ 1.200,00).
const NUMBER = /\(\d{2}\)\s?\d{4,5}[-–]?\d{4}|\d[\d.,/\-–]*\d/g;
const digits = (s) => s.replace(/\D/g, "");
// Two to four capitalized words, "de/da/do" allowed inside: a person, a place, a document.
const NAME = /[A-ZÀ-Ú][a-zà-ÿ]+(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ú][a-zà-ÿ]+){1,3}/g;

const cents = (s) => String(s).replace(/[.,]00\b/g, "");
const pairsOf = (text) => (String(text).match(NAME) || []).flatMap((name) => {
  const words = fold(name).split(/\s+/).filter((w) => !/^d[aeo]s?$/.test(w));
  return words.slice(1).map((w, i) => [words[i], w]);
});
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j += 1) { const tmp = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = tmp; }
  }
  return row[b.length];
}

/**
 * Facts of the answer the evidence (documents, tool results, the
 * conversation) contradicts — kept narrow so a correct answer is never sent
 * back:
 * - numbers of 4+ digits found nowhere (ramal 2200 when the document says
 *   2210; "R$ 80,00" equals "R$ 80"), unless the answer computes something;
 * - a name copied almost right ("Marcoa Lima" for "Marcos Lima"): one word
 *   identical, the other off by one or two letters. Headings and common
 *   phrases ("Data do Evento") are never flagged.
 */
/**
 * "50 mil", "1,5 milhão" as written numbers ("50.000,00", "1.500.000,00"). The question's own
 * values are no invention: "compra de 50 mil" answered with "R$ 50.000,00" was flagged, and the
 * model took back a right answer ("Você está correto, meu erro…", empresa compras-1, 05/10/2026).
 */
export function spokenNumbers(text) {
  return [...String(text || "").matchAll(/(\d+(?:[.,]\d+)?)\s*(mil|milh[õo]es|milh[ãa]o|bilh[õo]es|bilh[ãa]o)\b/gi)].map(([, n, unit]) => {
    const value = Number(n.replace(/\./g, "").replace(",", ".")) * (/^mil$/i.test(unit) ? 1e3 : /^milh/i.test(unit) ? 1e6 : 1e9);
    return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }).join(" ");
}

export function unsupportedFacts(answer, evidence) {
  const text = String(answer || "");
  const sourceNumbers = (cents(evidence).match(NUMBER) || []).map(digits).filter((d) => d.length >= 4);
  const missing = [];
  // A computed answer ("22 × R$ 42,00 = R$ 924,00") has numbers of its own; markdown ** is not a product.
  if (!/\d\s*[×x*]\s*(R\$\s*)?\d|=\s*(R\$|US\$)?\s*\d|\bvezes\b|\bsomando\b|\btotal de\b/i.test(text)) {
    for (const raw of cents(text).match(NUMBER) || []) {
      // A date is checked by day and month: adding the year the document implies is fine.
      const d = digits(raw.trim().match(/^(\d{1,2}\/\d{1,2})\/\d{2,4}$/)?.[1] || raw);
      if (d.length < 4) continue;
      const supported = (x) => sourceNumbers.some((n) => n.includes(x));
      // Two numbers joined by a separator ("20–2026", "20/2026"): each part on its own.
      const parts = /^\(/.test(raw) || d.length < 6 ? [d] : raw.split(/\D+/).filter((p) => p.length >= 4);
      if (!parts.every(supported)) missing.push(raw.trim().replace(/[).,\s]+$/, ""));
    }
  }
  const known = pairsOf(evidence);
  const exact = new Set(known.map((p) => p.join(" ")));
  for (const [a, b] of pairsOf(text)) {
    if (exact.has(`${a} ${b}`)) continue;
    const near = known.find(([x, y]) => (a === x && b !== y && distance(b, y) <= 2) || (b === y && a !== x && distance(a, x) <= 2));
    if (near) missing.push(`${a} ${b}`.replace(/\b\w/g, (c) => c.toUpperCase()));
  }
  return [...new Set(missing)];
}

// Words that say what kind of question it is, not what it is about.
const GENERIC = new Set("empresa companhia paga pagar pago oferece oferecer existe existem tem temos politica politicas regra regras beneficio beneficios colaborador colaboradores funcionario funcionarios qual quais quanto quanta quantos quantas quando onde quem como sobre informacao informacoes documento documentos preciso posso pode podemos nossa nosso nossos nossas empresa? isso essa esse esta este aqui hoje agora tambem ainda alguma algum".split(" "));
const words = (text) => [...new Set(fold(text).match(/[a-z0-9]{4,}/g) || [])].filter((w) => !GENERIC.has(w));
const stem = (w) => (w.length > 5 ? w.slice(0, -2) : w);

// A yes/no question ("A empresa paga curso de inglês?", "Existe bônus?") —
// not "qual/quanto/quem/como…", which ask for content.
const YES_NO = /^(?!.*\b(qual|quais|quanto|quanta|quantos|quantas|quem|como|onde|quando|por ?que|o que)\b).*\?\s*$/i;
const AFFIRMS = /^\W*(sim\b|a empresa (oferece|paga|tem|financia|disponibiliza|cobre)|existe(m)?\b|h[áa]\b)/i;

/**
 * A yes/no company question answered "sim" when no consulted document even
 * mentions its subject ("Sim, a empresa paga curso de inglês" with only the
 * benefits policy in hand). Kept to this shape: an open question ("quem
 * cuida da folha?") is never judged by its words.
 */
export function unsupportedTopic(question, answer, documents) {
  if (!YES_NO.test(String(question).trim()) || !AFFIRMS.test(String(answer)) || NOT_FOUND.test(answer)) return [];
  const source = fold(documents);
  const said = fold(answer);
  return words(question).filter((w) => !source.includes(stem(w)) && said.includes(stem(w)));
}
