import { useEffect, useState } from 'react';
import { createKnowledgeSourcesBulk, discoverKnowledgeFolders, getPersonalFolders, getSettings, pickFolder, updateSettings, type DiscoveredFolder, type Settings } from './api';
import Icon from './Icon';

const DEPARTMENTS = ['RH', 'Financeiro', 'Controladoria', 'Fiscal', 'Jurídico', 'Comercial', 'Marketing', 'Compras', 'Logística', 'Produção', 'Qualidade', 'SSMA', 'TI', 'Diretoria', 'Administrativo', 'Atendimento'];
type Profile = NonNullable<Settings['usageProfile']>;
const PROFILES: [Profile, string, string][] = [
  ['pessoal', 'Uso pessoal', 'Seus arquivos, projetos e o dia a dia no computador.'],
  ['empresa', 'Empresa', 'Documentos dos setores: RH, Financeiro, Jurídico e os demais.'],
  ['ambos', 'Os dois', 'Seus arquivos e os da empresa.'],
];

/**
 * Where Aurora looks for files, for the two ways of using it. Personal: full computer access
 * (read and search any drive without pointing folders) and, optionally, the personal folders
 * indexed by meaning. Company: sector folders found automatically and confirmed in a list,
 * or pointed one by one in the form below (KnowledgePanel).
 */
