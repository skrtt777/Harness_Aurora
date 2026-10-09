// The Aurora's diary (OpenClaw's daily notes): what it did today and yesterday, in any conversation
// or agent run — documents created and edited, files organized — built from its own records with no
// AI. In every turn, so "aquele relatório de ontem" or "onde ficou a planilha?" works anywhere.
import { getDb } from "./db.js";

const WROTE = /^(?:Criei|Salvei|Editei) (.+?)(?: \(|\.$)/;
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Today's and yesterday's entries, newest first: { day: "hoje"|"ontem", time, title, files, moved }. */
// projectId (a string, "" for no project): only that project's work. A conversation of company Y must
// not list the files made for company X (their names carry the client: "inadimplentes_emporio.xlsx").
export async function diaryEntries(now = new Date(), { projectId } = {}) {
  const db = await getDb();
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000));
  const since = new Date(now.getTime() - 2 * 86_400_000).toISOString();
  const rows = db.prepare(`SELECT m.created_at, m.execution, c.title FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE m.role = 'assistant' AND m.created_at >= ? AND m.execution LIKE '%toolSteps%'${projectId === undefined ? "" : " AND IFNULL(c.project_id, '') = ?"} ORDER BY m.created_at DESC LIMIT 200`).all(since, ...(projectId === undefined ? [] : [projectId]));
  const entries = [];
  for (const row of rows) {
    const when = new Date(row.created_at);
    const day = dayKey(when) === today ? "hoje" : dayKey(when) === yesterday ? "ontem" : null;
    if (!day) continue;
    let execution = {};
    try { execution = JSON.parse(row.execution); } catch { continue; }
    const steps = execution.toolSteps || [];
    const files = [...new Set(steps.filter((s) => s.ok && ["write_document", "write_file", "edit_file"].includes(s.tool)).map((s) => WROTE.exec(s.summary || "")?.[1]).filter(Boolean))];
    const moved = (execution.moves || []).length;
    if (!files.length && !moved) continue;
    entries.push({ day, time: when.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }), title: row.title || "conversa", files, moved, undone: Boolean(execution.movesUndoneAt) });
  }
  return entries;
}

/** The diary as a context block: at most a few lines, the paths in full. */
export async function diaryBlock(now = new Date(), { projectId } = {}) {
  const entries = (await diaryEntries(now, { projectId })).slice(0, 10);
  if (!entries.length) return [];
  const lines = entries.map((e) => `- ${e.day} ${e.time}, em "${e.title.slice(0, 60)}": ${[
    ...(e.files.length ? [`criou/editou ${e.files.slice(0, 3).join("; ")}${e.files.length > 3 ? ` e mais ${e.files.length - 3}` : ""}`] : []),
    ...(e.moved ? [`organizou ${e.moved} arquivo(s)${e.undone ? " (desfeito depois)" : ""}`] : []),
  ].join("; ")}`);
  return [`O que você (Aurora) fez hoje e ontem (seu diário; use para "aquele arquivo de ontem", "onde ficou?"):\n${lines.join("\n").slice(0, 1400)}`];
}
