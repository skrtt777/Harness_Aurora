import { useState } from 'react';
import { createKnowledgeSourcesBulk, discoverKnowledgeFolders, pickFolder, type DiscoveredFolder } from './api';
import Icon from './Icon';

const DEPARTMENTS = ['RH', 'Financeiro', 'Controladoria', 'Fiscal', 'Jurídico', 'Comercial', 'Marketing', 'Compras', 'Logística', 'Produção', 'Qualidade', 'SSMA', 'TI', 'Diretoria', 'Administrativo', 'Atendimento'];

/**
 * The company's shared folder with one subfolder per sector (RH, Financeiro…): the sectors are found
 * by their folder names, confirmed in a list, and each becomes a folder the Aurora consults.
 */
export default function CompanyFolders({ onChange }: { onChange?: () => void }) {
  const [root, setRoot] = useState('');
  const [found, setFound] = useState<(DiscoveredFolder & { selected: boolean })[] | null>(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError(''); setNote('');
    try { await fn(); onChange?.(); } catch (e) { setError(e instanceof Error ? e.message : 'Falhou.'); } finally { setBusy(''); }
  };
  const selected = found?.filter(f => f.selected && !f.registered) || [];

  return <div className="folder-setup">
    <p className="section-desc">Escolha a pasta onde ficam os setores (na rede, ou a do SharePoint sincronizada pelo OneDrive). A Aurora reconhece cada setor pelo nome da pasta, como "RH" ou "02 - Financeiro".</p>
    <form className="project-folder-row" onSubmit={e => { e.preventDefault(); void run('discover', async () => setFound((await discoverKnowledgeFolders(root.trim() ? [root.trim()] : [])).map(f => ({ ...f, selected: !f.registered })))); }}>
      <input className="path-field" placeholder="Pasta da empresa (opcional)" value={root} onChange={e => setRoot(e.target.value)} disabled={!!busy} aria-label="Pasta da empresa" />
      <button type="button" disabled={!!busy} onClick={async () => { const chosen = await pickFolder().catch(() => null); if (chosen) setRoot(chosen); }}><Icon name="folder" size={13} /> Escolher…</button>
      <button className="btn primary" disabled={!!busy}>{busy === 'discover' ? 'Procurando…' : 'Procurar setores'}</button>
    </form>
    {found && (found.length === 0
      ? <p className="section-desc">Nenhuma pasta com nome de setor aqui. Escolha outra pasta, ou adicione cada pasta de setor na lista acima.</p>
      : <div className="folder-setup-found">
        <p className="section-desc">Confira o setor de cada pasta e desmarque o que não for da empresa. Nada é lido antes de você confirmar.</p>
        <ul>{found.map((f, i) => <li key={f.path}>
          <label><input type="checkbox" checked={f.selected && !f.registered} disabled={f.registered || !!busy} onChange={e => setFound(list => list!.map((x, j) => j === i ? { ...x, selected: e.target.checked } : x))} />
            <span className="mono">{f.path}</span></label>
          <select value={f.department} disabled={f.registered || !!busy} aria-label={`Setor de ${f.name}`} onChange={e => setFound(list => list!.map((x, j) => j === i ? { ...x, department: e.target.value } : x))}>
            {[...new Set([f.department, ...DEPARTMENTS])].map(d => <option key={d}>{d}</option>)}
          </select>
          <small>{f.registered ? 'já adicionada' : `${f.documents >= 2000 ? '2000+' : f.documents} documentos`}</small>
        </li>)}</ul>
        <button className="btn primary" disabled={!selected.length || !!busy} onClick={() => void run('add', async () => {
          const created = await createKnowledgeSourcesBulk(selected.map(f => ({ path: f.path, department: f.department })));
          setFound(list => list!.map(f => created.some(c => c.path.toLowerCase() === f.path.toLowerCase()) ? { ...f, registered: true } : f));
          setNote(`${created.length} pasta(s) adicionada(s). A Aurora está lendo os documentos; isso leva alguns minutos.`);
        })}>{busy === 'add' ? 'Adicionando…' : `Adicionar ${selected.length} pasta(s)`}</button>
      </div>)}
    {note && <p className="settings-saved" role="status">{note}</p>}
    {error && <p className="settings-error">{error}</p>}
  </div>;
}
