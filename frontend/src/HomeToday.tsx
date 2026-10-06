import { useEffect, useState } from 'react';
import { canOpenFiles, getDiary, getUserProfile, listTaskAgents, openDeliveredFile, type DiaryEntry, type TaskAgent, type AgentRun } from './api';
import { nextRunLabel } from './agentTime';

/**
 * The start screen knows the person: a greeting with the name from "Sobre você", the agents that
 * work today, and the files the Aurora made lately (from its diary), each one a click away.
 */
export function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

export default function HomeToday() {
  const [name, setName] = useState<string | null>(null);
  const [agents, setAgents] = useState<{ agents: TaskAgent[]; runs: AgentRun[] } | null>(null);
  const [diary, setDiary] = useState<DiaryEntry[]>([]);
  useEffect(() => {
    void getUserProfile().then((p) => setName(p.learned.map((l) => /^Nome: (.+)$/.exec(l.text)?.[1]).find(Boolean) || null)).catch(() => {});
    void listTaskAgents().then(setAgents).catch(() => {});
    void getDiary().then(setDiary).catch(() => {});
  }, []);
  const soon = (agents?.agents || []).filter((a) => a.enabled).map((a) => {
    const last = agents!.runs.find((r) => r.agentId === a.id && r.trigger === 'schedule')?.startedAt || null;
    return { name: a.name, when: nextRunLabel(a.trigger, last) };
  }).filter((x) => x.when && /^(hoje|em )/.test(x.when)).slice(0, 3);
  const files = [...new Set(diary.flatMap((e) => e.files))].slice(0, 3);
  const openable = canOpenFiles();

  return <div className="home-today">
    <h1>{greeting()}{name ? `, ${name}` : ''}.</h1>
    <p>O que vamos fazer hoje? A Aurora organiza seus arquivos, cria documentos e planilhas e pesquisa para você.</p>
    {(soon.length > 0 || files.length > 0) && <ul className="home-today-list" aria-label="Hoje">
      {soon.map((s) => <li key={s.name}><span className="home-tag">Agenda</span>{s.name} trabalha {s.when}</li>)}
      {files.map((f) => <li key={f}><span className="home-tag done">Feito</span><span className="home-file" title={f}>{f.split(/[\\/]/).pop()}</span>
        {openable && <button type="button" className="btn btn-text btn-sm" onClick={() => void openDeliveredFile(f)}>Abrir</button>}</li>)}
    </ul>}
  </div>;
}
