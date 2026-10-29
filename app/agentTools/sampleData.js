// Made-up data in volume. "Crie dados de uma empresa com mais de 300 funcionários" came back as 20 rows and
// a text saying 270 per area, "É FICTICIO, PODE GERAR NUMEROS" as a sheet of 12 lines (28/10, 4b): a small
// model cannot write hundreds of rows by hand. It says the columns; the code writes the rows (the same
// rows for the same file, so a rebuilt BI shows the same numbers) and saves them with write_document.

const FIRST = ["Ana", "Bruno", "Carla", "Diego", "Eduarda", "Felipe", "Gabriela", "Henrique", "Isabela", "João", "Juliana", "Lucas", "Mariana", "Matheus", "Natália", "Otávio", "Patrícia", "Rafael", "Renata", "Rodrigo", "Sabrina", "Thiago", "Vanessa", "Vinícius", "Larissa", "Gustavo", "Camila", "André", "Beatriz", "Caio", "Fernanda", "Leonardo", "Letícia", "Marcelo", "Paula", "Pedro", "Priscila", "Ricardo", "Simone", "Tatiane"];
const LAST = ["Silva", "Santos", "Oliveira", "Souza", "Rodrigues", "Ferreira", "Alves", "Pereira", "Lima", "Gomes", "Costa", "Ribeiro", "Martins", "Carvalho", "Almeida", "Lopes", "Soares", "Fernandes", "Vieira", "Barbosa", "Rocha", "Dias", "Nascimento", "Andrade", "Moreira", "Nunes", "Marques", "Machado", "Mendes", "Freitas"];
const CITIES = ["São Paulo", "Rio de Janeiro", "Belo Horizonte", "Curitiba", "Porto Alegre", "Salvador", "Recife", "Fortaleza", "Brasília", "Goiânia", "Campinas", "Florianópolis", "Manaus", "Belém", "Vitória", "Natal"];
const STATES = { "São Paulo": "SP", "Rio de Janeiro": "RJ", "Belo Horizonte": "MG", Curitiba: "PR", "Porto Alegre": "RS", Salvador: "BA", Recife: "PE", Fortaleza: "CE", "Brasília": "DF", "Goiânia": "GO", Campinas: "SP", "Florianópolis": "SC", Manaus: "AM", "Belém": "PA", "Vitória": "ES", Natal: "RN" };
export const KINDS = ["id", "nome", "lista", "inteiro", "dinheiro", "data", "cidade", "uf", "email", "placa", "texto"];
export const MAX_ROWS = 5000;

