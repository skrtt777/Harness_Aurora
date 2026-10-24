// Two checks of a code answer against what really happened (13/10: asked for "jogos.csv … e um script
// relatorio.py … Rode o script e me mostre o resultado", the Aurora wrote only the CSV and answered "o
// script rodou e encontrou God of War (nota 100)").
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const CODE_EXT = "py|js|mjs|cjs|jsx|ts|tsx|java|cpp|cc|c|h|hpp|cs|go|rs|rb|php|html|css|json|csv|sql|sh|ps1|md|txt|xml|yml|yaml";

/** The file names a request asks for ("um script relatorio.py", "jogos.csv", "src/App.jsx"). */
export function requestedFiles(request) {
  const names = [...String(request || "").matchAll(new RegExp(`(?:^|[\\s"'\`(])((?:[\\w.-]+[\\\\/])*[\\w-][\\w.-]*\\.(?:${CODE_EXT}))(?=$|[\\s"'\`),.;:!?])`, "gi"))].map((m) => m[1].replace(/[.]+$/, ""));
  // Not a file someone already has ("leia o vendas.csv", "abra o index.html"): only files to create.
  if (!/\b(cri[ae]|criar|fa[cz]a|fazer|gere|gerar|escrev[ae]|monte|desenvolv[ae]|programe|grave|salve)\b/.test(fold(request))) return [];
  return [...new Set(names)].filter((n) => !/^(node|python|java|three|react)\.js$/i.test(n) && !/^\d/.test(n));
}

/** Where a file name is, under the project (a few levels deep): its path, or null. */
export function findInProject(root, name, depth = 4) {
  const target = name.replace(/\\/g, "/").toLowerCase();
  const base = target.split("/").pop();
  const walk = (dir, d) => {
    if (d > depth) return null;
    let entries = []; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isFile() && e.name.toLowerCase() === base && p.replace(/\\/g, "/").toLowerCase().endsWith(target)) return p;
    }
    for (const e of entries) if (e.isDirectory() && !["node_modules", ".git", ".aurora"].includes(e.name)) { const f = walk(join(dir, e.name), d + 1); if (f) return f; }
    return null;
  };
  return existsSync(root) ? walk(root, 0) : null;
}

/** The files the request names that are not in the project yet. */
export function missingFiles(request, root) {
  if (!root) return [];
  return requestedFiles(request).filter((n) => !findInProject(root, n));
}

const RAN = /\b(rodei|executei|rodou|executou|rodando o script|ao rodar|o script (mostrou|encontrou|retornou|gerou|calculou)|resultado do script|sa[ií]da do (script|programa|comando)|testes? (passaram|passou|rodaram)|\d+ testes? passa)/;
const ASKED_RUN = /\b(rode|rodar|execute|executar|roda|teste|testar|rode os testes|me mostre o resultado)\b/;
const RUNNERS = new Set(["run_command", "create_api", "check_page", "command_output"]);

/** An answer that says something ran when nothing ran in this turn. */
export function claimsRunWithoutRunning(answer, steps, request) {
  if (!RAN.test(fold(answer))) return false;
  if (!ASKED_RUN.test(fold(request)) && !/\b(script|codigo|teste|programa)\b/.test(fold(request))) return false;
  return !steps.some((s) => s.ok && RUNNERS.has(s.tool));
}


/**
 * "Pronto! Tema do BI: Escuro… aplicado às 4 páginas" with nothing done (13/10: six answers in a row
 * said they applied or updated something, one call each, no tool). An answer that says it did a change
 * while no tool that acts or writes ran in this turn.
 */
const DID = /^\W*(pronto|feito|conclu[ií]d[oa]|(atualizad|aplicad|criad|gerad|montad|configurad|alterad)[oa]s?|salv[oa])\b|\b(apliquei|atualizei|criei|gerei|montei|configurei|mudei|alterei|salvei|ajustei|troquei|adicionei|inclu[ií]|removi|apaguei)\b|\bfoi (aplicad|atualizad|criad|gerad|montad|salv)/i;
const NOT_DONE = /\b(n[aã]o (fiz|criei|apliquei|executei|consegui|alterei|foi (feito|criado|aplicado))|nada foi (executado|criado|alterado|feito)|modo plano|vou (fazer|criar|aplicar)|posso (fazer|criar|aplicar)|quer que eu)\b/i;
export function claimsActionWithoutAction(answer, steps, actionTools) {
  const text = String(answer || "");
  if (!DID.test(text.slice(0, 600)) || NOT_DONE.test(text.slice(0, 400))) return false;
  // About something that needs an action (a text written in the chat, "Pronto, aqui está o e-mail", is fine).
  if (!/\b(bi|power ?bi|painel|dashboard|planilha|documento|arquivo|relat[oó]rio|p[aá]ginas?|tema|gr[aá]fico|tabela|apresenta[cç][aã]o|slides?|site|pasta|programa|excel|word)\b/i.test(text.slice(0, 800))) return false;
  return !steps.some((s) => s.ok && actionTools.has(s.tool));
}

/** The conversation allows made-up data ("é fictício, pode gerar números", "dados de exemplo"). */
export const FICTIONAL = /\bfict[ií]ci|\binvent(e|ar|ado|ados)\b.{0,20}(dados|n[uú]meros|valores)|pode (inventar|gerar|criar) (os )?(n[uú]meros|dados|valores)|dados (de exemplo|aleat|falsos|simulados|ficticios)|aleat[oó]ri|simulad[oa]s?\b/i;

