import { useEffect, useState } from "react";
import { deleteApiEngine, listApiEngines, saveApiEngine, testApiEngine, type ApiEngine, type ApiEnginePreset, type EngineState } from "./api";

/**
 * Models by API key (app/apiEngines.js): Claude, OpenAI, OpenRouter, Gemini or any compatible endpoint, next
 * to the Claude Code and Codex CLIs. They work like the others — the active help, the agents, the Office —
 * and, with "Seus dados: ficam aqui", only on a copy with fake values. The key stays on this computer.
 */
export default function ModelsPanel({ onChanged }: { onChanged?: () => void } = {}) {
  const [engines, setEngines] = useState<ApiEngine[] | null>(null);
  const [presets, setPresets] = useState<Record<string, ApiEnginePreset>>({});
  const [status, setStatus] = useState<Record<string, EngineState>>({});
  const [draft, setDraft] = useState({ preset: "anthropic", label: "", model: "", baseUrl: "", apiKey: "" });
  const [tests, setTests] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = () => listApiEngines().then((r) => { setEngines(r.engines); setPresets(r.presets); setStatus(r.status); }).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);

  const preset = presets[draft.preset];
  const add = () => {
    setBusy(true); setError("");
    saveApiEngine({ preset: draft.preset, label: draft.label || preset?.label, model: draft.model || preset?.model, baseUrl: draft.baseUrl || preset?.baseUrl, apiKey: draft.apiKey })
      // Added, it is tried at once: the person sees "Funcionando" (or why not) without another click.
      .then((saved) => { setDraft({ preset: draft.preset, label: "", model: "", baseUrl: "", apiKey: "" }); const id = (saved as { id?: string } | null)?.id; if (id) test(id); onChanged?.(); return load(); })
      .catch((e: Error) => setError(e.message)).finally(() => setBusy(false));
  };
  const test = (id: string) => {
    setTests({ ...tests, [id]: "Testando…" });
    testApiEngine(id).then((r) => setTests((t) => ({ ...t, [id]: r.ok ? `Funcionando (${Math.round(r.ms / 1000)} s)` : `Não funcionou: ${r.error}` })))
      .catch((e: Error) => setTests((t) => ({ ...t, [id]: `Não funcionou: ${e.message}` })));
  };

  return <div className="section" aria-label="Modelos">
    <h3 className="section-title">Colar uma chave de API</h3>
    <p className="section-desc">O jeito mais fácil de ligar um modelo forte: escolha o provedor, cole a chave e clique em Adicionar (a Aurora testa na hora). A chave fica só neste computador, e com "Seus dados: ficam aqui" (Professor) o modelo trabalha numa cópia com valores falsos.</p>
    {engines === null && !error && <p className="muted">Carregando…</p>}
    {(engines || []).map((e) => <div className="row" key={e.id}>
      <div className="row-text">
        <div className="row-label">{e.label}</div>
        <div className="row-desc">{e.model}{e.kind === "openai" ? ` · ${e.baseUrl}` : ""} · chave {e.hasKey ? e.keyHint : "não informada"}{status[e.id]?.limitedUntil ? " · sem limite de uso agora" : ""}</div>
        {tests[e.id] && <small className={/Não funcionou/.test(tests[e.id]) ? "memory-form-error" : "muted"}>{tests[e.id]}</small>}
      </div>
      <div className="row-control">
        <button className="btn btn-ghost btn-sm" onClick={() => test(e.id)}>Testar</button>
        <button className="btn btn-ghost btn-sm" onClick={() => void deleteApiEngine(e.id).then(load)}>Remover</button>
      </div>
    </div>)}
    <div className="model-new" aria-label="Novo modelo">
      <label>Provedor <select value={draft.preset} onChange={(ev) => setDraft({ ...draft, preset: ev.target.value })}>{Object.entries(presets).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}</select></label>
      <label>Modelo <input list="api-model-options" value={draft.model} onChange={(ev) => setDraft({ ...draft, model: ev.target.value })} placeholder={preset?.model || (draft.preset === "openrouter" ? "anthropic/claude-sonnet-5.5" : "nome do modelo")} /></label>
      <datalist id="api-model-options">{(preset?.models || []).map((m) => <option key={m} value={m} />)}</datalist>
          {preset?.kind === "openai" && <label>Endereço <input value={draft.baseUrl} onChange={(ev) => setDraft({ ...draft, baseUrl: ev.target.value })} placeholder={preset?.baseUrl || "https://…/v1"} /></label>}
      <label>Chave da API <input type="password" autoComplete="off" value={draft.apiKey} onChange={(ev) => setDraft({ ...draft, apiKey: ev.target.value })} placeholder={draft.preset === "custom" ? "opcional para endpoint local" : "sk-…"} /></label>
      <label>Nome <input value={draft.label} onChange={(ev) => setDraft({ ...draft, label: ev.target.value })} placeholder={preset?.label || "Meu modelo"} /></label>
      <button className="btn btn-primary btn-sm" disabled={busy} onClick={add}>Adicionar</button>
    </div>
    {error && <p role="alert" className="memory-form-error">{error}</p>}
  </div>;
}
