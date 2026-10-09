// Dados pessoais e de negócio (LGPD, art. 5º): what in a text identifies a person or a company's
// client, so it never leaves the project it came from (a memory of company X showing up for company
// Y), never goes to the shared central memory, and reaches an external service only masked.
// A finder, not a judge: it errs toward "sensitive" (a false alarm keeps a memory in its project;
// a miss would let a client's debt travel).

const PATTERNS = [
  ["CPF", /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g],
  ["CNPJ", /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g],
  ["e-mail", /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g],
  ["telefone", /(?:\+?55\s*)?\(?\b\d{2}\)?\s*9?\d{4}[-\s]?\d{4}\b/g],
  ["valor em dinheiro", /R\$\s*-?\d[\d.]*(?:,\d{1,2})?(?:\s*(?:mil|milh[õo]es|bilh[õo]es))?/gi],
  ["conta bancária", /\b(?:ag[êe]ncia|ag\.?|conta|c\/c|cc|pix)\s*[:nº°]*\s*\d[\d.-]{3,}/gi],
  ["CEP", /\b\d{5}-\d{3}\b/g],
  ["endereço", /\b(?:rua|r\.|avenida|av\.|travessa|alameda|rodovia|estrada)\s+[A-ZÀ-Ú][^\n,;]{2,40},?\s*(?:n[º°.]?\s*)?\d+/gi],
  ["cartão", /\b(?:\d{4}[ -]?){3}\d{4}\b/g],
  ["senha ou chave", /(?:gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|sk-[a-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:password|senha|api[_ -]?key|access[_ -]?token|token)\s*[:=]\s*\S{6,})/gi],
  ["data de nascimento", /\b(?:nascid[oa]|nascimento|data de nasc\.?)\s*(?:em|:)?\s*\d{1,2}\/\d{1,2}\/\d{2,4}/gi],
];
// Sensitive by subject (art. 5º, II: health, religion, politics, sex life, biometrics…) and by kind
// of business fact (who owes, who earns, who was fired).
const SUBJECTS = [
  ["saúde", /\b(diagn[óo]stic|doen[çc]a|cid[- ]?\d|atestado|laudo|tratamento|gravidez|gr[áa]vida|depress[ãa]o|ansiedade|hiv|c[âa]ncer|medica(mento|ção) controlad)/i],
  ["salário ou remuneração", /\b(sal[áa]rio|remunera[çc][ãa]o|holerite|contracheque|ganha r\$)/i],
  ["dívida ou cobrança", /\b(deve|devendo|d[íi]vida|inadimpl|em atraso|cobran[çc]a|duplicata|protesto)\b/i],
  ["dado trabalhista", /\b(demiss[ãa]o|demitid|advert[êe]ncia|justa causa|processo trabalhista|rescis[ãa]o)/i],
  ["religião, política ou orientação", /\b(religi[ãa]o|filia[çc][ãa]o partid|orienta[çc][ãa]o sexual|sindicat)/i],
];
// "Empório Central", "Bruno Gomes Souza": two or more capitalized words in a row, none of them a
// month, weekday or common heading. A proper name of a person or company (a sentence starts with one).
const NOT_NAMES = /^(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo|brasil|aurora|harness|word|excel|pdf|windows|google|microsoft|the|fonte|total|resumo|relat[óo]rio|planilha|documento|tabela|assunto|prezado|prezada|atenciosamente|quer|obs)$/i;
function properNames(text) {
  const names = [];
  // (Spaces only: "Planilhas\nPara contar…", a title and the next line, is not a name.)
  for (const m of String(text).matchAll(/\b([A-ZÀ-Ú][a-zà-ú]{2,}(?:[ \t]+(?:d[aeo]s?[ \t]+)?[A-ZÀ-Ú][a-zà-ú]{2,})+)/g)) {
    const words = m[1].split(/[ \t]+/).filter((w) => !/^d[aeo]s?$/.test(w));
    if (words.some((w) => NOT_NAMES.test(w))) continue;
    names.push(m[1]);
  }
  return [...new Set(names)];
}

/** What kinds of personal or business data the text has (empty: none found). */
export function sensitiveFindings(text) {
  const value = String(text || "");
  const found = PATTERNS.filter(([, re]) => { re.lastIndex = 0; return re.test(value); }).map(([name]) => name);
  for (const [name, re] of SUBJECTS) if (re.test(value)) found.push(name);
  if (properNames(value).length) found.push("nome de pessoa ou empresa");
  return [...new Set(found)];
}

export const isSensitive = (text) => sensitiveFindings(text).length > 0;

/** The text with identifiers masked, for a service outside the computer (the paid teacher). */
export function maskSensitive(text) {
  let out = String(text || "");
  const masks = { CPF: "[CPF]", CNPJ: "[CNPJ]", "e-mail": "[e-mail]", telefone: "[telefone]", "conta bancária": "[conta]", CEP: "[CEP]", cartão: "[cartão]", "senha ou chave": "[segredo]", "data de nascimento": "[nascimento]" };
  for (const [name, re] of PATTERNS) {
    if (!masks[name]) continue;
    re.lastIndex = 0;
    out = out.replace(re, masks[name]);
  }
  return out;
}
