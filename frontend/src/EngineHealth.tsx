import { useEffect, useState } from "react";
import { installEngine, installProgress, openEngineSetup, probeEngines, type EngineState, type InstallJob } from "./api";

// The other harnesses the Aurora can install (official installers) and set up (their own wizard).
const INSTALLABLE: Record<string, { label: string; what: string }> = {
  hermes: { label: "Hermes", what: "agente da Nous Research, que aprende skills com o uso" },
  openclaw: { label: "OpenClaw", what: "agente pessoal que trabalha em segundo plano" },
};

/**
 * Who helps the Aurora, in plain words: each strong engine tried for real (a tiny test, once a day or when the
 * person asks), working or what to do about it. Engines of other harnesses (Hermes, OpenClaw) appear only when
 * they are installed; the subscriptions (Claude, Codex) always, since they are the easy way in.
 */
export default function EngineHealth({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<Record<string, EngineState> | null>(null);
  const [testing, setTesting] = useState<string | null>("todos");
  const [error, setError] = useState("");
  const [jobs, setJobs] = useState<Record<string, InstallJob>>({});
  const [setupNote, setSetupNote] = useState<Record<string, string>>({});
  // Install: the official installer runs in the background; its last lines show until it ends, then it is tested.
  const install = (id: string) => {
    setError("");
    void installEngine(id).then((job) => {
      setJobs((j) => ({ ...j, [id]: job }));
      const poll = () => void installProgress(job.jobId).then((now) => {
        setJobs((j) => ({ ...j, [id]: now }));
        if (now.state === "instalando") setTimeout(poll, 1500);
        else if (now.state === "instalado") run(id);
      }).catch((e: Error) => setError(e.message));
      setTimeout(poll, 1500);
    }).catch((e: Error) => setError(e.message));
  };
  const setup = (id: string) => void openEngineSetup(id).then(() => setSetupNote((n) => ({ ...n, [id]: "Abri a configuração numa janela: escolha um modelo e entre na sua conta lá, depois clique em Testar." }))).catch((e: Error) => setError(e.message));
  const run = (id?: string) => {
    setTesting(id || "todos"); setError("");
    void probeEngines(id).then(setStatus).catch((e: Error) => setError(e.message)).finally(() => setTesting(null));
  };
  useEffect(() => { run(); }, []);
  const rows = Object.entries(status || {}).filter(([id, s]) => s.installed || id === "claude" || id === "codex" || id in INSTALLABLE);
  const working = rows.filter(([, s]) => s.probe?.ok && !s.limitedUntil).map(([, s]) => s.label);
  const time = (t: number) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className={`engine-health ${compact ? "compact" : ""}`}>
      <div className="engine-health-head">
        <b>Quem ajuda a Aurora</b>
        <span>{testing === "todos" && !status ? "testando…" : working.length ? `funcionando: ${working.join(", ")}` : "nenhum funcionando agora"}</span>
        <button className="button-secondary" disabled={Boolean(testing)} onClick={() => run()}>Testar de novo</button>
      </div>
      {status && !working.length && (
        <p className="engine-health-tip">
          Para a Aurora pedir ajuda a um modelo forte, o jeito mais fácil é <b>colar uma chave de API</b> (Anthropic ou OpenAI) em <b>Configurações → Modelos</b>, ou entrar na sua conta do <b>Claude Code</b> ou do <b>Codex</b>. Seus dados continuam protegidos: o modelo forte trabalha numa cópia com valores falsos.
        </p>
      )}
      <ul>
        {rows.map(([id, s]) => {
          const state = !s.installed ? { cls: "off", text: s.api ? "Sem chave configurada." : "Não instalado neste computador." }
            : s.limitedUntil ? { cls: "wait", text: `Sem limite de uso até ${new Date(s.limitedUntil).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}.` }
            : testing === id ? { cls: "wait", text: "Testando…" }
            : !s.probe ? { cls: "wait", text: "Ainda não testado." }
            : s.probe.ok ? { cls: "ok", text: `Funcionando (testado às ${time(s.probe.at)}).` }
            : { cls: "bad", text: s.probe.reason || "Não respondeu." };
          return (
            <li key={id} className={state.cls}>
              <i aria-hidden="true">{state.cls === "ok" ? "✓" : state.cls === "bad" ? "✗" : "•"}</i>
              <span>
                <b>{s.label}</b> {!s.installed && INSTALLABLE[id] ? `Opcional: ${INSTALLABLE[id].what}. Não instalado.` : state.text}
                {jobs[id]?.state === "instalando" && <small className="engine-health-log">Instalando… {jobs[id].lines.at(-1) || ""}</small>}
                {jobs[id]?.state === "falhou" && <small className="engine-health-log bad">A instalação não terminou: {jobs[id].lines.slice(-2).join(" · ") || "sem detalhe"}</small>}
                {setupNote[id] && <small className="engine-health-log">{setupNote[id]}</small>}
              </span>
              {!s.installed && INSTALLABLE[id] && <button className="button-secondary" disabled={jobs[id]?.state === "instalando"} onClick={() => install(id)} title="Usa o instalador oficial; não precisa de administrador">{jobs[id]?.state === "instalando" ? "Instalando…" : "Instalar"}</button>}
              {s.installed && INSTALLABLE[id] && s.probe && !s.probe.ok && <button className="button-secondary" onClick={() => setup(id)}>Configurar conta</button>}
              {s.installed && <button className="button-secondary" disabled={Boolean(testing)} onClick={() => run(id)}>Testar</button>}
            </li>
          );
        })}
      </ul>
      {error && <p className="memory-form-error" role="alert">{error}</p>}
    </div>
  );
}
