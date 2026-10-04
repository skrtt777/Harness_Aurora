import { useCallback, useEffect, useState } from 'react';
import { createKnowledgeSource, decideKnowledgeSuggestion, deleteKnowledgeSource, getKnowledgeMap, getKnowledgeSources, getKnowledgeSuggestions, pickFolder, reindexKnowledgeSource, reviewKnowledgeSource, updateKnowledgeSource, type KnowledgeCategory, type KnowledgeSource, type KnowledgeSuggestion } from './api';

const FIELD_LABEL: Record<KnowledgeSuggestion['field'], string> = { title: 'Título', summary: 'Resumo', keywords: 'Palavras-chave', type: 'Tipo', category: 'Categoria', flow: 'Passo a passo' };
const shown = (value: string | string[] | null) => (Array.isArray(value) ? value.join(', ') : value || '—');
import Icon from './Icon';
import FolderSetup from './FolderSetup';

// Company knowledge: folders on the network (\\servidor\RH) or SharePoint
// libraries synced by OneDrive, indexed and organized by the local model.
export default function KnowledgePanel() {
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [map, setMap] = useState<KnowledgeCategory[]>([]);
  const [draft, setDraft] = useState({ name: '', department: '', path: '', paidAllowed: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<KnowledgeSuggestion[]>([]);
  const [reviewing, setReviewing] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const refresh = useCallback(async () => {
    try { setSources(await getKnowledgeSources()); setMap(await getKnowledgeMap()); setSuggestions(await getKnowledgeSuggestions()); } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao carregar.'); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const indexing = sources.some(s => s.job && !s.job.finished);
  useEffect(() => {
    if (!indexing) return;
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [indexing, refresh]);
  const act = async (fn: () => Promise<unknown>) => { setError(''); try { await fn(); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Falha.'); } };
  return <div className="knowledge-panel">
    <FolderSetup onChange={() => void refresh()} />
    {sources.map(source => <div key={source.id} className="knowledge-source">
      <div><strong>{source.department}</strong> · {source.name}<br /><small>{source.path}</small></div>
      <small>
        {source.job && !source.job.finished ? `Indexando ${source.job.done}/${source.job.total}${source.job.current ? ` — ${source.job.current}` : ''}` : `${source.documents} documentos${source.failed ? ` · ${source.failed} sem texto` : ''}${source.indexedAt ? ` · atualizado ${new Date(source.indexedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : ''}`}
        {source.lastError && <span className="memory-form-error"> {source.lastError}</span>}
      </small>
      <div className="settings-actions">
        <label title="Se desligado, trechos destes documentos só vão para Codex/Claude com a sua autorização"><input type="checkbox" checked={source.paidAllowed} onChange={e => act(() => updateKnowledgeSource(source.id, { paidAllowed: e.target.checked }))} /> IA paga pode ver</label>
        <button onClick={() => act(() => reindexKnowledgeSource(source.id))}>Atualizar agora</button>
        <button disabled={!!reviewing || !source.documents} title="Codex/Claude revisa as fichas (título, resumo, categoria, palavras-chave), nunca o texto dos documentos. Nada muda sem você aceitar." onClick={() => {
          if (!source.paidAllowed && !confirm(`"${source.name}" não está liberada para IA paga. Enviar as fichas de até 60 documentos (título, resumo, palavras-chave e caminho; não o texto) para revisão?`)) return;
          setReviewing(source.id); setReviewNote('');
          void act(async () => { const r = await reviewKnowledgeSource(source.id, !source.paidAllowed); setReviewNote(`${r.teacher === 'claude' ? 'Claude' : 'Codex'} revisou ${r.reviewed} fichas: ${r.suggestions} sugestões. ${r.taxonomy}`); }).finally(() => setReviewing(''));
        }}>{reviewing === source.id ? 'Revisando…' : 'Revisar com IA paga'}</button>
        <button onClick={() => { if (confirm(`Remover "${source.name}" do conhecimento? Os arquivos na pasta não são apagados.`)) void act(() => deleteKnowledgeSource(source.id)); }}>Remover</button>
      </div>
    </div>)}
    <form className="knowledge-add" onSubmit={e => { e.preventDefault(); setBusy(true); void act(async () => { await createKnowledgeSource(draft); setDraft({ name: '', department: '', path: '', paidAllowed: false }); }).finally(() => setBusy(false)); }}>
      <input placeholder="Departamento (ex.: RH)" value={draft.department} onChange={e => setDraft({ ...draft, department: e.target.value })} required disabled={busy} />
      <input placeholder="Nome (ex.: Pasta do RH)" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} disabled={busy} />
      <span className="project-folder-row">
        <input className="path-field" placeholder={'\\\\servidor\\RH ou a pasta do SharePoint sincronizada'} value={draft.path} onChange={e => setDraft({ ...draft, path: e.target.value })} required disabled={busy} />
        <button type="button" disabled={busy} onClick={async () => { const chosen = await pickFolder().catch(() => null); if (chosen) setDraft(d => ({ ...d, path: chosen })); }}><Icon name="folder" size={13} /> Escolher…</button>
      </span>
      <label><input type="checkbox" checked={draft.paidAllowed} onChange={e => setDraft({ ...draft, paidAllowed: e.target.checked })} disabled={busy} /> IA paga (Codex/Claude) pode ver estes documentos sem perguntar</label>
      <button className="primary" disabled={busy}>{busy ? 'Adicionando…' : 'Adicionar pasta'}</button>
    </form>
    {error && <p className="memory-form-error">{error}</p>}
    {reviewNote && <p><small>{reviewNote}</small></p>}
    {suggestions.length > 0 && <details className="knowledge-map" open><summary>Sugestões da revisão ({suggestions.length})</summary>
      <ul>{suggestions.map(s => <li key={s.id}><strong>{s.title}</strong> <small>{s.relPath}</small>
        <p>{FIELD_LABEL[s.field]}: <s>{shown(s.previous)}</s> → <strong>{shown(s.value)}</strong>{s.reason && <small> — {s.reason}</small>}</p>
        <span className="settings-actions"><button onClick={() => act(() => decideKnowledgeSuggestion(s.id, 'accept'))}>Aceitar</button><button onClick={() => act(() => decideKnowledgeSuggestion(s.id, 'reject'))}>Recusar</button></span></li>)}</ul>
      <button onClick={() => act(async () => { for (const s of suggestions) await decideKnowledgeSuggestion(s.id, 'accept'); })}>Aceitar todas</button>
    </details>}
    {map.length > 0 && <details className="knowledge-map"><summary>Mapa do conhecimento ({map.reduce((n, c) => n + c.documents.length, 0)} documentos em {map.length} categorias)</summary>
      {map.map(category => <details key={category.category}><summary>{category.category} ({category.documents.length})</summary>
        <ul>{category.documents.map(doc => <li key={doc.path}><strong>{doc.title}</strong> <small>{doc.relPath}{doc.ocr ? ' · lido por OCR' : ''}</small>{doc.summary && <p>{doc.summary}</p>}
          {doc.flow.length > 0 && <ol>{doc.flow.map((step, i) => <li key={i}>{step}</li>)}</ol>}</li>)}</ul>
      </details>)}
    </details>}
  </div>;
}
