// "O que mudou" in an open BI: after each refresh the Aurora compares the main numbers and, for an
// operation, where each entity is, with the refresh before; writes a short note with the local model
// (only those facts), keeps the last notes in the report's 'Notas da Aurora' table, and raises an alert
// when something got worse (more late, a number that fell or rose past a limit). The snapshot uses the
// same DAX as the scenes (vehicleVars), so a note never says what the picture does not show.
import { EventEmitter } from "node:events";

export const biEvents = new EventEmitter();
const fmtNum = (v) => (Number.isFinite(v) ? v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : String(v));

/**
 * The facts between two snapshots. snap: { at, numbers: { name: value }, entities: { name: { where, place, late } } }.
 * meta: { badUp: [names where up is bad], noun, place }. Returns { facts: [text], alerts: [text] }.
 */
export function diffSnapshots(prev, cur, meta = {}) {
  const facts = []; const alerts = [];
  if (!prev) return { facts, alerts, changed: [] };
  for (const [name, now] of Object.entries(cur.numbers || {})) {
    const before = prev.numbers?.[name];
    if (!Number.isFinite(now) || !Number.isFinite(before) || now === before) continue;
    const delta = now - before;
    const pct = before ? Math.abs(delta / before) : 1;
    // Small moves of big numbers are noise; counts move by units.
    if (Math.abs(delta) < 1 && pct < 0.02) continue;
    facts.push(`${name}: ${fmtNum(before)} → ${fmtNum(now)}`);
    const bad = (meta.badUp || []).includes(name) ? delta > 0 : false;
    if (bad) alerts.push(`${name} subiu de ${fmtNum(before)} para ${fmtNum(now)}`);
  }
  const where = { doca: meta.place ? `em ${meta.place.toLowerCase()}` : "em atendimento", filalocal: "na fila", fila: "na fila", estrada: "a caminho" };
  const prevE = prev.entities || {}; const curE = cur.entities || {};
  const moved = []; const arrived = []; const left = []; const newLate = [];
  for (const [name, e] of Object.entries(curE)) {
    const p = prevE[name];
    if (!p) arrived.push(`${name} (${where[e.where] || e.where}${e.place ? ` ${e.place}` : ""})`);
    else if (p.where !== e.where || p.place !== e.place) moved.push(`${name}: ${where[p.where] || p.where}${p.place ? ` ${p.place}` : ""} → ${where[e.where] || e.where}${e.place ? ` ${e.place}` : ""}`);
    if (e.late && !(p && p.late)) newLate.push(name);
  }
  for (const name of Object.keys(prevE)) if (!curE[name]) left.push(name);
  if (arrived.length) facts.push(`Chegaram: ${arrived.slice(0, 6).join(", ")}${arrived.length > 6 ? ` e mais ${arrived.length - 6}` : ""}`);
  if (moved.length) facts.push(`Mudaram de lugar: ${moved.slice(0, 6).join("; ")}${moved.length > 6 ? ` e mais ${moved.length - 6}` : ""}`);
  if (left.length) facts.push(`Concluídos: ${left.slice(0, 6).join(", ")}${left.length > 6 ? ` e mais ${left.length - 6}` : ""}`);
  if (newLate.length) {
    facts.push(`Novos atrasados: ${newLate.join(", ")}`);
    alerts.push(`${newLate.length} ${newLate.length === 1 ? "novo atrasado" : "novos atrasados"}: ${newLate.slice(0, 5).join(", ")}`);
  }
  // Who to ring in the scene: those who arrived and those who changed place.
  const changed = Object.keys(curE).filter((name) => !prevE[name] || prevE[name].where !== curE[name].where || prevE[name].place !== curE[name].place);
  return { facts, alerts, changed };
}

/** The 'Mudanças' table: the names to ring (one empty row: nobody). */
export function changedTable(names) {
  const esc = (v) => String(v).replace(/"/g, "\"\"");
  return `DATATABLE("Nome", STRING, {${(names.length ? names.slice(0, 200) : [""]).map((n) => `{"${esc(n)}"}`).join(", ")}})`;
}

/** The note from the facts: the local model writes 1-2 sentences with only them; without it, the facts. */
export async function narrate(facts, ask, env = {}, about = "o que mudou na operação desde a última atualização", maxChars = 220) {
  if (!facts.length) return "";
  const plain = facts.join(". ").slice(0, 240);
  if (!ask) return plain;
  const prompt = `Escreva em português do Brasil, em ${maxChars < 160 ? "1 frase curta" : "1 ou 2 frases curtas"} (no máximo ${maxChars} caracteres), ${about}, usando SÓ estes fatos, sem inventar números nem causas:\n- ${facts.join("\n- ")}\nResponda só a frase.`;
  const reply = await ask(prompt, { ...env, LOCAL_MAX_OUTPUT_TOKENS: "160", LOCAL_TEMPERATURE: "0.2" }).catch(() => null);
  const text = String(reply?.ok ? reply.text : "").replace(/\s+/g, " ").trim();
  // A note with a number the facts do not have is not used. A rounding is ("R$ 4,6 milhões" for
  // 4.634.278,59; "94k"): within 5% of a number of the facts. An invented one is not.
  const known = numbersIn(facts.join(" "));
  const said = numbersIn(text);
  const close = (v) => known.some((k) => Math.abs(v - k) <= Math.max(0.05 * Math.abs(k), 0.051));
  return text && text.length <= Math.max(maxChars + 20, 120) && said.every(close) ? text : plain;
}

/** The numbers of a Brazilian text, with "mil"/"milhões"/"k" applied: "R$ 4,6 milhões" -> 4600000. */
export function numbersIn(text) {
  const out = [];
  const re = /(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)\s*(mil\b|milh(?:ão|ões|oes|ao)\b|mi\b|bilh(?:ão|ões|oes|ao)\b|bi\b|k\b)?/gi;
  for (const [, n, unit] of String(text).matchAll(re)) {
    let v = Number(n.replace(/\./g, "").replace(",", "."));
    const u = String(unit || "").toLowerCase();
    if (/^(mil|k)$/.test(u)) v *= 1e3; else if (/^(milh|mi$)/.test(u)) v *= 1e6; else if (/^(bilh|bi$)/.test(u)) v *= 1e9;
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

/** The 'Notas da Aurora' table with the last notes (newest first). */
export function notesTable(notes) {
  const esc = (v) => String(v).replace(/"/g, "\"\"");
  const rows = notes.length ? notes.slice(0, 6).map((n) => `{"${esc(n.when)}", "${esc(n.text)}"}`) : ["{\"\", \"\"}"];
  return `DATATABLE("Quando", STRING, "Texto", STRING, {${rows.join(", ")}})`;
}
