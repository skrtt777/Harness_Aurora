import { useEffect, useRef, useState } from "react";
import {
  checkForUpdates,
  getLocalModels,
  getLocalStatus,
  getProviders,
  getSettings,
  getUpdateState,
  installUpdate,
  pickFolder,
  setLocalModel,
  subscribeUpdateStatus,
  updateSettings,
  watchLocalSetup,
  type LocalModelOption,
  type LocalStatus,
  type ProviderInfo,
  type Settings,
  type UpdateState,
  exportAudit,
  getLocalHardware,
  type GpuInfo,
} from "./api";
import { ModelPicker } from "./LocalSetupPanel";
import ModelTrainingPanel from './ModelTrainingPanel';
import Icon from './Icon';
import EvalPanel from './EvalPanel';
import KnowledgePanel from './KnowledgePanel';
import McpPanel from './McpPanel';

const PROVIDER_LABEL: Record<string, string> = { codex: "Codex", claude: "Claude", local: "Local (Ollama)" };
const SECTIONS = [
  { id: "general", label: "Geral" },
  { id: "agent", label: "Agente" },
  { id: "teacher", label: "Professor" },
  { id: "local", label: "IA local" },
  { id: "knowledge", label: "Conhecimento" },
  { id: "learning", label: "Aprendizado" },
  { id: "advanced", label: "Avançado" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

/**
 * Marco 2 do docs/historico/ROADMAP_MELHORIAS.md: antes desta tela, ajustar qualquer
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
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [maxFixAttemptsDraft, setMaxFixAttemptsDraft] = useState("2");
  const [contextTokensDraft, setContextTokensDraft] = useState("8192");
  const [tuningSaved, setTuningSaved] = useState(false);
  const [hardware, setHardware] = useState<{ gpu: GpuInfo } | null>(null);
  const [tuningError, setTuningError] = useState("");
  const [rootsDraft, setRootsDraft] = useState("");
  const [agentSaved, setAgentSaved] = useState(false);
  const [agentError, setAgentError] = useState("");

  const refresh = () => {
    getSettings().then((s) => {
      setSettingsState(s);
      setManifestDraft(s.communityManifestUrl);
      setSandboxDraft(s.sandboxDir);
      setMaxFixAttemptsDraft(String(s.localMaxFixAttempts));
      setContextTokensDraft(String(s.localContextTokens));
      setRootsDraft((s.agentAllowedRoots || []).join("\n"));
    }).catch(e => setError(e.message));
    getProviders().then(setProviders).catch(e => setError(e.message));
    getLocalStatus().then(setLocalStatus).catch(e => setError(e.message));
    getLocalModels().then(setModels).catch(e => setError(e.message));
  };

  useEffect(refresh, []);

  useEffect(() => {
    // Reads whatever the startup check already found (it runs once at boot,
    // before this screen exists) instead of only reacting to new events —
    // otherwise "up to date"/"erro" from the automatic check would be
    // invisible until the next one.
    void getUpdateState().then((s) => s && setUpdate((prev) => prev ?? s));
    return subscribeUpdateStatus((status) => setUpdate((prev) => (prev ? { ...prev, ...status } : null)));
  }, []);

  const runUpdateCheck = () => void checkForUpdates().then((s) => s && setUpdate(s));
  const runInstall = () => void installUpdate();

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

  const saveAgent = async (patch: Partial<Pick<Settings, "agentToolsEnabled" | "browserBackend" | "agentAllowedRoots" | "agentMode" | "agentAlwaysAllow" | "teacherMode" | "teacherDailyLimit">>) => {
    setAgentError("");
    try {
      const updated = await updateSettings(patch);
      setSettingsState((prev) => (prev ? { ...prev, ...updated } : prev));
      setRootsDraft(updated.agentAllowedRoots.join("\n"));
      setAgentSaved(true);
      setTimeout(() => setAgentSaved(false), 2000);
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : "Falha ao salvar.");
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

  const saveTuning = async () => {
    setTuningError("");
    const localMaxFixAttempts = Number(maxFixAttemptsDraft);
    const localContextTokens = Number(contextTokensDraft);
    if (!Number.isInteger(localMaxFixAttempts) || localMaxFixAttempts < 0 || localMaxFixAttempts > 5) {
      setTuningError("Tentativas de correção deve ser um número inteiro entre 0 e 5.");
      return;
    }
    if (!Number.isInteger(localContextTokens) || localContextTokens < 2048 || localContextTokens > 32768) {
      setTuningError("Tamanho do contexto deve ser um número inteiro entre 2048 e 32768.");
      return;
    }
    try {
      const updated = await updateSettings({ localMaxFixAttempts, localContextTokens });
      setSettingsState((prev) => (prev ? { ...prev, ...updated } : prev));
      setMaxFixAttemptsDraft(String(updated.localMaxFixAttempts));
      setContextTokensDraft(String(updated.localContextTokens));
      setTuningSaved(true);
      setTimeout(() => setTuningSaved(false), 2000);
    } catch (err) {
      setTuningError(err instanceof Error ? err.message : "Falha ao salvar.");
    }
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


  const [section, setSection] = useState<SectionId>(() => {
    try { const saved = localStorage.getItem("aurora-settings-section") as SectionId | null; return saved && SECTIONS.some((s) => s.id === saved) ? saved : "general"; } catch { return "general"; }
  });
  const openSection = (id: SectionId) => { setSection(id); try { localStorage.setItem("aurora-settings-section", id); } catch { /* private mode */ } };
  useEffect(() => { if (section === "local" && !hardware) void getLocalHardware().then(setHardware).catch(() => {}); }, [section, hardware]);

  if (!settings) return <section className="settings-page"><div className="page"><p className="muted">{error || "Carregando…"}</p></div></section>;

  const choice = <T extends string | boolean>(value: T, options: readonly (readonly [T, string, string?])[], onPick: (v: T) => void, label: string) => (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([id, text, hint]) => (
        <button key={String(id)} title={hint} aria-pressed={value === id} onClick={() => onPick(id)}>{text}</button>
      ))}
    </div>
  );
  const readyDot = (id: string) => <span className={`status-dot ${isReady(id) ? "ready" : "pending"}`} />;

  return (
    <section className="settings-page">
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Seções das configurações">
          <h1 className="settings-nav-title">Configurações</h1>
          {SECTIONS.map((s) => (
            <button key={s.id} className={`settings-nav-item ${section === s.id ? "active" : ""}`} aria-current={section === s.id ? "page" : undefined} onClick={() => openSection(s.id)}>
              {s.label}
            </button>
          ))}
        </nav>

        <div className="settings-content">
          {error && <p role="alert" className="settings-error">{error}</p>}

          {section === "general" && <>
            <header className="page-header">
              <h2 className="page-title">Geral</h2>
              <p className="page-desc">Preferências deste computador, salvas localmente.</p>
            </header>
            <div className="section">
              <div className="row">
                <div className="row-text"><div className="row-label">Modelo das novas conversas</div><div className="row-desc">Quem responde quando você abre uma conversa nova.</div></div>
                <div className="row-control">{choice(settings.defaultProvider, [["codex", "Codex"], ["claude", "Claude"], ["local", "Local"]] as const, (id) => void setDefaultProvider(id), "Modelo das novas conversas")}</div>
              </div>
              <div className="row">
                <div className="row-text"><div className="row-label">Professor da IA local</div><div className="row-desc">Quem revisa e ensina o modelo local.</div></div>
                <div className="row-control">{choice(settings.defaultTeacher, [["codex", "Codex"], ["claude", "Claude"]] as const, (id) => void setDefaultTeacher(id), "Professor da IA local")}</div>
              </div>
              <div className="row">
                <div className="row-text"><div className="row-label">Disponibilidade</div><div className="row-desc">Codex e Claude precisam do programa instalado e do login feito.</div></div>
                <div className="row-control provider-status">
                  {["codex", "claude", "local"].map((id) => <span key={id}>{readyDot(id)} {PROVIDER_LABEL[id]}</span>)}
                </div>
              </div>
            </div>
            <div className="section">
              <div className="row">
                <div className="row-text"><div className="row-label">Guia de boas-vindas</div><div className="row-desc">Como usar a Aurora, conectar Codex ou Claude e aproveitar as memórias.</div></div>
                <div className="row-control"><button className="btn" onClick={onOpenGuide}>Abrir guia de boas-vindas</button></div>
              </div>
              {update && (
                <div className="row">
                  <div className="row-text">
                    <div className="row-label">Atualizações · v{update.currentVersion}</div>
                    <div className="row-desc">
                      {!update.packaged ? "A atualização automática só funciona na versão instalada." : <>
                        {update.status === "idle" && "Ainda não verificado nesta sessão."}
                        {update.status === "checking" && "Verificando…"}
                        {update.status === "up-to-date" && "Você está na versão mais recente."}
                        {update.status === "downloading" && `Baixando a versão v${update.version || "nova"}… ${update.percent ?? 0}%`}
                        {update.status === "ready" && `Versão v${update.version} pronta. Reinicie para instalar.`}
                        {update.status === "error" && (update.message || "Falha ao verificar atualizações.")}
                      </>}
                    </div>
                    {update.status === "downloading" && <div className="update-progress"><div className="update-progress-bar" style={{ width: `${update.percent ?? 0}%` }} /></div>}
                  </div>
                  {update.packaged && <div className="row-control">
                    {update.status === "ready"
                      ? <button className="btn btn-primary" onClick={runInstall}>Reiniciar e atualizar</button>
                      : <button className="btn" onClick={runUpdateCheck} disabled={update.status === "checking" || update.status === "downloading"}><Icon name="refresh" size={13} /> Verificar</button>}
                  </div>}
                </div>
              )}
            </div>
          </>}

          {section === "agent" && <>
            <header className="page-header">
              <h2 className="page-title">Agente</h2>
              <p className="page-desc">O chat pode agir por você: navegador, web, programas, arquivos e comandos. O modo define o que ele faz sem perguntar.</p>
            </header>
            <div className="section">
              <div className="row">
                <div className="row-text"><div className="row-label">Ações do chat</div><div className="row-desc">Desligado, o chat só conversa.</div></div>
                <div className="row-control"><input type="checkbox" className="switch" aria-label="Ações do chat" checked={settings.agentToolsEnabled} onChange={(e) => void saveAgent({ agentToolsEnabled: e.target.checked })} /></div>
              </div>
              <div className="row">
                <div className="row-text"><div className="row-label">Modo</div><div className="row-desc">{settings.agentMode === "auto" ? "Livre na pasta do projeto; pergunta antes de apagar, instalar, usar a rede ou sair da pasta." : settings.agentMode === "manual" ? "Pergunta antes de toda alteração, comando ou programa." : "Só olha e propõe; não altera nada."}</div></div>
                <div className="row-control">{choice(settings.agentMode, [["auto", "Auto"], ["manual", "Manual"], ["plan", "Plano"]] as const, (id) => void saveAgent({ agentMode: id }), "Modo")}</div>
              </div>
              <div className="row">
                <div className="row-text"><div className="row-label">Navegador que a Aurora controla</div><div className="row-desc">"Meu Chrome" abre o seu Chrome num perfil próprio da Aurora; faça login lá uma vez.</div></div>
                <div className="row-control">{choice(settings.browserBackend, [["aurora", "Chromium da Aurora"], ["chrome", "Meu Chrome"]] as const, (id) => void saveAgent({ browserBackend: id }), "Navegador")}</div>
              </div>
            </div>
            <div className="section">
              <h3 className="section-title">Pastas de trabalho</h3>
              <p className="section-desc">Usadas quando a conversa não tem um projeto com pasta. Uma por linha.</p>
              <textarea className="field mono" rows={3} value={rootsDraft} onChange={(e) => setRootsDraft(e.target.value)} aria-label="Pastas de trabalho" />
              <div className="form-actions">
                {agentSaved && <span className="settings-saved">Salvo</span>}
                <button className="btn" onClick={() => void saveAgent({ agentAllowedRoots: rootsDraft.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) })}>Salvar pastas</button>
              </div>
              {agentError && <p className="settings-error">{agentError}</p>}
            </div>
            <div className="section">
              <h3 className="section-title">Registro de ações</h3>
              <p className="section-desc">Tudo o que a Aurora fez no computador (arquivos criados, movidos e editados, comandos, formulários), em qualquer conversa, numa planilha para conferência.</p>
              <div className="row">
                <span>Planilha com data, conversa, ação e resultado</span>
                <div className="row-control"><button className="btn btn-ghost btn-sm" onClick={() => void exportAudit().catch((e: Error) => setError(e.message))}>Exportar registro</button></div>
              </div>
            </div>
            <McpPanel />
            {settings.agentAlwaysAllow.length > 0 && <div className="section">
              <h3 className="section-title">Comandos sempre permitidos</h3>
              <p className="section-desc">Comandos que você autorizou com "Sempre permitir".</p>
              {settings.agentAlwaysAllow.map((rule) => (
                <div className="row" key={rule.prefix}>
                  <code className="mono">{rule.prefix}</code>
                  <div className="row-control"><button className="btn btn-ghost btn-sm" onClick={() => void saveAgent({ agentAlwaysAllow: settings.agentAlwaysAllow.filter((r) => r.prefix !== rule.prefix) })}>Remover</button></div>
                </div>
              ))}
            </div>}
          </>}

          {section === "teacher" && <>
            <header className="page-header">
              <h2 className="page-title">Professor</h2>
              <p className="page-desc">Codex ou Claude revisam as entregas da IA local, ensinam lições e a local refaz. Cada revisão leva de 30 s a 2 min e usa a sua cota.</p>
            </header>
            <div className="section">
              <div className="row">
                <div className="row-text"><div className="row-label">Revisão automática</div><div className="row-desc">{settings.teacherMode === "actions" ? "Revisa quando há erro e toda entrega que alterou arquivos, rodou comandos ou agiu em páginas." : settings.teacherMode === "errors" ? "Revisa só quando detecta erro ou você reclama." : "Nunca chama o professor sozinho."}</div></div>
                <div className="row-control">{choice(settings.teacherMode, [["actions", "Erros e entregas"], ["errors", "Só erros"], ["off", "Desligado"]] as const, (id) => void saveAgent({ teacherMode: id }), "Revisão automática")}</div>
              </div>
              <div className="row">
                <div className="row-text"><div className="row-label">Limite por dia</div><div className="row-desc">Usadas hoje: {settings.teacherUsedToday}.</div></div>
                <div className="row-control"><input className="field num-field" type="number" min={0} max={1000} aria-label="Limite de revisões por dia" value={settings.teacherDailyLimit} onChange={(e) => { const value = Number(e.target.value); if (Number.isInteger(value) && value >= 0) void saveAgent({ teacherDailyLimit: value }); }} /></div>
              </div>
            </div>
          </>}

          {section === "local" && <>
            <header className="page-header">
              <h2 className="page-title">IA local</h2>
              <p className="page-desc">{localStatus?.ready ? `Pronta, usando ${localStatus.model}.` : "Ainda preparando ou não configurada. Abra uma conversa Local para configurar sozinha."}</p>
            </header>
            <div className="section">
              <div className="row">
                <div className="row-text"><div className="row-label">Modelo</div><div className="row-desc">O padrão é o Qwen3.5 4B. Versões treinadas só entram depois de aprovadas nos testes.</div></div>
                <div className="row-control"><button className="btn" disabled={pullingModel || localStatus?.selection === "automatic"} onClick={() => void pickModel("auto")}>Usar seleção automática</button></div>
              </div>
              {pullingModel && <p className="muted">Trocando modelo… ({modelStage})</p>}
              <details className="disclosure">
                <summary>Escolha manual avançada</summary>
                <ModelPicker models={models} customModel={customModel} setCustomModel={setCustomModel} onPick={pickModel} disabled={pullingModel} />
              </details>
            </div>
            <div className="section">
              <h3 className="section-title">Desempenho</h3>
              <p className="section-desc">Contexto maior permite conversas mais longas, mas usa mais memória e fica mais lento.</p>
              {hardware && <div className="row">
                <div className="row-text"><div className="row-label">Onde o modelo roda</div><div className="row-desc">{hardware.gpu ? `Placa de vídeo ${hardware.gpu.name}${hardware.gpu.memoryGb ? ` (${hardware.gpu.memoryGb} GB)` : ""}.` : "No processador (nenhuma placa de vídeo compatível): as respostas são mais lentas, e a primeira pode levar perto de um minuto. A Aurora adianta parte do trabalho enquanto você digita."}</div></div>
              </div>}
              <div className="row">
                <div className="row-text"><div className="row-label">Tentativas de correção</div><div className="row-desc">Quantas vezes o modelo tenta corrigir sozinho um erro detectado.</div></div>
                <div className="row-control"><input className="field num-field" type="number" min={0} max={5} step={1} aria-label="Tentativas de correção" value={maxFixAttemptsDraft} onChange={(e) => setMaxFixAttemptsDraft(e.target.value)} /></div>
              </div>
              <div className="row">
                <div className="row-text"><div className="row-label">Contexto (tokens)</div><div className="row-desc">Entre 2.048 e 32.768. O agente usa no mínimo 12.288.</div></div>
                <div className="row-control"><input className="field num-field" type="number" min={2048} max={32768} step={256} aria-label="Contexto em tokens" value={contextTokensDraft} onChange={(e) => setContextTokensDraft(e.target.value)} /></div>
              </div>
              <div className="form-actions">
                {tuningSaved && <span className="settings-saved">Salvo</span>}
                <button className="btn" onClick={() => void saveTuning()}>Salvar</button>
              </div>
              {tuningError && <p className="settings-error">{tuningError}</p>}
            </div>
            <div className="section legacy-panel"><ModelTrainingPanel /></div>
          </>}

          {section === "knowledge" && <>
            <header className="page-header">
              <h2 className="page-title">Conhecimento da empresa</h2>
              <p className="page-desc">Pastas da rede ou do SharePoint sincronizadas pelo OneDrive. A IA local lê Word, Excel, PowerPoint, PDF (inclusive escaneado) e texto, organiza por categoria e responde citando o arquivo. Nada sai deste computador sem a sua autorização.</p>
            </header>
            <div className="section legacy-panel"><KnowledgePanel /></div>
          </>}

          {section === "learning" && <>
            <header className="page-header">
              <h2 className="page-title">Aprendizado</h2>
              <p className="page-desc">A bateria fixa de tarefas roda com o modelo local numa cópia dos seus dados, sem o professor. Compare com e sem memórias e acompanhe a evolução.</p>
            </header>
            <div className="section legacy-panel"><EvalPanel /></div>
          </>}

          {section === "advanced" && <>
            <header className="page-header">
              <h2 className="page-title">Avançado</h2>
            </header>
            <div className="section">
              <h3 className="section-title">Comunidade</h3>
              <p className="section-desc">De onde a página Memória busca pacotes de memória compartilhados.</p>
              <input className="field" value={manifestDraft} onChange={(e) => setManifestDraft(e.target.value)} placeholder="https://.../manifest.json" aria-label="Endereço do catálogo da comunidade" />
              <div className="form-actions">
                {manifestSaved && <span className="settings-saved">Salvo</span>}
                <button className="btn btn-ghost" onClick={() => void saveManifest("")}>Restaurar padrão</button>
                <button className="btn" onClick={() => void saveManifest(manifestDraft)}>Salvar</button>
              </div>
              {manifestError && <p className="settings-error">{manifestError}</p>}
            </div>
            <div className="section">
              <h3 className="section-title">Sandbox de execução</h3>
              <p className="section-desc">Pasta onde fica o código gerado (jogos, páginas, scripts) quando você clica em Executar numa resposta, numa subpasta por conversa.</p>
              <input className="field mono" value={sandboxDraft} onChange={(e) => setSandboxDraft(e.target.value)} placeholder="Ex.: C:\Users\você\Documents\Harness\Sandbox" aria-label="Pasta do sandbox" />
              <div className="form-actions">
                {sandboxSaved && <span className="settings-saved">Salvo</span>}
                <button className="btn btn-ghost" onClick={() => void chooseSandboxFolder()}><Icon name="folder" size={13} /> Escolher pasta…</button>
                <button className="btn" onClick={() => void saveSandboxDir(sandboxDraft)}>Salvar</button>
              </div>
              {sandboxError && <p className="settings-error">{sandboxError}</p>}
            </div>
          </>}
        </div>
      </div>
    </section>
  );
}
