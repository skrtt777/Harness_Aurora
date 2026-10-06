import { useCallback, useEffect, useState } from 'react';
import { createKnowledgeSource, deleteKnowledgeSource, getKnowledgeSources, getPersonalFolders, getSettings, pickFolder, updateSettings, type KnowledgeSource, type Settings } from './api';
import CompanyFolders from './FolderSetup';
import ComputerMapPanel from './ComputerMapPanel';
import Icon from './Icon';

type Mode = 'consult' | 'organize';
type Entry = { path: string; name: string; organize: boolean; source: KnowledgeSource | null };

const norm = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
const tail = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

/**
 * Every folder the Aurora uses, in one list, each with one plain choice: "Só consultar" (it reads
 * and finds things there; the folder becomes knowledge) or "Consultar e organizar" (it may also
 * create, move and edit files there). Before this, the same idea lived in four places with
 * technical names ("pastas de trabalho", "indexar", "conhecimento").
 */
export default function FoldersPanel({ compact = false }: { compact?: boolean }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [personal, setPersonal] = useState<{ name: string; path: string }[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [company, setCompany] = useState(false);

  const refresh = useCallback(async () => {
    const [s, k] = await Promise.all([getSettings(), getKnowledgeSources()]);
    setSettings(s); setSources(k);
  }, []);
  useEffect(() => {
    void refresh().catch(() => setError('Não foi possível carregar as pastas.'));
    void getPersonalFolders().then((p) => setPersonal(p.folders)).catch(() => {});
  }, [refresh]);
  // Reading a folder takes minutes: follow it while it runs.
  const reading = sources.some((s) => s.job && !s.job.finished);
  useEffect(() => {
    if (!reading) return undefined;
    const id = setInterval(() => void refresh().catch(() => {}), 2000);
    return () => clearInterval(id);
  }, [reading, refresh]);

  if (!settings) return <p className="section-desc">{error || 'Carregando…'}</p>;
  const roots = settings.agentAllowedRoots || [];
  const friendly = (path: string) => personal.find((f) => norm(f.path) === norm(path))?.name || tail(path);
  const entries: Entry[] = [];
  for (const path of roots) entries.push({ path, name: friendly(path), organize: true, source: null });
  for (const source of sources) {
    const same = entries.find((e) => norm(e.path) === norm(source.path));
    if (same) same.source = source;
    else entries.push({ path: source.path, name: source.department && source.department !== 'Geral' && source.department !== 'Pessoal' ? `${friendly(source.path)} (${source.department})` : friendly(source.path), organize: false, source });
  }
  const known = new Set(entries.map((e) => norm(e.path)));
  const suggestions = personal.filter((f) => !known.has(norm(f.path)));

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Não deu certo.'); } finally { setBusy(false); }
  };
  const setRoots = (next: string[]) => updateSettings({ agentAllowedRoots: next });
  const setMode = (entry: Entry, mode: Mode) => act(async () => {
    if (mode === 'organize' && !entry.organize) await setRoots([...roots, entry.path]);
    if (mode === 'consult') {
      if (entry.organize) await setRoots(roots.filter((r) => norm(r) !== norm(entry.path)));
      if (!entry.source) await createKnowledgeSource({ name: entry.name, department: 'Pessoal', path: entry.path, paidAllowed: false });
    }
  });
  const add = (path: string, mode: Mode) => act(async () => {
    if (known.has(norm(path))) throw new Error('Essa pasta já está na lista.');
    if (mode === 'organize') await setRoots([...roots, path]);
    else await createKnowledgeSource({ name: friendly(path), department: 'Pessoal', path, paidAllowed: false });
    setPending(null); setTyped('');
  });
  const remove = (entry: Entry) => {
    if (!window.confirm(`A Aurora deixa de usar "${entry.name}". Nenhum arquivo é apagado.`)) return;
    void act(async () => {
      if (entry.organize) await setRoots(roots.filter((r) => norm(r) !== norm(entry.path)));
      if (entry.source) await deleteKnowledgeSource(entry.source.id);
    });
  };
  const choose = async () => {
    const chosen = await pickFolder().catch(() => null);
    if (chosen) setPending(chosen);
    else setPending(''); // no folder picker (browser): type the path
  };

  const status = (e: Entry) => {
    const s = e.source;
    if (s?.job && !s.job.finished) return `Lendo os documentos… ${s.job.done} de ${s.job.total}`;
    if (s?.lastError) return `Não consegui ler: ${s.lastError}`;
    if (s && !s.indexedAt && !s.documents) return 'Vai ler os documentos em instantes';
    if (s) return `${s.documents} documento(s) lido(s)${s.failed ? ` · ${s.failed} sem texto` : ''}`;
    return 'Pode ler, criar, organizar e editar arquivos aqui';
  };

  return <div className="folders-panel">
    <ul className="folders-list" aria-label="Pastas que a Aurora usa">
      {entries.length === 0 && <li className="folders-empty">Nenhuma pasta ainda. Adicione abaixo as pastas onde ficam os seus arquivos.</li>}
      {entries.map((e) => <li key={e.path} className="folder-card" aria-label={e.name}>
        <Icon name="folder" size={18} />
        <div className="folder-card-text">
          <strong>{e.name}</strong>
          <small className="mono" title={e.path}>{e.path}</small>
          <small className={e.source?.lastError ? 'folder-card-error' : 'folder-card-status'}>{status(e)}</small>
        </div>
        <div className="folder-card-mode segmented" role="group" aria-label={`O que a Aurora pode fazer em ${e.name}`}>
          <button type="button" aria-pressed={!e.organize} disabled={busy} title="Ela lê e encontra coisas aqui, mas não muda nada" onClick={() => void setMode(e, 'consult')}>Só consultar</button>
          <button type="button" aria-pressed={e.organize} disabled={busy} title="Ela também cria, organiza e edita arquivos aqui (e você pode desfazer)" onClick={() => void setMode(e, 'organize')}>Consultar e organizar</button>
        </div>
        <button type="button" className="btn btn-ghost btn-sm folder-card-remove" disabled={busy} aria-label={`Remover ${e.name}`} onClick={() => remove(e)}>Remover</button>
      </li>)}
    </ul>

    {pending !== null
      ? <div className="folder-pending" role="group" aria-label="Nova pasta">
        {pending
          ? <p><Icon name="folder" size={14} /> <strong>{friendly(pending)}</strong> <small className="mono">{pending}</small></p>
          : <input className="field mono" autoFocus placeholder="Caminho da pasta" aria-label="Caminho da pasta" value={typed} onChange={(ev) => setTyped(ev.target.value)} />}
        <p className="section-desc">O que a Aurora pode fazer nesta pasta?</p>
        <div className="folder-pending-actions">
          <button className="btn" disabled={busy || !(pending || typed.trim())} onClick={() => void add(pending || typed.trim(), 'consult')}>Só consultar</button>
          <button className="btn btn-primary" disabled={busy || !(pending || typed.trim())} onClick={() => void add(pending || typed.trim(), 'organize')}>Consultar e organizar</button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => { setPending(null); setTyped(''); }}>Cancelar</button>
        </div>
      </div>
      : <div className="folder-add-row">
        <button className="btn btn-primary" disabled={busy} onClick={() => void choose()}><Icon name="folder" size={14} /> Adicionar pasta</button>
        {suggestions.map((f) => <button key={f.path} className="btn btn-ghost" disabled={busy} title={f.path} onClick={() => setPending(f.path)}>+ {f.name}</button>)}
      </div>}

    <label className="folder-setup-toggle">
      <input type="checkbox" className="switch" checked={settings.fullComputerAccess} disabled={busy} onChange={(ev) => void act(() => updateSettings({ fullComputerAccess: ev.target.checked }))} />
      <span><strong>Procurar em todo o computador</strong><small>Quando você perguntar por um arquivo, a Aurora também procura fora das pastas da lista, só para ler. Senhas e pastas do Windows ficam de fora, e mudar qualquer coisa fora da lista sempre pede permissão.</small></span>
    </label>

    {!compact && <section className="folders-map"><h3 className="section-title">Mapa do computador</h3><ComputerMapPanel /></section>}

    {!compact && <details className="folder-company" open={company} onToggle={(ev) => setCompany((ev.target as HTMLDetailsElement).open)}>
      <summary>Pasta da empresa com uma pasta por setor (RH, Financeiro…)</summary>
      {company && <CompanyFolders onChange={() => void refresh()} />}
    </details>}
    {error && <p role="alert" className="settings-error">{error}</p>}
  </div>;
}
