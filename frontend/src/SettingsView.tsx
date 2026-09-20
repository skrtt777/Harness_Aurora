import { useEffect, useState } from "react";
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
}: {
  /** Mantém o seletor rápido da sidebar (próxima conversa) sincronizado sem esperar um recarregamento. */
  onDefaultsChanged?: (provider: string, teacher: string) => void;
}) {
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [localStatus, setLocalStatus] = useState<LocalStatus | null>(null);
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
    });
    getProviders().then(setProviders);
    getLocalStatus().then(setLocalStatus);
    getLocalModels().then(setModels);
  };

  useEffect(refresh, []);

  const isReady = (id: string) => {
    if (id === "local") return Boolean(localStatus?.ready);
    return providers.find((p) => p.id === id)?.configured ?? false;
  };

  const setDefaultProvider = async (id: string) => {
    const updated = await updateSettings({ defaultProvider: id });
    setSettingsState((prev) => (prev ? { ...prev, ...updated } : prev));
    onDefaultsChanged?.(updated.defaultProvider, updated.defaultTeacher);
  };
  const setDefaultTeacher = async (id: string) => {
    const updated = await updateSettings({ defaultTeacher: id });
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
    const chosen = await pickFolder();
    if (chosen) await saveSandboxDir(chosen);
  };

  const pickModel = async (model: string) => {
    if (!model.trim()) return;
    await setLocalModel(model.trim());
    setPullingModel(true);
    setModelStage("checking");
    const stop = watchLocalSetup((event) => {
      setModelStage(event.stage);
      if (event.stage === "done" || event.stage === "failed" || event.stage === "error") {
        stop();
        setPullingModel(false);
        getLocalStatus().then(setLocalStatus);
      }
    });
  };

  if (!settings) return <section className="settings-page">Carregando…</section>;

  return (
    <section className="settings-page">
      <div className="chat-page-head">
        <h1>Configurações</h1>
        <p>Preferências do Harness Aurora neste computador — salvas localmente, sem precisar editar nada por fora.</p>
      </div>

      <div className="settings-body">
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
                  <span className={`status-dot ${isReady(id) ? "ready" : "pending"}`} title={isReady(id) ? "Pronto" : "Precisa configurar"} />
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
          <h2>Modelo local (Ollama)</h2>
          <p className="settings-hint">
            {localStatus?.ready
              ? `Pronto — usando "${localStatus.model}".`
              : "Ainda preparando ou não configurado — abra uma conversa Local para configurar automaticamente."}
          </p>
          {pullingModel && <p className="settings-hint">Trocando modelo… ({modelStage})</p>}
          <ModelPicker
            models={models}
            customModel=""
            setCustomModel={() => {}}
            onPick={pickModel}
          />
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
