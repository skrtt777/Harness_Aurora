import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  createSectorAgents, createTaskAgent, deleteTaskAgent, exportAgentRuns, getPendingTurn, listOrchestrations, listTaskAgentRuns, listTaskAgents, pickFolder, planTeamRequest, runTaskAgent, startTeamRequest, updateTaskAgent,
  type AgentRun, type AgentTrigger, type NewTaskAgent, type Orchestration, type PendingTurn, type PlannedTask, type TaskAgent,
} from './api';
import DeliveredFiles from './DeliveredFiles';
import { stepText } from './ChatView';

/**
 * Task agents (docs/AGENTES_ROTEIRO.md): "employees" with a mission, a work folder and a trigger.
 * Run one now, on a schedule or when a file arrives in a folder; each run's delivery (files)
 * stays in its history.
 */

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const STATUS: Record<AgentRun['status'], string> = { running: 'Trabalhando…', done: 'Concluída', failed: 'Não concluída' };
const TRIGGER_LABEL: Record<AgentRun['trigger'], string> = { manual: 'pedido seu', schedule: 'horário', file: 'arquivo novo', orquestrador: 'pedido para a equipe' };

export function describeTrigger(trigger: AgentTrigger): string {
  if (trigger.type === 'schedule' && trigger.everyMinutes) return `A cada ${trigger.everyMinutes} min`;
  if (trigger.type === 'schedule') return `Às ${trigger.at} (${(trigger.weekdays || []).map((d) => WEEKDAYS[d]).join(', ') || 'nenhum dia'})`;
  if (trigger.type === 'file') return `Arquivo novo em ${trigger.folder}${trigger.pattern && trigger.pattern !== '*' ? ` (${trigger.pattern})` : ''}`;
  return 'Quando você pedir';
}

const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

type TriggerDraft = { type: 'manual' | 'at' | 'every' | 'file'; at: string; weekdays: number[]; everyMinutes: number; folder: string; pattern: string; request: string };
const draftOf = (t: AgentTrigger): TriggerDraft => ({
  type: t.type === 'schedule' ? (t.everyMinutes ? 'every' : 'at') : t.type,
  at: t.type === 'schedule' && t.at ? t.at : '08:00',
  weekdays: t.type === 'schedule' && t.weekdays ? t.weekdays : [1, 2, 3, 4, 5],
  everyMinutes: t.type === 'schedule' && t.everyMinutes ? t.everyMinutes : 60,
  folder: t.type === 'file' ? t.folder : '',
  pattern: t.type === 'file' ? t.pattern || '*' : '*',
  request: t.type !== 'manual' ? t.request || '' : '',
});
const triggerOf = (d: TriggerDraft): AgentTrigger =>
  d.type === 'at' ? { type: 'schedule', at: d.at, weekdays: d.weekdays, request: d.request }
    : d.type === 'every' ? { type: 'schedule', everyMinutes: d.everyMinutes, request: d.request }
      : d.type === 'file' ? { type: 'file', folder: d.folder, pattern: d.pattern, request: d.request }
        : { type: 'manual' };

