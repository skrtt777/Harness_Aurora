import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { droppedFilePath, getArtifacts, getProviders, getSettings, undoMessageMoves, updateSettings, warmLocalModel, type AgentMode, type AgentStep, type Artifact, type ChatMessage, type ConversationWithMessages, type PendingTurn, type PlanItem, type Project, type TeacherReview } from './api';
import LocalSetupPanel from './LocalSetupPanel';
import WorkflowPanel from './WorkflowPanel';
import ArtifactPanel from './ArtifactPanel';
import Markdown from './Markdown';
import Icon from './Icon';
import DeliveredFiles from './DeliveredFiles';

// Marco 6 backlog (docs/historico/ROADMAP_MELHORIAS.md): exportar uma conversa inteira, não
// só memórias — útil pra compartilhar um resultado sem abrir o app. Pura
// client-side (a conversa com mensagens já está inteira na página), mesma
// técnica de Blob+<a download> que MemoryView.tsx já usa pra memórias.
function slugifyTitle(title: string) {
  return (
    title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'conversa'
  );
}
function downloadBlob(content: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const roleLabel: Record<ChatMessage['role'], string> = { user: 'Você', assistant: 'Aurora', system: 'Sistema' };
function conversationToMarkdown(conversation: ConversationWithMessages) {
  const lines = [`# ${conversation.title}`, '', `Provedor: ${conversation.provider} · Exportado em ${new Date().toLocaleString('pt-BR')}`, ''];
  for (const m of conversation.messages) {
    lines.push(`**${roleLabel[m.role]}**${m.provider ? ` (${m.provider})` : ''} — ${new Date(m.createdAt).toLocaleString('pt-BR')}`, '', m.content, '');
  }
  return lines.join('\n');
}
function conversationToJson(conversation: ConversationWithMessages) {
  return JSON.stringify(
    {
      title: conversation.title,
      provider: conversation.provider,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages: conversation.messages.map((m) => ({ role: m.role, provider: m.provider, content: m.content, createdAt: m.createdAt })),
    },
    null,
    2,
  );
}
function exportConversation(conversation: ConversationWithMessages, format: 'md' | 'json') {
  const slug = slugifyTitle(conversation.title);
  if (format === 'md') downloadBlob(conversationToMarkdown(conversation), `${slug}.md`, 'text/markdown');
  else downloadBlob(conversationToJson(conversation), `${slug}.json`, 'application/json');
}

// What the Aurora does best for anyone, as ready starts (the old ones — a game, a dashboard — were a programmer's).
const STARTERS: [string, string][] = [
  ['Organizar meus Downloads', 'Organize a minha pasta Downloads por tipo de arquivo, sem apagar nada.'],
  ['Resumir um documento', 'Resuma este documento em tópicos: '],
  ['Criar uma planilha', 'Crie uma planilha com '],
  ['Pesquisar na internet', 'Pesquise na internet e me dê um resumo com as fontes sobre '],
];

const TOOL_LABELS: Record<string, string> = {
  browser_navigate: 'Abriu site', browser_snapshot: 'Olhou a página', browser_click: 'Clicou', browser_type: 'Digitou',
  browser_key: 'Apertou tecla', browser_scroll: 'Rolou a página', browser_read: 'Leu a página', browser_tabs: 'Abas',
  web_search: 'Pesquisou', web_fetch: 'Leu', open: 'Abriu', run_command: 'Rodou comando',
  list_dir: 'Listou pasta', read_file: 'Leu arquivo', write_file: 'Salvou arquivo', write_document: 'Criou documento', move_file: 'Moveu arquivo', edit_file: 'Editou arquivo',
  search_files: 'Procurou arquivos', grep: 'Procurou texto', command_output: 'Conferiu processo', command_stop: 'Encerrou processo',
  memory_search: 'Consultou memórias', memory_save: 'Guardou na memória', skill_search: 'Procurou skills', skill_use: 'Usou skill',
  skill_create: 'Criou skill', update_plan: 'Atualizou o plano', knowledge_search: 'Consultou documentos da empresa', knowledge_map: 'Consultou o mapa de documentos',
  computer_map: 'Consultou o mapa do computador', organize_folder: 'Organizou a pasta', knowledge_setup: 'Cadastrou documentos da empresa', agent_delegate: 'Pediu ao agente', team_request: 'Pediu à equipe',
};

const MODE_LABEL: Record<AgentMode, string> = { auto: 'Auto', manual: 'Manual', plan: 'Plano' };
const MODE_HINT: Record<AgentMode, string> = {
  auto: 'Age livremente na pasta do projeto; pergunta antes de apagar, instalar, usar a rede ou sair da pasta.',
  manual: 'Pergunta antes de toda alteração, comando ou programa aberto.',
  plan: 'Só olha e propõe: não altera nada.',
};

// Global agent mode, switchable right from the chat.
function AgentModeSelect() {
  const [mode, setMode] = useState<AgentMode | null>(null);
  useEffect(() => { getSettings().then(s => setMode(s.agentMode)).catch(() => {}); }, []);
  if (!mode) return null;
  return <label className="composer-pill" title={MODE_HINT[mode]}>
    <select aria-label="Modo do agente" value={mode} onChange={async event => { const next = event.target.value as AgentMode; setMode(next); await updateSettings({ agentMode: next }).catch(() => {}); }}>
      {(Object.keys(MODE_LABEL) as AgentMode[]).map(m => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
    </select>
    <Icon name="down" size={11} />
  </label>;
}

function ReviewNote({ review }: { review: TeacherReview }) {
  const teacher = review.teacher === 'claude' ? 'Claude' : 'Codex';
  const text = review.skipped === 'daily_limit' ? `Revisão de ${teacher} pulada: limite diário atingido.`
    : review.skipped === 'privacy' ? `Revisão de ${teacher} não enviada: a conversa usa documentos internos e você não autorizou.`
    : review.error ? `Não foi possível revisar com ${teacher}: ${review.error}`
    : review.verdict === 'ok' ? `Conferido por ${teacher}: aprovado.`
    : review.verdict === 'fix' ? `${teacher} encontrou ${review.problems?.length || 0} problema(s)${review.lessonIds?.length ? ` e ensinou ${review.lessonIds.length} lição(ões)` : ''}; a Aurora ${review.redo === 'ok' ? 'refez e corrigiu' : review.redo === 'com_erros' ? 'refez, mas ainda há erros' : 'não conseguiu refazer'}.` : '';
  if (!text) return null;
  return <details className={`teacher-review ${review.verdict || 'none'}`}><summary><span className="teacher-dot" aria-hidden="true" />{text}</summary>
    {!!review.problems?.length && <ul>{review.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
  </details>;
}

function PlanList({ plan }: { plan: PlanItem[] }) {
  return <ol className="agent-plan">{plan.map((item, index) => <li key={index} className={item.status}>{item.status === 'done' ? '☑' : item.status === 'in_progress' ? '▸' : '☐'} {item.text}</li>)}</ol>;
}

export function stepText(step: AgentStep) {
  const args = step.args || {};
  const detail = args.url ?? args.query ?? args.target ?? args.text ?? args.key ?? args.command ?? args.path ?? args.agent ?? args.ref ?? args.action ?? '';
  return `${TOOL_LABELS[step.tool] || step.tool}${detail ? ` ${String(detail).slice(0, 80)}` : ''}`;
}

function StepList({ steps }: { steps: AgentStep[] }) {
  return <ol className="agent-steps">{steps.map((step, index) => <li key={index} className={`agent-step ${step.status || (step.ok === false ? 'failed' : 'done')}`} title={step.summary || ''}>
    <span className="agent-step-icon" aria-hidden="true">{step.status === 'running' ? '…' : step.ok === false || step.status === 'failed' ? '✕' : '✓'}</span>{stepText(step)}
  </li>)}</ol>;
}

type Props = {
  conversation: ConversationWithMessages | null; project: Project | null; loading: boolean;
  sending: boolean; pendingStage: string | null; lastMemoryCreatedCount: number;
  pendingTurn?: PendingTurn | null; onResolveApproval?: (approvalId: string, approved: boolean, always?: boolean) => void;
  onSend: (message: string) => Promise<boolean>; onCancel: () => void;
  onCorrect: (messageId: string, note: string) => Promise<void>; onRenameTitle: (title: string) => void;
  onDuplicate: () => void;
};

/** "Moveu 12 arquivos · Desfazer" under an answer that organized a folder. */
function UndoChatMoves({ message }: { message: ChatMessage }) {
  const [done, setDone] = useState(message.execution?.movesUndoneAt ? 'Mudanças desfeitas.' : '');
  const moved = message.execution?.moves?.length ?? 0, edited = message.execution?.edits?.length ?? 0;
  const undo = () => {
    if (!window.confirm('Desfazer o que esta resposta mudou nos seus arquivos?')) return;
    undoMessageMoves(message.id)
      .then((r) => setDone(`Mudanças desfeitas: ${r.restored.length} voltaram${r.skipped.length ? `; ${r.skipped.length} ficaram (${r.skipped.map((x) => x.reason).join(', ')})` : ''}.`))
      .catch((e: Error) => setDone(e.message));
  };
  const text = moved && edited ? `Moveu ${moved} e editou ${edited} arquivo(s).` : moved ? `Moveu ${moved} arquivo(s).` : `Editou ${edited} arquivo(s).`;
  return <p className="chat-undo-moves">{done ? <small>{done}</small> : <><small>{text}</small> <button type="button" className="btn btn-text btn-sm" onClick={undo}>Desfazer</button></>}</p>;
}

function MessageBubble({ message, artifacts, onOpen, correctable, teacher, onCorrect }: {
  message: ChatMessage; artifacts: Artifact[]; onOpen: (id: string) => void;
  correctable: boolean; teacher: string; onCorrect: Props['onCorrect'];
}) {
  const [review, setReview] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const isUser = message.role === 'user';
  const parts = [];
  let offset = 0;
  for (const artifact of artifacts) {
    if (artifact.start > offset) parts.push(<Markdown key={`text-${offset}`}>{message.content.slice(offset, artifact.start)}</Markdown>);
    parts.push(<button className="artifact-card" key={artifact.id} onClick={() => onOpen(artifact.id)}>
      <span className="file-symbol">◇</span><span><strong>{artifact.name}</strong><small>{artifact.previewable ? 'Abrir visualização' : 'Abrir arquivo'}</small></span><span aria-hidden="true">↗</span>
    </button>);
    offset = artifact.end;
  }
  if (offset < message.content.length) parts.push(<Markdown key={`text-${offset}`}>{message.content.slice(offset)}</Markdown>);
  return <article className={`chat-message ${isUser ? 'user' : 'assistant'} ${message.provider === 'Sistema' ? 'system' : ''}`} aria-label={isUser ? 'Você' : 'Aurora'}>
    {!isUser && <div className="chat-avatar" aria-hidden="true"><img className="aurora-symbol" src="/brand/aurora-symbol.png" alt="" width="1254" height="1254" draggable={false} /></div>}
    <div className="chat-bubble-wrap">
      {!isUser && (message.execution?.toolSteps?.length ?? 0) > 0 && <details className="agent-actions"><summary>{message.execution!.toolSteps!.length} {message.execution!.toolSteps!.length === 1 ? 'ação executada' : 'ações executadas'}</summary><StepList steps={message.execution!.toolSteps!} /></details>}
      {!isUser && message.execution?.review && <ReviewNote review={message.execution.review} />}
      <div className="chat-content">{isUser ? message.content : parts}</div>
      {!isUser && <DeliveredFiles steps={message.execution?.toolSteps || []} />}
      {!isUser && ((message.execution?.moves?.length ?? 0) + (message.execution?.edits?.length ?? 0)) > 0 && <UndoChatMoves message={message} />}
      {!isUser && <div className="message-actions">
        <button className="btn btn-text btn-sm" onClick={async () => {
          try { await navigator.clipboard.writeText(message.content); setFeedback('Resposta copiada'); }
          catch { setFeedback('Não foi possível copiar.'); }
        }}><Icon name="copy" size={13} /> Copiar</button>
        {correctable && <button className="btn btn-text btn-sm" onClick={() => setReview(value => !value)}>Revisar com {teacher}</button>}
        {(message.execution?.context?.skills?.length ?? 0) > 0 && <span className="used-skills" aria-label="Skills usadas nesta resposta">
          {message.execution!.context!.skills!.map(s => <span key={s.id} className="skill-chip" title={s.partial ? `Skill "${s.name}" — trecho relevante usado` : `Skill "${s.name}" — texto completo usado`}>🧩 {s.name}</span>)}
        </span>}
        <details><summary>Detalhes</summary><p><span className="provider-name">{message.provider || 'Aurora'}</span> · {new Date(message.createdAt).toLocaleString('pt-BR')}</p>
          <p>{message.memoryAccess.length} memórias consultadas · {message.memoryCreated.length} criadas</p>
          {message.memoryStatus === 'pending' && <p>Salvando aprendizados…</p>}
          {['failed', 'interrupted'].includes(message.memoryStatus || '') && <p>Os aprendizados desta resposta não foram salvos.</p>}
        </details>
      </div>}
      {review && <form className="review-form" onSubmit={async event => {
        event.preventDefault(); setBusy(true); setFeedback('');
        try { await onCorrect(message.id, note); setReview(false); setNote(''); }
        catch (error) { setFeedback(error instanceof Error ? error.message : 'Falha ao revisar.'); }
        finally { setBusy(false); }
      }}><label>O que precisa melhorar?<textarea className="field" value={note} onChange={event => setNote(event.target.value)} placeholder="Descreva o ajuste que você precisa" disabled={busy} /></label>
        <small>Esta revisão usa {teacher}. Para ajustar com a IA atual, escreva no chat.</small>
        <div><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setReview(false)}>Cancelar</button><button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Revisando…' : 'Pedir revisão'}</button></div>
      </form>}
      {feedback && <small role="status">{feedback}</small>}
    </div>
  </article>;
}

const drafts = new Map<string, string>();
export default function ChatView({ conversation, project, loading, sending, pendingStage, pendingTurn, onResolveApproval, onSend, onCancel, onCorrect, onRenameTitle, onDuplicate }: Props) {
  const [draftState, setDraftState] = useState(() => new Map(drafts));
  const draftId = conversation?.id || '';
  const draft = draftState.get(draftId) || '';
  const setDraft = (value: string, id = draftId) => { drafts.set(id, value); setDraftState(new Map(drafts)); };
  const [panel, setPanel] = useState<'files' | 'tools' | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  // "Revisar com Codex/Claude" only when that program is there: without it the click was just an error.
  const [teachers, setTeachers] = useState<Record<string, boolean> | null>(null);
  useEffect(() => { void getProviders().then((list) => setTeachers(Object.fromEntries(list.map((p) => [p.id, p.configured])))).catch(() => {}); }, []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fileError, setFileError] = useState('');
  const [dropping, setDropping] = useState(false);
  const [dropNote, setDropNote] = useState('');
  const [fileRetry, setFileRetry] = useState(0);
  const [editingTitle, setEditingTitle] = useState(false);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const filesButton = useRef<HTMLButtonElement>(null);
  const knownArtifacts = useRef<{ conversationId: string; ids: Set<string> } | null>(null);
  const closePanel = useCallback(() => { setPanel(null); filesButton.current?.focus(); }, []);
  const artifactSignature = useMemo(() => conversation?.messages.filter(m => m.role === 'assistant').map(m => m.id).join('|') || '', [conversation?.messages]);

  useEffect(() => {
    setPanel(null); setArtifacts([]); setSelectedId(null); setFileError(''); setEditingTitle(false); setComposerExpanded(false);
    setTitleDraft(conversation?.title || ''); knownArtifacts.current = null;
  }, [conversation?.id]);
  useEffect(() => {
    if (!conversation) return;
    let stale = false;
    const id = conversation.id;
    getArtifacts(id).then(files => {
      if (stale) return;
      setArtifacts(files); setFileError('');
      const previous = knownArtifacts.current;
      const fresh = previous?.conversationId === id ? files.filter(file => !previous.ids.has(file.id)) : [];
      if (fresh.length) { setSelectedId(fresh[fresh.length - 1].id); setPanel('files'); }
      knownArtifacts.current = { conversationId: id, ids: new Set(files.map(file => file.id)) };
    }).catch(error => { if (!stale) setFileError(error.message); });
    return () => { stale = true; };
  }, [conversation?.id, artifactSignature, fileRetry]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [conversation?.messages.length, sending, artifacts.length]);
  useEffect(() => {
    const input = textareaRef.current;
    if (!input) return;
    const resize = () => {
      input.style.height = composerExpanded ? '100%' : 'auto';
      if (!composerExpanded) input.style.height = `${Math.min(window.innerHeight * .52, input.scrollHeight)}px`;
    };
    resize();
    let width = input.clientWidth;
    const observer = new ResizeObserver(() => {
      if (input.clientWidth !== width) { width = input.clientWidth; resize(); }
    });
    observer.observe(input);
    window.addEventListener('resize', resize);
    return () => { observer.disconnect(); window.removeEventListener('resize', resize); };
  }, [draft, composerExpanded, conversation?.id]);
  if (!conversation) return <section className="chat-page chat-empty-state"><h1>{loading ? 'Abrindo conversa…' : 'Vamos criar algo?'}</h1><p>{!loading && 'Abra uma nova conversa para começar.'}</p></section>;

  const openFile = (id: string) => { setSelectedId(id); setPanel('files'); };
  const send = async () => {
    const message = draft.trim(); if (!message || sending) return;
    const id = conversation.id; setDraft('', id); setComposerExpanded(false);
    const ok = await onSend(message);
    if (!ok && !drafts.get(id)) setDraft(message, id);
    textareaRef.current?.focus();
  };
  const provider = conversation.provider === 'local' ? 'Local' : conversation.provider === 'claude' ? 'Claude' : 'Codex';
  return <div className={`conversation-workspace ${panel ? 'with-panel' : ''} ${composerExpanded ? 'composer-expanded' : ''}`}>
    <section className="chat-page">
      <header className="chat-page-head">
        <div className="conversation-heading">
          {project && <span className="conversation-project">{project.name}</span>}
          {editingTitle ? <form onSubmit={event => { event.preventDefault(); onRenameTitle(titleDraft.trim() || conversation.title); setEditingTitle(false); }}>
            <input autoFocus aria-label="Título da conversa" className="title-input" value={titleDraft} onChange={event => setTitleDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setEditingTitle(false); }} onBlur={() => setEditingTitle(false)} />
          </form> : <button className="conversation-title" onClick={() => { setTitleDraft(conversation.title); setEditingTitle(true); }} title="Renomear conversa">{conversation.title}</button>}
          <span className="badge">{provider}</span>
        </div>
        <div className="conversation-controls">
          <button ref={filesButton} className="btn btn-ghost btn-sm" aria-expanded={panel === 'files'} onClick={() => {
            if (panel === 'files') closePanel(); else { setSelectedId(selectedId || artifacts.at(-1)?.id || null); setPanel('files'); }
          }}><Icon name="folder" size={14} /> Arquivos{artifacts.length > 0 && <span className="sb-count">{artifacts.length}</span>}</button>
          <button className="btn-icon" aria-label="Ajustes da conversa" aria-expanded={panel === 'tools'} onClick={() => setPanel(panel === 'tools' ? null : 'tools')}><Icon name="more" size={18} /></button>
        </div>
      </header>
      <LocalSetupPanel active={conversation.provider === 'local'} compact />
      <div className="chat-messages" ref={scrollRef}>
        {!conversation.messages.length ? <div className="chat-welcome"><div className="welcome-mark"><img className="aurora-symbol" src="/brand/aurora-symbol.png" alt="Símbolo Aurora" width="1254" height="1254" draggable={false} /></div><h1>O que vamos fazer hoje?</h1><p>Peça do seu jeito. A Aurora organiza seus arquivos, cria documentos e planilhas e pesquisa para você.</p>
          <div className="starter-prompts">{STARTERS.map(([label, text]) => <button key={label} onClick={() => { setDraft(text); textareaRef.current?.focus(); }}>{label}<span>↗</span></button>)}</div>
        </div> : conversation.messages.map(message => <MessageBubble key={message.id} message={message} artifacts={artifacts.filter(file => file.messageId === message.id)} onOpen={openFile} teacher={conversation.teacherProvider === 'claude' ? 'Claude' : 'Codex'}
          correctable={!sending && teachers?.[conversation.teacherProvider === 'claude' ? 'claude' : 'codex'] !== false && conversation.provider === 'local' && message.provider?.startsWith('Local') === true && !conversation.messages.some(m => m.correctionOf === message.id)} onCorrect={onCorrect} />)}
        {sending && <div className="chat-message assistant pending" role="status" aria-label={/valid|test|verific|corrig/i.test(pendingStage || '') ? 'Aurora está conferindo a resposta' : 'Aurora está preparando a resposta'}><div className="chat-avatar" aria-hidden="true"><picture><source media="(prefers-reduced-motion: reduce)" srcSet="/brand/aurora-symbol.png" /><img className="aurora-symbol" src="/brand/aurora-thinking.gif" alt="" width="560" height="560" draggable={false} /></picture></div><div className="pending-response">
          {pendingTurn?.plan && <PlanList plan={pendingTurn.plan} />}
          {(pendingTurn?.steps.length ?? 0) > 0 && <StepList steps={pendingTurn!.steps} />}
          {/* The answer as the local model writes it; the final message replaces it. */}
          {!pendingTurn?.approval && pendingTurn?.partial && <div className="chat-content pending-partial"><Markdown>{pendingTurn.partial}</Markdown></div>}
          {pendingTurn?.approval ? <div className="agent-approval" role="alertdialog" aria-label="Autorização necessária">
            <p>A Aurora quer {pendingTurn.approval.tool === 'run_command' ? 'executar este comando' : 'fazer isto'}:</p>
            <code>{pendingTurn.approval.summary}</code>
            {pendingTurn.approval.detail && <small>{pendingTurn.approval.detail}</small>}
            <div className="agent-approval-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => onResolveApproval?.(pendingTurn.approval!.id, false)}>Negar</button>{pendingTurn.approval.rule && <button type="button" className="btn btn-sm" title="Não perguntar de novo para comandos que começam assim" onClick={() => onResolveApproval?.(pendingTurn.approval!.id, true, true)}>Sempre permitir “{pendingTurn.approval.rule}”</button>}<button type="button" className="btn btn-primary btn-sm" onClick={() => onResolveApproval?.(pendingTurn.approval!.id, true)}>Permitir</button></div>
          </div> : <span className="pending-stage">{pendingStage && pendingStage !== 'Gerando resposta…' && <small>{pendingStage}</small>}<span className="typing-dots" aria-hidden="true"><span /><span /><span /></span></span>}
        </div></div>}
      </div>
      <div className="composer-area"><form className={`chat-composer ${dropping ? 'is-dropping' : ''}`} onSubmit={event => { event.preventDefault(); void send(); }}
        onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDropping(true); } }}
        onDragLeave={() => setDropping(false)}
        onDrop={event => {
          if (!event.dataTransfer.files.length) return;
          event.preventDefault(); setDropping(false);
          // The path goes into the message in quotes: the Aurora reads the file along with the request.
          const paths = [...event.dataTransfer.files].map(droppedFilePath).filter(Boolean);
          if (!paths.length) { setDropNote('Arrastar arquivos funciona no aplicativo da Aurora.'); return; }
          setDropNote('');
          setDraft(`${draft}${draft && !/\s$/.test(draft) ? ' ' : ''}${paths.map(p => `"${p}"`).join(' ')} `);
          textareaRef.current?.focus();
        }}>
        {dropping && <div className="composer-drop" aria-hidden="true">Solte para a Aurora usar este arquivo</div>}
        <textarea ref={textareaRef} aria-label="Mensagem para Aurora" placeholder="Peça à Aurora…" rows={1} value={draft} onChange={event => { setDraft(event.target.value); if (conversation.provider === 'local' && event.target.value.trim()) warmLocalModel(); }} onKeyDown={event => {
          if (event.key === 'Escape' && composerExpanded) { event.preventDefault(); setComposerExpanded(false); }
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
        }} disabled={loading} />
        <div className="composer-toolbar">
          <AgentModeSelect />
          <span className="composer-hint">{dropNote || "Enter envia · Shift + Enter quebra linha · arraste um arquivo para usá-lo"}</span>
          <button type="button" className="btn-icon" aria-label={composerExpanded ? 'Recolher campo' : 'Ampliar campo'} aria-expanded={composerExpanded} onClick={() => { setComposerExpanded(value => !value); textareaRef.current?.focus(); }}><Icon name={composerExpanded ? 'collapse' : 'expand'} size={14} /></button>
          {sending ? <button type="button" className="composer-send stop" aria-label="Parar resposta" onClick={onCancel}><span className="stop-square" /></button> : <button type="submit" className="composer-send" aria-label="Enviar mensagem" disabled={loading || !draft.trim()}><Icon name="send" size={15} /></button>}
        </div>
      </form></div>
    </section>
    {panel === 'files' && <div className="artifact-panel-wrap">{fileError && <p role="alert" className="artifact-error">{fileError}<button onClick={() => setFileRetry(x => x + 1)}>Tentar novamente</button></p>}<ArtifactPanel conversationId={conversation.id} artifacts={artifacts} selectedId={selectedId} onSelect={setSelectedId} onClose={closePanel} /></div>}
    {panel === 'tools' && <aside className="conversation-tools" aria-label="Ajustes da conversa"><header className="artifact-heading"><strong>Ajustes da conversa</strong><button className="quiet-button" onClick={closePanel} aria-label="Fechar ajustes">✕</button></header>
      <p>Modelo atual: <span className="provider-name">{provider}</span></p><LocalSetupPanel active={conversation.provider === 'local'} />
      <div className="export-conversation">
        <p className="export-conversation-label">Exportar esta conversa</p>
        <div className="export-conversation-actions">
          <button onClick={() => exportConversation(conversation, 'md')}><Icon name="download" size={13} /> Markdown</button>
          <button onClick={() => exportConversation(conversation, 'json')}><Icon name="download" size={13} /> JSON</button>
        </div>
      </div>
      <div className="export-conversation">
        <p className="export-conversation-label">Recomeçar do zero, mantendo esta conversa como referência</p>
        <div className="export-conversation-actions">
          <button onClick={onDuplicate}><Icon name="copy" size={13} /> Duplicar conversa</button>
        </div>
      </div>
      {conversation.provider === 'local' && <WorkflowPanel key={conversation.id} conversationId={conversation.id} />}
    </aside>}
  </div>;
}
