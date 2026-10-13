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