function TriggerEditor({ value, onChange }: { value: TriggerDraft; onChange: (d: TriggerDraft) => void }) {
  const set = (patch: Partial<TriggerDraft>) => onChange({ ...value, ...patch });
  return <fieldset className="agent-trigger">
    <legend>Quando ele trabalha</legend>
    <select value={value.type} onChange={(e) => set({ type: e.target.value as TriggerDraft['type'] })} aria-label="Tipo de gatilho">
      <option value="manual">Só quando eu pedir</option>
      <option value="at">Num horário, em dias da semana</option>
      <option value="every">A cada tantos minutos</option>
      <option value="file">Quando chegar um arquivo numa pasta</option>
    </select>
    {value.type === 'at' && <div className="agent-trigger-row">
      <label>Horário <input type="time" value={value.at} onChange={(e) => set({ at: e.target.value })} /></label>
      <span className="agent-weekdays" role="group" aria-label="Dias">{WEEKDAYS.map((d, i) => <label key={d}><input type="checkbox" checked={value.weekdays.includes(i)} onChange={(e) => set({ weekdays: e.target.checked ? [...value.weekdays, i].sort() : value.weekdays.filter((x) => x !== i) })} />{d}</label>)}</span>
    </div>}
    {value.type === 'every' && <label>A cada <input type="number" min={5} max={10080} value={value.everyMinutes} onChange={(e) => set({ everyMinutes: Number(e.target.value) })} /> minutos</label>}
    {value.type === 'file' && <div className="agent-trigger-row">
      <label className="grow">Pasta observada <input value={value.folder} onChange={(e) => set({ folder: e.target.value })} placeholder="C:\Users\voce\Notas a lançar" /></label>
      <button type="button" onClick={() => void pickFolder().then((f) => f && set({ folder: f }))}>Escolher…</button>
      <label>Arquivos <input value={value.pattern} onChange={(e) => set({ pattern: e.target.value })} placeholder="*.pdf" /></label>
    </div>}
    {value.type !== 'manual' && <label className="grow">O que fazer <textarea rows={2} value={value.request} onChange={(e) => set({ request: e.target.value })} placeholder="Ex.: gere a planilha de títulos com mais de 30 dias de atraso" /></label>}
    {value.type === 'file' && <small>Os arquivos que já estão na pasta não disparam; só os que chegarem depois.</small>}
  </fieldset>;
}

