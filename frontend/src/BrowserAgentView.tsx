import { useEffect, useRef, useState } from "react";
import {
  cancelBrowserAgent,
  getBrowserAgentStatus,
  getActiveBrowserAgent,
  startBrowserAgent,
  type BrowserAgentRunStatus,
  type BrowserAgentStep,
} from "./api";

const STAGE_LABEL: Record<string, string> = {
  "preparing-browser": "Preparando o navegador automatizado (só na primeira vez)…",
  "downloading-browser": "Baixando o navegador automatizado (só na primeira vez)…",
  observing: "Olhando a tela (tirando print e lendo o texto)…",
  thinking: "Decidindo o próximo passo…",
  acted: "Ação executada.",
  "invalid-action": "O modelo respondeu de um jeito que não deu pra entender.",
  error: "Erro.",
  finished: "Concluído.",
};

function describeAction(action?: BrowserAgentStep["action"]) {
  if (!action) return "";
  switch (action.action) {
    case "click":
      return `clicar em "${action.target}"`;
    case "type":
      return `digitar "${action.text}"`;
    case "goto":
      return `ir para ${action.url}`;
    case "key":
      return `apertar a tecla "${action.key}"`;
    case "scroll":
      return "rolar a tela";
    case "wait":
      return "esperar um instante";
    case "finish":
      return `finalizar (${action.reason || "sem motivo informado"})`;
    default:
      return action.action;
  }
}

function StepRow({ step }: { step: BrowserAgentStep }) {
  const time = new Date(step.at).toLocaleTimeString("pt-BR");
  let text = STAGE_LABEL[step.stage] || step.stage;
  if (step.stage === "acted" && step.action) {
    const ok = step.execResult?.ok;
    text = `${describeAction(step.action)} — ${ok ? "ok" : `falhou: ${step.execResult?.error || "erro desconhecido"}`}`;
  } else if (step.stage === "thinking" && step.url) {
    text = `Decidindo o próximo passo (na página ${step.url})…`;
  } else if (step.stage === "invalid-action" && step.raw) {
    text = `O modelo respondeu algo que não é uma ação válida: "${step.raw.slice(0, 120)}"`;
  } else if (step.stage === "error" && step.message) {
    text = `Erro: ${step.message}`;
  } else if (step.stage === "finished") {
    text = `Concluído: ${step.reason || "sem motivo informado"}`;
  }
  return (
    <li className={`browser-agent-step ${step.stage}`}>
      <small>{time}</small>
      <span>{text}</span>
    </li>
  );
}

/**
 * UI para o agente de navegador (capacidade interna do Harness): o usuário
 * descreve uma tarefa em linguagem natural, e o modelo local a executa
 * sozinho — tirando print da tela, lendo o texto visível via OCR
 * (Tesseract.js, sem gastar tokens de IA paga) e decidindo cliques/digitação
 * via Playwright, num loop parecido com o que o usuário já faz manualmente
 * com Claude/Codex para mexer em apps do PowerApps.
 */
export default function BrowserAgentView() {
  const [goal, setGoal] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<BrowserAgentRunStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => {
    let stale = false;
    getActiveBrowserAgent().then(({ runId: id }) => { if (!stale) setRunId(id); }).catch(e => setStartError(e.message));
    return () => { stale = true; stopPolling(); };
  }, []);

  useEffect(() => {
    if (!runId) return;
    let stale = false;
    const poll = () => getBrowserAgentStatus(runId).then(status => {
      if (stale) return;
      setRun(status);
      if (status.status !== "running") stopPolling();
    }).catch(e => { if (!stale) { setStartError(e.message); stopPolling(); } });
    void poll();
    pollRef.current = setInterval(poll, 1000);
    return () => { stale = true; stopPolling(); };
  }, [runId]);

  const handleStart = async () => {
    const trimmed = goal.trim();
    if (!trimmed) return;
    setStartError("");
    setStarting(true);
    setRun(null);
    try {
      const { runId: id } = await startBrowserAgent(trimmed);
      setRunId(id);

    } catch (error) {
      setStartError(error instanceof Error ? error.message : "Falha ao iniciar o agente.");
    } finally {
      setStarting(false);
    }
  };

  const handleCancel = async () => {
    if (!runId) return;
    await cancelBrowserAgent(runId).catch(() => {});
  };

  const running = run?.status === "running";

  return (
    <section className="settings-page browser-agent-page">
      <div className="chat-page-head">
        <h1>Agente de navegador</h1>
        <p>
          Descreva uma tarefa e o modelo local a executa sozinho no navegador — tirando prints e lendo a tela via OCR
          (sem gastar tokens de IA paga), decidindo cliques e digitação a cada passo. Bom para tarefas repetitivas em
          apps web, como preencher ou navegar telas do PowerApps.
        </p>
      </div>

      <div className="settings-body">
        <div className="settings-card">
          <h2>Nova tarefa</h2>
          <div className="settings-field">
            <label>O que o agente deve fazer?</label>
            <textarea
              rows={3}
              placeholder='Ex.: "Abrir powerapps.microsoft.com, ir em Aplicativos e abrir o app Relatório de Vendas"'
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              disabled={running || starting}
            />
          </div>
          <div className="settings-actions">
            <button onClick={handleStart} disabled={running || starting || !goal.trim()}>
              {starting ? "Iniciando…" : "Iniciar"}
            </button>
            {running && (
              <button className="link-button" onClick={handleCancel}>
                Cancelar
              </button>
            )}
          </div>
          {startError && <p className="memory-form-error">{startError}</p>}
          <small className="settings-hint">
            Na primeira vez, o navegador automatizado é baixado sozinho — pode demorar um pouco. As próximas tarefas
            abrem na hora. O agente reaproveita o mesmo perfil de navegador entre execuções, então logins (ex.:
            Microsoft) continuam válidos.
          </small>
        </div>

        {run && (
          <div className="settings-card browser-agent-log">
            <h2>
              Andamento{" "}
              {run.status === "running" && <span className="spinner" aria-hidden="true" />}
              {run.status === "done" && <span className="status-dot ready" title="Concluído" />}
              {(run.status === "error" || run.status === "cancelled") && (
                <span className="status-dot pending" title={run.status === "cancelled" ? "Cancelado" : "Erro"} />
              )}
            </h2>
            <ul className="browser-agent-steps">
              {run.steps.map((step, i) => (
                <StepRow key={i} step={step} />
              ))}
            </ul>
            {run.result && !run.result.ok && run.result.error && (
              <p className="memory-form-error">{run.result.error}</p>
            )}
            {run.result?.ok && run.result.done && (
              <p className="settings-saved">Tarefa concluída: {run.result.reason || "sem detalhes."}</p>
            )}
            {run.result?.cancelled && <p className="settings-hint">Execução cancelada.</p>}
          </div>
        )}
      </div>
    </section>
  );
}