/** A seeded generator (mulberry32): the same file gets the same rows. */
function random(seed) {
  let a = 0;
  for (const ch of String(seed)) a = (Math.imul(a, 31) + ch.charCodeAt(0)) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const num = (v, fallback) => { const n = Number(String(v ?? "").replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : fallback; };
const day = (v, fallback) => {
  const s = String(v || "");
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const t = br ? Date.UTC(+br[3], +br[2] - 1, +br[1]) : Date.parse(s);
  return Number.isFinite(t) ? t : fallback;
};
const brDate = (t) => { const d = new Date(t); return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`; };
const plain = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** The kind of a column the model left vague, from its name ("Salário" → dinheiro, "Admissão" → data). */
export function guessKind(column) {
  if (KINDS.includes(column.kind)) return column.kind;
  if (Array.isArray(column.values) && column.values.length) return "lista";
  const n = plain(column.name);
  if (/\b(id|codigo|matricula|cod)\b/.test(n)) return "id";
  if (/\b(nome|funcionario|vendedor|cliente|responsavel|colaborador|gerente|paciente|motorista)\b/.test(n)) return "nome";
  if (/\b(data|admissao|nascimento|validade|vencimento|entrega|emissao|inicio|fim)\b/.test(n)) return "data";
  if (/\b(cidade|municipio)\b/.test(n)) return "cidade";
  if (/\b(uf|estado)\b/.test(n)) return "uf";
  if (/e-?mail/.test(n)) return "email";
  if (/\bplaca\b/.test(n)) return "placa";
  if (/(r\$|salario|valor|preco|custo|receita|faturamento|orcamento|despesa|gasto|total)/.test(n)) return "dinheiro";
  if (/\b(qtd|quantidade|estoque|idade|ano|km|unidades|horas|dias|nota)\b/.test(n)) return "inteiro";
  return "texto";
}

/**
 * The rows: [header, ...rows]. columns: [{ name, kind, values?, weights?, min?, max?, from?, to?, prefix? }].
 * A "lista" column with a weight per value draws them in that proportion (Ativo 90, Inativo 10).
 */
export function sampleRows({ rows, columns, seed = "aurora" }) {
  const count = Math.max(1, Math.min(MAX_ROWS, Math.round(num(rows, 100))));
  const rand = random(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const cols = columns.map((c) => ({ ...c, name: String(c.name || "").trim() || "Coluna", kind: guessKind(c) }));
  const out = [cols.map((c) => c.name)];
  const now = Date.UTC(2026, 9, 1);
  for (let i = 0; i < count; i += 1) {
    const person = `${pick(FIRST)} ${pick(LAST)}`;
    let city = null;
    out.push(cols.map((c) => {
      switch (c.kind) {
        case "id": return `${c.prefix ?? ""}${String(i + 1).padStart(String(count).length, "0")}`;
        case "nome": return person;
        case "lista": {
          const values = (c.values || []).map(String).filter(Boolean);
          if (!values.length) return `${c.name} ${1 + Math.floor(rand() * 5)}`;
          const weights = values.map((_, k) => Math.max(0, num(c.weights?.[k], 1)));
          let r = rand() * weights.reduce((a, b) => a + b, 0);
          for (let k = 0; k < values.length; k += 1) { r -= weights[k]; if (r < 0) return values[k]; }
          return values.at(-1);
        }
        case "inteiro": { const lo = num(c.min, 1), hi = num(c.max, 100); return String(Math.round(lo + rand() * (hi - lo))); }
        case "dinheiro": { const lo = num(c.min, 100), hi = num(c.max, 10000); return (Math.round((lo + rand() * (hi - lo)) * 100) / 100).toFixed(2); }
        case "data": { const lo = day(c.from ?? c.min, now - 365 * 864e5), hi = day(c.to ?? c.max, now); return brDate(lo + Math.floor(rand() * ((Math.max(hi, lo) - lo) / 864e5 + 1)) * 864e5); }
        case "cidade": city = city || pick(CITIES); return city;
        case "uf": city = city || pick(CITIES); return STATES[city];
        case "email": return `${plain(person).replace(/\s+/g, ".")}${i + 1}@empresa.com.br`;
        case "placa": { const L = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"; return `${pick(L)}${pick(L)}${pick(L)}${Math.floor(rand() * 10)}${pick(L)}${Math.floor(rand() * 10)}${Math.floor(rand() * 10)}`; }
        default: return Array.isArray(c.values) && c.values.length ? String(pick(c.values)) : `${c.name} ${i + 1}`;
      }
    }));
  }
  return out;
}

export function sampleDataTools(writeDocument) {
  return [{
    name: "sample_data",
    description: "Gera dados FICTÍCIOS em volume numa planilha (.xlsx ou .csv) — use quando a pessoa pedir para criar/inventar dados (\"crie dados de uma empresa com 300 funcionários\", \"é fictício, pode gerar números\"); você diz as colunas, a ferramenta escreve as linhas (até 5000). Uma chamada por tabela (ex.: Funcionários, Frota). kind de cada coluna: id (prefix), nome, lista (values; weights opcional, ex. [\"Ativo\",\"Inativo\"] com [90,10]), inteiro (min, max), dinheiro (min, max), data (from, to: \"01/01/2025\"), cidade, uf, email, placa, texto. Depois diga à pessoa que os dados são fictícios e onde ficaram; para um BI, chame powerbi action=build com esses arquivos.",
    parameters: { type: "object", properties: {
      path: { type: "string", description: "ex.: Documentos/Funcionarios.xlsx" },
      rows: { type: "number", description: "quantas linhas (até 5000)" },
      columns: { type: "array", items: { type: "object", properties: { name: { type: "string" }, kind: { type: "string", enum: KINDS }, values: { type: "array", items: { type: "string" } }, weights: { type: "array", items: { type: "number" } }, min: { type: "number" }, max: { type: "number" }, from: { type: "string" }, to: { type: "string" }, prefix: { type: "string" } }, required: ["name"] } },
    }, required: ["path", "rows", "columns"] },
    stage: (a) => `Gerando ${a.rows || ""} linhas fictícias…`,
    describe: (a, ctx) => writeDocument.describe({ path: a.path }, ctx),
    async run(args, ctx) {
      const columns = [args.columns].flat().filter((c) => c && typeof c === "object" && c.name);
      if (!columns.length) throw new Error("Diga as colunas em columns (ex.: [{\"name\":\"Nome\",\"kind\":\"nome\"},{\"name\":\"Salário\",\"kind\":\"dinheiro\",\"min\":2000,\"max\":15000}]).");
      const path = String(args.path || "");
      if (!/\.(xlsx|csv)$/i.test(path)) throw new Error("sample_data grava planilhas: use um path .xlsx ou .csv.");
      const table = sampleRows({ rows: args.rows, columns, seed: path.toLowerCase() });
      const content = table.map((r) => `| ${r.map((v) => String(v).replace(/\|/g, "/")).join(" | ")} |`);
      content.splice(1, 0, `|${table[0].map(() => "---").join("|")}|`);
      const saved = await writeDocument.run({ path, content: content.join("\n") }, { ...ctx, sampleData: true });
      return `${String(saved).split("\n")[0]}\n${table.length - 1} linhas fictícias geradas (colunas: ${table[0].join(", ")}). Primeiras linhas:\n${table.slice(0, 4).map((r) => r.join(" | ")).join("\n")}\nDiga à pessoa que os dados são fictícios.`;
    },
  }];
}