function AgentCard({ agent, runs, onChanged, onOpenConversation }: { agent: TaskAgent; runs: AgentRun[]; onChanged: () => void; onOpenConversation: (id: string) => void }) {
  const [requestText, setRequestText] = useState('');
  const [editing, setEditing] = useState(false);
  const [trigger, setTrigger] = useState(draftOf(agent.trigger));
  const [history, setHistory] = useState<AgentRun[] | null>(null);
  const [error, setError] = useState('');
  const running = runs.some((r) => r.status === 'running');
  // While it works, the card follows its turn like the chat does: stage, steps, text so far.
  const runningConversation = runs.find((r) => r.status === 'running')?.conversationId || null;
  const [live, setLive] = useState<PendingTurn | null>(null);
  useEffect(() => {
    if (!runningConversation) { setLive(null); return undefined; }
    const poll = () => void getPendingTurn(runningConversation).then(setLive).catch(() => {});
    poll();
    const id = setInterval(poll, 1500);
    return () => clearInterval(id);
  }, [runningConversation]);
  const latest = runs[0];
  const act = (fn: () => Promise<unknown>) => { setError(''); fn().then(onChanged).catch((e: Error) => setError(e.message)); };
  useEffect(() => { if (history) void listTaskAgentRuns(agent.id).then(setHistory).catch(() => {}); }, [runs]); // eslint-disable-line react-hooks/exhaustive-deps

  return <article className={`agent-card ${agent.enabled ? '' : 'disabled'}`} aria-label={agent.name}>
    <header className="agent-card-head">
      <div>
        <h3>{agent.name}</h3>
        <p className="agent-meta">{agent.kind === 'setor' ? `Setor ${agent.department || ''}` : 'Pessoal'} · {describeTrigger(agent.trigger)}</p>
      </div>
      <span className={`agent-status ${running ? 'running' : latest?.status || ''}`}>{running ? 'Trabalhando…' : agent.enabled ? 'Pronto' : 'Desligado'}</span>
    </header>
    <p className="agent-mission">{agent.mission}</p>
    <small className="agent-folder" title={agent.workDir}>Pasta: {agent.workDir}</small>
    {running && live && <div className="agent-live" aria-live="polite" aria-label="Andamento">
      {live.stage && <small>{live.stage}</small>}
      {live.steps.length > 0 && <ol>{live.steps.slice(-4).map((s, i) => <li key={i} className={s.status === 'running' ? 'running' : s.ok === false ? 'failed' : 'done'}>{stepText(s)}</li>)}</ol>}
      {live.partial && <p>{live.partial.slice(-300)}</p>}
    </div>}

    <form className="agent-run" onSubmit={(e) => { e.preventDefault(); if (requestText.trim()) act(() => runTaskAgent(agent.id, requestText.trim()).then(() => setRequestText(''))); }}>
      <textarea rows={2} value={requestText} onChange={(e) => setRequestText(e.target.value)} placeholder={`O que ${agent.name} deve fazer agora?`} aria-label={`Pedido para ${agent.name}`} disabled={!agent.enabled} />
      <button className="primary" disabled={running || !agent.enabled || !requestText.trim()}>Rodar agora</button>
    </form>
    {error && <p role="alert" className="memory-form-error">{error}</p>}

    {latest && <section className="agent-latest" aria-label="Última execução">
      <p><b>{STATUS[latest.status]}</b> · {when(latest.startedAt)} · {TRIGGER_LABEL[latest.trigger]}: “{latest.request.slice(0, 120)}{latest.request.length > 120 ? '…' : ''}”</p>
      {latest.status !== 'running' && latest.files.length > 0 && <DeliveredFiles files={latest.files} />}
      {latest.status === 'failed' && latest.error && <p className="agent-error">{latest.error.slice(0, 300)}</p>}
      {latest.conversationId && latest.status !== 'running' && <button type="button" className="link-button" onClick={() => onOpenConversation(latest.conversationId!)}>Ver a conversa completa</button>}
    </section>}

    <div className="agent-actions-row">
      <button type="button" onClick={() => (history ? setHistory(null) : void listTaskAgentRuns(agent.id).then(setHistory).catch((e: Error) => setError(e.message)))}>{history ? 'Fechar histórico' : 'Histórico'}</button>
      <button type="button" onClick={() => setEditing(!editing)}>{editing ? 'Cancelar' : 'Quando trabalha'}</button>
      <button type="button" onClick={() => act(() => updateTaskAgent(agent.id, { enabled: !agent.enabled }))}>{agent.enabled ? 'Desligar' : 'Ligar'}</button>
      <button type="button" className="danger" onClick={() => { if (window.confirm(`Apagar ${agent.name}? A pasta e os arquivos entregues continuam no disco.`)) act(() => deleteTaskAgent(agent.id)); }}>Apagar</button>
    </div>

    {editing && <form className="agent-edit" onSubmit={(e) => { e.preventDefault(); act(() => updateTaskAgent(agent.id, { trigger: triggerOf(trigger) }).then(() => setEditing(false))); }}>
      <TriggerEditor value={trigger} onChange={setTrigger} />
      <button className="primary">Salvar</button>
    </form>}

    {history && <ol className="agent-history" aria-label={`Histórico de ${agent.name}`}>
      {history.length === 0 && <li><small>Nenhuma execução ainda.</small></li>}
      {history.map((run) => <li key={run.id} className={run.status}>
        <p><b>{STATUS[run.status]}</b> · {when(run.startedAt)} · {TRIGGER_LABEL[run.trigger]}</p>
        <p className="agent-history-request">{run.request.slice(0, 200)}</p>
        {run.files.length > 0 && <DeliveredFiles files={run.files} />}
        {run.conversationId && run.status !== 'running' && <button type="button" className="link-button" onClick={() => onOpenConversation(run.conversationId!)}>Ver a conversa</button>}
      </li>)}
    </ol>}
  </article>;
}

const TEAM_STATUS: Record<Orchestration['status'], string> = { running: 'A equipe está trabalhando…', done: 'Tudo entregue', partial: 'Entregue em parte', failed: 'Não concluído' };

