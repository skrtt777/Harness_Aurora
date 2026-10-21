import { useEffect, useRef, useState } from "react";
import { createConversation, getConversation, getPendingTurn, listConversations, sendMessage, type ChatMessage, type Conversation } from "../api";
import Markdown from "../Markdown";

/**
 * Talk to the Aurora without leaving the Mapa Vivo: the same conversations as the chat, the answer as it is
 * being made (its real stage), and under each answer the memories it really used and created — a click goes
 * to the memory on the map.
 */
type Chip = { id: string; title: string; kind: "used" | "created" };
type Shown = ChatMessage & { chips?: Chip[] };
type Props = { open: boolean; onToggle: () => void; onGoTo: (id: string) => void; onConversation: (id: string | null) => void;
  /** The map's folder filter: a new conversation started here belongs to it (its memories are searched). */
  projectId?: string | null };

const KEY = "aurora-livemap-conversation";

export default function ChatDock({ open, onToggle, onGoTo, onConversation, projectId }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(() => { try { return localStorage.getItem(KEY); } catch { return null; } });
  const [messages, setMessages] = useState<Shown[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState("");
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => { void listConversations().then((c) => setConversations(c)).catch(() => {}); }, []);
  useEffect(() => {
    try { if (conversationId) localStorage.setItem(KEY, conversationId); } catch { /* private mode */ }
    onConversation(conversationId);
    if (!conversationId) { setMessages([]); return; }
    void getConversation(conversationId).then((c) => setMessages(c.messages.filter((m) => m.role !== "system").slice(-16))).catch(() => { setConversationId(null); });
  }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [messages, stage]);

  // While the answer is being made: its real stage (the same one the chat shows).
  useEffect(() => {
    if (!busy || !conversationId) return undefined;
    const id = window.setInterval(() => { void getPendingTurn(conversationId).then((t) => setStage(t.stage)).catch(() => {}); }, 700);
    return () => window.clearInterval(id);
  }, [busy, conversationId]);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setError(""); setDraft(""); setBusy(true); setStage("Começando…");
    let id = conversationId;
    try {
      if (!id) {
        const created = await createConversation({ provider: "local", title: text.slice(0, 48), projectId: projectId || null });
        id = created.id;
        setConversations((c) => [created, ...c]);
        setConversationId(id);
      }
      setMessages((m) => [...m, { id: `local-${Date.now()}`, conversationId: id!, role: "user", content: text } as Shown]);
      const result = await sendMessage(id, text);
      if (!result.ok || !result.message) { setError(result.error || "A Aurora não conseguiu responder."); return; }
      const chips: Chip[] = [
        ...(result.memoryAccess || []).map((m) => ({ id: m.id, title: m.title, kind: "used" as const })),
        ...(result.memoryCreated || []).map((m) => ({ id: m.id, title: m.title, kind: "created" as const })),
      ];
      setMessages((m) => [...m, { ...result.message!, chips }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao enviar.");
    } finally {
      setBusy(false); setStage(null);
    }
  };

  if (!open) return <button className="lm-dock-open" onClick={onToggle} aria-label="Abrir a conversa">conversar com a Aurora</button>;
  return (
    <aside className="lm-dock" aria-label="Conversa com a Aurora">
      <header>
        <select aria-label="Conversa" value={conversationId || ""} onChange={(e) => setConversationId(e.target.value || null)}>
          <option value="">{projectId ? "nova conversa nesta pasta" : "nova conversa"}</option>
          {conversations.slice(0, 60).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <button className="lm-x" onClick={onToggle} aria-label="Recolher a conversa">−</button>
      </header>
      <div className="lm-dock-list" ref={list} aria-live="polite">
        {messages.length === 0 && <p className="lm-muted">Pergunte algo. As memórias que a Aurora consultar e criar acendem no mapa enquanto ela responde.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`lm-msg ${m.role}`}>
            {m.role === "assistant" ? <Markdown>{m.content}</Markdown> : <p>{m.content}</p>}
            {m.chips && m.chips.length > 0 && (
              <div className="lm-chips-mem">
                {m.chips.slice(0, 8).map((c) => <button key={`${c.kind}-${c.id}`} className={c.kind} onClick={() => onGoTo(c.id)} title={c.kind === "used" ? "Memória consultada nesta resposta" : "Memória criada nesta resposta"}>{c.kind === "used" ? "usou" : "criou"} · {c.title}</button>)}
                {m.chips.length > 8 && <span className="lm-muted">+{m.chips.length - 8}</span>}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="lm-msg assistant pending"><span className="lm-stage">{stage || "Pensando…"}</span></div>}
      </div>
      {error && <p className="lm-dock-error" role="alert">{error}</p>}
      <form onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <textarea rows={2} value={draft} placeholder="Mensagem para a Aurora (Enter envia)" aria-label="Mensagem" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} disabled={busy} />
        <button className="lm-btn" disabled={busy || !draft.trim()}>{busy ? "…" : "enviar"}</button>
      </form>
    </aside>
  );
}
