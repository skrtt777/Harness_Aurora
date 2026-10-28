// Brazilian everyday code idioms for the editor (Ctrl+I and the gray suggestion, app/codeAssist.js): the
// small local models got these wrong (27/10, scripts/code-bench.mjs): reais formatted by hand, accents
// turned into hyphens in a slug, an age in days, a CEP without its hyphen. When the request or the code
// around the cursor speaks of one, its idiom goes along as a hint (at most three).
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const HINTS = [
  { id: "moeda", when: /\b(reais|real brasileiro|r\$|moeda|brl|dinheiro|formatar? (o )?(valor|preco))\b/,
    js: "Reais: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor) → 'R$ 1.234,50' (o espaço depois de R$ é um espaço fino; troque por ' ' se precisar).",
    py: "Reais: f\"R$ {valor:,.2f}\".replace(',', 'X').replace('.', ',').replace('X', '.') → 'R$ 1.234,50'." },
  { id: "acentos", when: /\b(acento\w*|slug|sem acento|normaliz\w*|url amigavel)\b/,
    js: "Tirar acentos: texto.normalize('NFD').replace(/[\\u0300-\\u036f]/g, ''). Slug: depois disso, toLowerCase(), troque o que não é [a-z0-9] por '-' e tire '-' repetidos e das pontas.",
    py: "Tirar acentos: ''.join(c for c in unicodedata.normalize('NFD', texto) if unicodedata.category(c) != 'Mn') (import unicodedata)." },
  { id: "idade", when: /\b(idade|anos completos|aniversario|data de nascimento)\b/,
    js: "Idade em anos completos: anos = hoje.getFullYear() - nasc.getFullYear(); se (hoje.getMonth() < nasc.getMonth()) ou (mesmo mês e hoje.getDate() < nasc.getDate()) tire 1. Não divida milissegundos por 365.",
    py: "Idade em anos completos: hoje.year - nasc.year - ((hoje.month, hoje.day) < (nasc.month, nasc.day))." },
  { id: "cep", when: /\bcep\b/,
    js: "CEP: 8 dígitos, com ou sem hífen: /^\\d{5}-?\\d{3}$/.", py: "CEP: re.fullmatch(r'\\d{5}-?\\d{3}', cep)." },
  { id: "cpf", when: /\bcpf\b/,
    js: "CPF: só os dígitos (cpf.replace(/\\D/g, '')), 11 dígitos, não todos iguais (/^(\\d)\\1{10}$/), e os dois dígitos verificadores: soma dos 9 primeiros × (10..2), resto = (soma × 10) % 11 (10 vira 0); depois os 10 primeiros × (11..2).",
    py: "CPF: só os dígitos (re.sub(r'\\D', '', cpf)), 11 dígitos, não todos iguais, e os dois verificadores (pesos 10..2 e depois 11..2; resto = soma * 10 % 11, 10 vira 0)." },
  { id: "cnpj", when: /\bcnpj\b/,
    js: "CNPJ: 14 dígitos; verificadores com pesos 5,4,3,2,9,8,7,6,5,4,3,2 e depois 6,5,4,3,2,9,8,7,6,5,4,3,2; resto = soma % 11, dígito = resto < 2 ? 0 : 11 - resto.",
    py: "CNPJ: 14 dígitos; verificadores com pesos [5,4,3,2,9,8,7,6,5,4,3,2] e [6]+esses; resto = soma % 11, dígito = 0 se resto < 2 senão 11 - resto." },
  { id: "data-br", when: /\b(dd\/mm\/aaaa|dd\/mm\/yyyy|data brasileira|padrao brasileiro|formato brasileiro|data em portugues)\b/,
    js: "Data brasileira: new Intl.DateTimeFormat('pt-BR').format(data) → '05/03/2026'; de 'dd/mm/aaaa' para Date: const [d, m, a] = s.split('/').map(Number); new Date(a, m - 1, d).",
    py: "Data brasileira: data.strftime('%d/%m/%Y'); de texto: datetime.strptime(s, '%d/%m/%Y')." },
  { id: "telefone", when: /\b(telefone|celular|whatsapp)\b/,
    js: "Telefone BR: só dígitos; 10 (fixo) ou 11 (celular, começa com 9 depois do DDD) dígitos: /^\\d{2}9?\\d{8}$/.", py: "Telefone BR: re.fullmatch(r'\\d{2}9?\\d{8}', re.sub(r'\\D', '', tel))." },
  { id: "ordenar-data", when: /\b(mais recente|mais antig\w*|ordem cronologica|ordene? por data)\b/,
    js: "Ordenar por data (string ISO): [...lista].sort((a, b) => new Date(b.data) - new Date(a.data)) (mais recente primeiro; sem mudar a lista original).",
    py: "Ordenar por data: sorted(lista, key=lambda x: x['data'], reverse=True) (ISO ordena como texto)." },
];

/** The hints for a request in a language (javascript/typescript → js, python → py), at most three. */
export function hintsFor(text, language = "") {
  const t = fold(text);
  const key = /python/i.test(language) ? "py" : /(java|type)script|react/i.test(language) ? "js" : null;
  if (!key) return [];
  return HINTS.filter((h) => h.when.test(t) && h[key]).slice(0, 3).map((h) => h[key]);
}
