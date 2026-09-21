import { useEffect, useRef, useState } from "react";
import {
  getLocalModels,
  getLocalStatus,
  getProviders,
  getSettings,
  pickFolder,
  setLocalModel,
  updateSettings,
  watchLocalSetup,
  type LocalModelOption,
  type LocalStatus,
  type ProviderInfo,
  type Settings,
} from "./api";
import { ModelPicker } from "./LocalSetupPanel";
import ModelTrainingPanel from './ModelTrainingPanel';

const PROVIDER_LABEL: Record<string, string> = { codex: "Codex", claude: "Claude", local: "Local (Ollama)" };

/**
 * Marco 2 do ROADMAP_MELHORIAS.md: antes desta tela, ajustar qualquer
 * preferência (provedor/professor padrão, modelo local, URL da comunidade)
 * exigia editar código ou variável de ambiente — nada disso tinha UI. Esta
 * view reúne tudo num só lugar, persistido via /api/settings (tabela
 * settings, a mesma que já guarda o modelo local escolhido).
 */
export default function SettingsView({
  onDefaultsChanged,
  onOpenGuide,
}: {
  onOpenGuide?: () => void;
  /** Mantém o seletor rápido da sidebar (próxima conversa) sincronizado sem esperar um recarregamento. */
  onDefaultsChanged?: (provider: string, teacher: string) => void;
}) {
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [localStatus, setLocalStatus] = useState<LocalStatus | null>(null);
  const [customModel, setCustomModel] = useState("");
  const [error, setError] = useState("");
  const setupStop = useRef<(() => void) | null>(null);
  useEffect(() => () => setupStop.current?.(), []);
  const [models, setModels] = useState<LocalModelOption[]>([]);
  const [manifestDraft, setManifestDraft] = useState("");
  const [manifestSaved, setManifestSaved] = useState(false);
  const [manifestError, setManifestError] = useState("");
  const [pullingModel, setPullingModel] = useState(false);
  const [modelStage, setModelStage] = useState<string | null>(null);
  const [sandboxDraft, setSandboxDraft] = useState("");
  const [sandboxSaved, setSandboxSaved] = useState(false);
  const [sandboxError, setSandboxError] = useState("");

  const refresh = () => {
    getSettings().then((s) => {
      setSettingsState(s);
      setManifestDraft(s.communityManifestUrl);
      setSandboxDraft(s.sandboxDir);
    }).catch(e => setError(e.message));
    getProviders().then(setProviders).catch(e => setError(e.message));
    getLocalStatus().then(setLocalStatus).catch(e => setError(e.message));
    getLocalModels().then(setModels).catch(e => setError(e.message));
  };

  useEffect(refresh, []);

  const isReady = (id: string) => {
    if (id === "local") return Boolean(localStatus?.ready);
    return providers.find((p) => p.id === id)?.configured ?? false;
  };

  const setDefaultProvider = async (id: string) => {
    const updated = await updateSettings({ defaultProvider: id }).catch(e => { setError(e.message); return null; });
    if (!updated) return;
    setSettingsState((prev) => (prev ? { ...prev, ...updated } : prev));
    onDefaultsChanged?.(updated.defaultProvider, updated.defaultTeacher);
  };
  const setDefaultTeacher = async (id: string) => {
    const updated = await updateSettings({ defaultTeacher: id }).catch(e => { setError(e.message); return null; });
    if (!updated) return;
    setSettingsState((prev) => (prev ? { ...prev, ...updated } : prev));
    onDefaultsChanged?.(updated.defaultProvider, updated.defaultTeacher);
  };

  const saveManifest = async (url: string) => {
    setManifestError("");
    try {
      const updated = await updateSettings({ communityManifestUrl: url });
      setSettingsState((prev) => (prev ? { ...prev, ...updated } : prev));
      setManifestDraft(updated.communityManifestUrl);
      setManifestSaved(true);
      setTimeout(() => setManifestSaved(false), 2000);
    } catch (err) {
      setManifestError(err instanceof Error ? err.message : "Falha ao salvar.");
    }
  };

  const saveSandboxDir = async (dir: string) => {
    setSandboxError("");
    try {
      const updated = await updateSettings({ sandboxDir: dir });
      setSettingsState((prev) => (prev ? { ...prev, ...updated } : prev));
      setSandboxDraft(updated.sandboxDir);
      setSandboxSaved(true);
      setTimeout(() => setSandboxSaved(false), 2000);
    } catch (err) {
      setSandboxError(err instanceof Error ? err.message : "Falha ao salvar.");
    }
  };

  const chooseSandboxFolder = async () => {
    const chosen = await pickFolder().catch(e => { setSandboxError(e.message); return null; });
    if (chosen) await saveSandboxDir(chosen);
  };

  const pickModel = async (model: string) => {
    if (!model.trim() || pullingModel) return;
    setError("");
    setPullingModel(true);
    try {
    await setLocalModel(model.trim());
    setPullingModel(true);
    setModelStage("checking");
    const stop = watchLocalSetup((event) => {
      setModelStage(event.stage);
      if (event.stage === "done" || event.stage === "failed" || event.stage === "error") {
        stop();
        setPullingModel(false);
        if (event.stage !== "done") setError(event.message || "Falha ao preparar o modelo.");
        getLocalStatus().then(setLocalStatus).catch(e => setError(e.message));
      }
    });
    setupStop.current = stop;
    } catch (e) { setPullingModel(false); setError(e instanceof Error ? e.message : "Falha ao selecionar modelo."); }
  };

  if (!settings) return <section className="settings-page">{error || "Carregando…"}</section>;

  return (
    <section className="settings-page">
      <div className="chat-page-head">
        <h1>Configurações</h1>
        <p>Preferências do Harness Aurora neste computador — salvas localmente, sem precisar editar nada por fora.</p>
      </div>

      <div className="settings-body">
        <div className="settings-card">
          <h2>Primeiros passos</h2>
          <p className="settings-hint">Como usar a Aurora, conectar Codex ou Claude e aproveitar suas memórias.</p>
          <button onClick={onOpenGuide}>Abrir guia de boas-vindas</button>
        </div>
        {error && <p role="alert" className="memory-form-error">{error}</p>}
        <div className="settings-card">
          <h2>Provedores</h2>
          <p className="settings-hint">Qual provedor uma nova conversa usa por padrão, e qual professor corrige o modelo local.</p>
          <div className="settings-field">
            <label>Provedor padrão de novas conversas</label>
            <div className="settings-options">
              {["codex", "claude", "local"].map((id) => (
                <button
                  key={id}
                  className={settings.defaultProvider === id ? "selected" : ""}
                  onClick={() => setDefaultProvider(id)}
                >
                  {PROVIDER_LABEL[id]}
                  <span className={`status-dot ${isReady(id) ? "ready" : "pending"}`} title={isReady(id) ? (id === "local" ? "Pronto" : "CLI encontrado; autenticação verificada ao conversar") : "Provedor não encontrado"} />
                </button>
              ))}
            </div>
          </div>
          <div className="settings-field">
            <label>Professor (corrige o modelo local)</label>
            <div className="settings-options">
              {["codex", "claude"].map((id) => (
                <button key={id} className={settings.defaultTeacher === id ? "selected" : ""} onClick={() => setDefaultTeacher(id)}>
                  {PROVIDER_LABEL[id]}
                  <span className={`status-dot ${isReady(id) ? "ready" : "pending"}`} />
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="settings-card">
          <h2>IA local</h2>
          <p className="settings-hint">
            {localStatus?.ready
              ? `Pronto — usando "${localStatus.model}".`
              : "Ainda preparando ou não configurado — abra uma conversa Local para configurar automaticamente."}
          </p>
          <p className="settings-hint">O padrão agora é Qwen3.5 4B. Seleções antigas de Qwen2 e dos experimentos Aurora 1,5B passam a usar esse padrão, sem apagar os arquivos antigos. Versões treinadas só entram após aprovação nos testes.</p>
          <button disabled={pullingModel || localStatus?.selection==='automatic'} onClick={()=>void pickModel('auto')}>Usar seleção automática</button>
          {pullingModel && <p className="settings-hint">Trocando modelo… ({modelStage})</p>}
          <details><summary>Escolha manual avançada</summary>
          <ModelPicker
            models={models}
            customModel={customModel}
            setCustomModel={setCustomModel}
            onPick={pickModel}
            disabled={pullingModel}
          />
          </details>
          <ModelTrainingPanel />
        </div>

        <div className="settings-card">
          <h2>Comunidade</h2>
          <p className="settings-hint">De onde a aba Memória busca pacotes de memória compartilhados (botão "🌐 Comunidade").</p>
          <div className="settings-field">
            <input
              value={manifestDraft}
              onChange={(e) => setManifestDraft(e.target.value)}
              placeholder="https://.../manifest.json"
            />
            <div className="settings-actions">
              <button onClick={() => saveManifest(manifestDraft)}>Salvar</button>
              <button className="link-button" onClick={() => saveManifest("")}>
                Restaurar padrão
              </button>
            </div>
            {manifestSaved && <small className="settings-saved">Salvo.</small>}
            {manifestError && <p className="memory-form-error">{manifestError}</p>}
          </div>
        </div>

        <div className="settings-card">
          <h2>Sandbox de execução</h2>
          <p className="settings-hint">
            Pasta onde fica salvo o código que o modelo local gera (jogos, páginas, scripts) quando você clica em
            "▶ Executar" numa resposta — organizado numa subpasta por conversa, pra você achar fácil no seu
            Explorer/Finder.
          </p>
          <div className="settings-field">
            <input
              value={sandboxDraft}
              onChange={(e) => setSandboxDraft(e.target.value)}
              placeholder="Ex.: C:\Users\você\Documents\Harness\Sandbox"
            />
            <div className="settings-actions">
              <button onClick={chooseSandboxFolder}>Escolher pasta…</button>
              <button onClick={() => saveSandboxDir(sandboxDraft)}>Salvar</button>
            </div>
            {sandboxSaved && <small className="settings-saved">Salvo.</small>}
            {sandboxError && <p className="memory-form-error">{sandboxError}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
