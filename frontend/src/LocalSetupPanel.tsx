import { useEffect, useRef, useState } from "react";
import {
  getLocalModels,
  getLocalStatus,
  setLocalModel,
  watchLocalSetup,
  type LocalModelOption,
  type LocalSetupEvent,
  type LocalStatus,
} from "./api";

const STAGE_LABEL: Record<string, string> = {
  checking: "Verificando o Ollama…",
  "downloading-installer": "Baixando o Ollama (só na primeira vez)…",
  installing: "Instalando o Ollama (só na primeira vez)…",
  installed: "Ollama instalado.",
  starting: "Iniciando o Ollama…",
  "server-ready": "Ollama pronto.",
  pulling: "Baixando o modelo de IA…",
  ready: "Tudo pronto!",
};

function formatBytes(n?: number) {
  if (!n && n !== 0) return "";
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Replaces the old raw "não foi possível conectar ao Ollama" error with a
 * self-driving setup flow: mounted whenever the active conversation uses
 * the Local provider, it checks status once and — if anything is missing —
 * opens the SSE stream that installs/starts Ollama and pulls the model on
 * its own, so a lay user never has to open a terminal. Also exposes a
 * "trocar modelo" control for people who do want to pick a stronger model.
 */
export default function LocalSetupPanel({ active }: { active: boolean }) {
  const [status, setStatus] = useState<LocalStatus | null>(null);
  const [event, setEvent] = useState<LocalSetupEvent | null>(null);
  const [running, setRunning] = useState(false);
  const [models, setModels] = useState<LocalModelOption[]>([]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [customModel, setCustomModel] = useState("");
  const stopRef = useRef<(() => void) | null>(null);

  const startSetup = () => {
    stopRef.current?.();
    setRunning(true);
    stopRef.current = watchLocalSetup((e) => {
      setEvent(e);
      if (e.stage === "done" || e.stage === "failed" || e.stage === "error") {
        stopRef.current?.();
        stopRef.current = null;
        setRunning(false);
        getLocalStatus()
          .then(setStatus)
          .catch(() => {});
      }
    });
  };

  useEffect(() => {
    if (!active) return;
    let stale = false;
    getLocalStatus()
      .then((s) => {
        if (stale) return;
        setStatus(s);
        if (!s.ready) startSetup();
      })
      .catch(() => {});
    getLocalModels()
      .then(setModels)
      .catch(() => {});
    return () => { stale = true; stopRef.current?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  if (!active) return null;

  const applyModel = async (model: string) => {
    if (!model.trim() || running) return;
    setRunning(true);
    try { await setLocalModel(model.trim()); } catch (e) {
      setRunning(false); setEvent({ stage: "error", message: e instanceof Error ? e.message : "Falha ao selecionar modelo." }); return;
    }
    setShowModelPicker(false);
    setCustomModel("");
    startSetup();
  };

  if (status?.ready && !running) {
    return (
      <div className="local-setup-panel ready">
        <span>✓ Modelo local pronto ({status.model})</span>
        <button className="link-button" onClick={() => setShowModelPicker((v) => !v)}>
          Trocar modelo
        </button>
        {showModelPicker && (
          <ModelPicker models={models} customModel={customModel} setCustomModel={setCustomModel} onPick={applyModel} />
        )}
      </div>
    );
  }

  const stage = event?.stage;
  const isError = stage === "error" || stage === "failed";
  const label = (stage && STAGE_LABEL[stage]) || "Preparando o modelo local…";
  const showProgress = stage === "pulling" && typeof event?.total === "number" && event.total > 0;
  const percent = showProgress ? Math.round(((event!.completed || 0) / event!.total!) * 100) : null;

  return (
    <div className={`local-setup-panel ${isError ? "error" : "busy"}`}>
      {isError ? (
        <>
          <span>⚠ {event?.message || "Não foi possível preparar o modelo local."}</span>
          {event?.manual && event?.url && (
            <a href={event.url} target="_blank" rel="noreferrer">
              Abrir instruções
            </a>
          )}
          <button className="link-button" onClick={startSetup}>
            Tentar de novo
          </button>
        </>
      ) : (
        <>
          <span className="spinner" aria-hidden="true" />
          <span>
            {label}
            {percent !== null && ` (${percent}% — ${formatBytes(event?.completed)} de ${formatBytes(event?.total)})`}
          </span>
          <small>Isso acontece só uma vez neste computador — as próximas conversas abrem na hora.</small>
        </>
      )}
    </div>
  );
}

/** Also reused by SettingsView.tsx (Central de Configurações), so the model list/custom-tag form isn't duplicated. */
export function ModelPicker({
  models,
  customModel,
  setCustomModel,
  onPick,
  disabled = false,
}: {
  models: LocalModelOption[];
  customModel: string;
  setCustomModel: (v: string) => void;
  onPick: (model: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="model-picker">
      {models.map((m) => (
        <button disabled={disabled} key={m.id} onClick={() => onPick(m.id)} title={`Recomendado: ${m.recommendedRamGb} GB de RAM`}>
          {m.label} <small>{m.size}</small>
        </button>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onPick(customModel);
        }}
      >
        <input
          disabled={disabled}
          placeholder="ou nome de outro modelo do Ollama…"
          value={customModel}
          onChange={(e) => setCustomModel(e.target.value)}
        />
        <button type="submit" disabled={disabled || !customModel.trim()}>
          Usar
        </button>
      </form>
    </div>
  );
}
