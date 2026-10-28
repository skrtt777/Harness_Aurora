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
  // The check digits as code (28/10: described in words, the 30B still invented the weights).
  { id: "cpf", when: /\bcpf\b/,
    js: "CPF (dígitos verificadores):\nconst d = cpf.replace(/\\D/g, ''); if (d.length !== 11 || /^(\\d)\\1{10}$/.test(d)) return false;\nconst dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };\nreturn dv(9) === Number(d[9]) && dv(10) === Number(d[10]);",
    py: "CPF (dígitos verificadores):\nd = re.sub(r'\\D', '', cpf)\nif len(d) != 11 or len(set(d)) == 1: return False\ndef dv(n): return (sum(int(d[i]) * (n + 1 - i) for i in range(n)) * 10 % 11) % 10\nreturn dv(9) == int(d[9]) and dv(10) == int(d[10])" },
  { id: "cnpj", when: /\bcnpj\b/,
    js: "CNPJ (dígitos verificadores):\nconst d = cnpj.replace(/\\D/g, ''); if (d.length !== 14 || /^(\\d)\\1{13}$/.test(d)) return false;\nconst dv = (n) => { const p = n === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2]; const r = p.reduce((s, w, i) => s + w * Number(d[i]), 0) % 11; return r < 2 ? 0 : 11 - r; };\nreturn dv(12) === Number(d[12]) && dv(13) === Number(d[13]);",
    py: "CNPJ (dígitos verificadores):\nd = re.sub(r'\\D', '', cnpj)\nif len(d) != 14 or len(set(d)) == 1: return False\ndef dv(n):\n    p = [5,4,3,2,9,8,7,6,5,4,3,2] if n == 12 else [6,5,4,3,2,9,8,7,6,5,4,3,2]\n    r = sum(w * int(d[i]) for i, w in enumerate(p)) % 11\n    return 0 if r < 2 else 11 - r\nreturn dv(12) == int(d[12]) and dv(13) == int(d[13])" },
  { id: "data-br", when: /\b(dd\/mm\/aaaa|dd\/mm\/yyyy|data brasileira|padrao brasileiro|formato brasileiro|data em portugues|aaaa-mm-dd|data iso)\b/,
    js: "Data brasileira: de 'aaaa-mm-dd' para 'dd/mm/aaaa' separe o texto (const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`): new Date('aaaa-mm-dd') é meia-noite em UTC e no Brasil vira o dia anterior. De um Date: new Intl.DateTimeFormat('pt-BR').format(data). De 'dd/mm/aaaa': const [d, m, a] = s.split('/').map(Number); new Date(a, m - 1, d).",
    py: "Data brasileira: data.strftime('%d/%m/%Y'); de texto: datetime.datetime.strptime(s, '%d/%m/%Y').date() (import datetime)." },
  { id: "regex-acentos", when: /\b(pontuac\w*|palavras?|letras?)\b/,
    js: "Texto em português: \\w do JavaScript não pega letras acentuadas ('olá' vira 'ol'). Tire a pontuação com texto.replace(/[^\\p{L}\\p{N}\\s]/gu, '') e pegue palavras com texto.match(/[\\p{L}\\p{N}]+/gu).",
    py: "Texto em português: re.findall(r'\\w+', texto.lower()) já pega letras acentuadas em Python 3." },
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
