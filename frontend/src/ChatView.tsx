import { useEffect, useRef, useState } from "react";
import type { ChatMessage, ConversationWithMessages, Project } from "./api";
import { openExternalUrl, runSandbox } from "./api";
import LocalSetupPanel from "./LocalSetupPanel";

/**
 * A quick, client-side "does this look worth offering a Executar button
 * for" check — deliberately looser than the backend's real extraction
 * (app/sandboxCode.js), which is the one that actually decides what gets
 * saved and run. This only decides whether to show the button at all, so a
 * false positive here just means a button that reports "nenhum código
 * executável" when clicked, not a wrong preview.
 */
function looksRunnable(content: string) {
  return /```html|```(?:javascript|js)\b|<html[\s>]|<script(?![^>]*\bsrc=)[^>]*>/i.test(content || "");
}

function SandboxPanel({ conversationId, messageId }: { conversationId: string; messageId: string }) {
  const [state, setState] = useState<"idle" | "running" | "error">("idle");
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);

  const execute = async () => {
    setState("running");
    setError("");
    try {
      const result = await runSandbox(conversationId, messageId);
      setPreviewUrl(`${result.previewUrl}?t=${Date.now()}`);
      setFilePath(result.filePath);
      setState("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao executar o código.");
      setState("error");
    }
  };

  return (
    <div className="sandbox-panel">
      <div className="sandbox-actions">
        <button onClick={execute} disabled={state === "running"}>
          {state === "running" ? "Executando…" : previewUrl ? "▶ Executar de novo" : "▶ Executar"}
        </button>
        {previewUrl && (
          <button className="link-button" onClick={() => openExternalUrl(`${window.location.origin}${previewUrl}`)}>
            Abrir no navegador
          </button>
        )}
      </div>
      {error && <p className="memory-form-error">{error}</p>}
      {filePath && <small className="sandbox-filepath">Salvo em: {filePath}</small>}
      {previewUrl && (
        <iframe
          className="sandbox-preview"
          src={previewUrl}
          title="Preview do código executado"
          sandbox="allow-scripts allow-same-origin allow-pointer-lock"
        />
      )}
    </div>
  );
}

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
  conversationId,
  providerLabel,
  correctable,
  onCorrect,
}: {
  message: ChatMessage;
  conversationId: string;
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
  const [correctionError, setCorrectionError] = useState("");

  const submitCorrection = async () => {
    setSendingCorrection(true);
    setCorrectionError("");
    try {
      await onCorrect(message.id, note.trim());
      setCorrecting(false);
      setNote("");
    } catch (err) {
      setCorrectionError(
        err instanceof Error ? err.message : "Não foi possível corrigir essa resposta. Tente de novo.",
      );
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
        {!isUser && !isSystem && looksRunnable(message.content) && (
          <SandboxPanel conversationId={conversationId} messageId={message.id} />
        )}
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
                {sendingCorrection && (
                  <small className="correct-hint">O professor (Codex/Claude) está revisando — pode levar até 1 minuto.</small>
                )}
                {correctionError && <p className="memory-form-error">{correctionError}</p>}
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

      <LocalSetupPanel active={conversation.provider === "local"} />

      <div className="chat-messages" ref={scrollRef}>
        {conversation.messages.length ? (
          conversation.messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              conversationId={conversation.id}
              providerLabel={providerLabel}
              correctable={correctable}
              onCorrect={onCorrect}
            />
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