/** One big request split among the agents: the plan is shown (and editable) before anything runs. */
function TeamRequest({ agents, onOpenConversation }: { agents: TaskAgent[]; onOpenConversation: (id: string) => void }) {
  const [text, setText] = useState('');
  const [plan, setPlan] = useState<PlannedTask[] | null>(null);
  const [planner, setPlanner] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [latest, setLatest] = useState<Orchestration | null>(null);
  const refresh = useCallback(() => listOrchestrations().then((list) => setLatest(list[0] || null)).catch(() => {}), []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (latest?.status !== 'running') return undefined; const id = setInterval(() => void refresh(), 3000); return () => clearInterval(id); }, [latest?.status, refresh]);
  if (agents.filter((a) => a.enabled).length < 2) return null;

  const makePlan = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    planTeamRequest(text.trim()).then((r) => { setPlan(r.tasks); setPlanner(r.planner); if (!r.tasks.length) setError('Nenhum agente tem relação com esse pedido. Reescreva citando o setor ou o que cada um deve entregar.'); })
      .catch((err: Error) => setError(err.message)).finally(() => setBusy(false));
  };
  const run = () => {
    if (!plan?.length) return;
    setBusy(true); setError('');
    startTeamRequest(text.trim(), plan).then(() => { setPlan(null); setText(''); return refresh(); }).catch((err: Error) => setError(err.message)).finally(() => setBusy(false));
  };

  return <section className="team-request" aria-label="Pedido para a equipe">
    <h2>Pedido para a equipe</h2>
    <p>Um pedido grande (“feche o mês”, “prepare a reunião de segunda”) dividido entre os agentes. Você confere o plano antes de começar; no fim sai um resumo em Word com a entrega de cada um.</p>
    <form className="agent-run" onSubmit={makePlan}>
      <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex.: feche o mês de setembro: férias de outubro, inadimplentes acima de 30 dias e áreas acima do orçamento" aria-label="Pedido para a equipe" />
      <button className="primary" disabled={busy || text.trim().length < 10}>{busy && !plan ? 'Montando…' : 'Montar plano'}</button>
    </form>
    {error && <p role="alert" className="memory-form-error">{error}</p>}
    {plan && plan.length > 0 && <div className="team-plan" aria-label="Plano">
      <p><b>Plano</b> ({planner === 'modelo' ? 'feito pela Aurora' : 'pelos setores citados no pedido'}): confira e ajuste cada tarefa.</p>
      <ol>{plan.map((task, i) => <li key={task.agentId}>
        <b>{task.agentName}</b>{task.dependsOn?.length ? <small className="team-after"> · depois de {task.dependsOn.map((id) => plan.find((t) => t.agentId === id)?.agentName || 'outro agente').join(', ')}, usando o que ele entregar</small> : null}
        <textarea rows={2} value={task.request} aria-label={`Tarefa de ${task.agentName}`} onChange={(e) => setPlan(plan.map((t, k) => (k === i ? { ...t, request: e.target.value } : t)))} />
        <button type="button" className="link-button" onClick={() => setPlan(plan.filter((_, k) => k !== i).map((t) => ({ ...t, dependsOn: t.dependsOn?.filter((id) => id !== task.agentId) })))}>Tirar do plano</button>
      </li>)}</ol>
      <div className="agent-actions-row"><button className="primary" onClick={run} disabled={busy}>Executar plano</button><button onClick={() => setPlan(null)}>Cancelar</button></div>
    </div>}
    {latest && <div className="agent-latest team-latest" aria-label="Último pedido para a equipe">
      <p><b>{TEAM_STATUS[latest.status]}</b> · {when(latest.startedAt)} · “{latest.request.slice(0, 140)}{latest.request.length > 140 ? '…' : ''}”</p>
      {latest.summaryFile && <DeliveredFiles files={[latest.summaryFile]} />}
      {latest.results.length > 0 && <ul className="team-results">{latest.results.map((r) => <li key={r.agentId}>
        <p><b>{r.agentName}</b> · {r.status === 'done' ? (r.files.length ? 'entregue' : 'sem arquivo') : 'não concluída'}{r.error ? `: ${r.error.slice(0, 160)}` : ''}</p>
        {r.files.length > 0 && <DeliveredFiles files={r.files} />}
        {r.conversationId && <button type="button" className="link-button" onClick={() => onOpenConversation(r.conversationId!)}>Ver a conversa</button>}
      </li>)}</ul>}
      {latest.status === 'running' && <small>{latest.plan.map((t) => t.agentName).join(', ')} estão trabalhando.</small>}
    </div>}
  </section>;
}