export default function FolderSetup({ onChange }: { onChange?: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [personal, setPersonal] = useState<{ folders: { name: string; path: string }[]; drives: string[] } | null>(null);
  const [root, setRoot] = useState('');
  const [found, setFound] = useState<(DiscoveredFolder & { selected: boolean })[] | null>(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    void getSettings().then(setSettings).catch(() => setError('Não foi possível carregar as configurações.'));
    void getPersonalFolders().then(setPersonal).catch(() => {});
  }, []);
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError(''); setNote('');
    try { await fn(); onChange?.(); } catch (e) { setError(e instanceof Error ? e.message : 'Falhou.'); } finally { setBusy(''); }
  };
  const save = (patch: Parameters<typeof updateSettings>[0]) => run('settings', async () => setSettings(await updateSettings(patch)));
  if (!settings) return <p className="section-desc">{error || 'Carregando…'}</p>;
  const profile = settings.usageProfile;
  const showPersonal = profile === 'pessoal' || profile === 'ambos';
  const showCompany = profile === 'empresa' || profile === 'ambos';
  const selected = found?.filter(f => f.selected && !f.registered) || [];

  return <div className="folder-setup">
    <fieldset className="folder-setup-profiles">
      <legend>Como você vai usar a Aurora?</legend>
      {PROFILES.map(([id, label, desc]) => <label key={id} className={profile === id ? 'is-selected' : ''}>
        <input type="radio" name="usage-profile" value={id} checked={profile === id} disabled={!!busy} onChange={() => void save({ usageProfile: id })} />
        <strong>{label}</strong><small>{desc}</small>
      </label>)}
    </fieldset>

    {showPersonal && <section className="folder-setup-block">
      <h3>Seus arquivos</h3>
      <label className="folder-setup-toggle">
        <input type="checkbox" className="switch" checked={settings.fullComputerAccess} disabled={!!busy} onChange={e => void save({ fullComputerAccess: e.target.checked })} />
        <span><strong>Acesso a todo o computador</strong><small>A Aurora lê e procura arquivos em {personal?.drives.join(', ') || 'todos os discos'} sem você apontar pastas. Senhas, chaves, perfis de navegador e pastas do Windows continuam pedindo autorização. Alterar ou apagar fora da pasta do projeto também pede.</small></span>
      </label>
      {personal && personal.folders.length > 0 && <div className="folder-setup-row">
        <span><strong>Lembrar pelo assunto</strong><small>Indexa {personal.folders.map(f => f.name).join(', ')} para achar pelo que o arquivo diz ("aquele contrato do aluguel"), não só pelo nome. Roda em segundo plano e fica só neste computador.</small></span>
        <button className="btn" disabled={!!busy} onClick={() => void run('personal', async () => {
          const created = await createKnowledgeSourcesBulk(personal.folders.map(f => ({ path: f.path, department: 'Pessoal', name: f.name })));
          setNote(created.length ? `Indexando ${created.length} pasta(s). Acompanhe em Conhecimento.` : 'Essas pastas já estão indexadas.');
        })}>{busy === 'personal' ? 'Adicionando…' : 'Indexar minhas pastas'}</button>
      </div>}
    </section>}

    {showCompany && <section className="folder-setup-block">
      <h3>Pastas da empresa</h3>
      <p className="section-desc">Indique a pasta onde ficam os setores (na rede, como <code>\\servidor\dados</code>, ou a biblioteca do SharePoint sincronizada pelo OneDrive). A Aurora reconhece cada setor pelo nome da pasta, como "RH", "02 - Financeiro" ou "SESMT". Deixe em branco para procurar nas unidades de rede e no SharePoint deste computador.</p>
      <form className="project-folder-row" onSubmit={e => { e.preventDefault(); void run('discover', async () => setFound((await discoverKnowledgeFolders(root.trim() ? [root.trim()] : [])).map(f => ({ ...f, selected: !f.registered })))); }}>
        <input className="path-field" placeholder="F:\Empresa ou \\servidor\dados (opcional)" value={root} onChange={e => setRoot(e.target.value)} disabled={!!busy} aria-label="Pasta da empresa" />
        <button type="button" disabled={!!busy} onClick={async () => { const chosen = await pickFolder().catch(() => null); if (chosen) setRoot(chosen); }}><Icon name="folder" size={13} /> Escolher…</button>
        <button className="btn primary" disabled={!!busy}>{busy === 'discover' ? 'Procurando…' : 'Procurar setores'}</button>
      </form>
      {found && (found.length === 0
        ? <p className="section-desc">Nenhuma pasta com nome de setor por aqui. Indique outra pasta ou cadastre cada uma no formulário de Conhecimento, escolhendo o setor.</p>
        : <div className="folder-setup-found">
          <p className="section-desc">Confira o setor de cada pasta e desmarque o que não for da empresa. Nada é lido antes de você cadastrar.</p>
          <ul>{found.map((f, i) => <li key={f.path}>
            <label><input type="checkbox" checked={f.selected && !f.registered} disabled={f.registered || !!busy} onChange={e => setFound(list => list!.map((x, j) => j === i ? { ...x, selected: e.target.checked } : x))} />
              <span className="mono">{f.path}</span></label>
            <select value={f.department} disabled={f.registered || !!busy} aria-label={`Setor de ${f.name}`} onChange={e => setFound(list => list!.map((x, j) => j === i ? { ...x, department: e.target.value } : x))}>
              {[...new Set([f.department, ...DEPARTMENTS])].map(d => <option key={d}>{d}</option>)}
            </select>
            <small>{f.registered ? 'já cadastrada' : `${f.documents >= 2000 ? '2000+' : f.documents} documentos · ${f.origin}`}</small>
          </li>)}</ul>
          <button className="btn primary" disabled={!selected.length || !!busy} onClick={() => void run('add', async () => {
            const created = await createKnowledgeSourcesBulk(selected.map(f => ({ path: f.path, department: f.department })));
            setFound(list => list!.map(f => created.some(c => c.path.toLowerCase() === f.path.toLowerCase()) ? { ...f, registered: true } : f));
            setNote(`${created.length} pasta(s) cadastrada(s). A IA local está lendo e organizando os documentos; isso leva alguns minutos.`);
          })}>{busy === 'add' ? 'Cadastrando…' : `Cadastrar ${selected.length} pasta(s)`}</button>
        </div>)}
      <p className="section-desc">Também dá para pedir no chat: <em>"minhas pastas da empresa ficam em F:\Empresa, configure para mim"</em>. A Aurora mostra a lista e só cadastra depois que você confirmar.</p>
    </section>}

    {!profile && <p className="section-desc">Escolha uma opção para ver como configurar.</p>}
    {note && <p className="settings-saved" role="status">{note}</p>}
    {error && <p className="settings-error">{error}</p>}
  </div>;
}
