import { useEffect, useRef, useState } from "react";
import type { ChatMessage, ConversationWithMessages, Project } from "./api";

type Props = {
  conversation: ConversationWithMessages | null;
  project: Project | null;
  loading: boolean;
  sending: boolean;
  pendingStage: string | null;
  lastMemoryCreatedCount: number;
  onSend: (message: string) => void;
  onCancel: () => void;
  onCorrect: (messageId: string, note: string) => Promise<void>;
  onRenameTitle: (title: string) => void;
};

function MessageBubble({
  message,
  providerLabel,
  correctable,
  onCorrect,
}: {
  message: ChatMessage;
  providerLabel: string;
  correctable: boolean;
  onCorrect: (messageId: string, note: string) => Promise<void>;
}) {
  const isUser = message.role === "user";
  const isSystem = message.provider === "Sistema";
  const isCorrection = (message.provider || "").includes("corrigindo");
  const [correcting, setCorrecting] = useState(false);
  const [note, setNote] = useState("");
  const [sendingCorrection, setSendingCorrection] = useState(false);

  const submitCorrection = async () => {
    setSendingCorrection(true);
    try {
      await onCorrect(message.id, note.trim());
      setCorrecting(false);
      setNote("");
    } finally {
      setSendingCorrection(false);
    }
  };

  return (
    <div className={`chat-message ${message.role} ${isSystem ? "system" : ""}`}>
      <div className="chat-avatar">{isUser ? "EU" : "✦"}</div>
      <div className="chat-bubble-wrap">
        <div className="chat-meta">
          {isUser ? "VOCÊ" : message.provider || providerLabel} · {new Date(message.createdAt).toLocaleString("pt-BR")}
        </div>
        <div className="chat-content">{message.content}</div>
        {!isUser && (message.memoryAccess.length > 0 || message.memoryCreated.length > 0) && (
          <div className="memory-footnote">
            {message.memoryAccess.length > 0 && (
              <span className="memory-chip" title="Memórias lidas para gerar esta resposta">
                📖 {message.memoryAccess.length} memória{message.memoryAccess.length > 1 ? "s" : ""} usada
                {message.memoryAccess.length > 1 ? "s" : ""}
              </span>
            )}
            {message.memoryCreated.length > 0 && (
              <span className="memory-chip new" title="Novas memórias salvas a partir desta troca">
                ✦ {message.memoryCreated.length} nova{message.memoryCreated.length > 1 ? "s" : ""} salva
                {message.memoryCreated.length > 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}
        {!isUser && correctable && !isSystem && !isCorrection && (
          <div className="correct-box">
            {correcting ? (
              <>
                <textarea
                  autoFocus
                  rows={2}
                  placeholder="O que estava errado? (opcional)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={sendingCorrection}
                />
                <div className="correct-actions">
                  <button onClick={() => setCorrecting(false)} disabled={sendingCorrection}>
                    Cancelar
                  </button>
                  <button className="primary" onClick={submitCorrection} disabled={sendingCorrection}>
                    {sendingCorrection ? "Corrigindo…" : "Enviar correção"}
                  </button>
                </div>
              </>
            ) : (
              <button className="correct-toggle" onClick={() => setCorrecting(true)}>
                🔧 Corrigir
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChatView({
  conversation,
  project,
  loading,
  sending,
  pendingStage,
  onSend,
  onCancel,
  onCorrect,
  onRenameTitle,
}: Props) {
  const [draft, setDraft] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(conversation?.title || "");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTitleDraft(conversation?.title || "");
  }, [conversation?.id, conversation?.title]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [conversation?.messages.length, sending]);

  if (!conversation) {
    return (
      <section className="chat-page chat-empty-state">
        <div className="chat-empty">
          <div className="empty-glyph">✦</div>
          <h1>Comece uma nova conversa</h1>
          <p>Escolha “Nova conversa” na barra lateral ou selecione uma conversa existente.</p>
        </div>
      </section>
    );
  }

  const send = () => {
    const message = draft.trim();
    if (!message || sending) return;
    onSend(message);
    setDraft("");
  };

  const providerLabel =
    conversation.provider === "claude" ? "Claude" : conversation.provider === "local" ? "Local" : "Codex";
  const correctable = conversation.provider === "local";

  return (
    <section className="chat-page">
      <div className="chat-page-head">
        <div>
          {project && <div className="project-badge">◈ {project.name}</div>}
          {editingTitle ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onRenameTitle(titleDraft.trim() || conversation.title);
                setEditingTitle(false);
              }}
            >
              <input
                autoFocus
                className="title-input"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => {
                  onRenameTitle(titleDraft.trim() || conversation.title);
                  setEditingTitle(false);
                }}
              />
            </form>
          ) : (
            <h1 onClick={() => setEditingTitle(true)} title="Clique para renomear">
              {conversation.title}
            </h1>
          )}
          <p>Memória própria desta conversa · lida e atualizada a cada resposta</p>
        </div>
      </div>

      <div className="chat-messages" ref={scrollRef}>
        {conversation.messages.length ? (
          conversation.messages.map((m) => (
            <MessageBubble key={m.id} message={m} providerLabel={providerLabel} correctable={correctable} onCorrect={onCorrect} />
          ))
        ) : (
          <div className="chat-empty">
            Comece uma nova conversa com o {providerLabel}.
            <br />
            <small>O histórico e a memória desta conversa serão salvos automaticamente.</small>
          </div>
        )}
        {sending && (
          <div className="chat-message assistant pending">
            <div className="chat-avatar">✦</div>
            <div className="chat-bubble-wrap">
              <div className="chat-meta">{providerLabel.toUpperCase()} · {pendingStage || "pensando…"}</div>
              <div className="chat-content typing-dots">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="chat-composer">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Escreva uma mensagem…"
          rows={2}
          disabled={loading || sending}
        />
        {sending ? (
          <button className="cancel-send" onClick={onCancel}>
            ✕ Cancelar
          </button>
        ) : (
          <button onClick={send} disabled={loading || !draft.trim()}>
            Enviar ↗
          </button>
        )}
      </div>
    </section>
  );
}