const EMPTY: NewTaskAgent = { name: '', kind: 'pessoal', mission: '', department: '', workDir: '' };

/** Ready-made starting points: they only fill the form; the folder and the confirmation stay with the person. */
const TEMPLATES: { label: string; agent: Omit<NewTaskAgent, 'workDir'>; trigger: Partial<TriggerDraft>; hint: string }[] = [
  {
    label: 'Organizar Downloads',
    hint: 'Escolha a sua pasta Downloads como pasta de trabalho.',
    agent: { name: 'Organizador de Downloads', kind: 'pessoal', mission: 'Manter a pasta organizada: cada arquivo numa subpasta por tipo (Documentos, Imagens, Planilhas, Instaladores, Compactados, Outros). Nunca apagar nada.' },
    trigger: { type: 'at', at: '09:00', weekdays: [1], request: 'Organize os arquivos soltos desta pasta em subpastas por tipo, sem apagar nada, e diga o que moveu.' },
  },
  {
    label: 'Notas que chegam numa pasta',
    hint: 'Escolha a pasta de trabalho (onde fica a planilha) e a pasta observada (onde as notas chegam).',
    agent: { name: 'Leitor de notas', kind: 'pessoal', mission: 'Ler cada nota fiscal ou boleto que chegar e manter uma planilha com fornecedor, número, vencimento e valor.' },
    trigger: { type: 'file', pattern: '*.pdf', request: 'Leia o(s) arquivo(s) novo(s) e acrescente fornecedor, número, vencimento e valor à planilha notas.xlsx da sua pasta (crie se não existir).' },
  },
  {
    label: 'Pesquisador',
    hint: 'Escolha uma pasta para guardar os resumos.',
    agent: { name: 'Pesquisador', kind: 'pessoal', mission: 'Pesquisar na web o que for pedido e entregar um resumo em Word com as fontes (links) no fim.' },
    trigger: { type: 'manual' },
  },
];

