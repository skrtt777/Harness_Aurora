import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getArtifacts, type Artifact, type ChatMessage, type ConversationWithMessages, type Project } from './api';
import LocalSetupPanel from './LocalSetupPanel';
import WorkflowPanel from './WorkflowPanel';
import ArtifactPanel from './ArtifactPanel';
import Markdown from './Markdown';

type Props = {
  conversation: ConversationWithMessages | null; project: Project | null; loading: boolean;
  sending: boolean; pendingStage: string | null; lastMemoryCreatedCount: number;
  onSend: (message: string) => Promise<boolean>; onCancel: () => void;
  onCorrect: (messageId: string, note: string) => Promise<void>; onRenameTitle: (title: string) => void;
};

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
      <div className="chat-content">{isUser ? message.content : parts}</div>
      {!isUser && <div className="message-actions">
        <button onClick={async () => {
          try { await navigator.clipboard.writeText(message.content); setFeedback('Resposta copiada'); }
          catch { setFeedback('Não foi possível copiar.'); }
        }}>Copiar</button>
        {correctable && <button onClick={() => setReview(value => !value)}>Revisar com <span className="provider-name">{teacher}</span></button>}
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
      }}><label>O que precisa melhorar?<textarea value={note} onChange={event => setNote(event.target.value)} placeholder="Descreva o ajuste que você precisa" disabled={busy} /></label>
        <small>Esta revisão usa {teacher}. Para ajustar com a IA atual, escreva no chat.</small>
        <div><button type="button" disabled={busy} onClick={() => setReview(false)}>Cancelar</button><button disabled={busy}>{busy ? 'Revisando…' : 'Pedir revisão'}</button></div>
      </form>}
      {feedback && <small role="status">{feedback}</small>}
    </div>
  </article>;
}

const drafts = new Map<string, string>();
export default function ChatView({ conversation, project, loading, sending, pendingStage, onSend, onCancel, onCorrect, onRenameTitle }: Props) {
  const [draftState, setDraftState] = useState(() => new Map(drafts));
  const draftId = conversation?.id || '';
  const draft = draftState.get(draftId) || '';
  const setDraft = (value: string, id = draftId) => { drafts.set(id, value); setDraftState(new Map(drafts)); };
  const [panel, setPanel] = useState<'files' | 'tools' | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fileError, setFileError] = useState('');
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
          <span className="conversation-provider provider-name">{provider}</span>
        </div>
        <div className="conversation-controls">
          <button ref={filesButton} className="quiet-button" aria-expanded={panel === 'files'} onClick={() => {
            if (panel === 'files') closePanel(); else { setSelectedId(selectedId || artifacts.at(-1)?.id || null); setPanel('files'); }
          }}>Arquivos{artifacts.length > 0 && <span className="file-count">{artifacts.length}</span>}</button>
          <button className="quiet-button" aria-label="Ajustes da conversa" title="Ajustes da conversa" aria-expanded={panel === 'tools'} onClick={() => setPanel(panel === 'tools' ? null : 'tools')}>•••</button>
        </div>
      </header>
      <LocalSetupPanel active={conversation.provider === 'local'} compact />
      <div className="chat-messages" ref={scrollRef}>
        {!conversation.messages.length ? <div className="chat-welcome"><div className="welcome-mark"><img className="aurora-symbol" src="/brand/aurora-symbol.png" alt="Símbolo Aurora" width="1254" height="1254" draggable={false} /></div><h1>O que vamos criar?</h1><p>Conte sua ideia. A Aurora ajuda a dar forma a ela.</p>
          <div className="starter-prompts">{['Criar um jogo', 'Montar um dashboard', 'Explorar uma ideia'].map(label => <button key={label} onClick={() => { setDraft(label === 'Criar um jogo' ? 'Crie um jogo em HTML que ' : label === 'Montar um dashboard' ? 'Crie um dashboard para ' : 'Quero explorar uma ideia: '); textareaRef.current?.focus(); }}>{label}<span>↗</span></button>)}</div>
        </div> : conversation.messages.map(message => <MessageBubble key={message.id} message={message} artifacts={artifacts.filter(file => file.messageId === message.id)} onOpen={openFile} teacher={conversation.teacherProvider === 'claude' ? 'Claude' : 'Codex'}
          correctable={!sending && conversation.provider === 'local' && message.provider?.startsWith('Local') === true && !conversation.messages.some(m => m.correctionOf === message.id)} onCorrect={onCorrect} />)}
        {sending && <div className="chat-message assistant pending" role="status" aria-label={/valid|test|verific|corrig/i.test(pendingStage || '') ? 'Aurora está conferindo a resposta' : 'Aurora está preparando a resposta'}><div className="chat-avatar" aria-hidden="true"><picture><source media="(prefers-reduced-motion: reduce)" srcSet="/brand/aurora-symbol.png" /><img className="aurora-symbol" src="/brand/aurora-thinking.gif" alt="" width="560" height="560" draggable={false} /></picture></div><div className="pending-response" aria-hidden="true"><span className="typing-dots"><span /><span /><span /></span></div></div>}
      </div>
      <div className="composer-area"><form className="chat-composer" onSubmit={event => { event.preventDefault(); void send(); }}>
        <textarea ref={textareaRef} aria-label="Mensagem para Aurora" placeholder="Peça à Aurora…" rows={1} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
          if (event.key === 'Escape' && composerExpanded) { event.preventDefault(); setComposerExpanded(false); }
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
        }} disabled={loading} />
        {sending ? <button type="button" className="cancel-send" aria-label="Parar resposta" title="Parar resposta" onClick={onCancel}>■</button> : <button type="submit" aria-label="Enviar mensagem" title="Enviar mensagem" disabled={loading || !draft.trim()}>↑</button>}
      </form><div className="composer-footer"><p className="composer-hint">Enter para enviar · Shift + Enter para uma nova linha</p><button type="button" className="composer-expand" aria-expanded={composerExpanded} onClick={() => { setComposerExpanded(value => !value); textareaRef.current?.focus(); }}>{composerExpanded ? '↙ Recolher campo' : '↗ Ampliar campo'}</button></div></div>
    </section>
    {panel === 'files' && <div className="artifact-panel-wrap">{fileError && <p role="alert" className="artifact-error">{fileError}<button onClick={() => setFileRetry(x => x + 1)}>Tentar novamente</button></p>}<ArtifactPanel conversationId={conversation.id} artifacts={artifacts} selectedId={selectedId} onSelect={setSelectedId} onClose={closePanel} /></div>}
    {panel === 'tools' && <aside className="conversation-tools" aria-label="Ajustes da conversa"><header className="artifact-heading"><strong>Ajustes da conversa</strong><button className="quiet-button" onClick={closePanel} aria-label="Fechar ajustes">✕</button></header>
      <p>Modelo atual: <span className="provider-name">{provider}</span></p><LocalSetupPanel active={conversation.provider === 'local'} />
      {conversation.provider === 'local' && <WorkflowPanel key={conversation.id} conversationId={conversation.id} />}
    </aside>}
  </div>;
}
