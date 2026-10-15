// The Aurora's own history, from ROADMAP.md (shipped with the app): asked from the phone for "um excel com
// update que fizemos em você, quantidade, tempo e % de melhoria", it made up "+49%, de 250 ms para 130 ms"
// (15/10). The real versions, with their dates and battery results, go into the context of that request.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROADMAP = join(dirname(fileURLToPath(import.meta.url)), "..", "ROADMAP.md");
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** A request about the Aurora's own updates, versions, improvements or history. */
export function asksAuroraHistory(text) {
  const t = fold(text);
  const about = /\b(em voce|de voce|sua[s]? (versao|versoes|atualizac|melhoria|evoluc)|seu[s]? (update|historico|progresso)|na aurora|da aurora|do harness|no harness|a aurora)\b/.test(t);
  return about && /\b(update|atualizac|versao|versoes|melhor|evoluc|mudou|mudanc|historico|progresso|release|changelog|bateria|desempenho|performance)/.test(t);
}

/** The last versions as written in ROADMAP.md (each "- **0.1.N (data, …)" entry with its lines), or "". */
export function auroraHistory({ file = ROADMAP, versions = 10 } = {}) {
  if (!existsSync(file)) return "";
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const entries = [];
  for (let i = 0; i < lines.length && entries.length < versions; i += 1) {
    if (!/^- \*\*\d+\.\d+\.\d+ \(/.test(lines[i])) continue;
    const body = [lines[i]];
    for (let j = i + 1; j < lines.length && /^\s{2,}\S/.test(lines[j]); j += 1) body.push(lines[j]);
    entries.push(body.join("\n"));
  }
  return entries.join("\n");
}

/** The context block for such a request, or "". */
export function auroraHistoryBlock(request, options) {
  if (!asksAuroraHistory(request)) return "";
  const history = auroraHistory(options);
  return history ? `HISTÓRICO REAL DAS VERSÕES DA AURORA (do roteiro do projeto; a mais nova primeiro). Para falar das atualizações, melhorias ou números da Aurora, use SÓ o que está aqui: datas, versões e resultados das baterias. Nunca invente tempos, porcentagens ou medidas que não estejam abaixo; se o pedido quer um número que não está aqui, diga que ele não foi medido.\n${history.slice(0, 12000)}` : "";
}
