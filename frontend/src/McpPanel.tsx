import { useEffect, useState } from "react";
import { getMcp, saveMcp, type McpServer, type McpStatus } from "./api";

/**
 * Extensions (MCP servers): ready-made connectors to e-mail, calendar, Notion… The agent gets their
 * tools; one that changes something always asks first, and what they return counts as content
 * from outside (a command afterwards asks too).
 */
export default function McpPanel() {
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [status, setStatus] = useState<McpStatus[]>([]);
  const [draft, setDraft] = useState({ name: "", line: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { getMcp().then((r) => { setServers(r.servers); setStatus(r.status); }).catch((e: Error) => setError(e.message)); }, []);

  const save = (next: McpServer[]) => {
    setBusy(true); setError("");
    saveMcp(next).then((r) => { setServers(r.servers); setStatus(r.status); }).catch((e: Error) => setError(e.message)).finally(() => setBusy(false));
  };
  const add = () => {
    const [command, ...args] = draft.line.trim().match(/"[^"]*"|\S+/g)?.map((p) => p.replace(/^"|"$/g, "")) || [];
    if (!draft.name.trim() || !command) { setError("Dê um nome e o comando do servidor."); return; }
    save([...(servers || []), { name: draft.name.trim(), command, args, enabled: true }]);
    setDraft({ name: "", line: "" });
  };

  return <div className="section" aria-label="Extensões (MCP)">
    <h3 className="section-title">Extensões (MCP)</h3>
    <p className="section-desc">Conecte a Aurora a outros serviços (e-mail, agenda, Notion, bancos de dados) com servidores MCP prontos. Ações que alteram algo sempre pedem sua autorização.</p>
    {servers === null && !error && <p className="muted">Carregando…</p>}
    {(servers || []).map((s) => {
      const st = status.find((x) => x.name === s.name);
      return <div className="row mcp-row" key={s.name}>
        <div>
          <strong>{s.name}</strong> <span className={`badge mcp-${st?.status || "desligado"}`}>{st?.status === "ativo" ? `${st.tools.length} ferramenta(s)` : st?.status || "…"}</span>
          <div><code className="mono">{[s.command, ...s.args].join(" ").slice(0, 120)}</code></div>
          {st?.error && <small className="memory-form-error">{st.error}</small>}
          {st?.status === "ativo" && st.tools.length > 0 && <small className="muted">{st.tools.join(", ").slice(0, 300)}</small>}
        </div>
        <div className="row-control">
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => save((servers || []).map((x) => (x.name === s.name ? { ...x, enabled: !x.enabled } : x)))}>{s.enabled ? "Desligar" : "Ligar"}</button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => save((servers || []).filter((x) => x.name !== s.name))}>Remover</button>
        </div>
      </div>;
    })}
    <form className="mcp-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
      <input className="field" aria-label="Nome da extensão" placeholder="Nome (ex.: Agenda)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      <input className="field mono" aria-label="Comando da extensão" placeholder="Comando (ex.: npx -y pacote-do-servidor-mcp)" value={draft.line} onChange={(e) => setDraft({ ...draft, line: e.target.value })} />
      <button className="btn btn-sm" disabled={busy}>{busy ? "Conectando…" : "Adicionar"}</button>
    </form>
    {error && <p role="alert" className="memory-form-error">{error}</p>}
  </div>;
}
