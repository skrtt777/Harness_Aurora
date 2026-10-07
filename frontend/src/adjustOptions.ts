// "Quer ajustar?" at the end of an answer (app/briefs.js asks for it): the numbered options become
// buttons, so a person who doesn't know what to ask next just picks one.
export interface AdjustOption { label: string; recommended: boolean }

export function adjustOptions(content: string): AdjustOption[] {
  const at = content.search(/\*{0,2}Quer ajustar\?\*{0,2}/i);
  if (at < 0) return [];
  const options: AdjustOption[] = [];
  for (const line of content.slice(at).split(/\r?\n/).slice(1)) {
    const match = /^\s*(\d)[.)]\s+(.+?)\s*$/.exec(line);
    if (!match) { if (options.length) break; continue; }
    const recommended = /\(recomendad[oa]\)/i.test(match[2]);
    const label = match[2].replace(/\s*\(recomendad[oa]\)\s*/gi, ' ').replace(/\*\*/g, '').replace(/^["“]|["”]$/g, '').trim();
    if (label && label.length <= 120) options.push({ label, recommended });
    if (options.length === 3) break;
  }
  return options;
}