/**
 * "totalizando **7 pessoas**" over a table of 4 names (13/10, cross-sheet count): the number said does not
 * match the list right beside it. Returns { said, listed } when no number said equals the list's size.
 */
const COUNTED = /\b(\d{1,3})\s+(?:\*\*)?\s*(pessoas|funcion[aá]rios|colaboradores|pedidos|itens|produtos|clientes|contratos|departamentos|fornecedores|vendedores|t[ií]tulos|registros|linhas)\b/gi;
export function countMismatch(answer) {
  const text = String(answer || "").replace(/\*\*/g, "");
  const said = [...text.matchAll(COUNTED)].map((m) => Number(m[1]));
  if (!said.length) return null;
  // "Dos 12 funcionários, 4 trabalham lá": the 4 is a count too.
  for (const m of text.matchAll(/\b(\d{1,3})\s+(trabalham|est[ãa]o|s[ãa]o|atendem|ficam|t[êe]m|aparecem|vencem|precisam)\b/gi)) said.push(Number(m[1]));
  const lines = text.split(/\r?\n/);
  const tableRows = lines.filter((l) => /^\s*\|/.test(l) && !/^\s*\|[\s:|-]+\|\s*$/.test(l));
  const table = tableRows.length >= 2 ? tableRows.length - 1 : 0;
  const bullets = lines.filter((l) => /^\s*([-*•]|\d+[.)])\s+\S/.test(l)).length;
  const listed = table || bullets;
  if (listed < 2 || said.includes(listed)) return null;
  return { said, listed };
}

/**
 * "Quantos chamados ainda estão abertos?": the filtered read said "18 linha(s)" and the answer said "19
 * chamados" (empresa ti-3, 24/10). A number said next to the question's own noun that differs from the
 * tool's total: { said, filtered }.
 */
const foldCount = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const COUNT_STOP = new Set(["quantos", "quantas", "ainda", "esta", "estao", "temos", "existem", "empresa", "desse", "deste", "dessa", "desta", "mais", "menos", "total"]);
// Only a near miss (19 or 15 for 18) that is no total of the turn's filtered reads nor a sum of two of them:
// "9 aguardando + 5 parcial = 14" over two reads is a right answer, not a miscount.
export function filteredCountMismatch(answer, question, filtered, counts = []) {
  if (!filtered || filtered < 2 || !/\bquant[oa]s\b/i.test(foldCount(question))) return null;
  const known = new Set([...counts, ...counts.flatMap((a, i) => counts.slice(i + 1).map((b) => a + b))]);
  const nouns = (foldCount(question).match(/[a-z]{4,}/g) || []).filter((w) => !COUNT_STOP.has(w)).map((w) => w.slice(0, 5));
  const said = [...foldCount(answer).replace(/\*/g, "").matchAll(/\b(\d{1,4})\s+([a-z]{4,})/g)].filter((m) => nouns.some((n) => m[2].startsWith(n))).map((m) => Number(m[1]));
  if (!said.length || said.includes(filtered) || said.some((n) => known.has(n)) || !said.some((n) => Math.abs(n - filtered) <= 3)) return null;
  return { said, filtered };
}

/**
 * "Liste os departamentos do maior para o menor": a read of 8 rows answered with a table of 2 and a
 * filter nobody applied (13/10). The rows of the answer's list, when the request asks for all of them.
 */
export function shortList(answer, request, readRows) {
  if (!readRows || readRows < 3) return null;
  const req = String(request || "");
  if (!/\b(liste|listar|lista|todos|todas|cada|ordem|ordene|ordenar|do maior para o menor|do menor para o maior)\b/i.test(req)) return null;
  if (/\b(top|primeir[oa]s|[uú]ltim[oa]s|\d+ (maiores|menores|mais|primeiros))\b|\b\d+\b/i.test(req.replace(/\b\w+\.(csv|xlsx)\b/gi, ""))) return null;
  if (/\b(acima|abaixo|mais de|menos de|maior que|menor que|que (n[aã]o|ainda|est[aã]o|vencem|foram)|com |sem |s[oó] |apenas)\b/i.test(req)) return null;
  const lines = String(answer || "").split(/\r?\n/);
  const tableRows = lines.filter((l) => /^\s*\|/.test(l) && !/^\s*\|[\s:|-]+\|\s*$/.test(l));
  const listed = tableRows.length >= 2 ? tableRows.length - 1 : lines.filter((l) => /^\s*([-*•]|\d+[.)])\s+\S/.test(l)).length;
  return listed >= 1 && listed < readRows ? { listed, readRows } : null;
}

/**
 * The rows came sorted by the tool and the answer lists them in another order (14/10: qwen3.5:2b put
 * Tecnologia 420 before Vendas 610 under "do maior para o menor"). The right order, when it differs.
 */
export function orderMismatch(answer, order) {
  if (!Array.isArray(order) || order.length < 3) return null;
  const text = String(answer || "").toLowerCase();
  const at = order.map((k) => text.indexOf(k.toLowerCase()));
  if (at.some((p) => p < 0)) return null;
  return at.every((p, i) => !i || p > at[i - 1]) ? null : order;
}