export default function AgentsView({ onOpenConversation }: { onOpenConversation: (id: string) => void }) {
  const [agents, setAgents] = useState<TaskAgent[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<NewTaskAgent>(EMPTY);
  const [trigger, setTrigger] = useState(draftOf({ type: 'manual' }));
  const [sectorDir, setSectorDir] = useState('');
  const [templateHint, setTemplateHint] = useState('');

  const refresh = useCallback(() => listTaskAgents().then((r) => { setAgents(r.agents); setRuns(r.runs); setLoaded(true); }).catch((e: Error) => { setError(e.message); setLoaded(true); }), []);
  useEffect(() => { void refresh(); }, [refresh]);
  const anyRunning = runs.some((r) => r.status === 'running');
  // While someone works, the page follows it; otherwise a slow check picks up scheduled runs.
  useEffect(() => { const id = setInterval(() => void refresh(), anyRunning ? 3000 : 20000); return () => clearInterval(id); }, [anyRunning, refresh]);
  const runsOf = useMemo(() => (id: string) => runs.filter((r) => r.agentId === id), [runs]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    createTaskAgent({ ...draft, department: draft.kind === 'setor' ? draft.department : null, trigger: triggerOf(trigger) })
      .then(() => { setCreating(false); setDraft(EMPTY); setTrigger(draftOf({ type: 'manual' })); return refresh(); })
      .catch((err: Error) => setError(err.message));
  };

  return <section className="agents-view page-skin" aria-label="Agentes">
    <header className="page-header page-header-row">
      <div>
        <h1 className="page-title">Agentes</h1>
        <p className="page-desc">Funcionários da Aurora. Cada um tem uma missão e uma pasta de trabalho, e entrega arquivos: rode quando quiser, num horário ou quando chegar um arquivo numa pasta. Eles trabalham sozinhos na pasta deles e pedem sua autorização para o resto.</p>
      </div>
      <div className="agent-header-actions">
        {agents.length > 0 && <button onClick={() => void exportAgentRuns().catch((e: Error) => setError(e.message))} title="Todas as execuções, para conferência (abre no Excel)">Exportar histórico</button>}
        <button className="primary" onClick={() => setCreating(!creating)}>{creating ? 'Cancelar' : 'Novo agente'}</button>
      </div>
    </header>
    {error && <p role="alert" className="memory-form-error">{error}</p>}

    {creating && <form className="agent-new" onSubmit={submit} aria-label="Novo agente">
      <div className="agent-templates" role="group" aria-label="Modelos prontos">
        <small>Começar de um modelo:</small>
        {TEMPLATES.map((t) => <button type="button" key={t.label} onClick={() => { setDraft({ ...t.agent, workDir: draft.workDir }); setTrigger({ ...draftOf({ type: 'manual' }), ...t.trigger }); setTemplateHint(t.hint); }}>{t.label}</button>)}
      </div>
      {templateHint && <p className="agent-template-hint">{templateHint}</p>}
      <div className="agent-new-grid">
        <label>Nome <input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Agente Financeiro" /></label>
        <label>Tipo <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as NewTaskAgent['kind'] })}><option value="pessoal">Pessoal</option><option value="setor">Setor da empresa</option></select></label>
        {draft.kind === 'setor' && <label>Setor <input value={draft.department || ''} onChange={(e) => setDraft({ ...draft, department: e.target.value })} placeholder="Financeiro" /></label>}
      </div>
      <label className="grow">Missão <textarea required rows={3} value={draft.mission} onChange={(e) => setDraft({ ...draft, mission: e.target.value })} placeholder="Acompanhar contas a receber e gerar a lista de cobrança toda segunda." /></label>
      <div className="agent-trigger-row">
        <label className="grow">Pasta de trabalho <input required value={draft.workDir} onChange={(e) => setDraft({ ...draft, workDir: e.target.value })} placeholder="C:\Users\voce\Documents\Agentes\Financeiro" /></label>
        <button type="button" onClick={() => void pickFolder().then((f) => f && setDraft({ ...draft, workDir: f }))}>Escolher…</button>
      </div>
      <TriggerEditor value={trigger} onChange={setTrigger} />
      <button className="primary">Criar agente</button>
    </form>}

    {loaded && agents.length === 0 && !creating && <section className="agents-empty">
      <h2>Nenhum agente ainda</h2>
      <p>Crie um agente pessoal (organizar downloads, resumir relatórios) ou, se as pastas da empresa já estão em Configurações → Conhecimento, um agente para cada setor.</p>
      <form className="agent-trigger-row" onSubmit={(e) => { e.preventDefault(); setError(''); createSectorAgents(sectorDir).then(refresh).catch((err: Error) => setError(err.message)); }}>
        <label className="grow">Pasta onde os agentes de setor guardam as entregas <input required value={sectorDir} onChange={(e) => setSectorDir(e.target.value)} placeholder="C:\Users\voce\Documents\Agentes" /></label>
        <button type="button" onClick={() => void pickFolder().then((f) => f && setSectorDir(f))}>Escolher…</button>
        <button className="primary">Criar agentes por setor</button>
      </form>
    </section>}

    <TeamRequest agents={agents} onOpenConversation={onOpenConversation} />

    <div className="agent-list">
      {agents.map((agent) => <AgentCard key={agent.id} agent={agent} runs={runsOf(agent.id)} onChanged={() => void refresh()} onOpenConversation={onOpenConversation} />)}
    </div>
  </section>;
}
