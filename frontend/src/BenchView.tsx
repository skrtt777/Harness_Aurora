import { useEffect, useRef, useState } from 'react';
import { ApiError, getBench, getBenchPreview, saveBenchDecision, type BenchMaterial, type BenchSnapshot, type BenchDecisionInput } from './api';
import './bench.css';
function ReferenceImage({ material }: { material: BenchMaterial }) {
  const [image, setImage] = useState('');
  useEffect(() => { let live = true; setImage('');
    if (material.hasPreview) void getBenchPreview(material.projectId, material.id).then(p => { if (live) setImage(`data:${p.mime};base64,${p.image}`); }).catch(() => {});
    return () => { live = false; };
  }, [material.id, material.projectId, material.hasPreview]);
  return image ? <img src={image} alt={material.title} /> : <div className="bench-placeholder">{material.fileName ? 'Arquivo recebido • prévia indisponível' : 'Ideia em texto'}</div>;
}
export default function BenchView({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [snapshot, setSnapshot] = useState<BenchSnapshot | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const storageKey = `aurora-bench-pending:${projectId}`;
  const pending = useRef<BenchDecisionInput | null>(null);
  const locked = useRef(false);
  useEffect(() => {
    try { const raw = localStorage.getItem(storageKey); if(raw) { pending.current = JSON.parse(raw); setContent(pending.current?.content || ''); setSelected(pending.current?.materialIds || []); setError('Há uma confirmação pendente. Use Confirmar para recuperar o resultado com o mesmo identificador.'); } } catch { /* Invalid local draft is ignored. */ }
    let live = true, fetching = false;
    const refresh = async () => { if(fetching) return; fetching = true; try { const next = await getBench(projectId); if(live) setSnapshot(next); } catch { if(live) setError('PC indisponível. Os materiais já carregados permanecem visíveis.'); } finally { fetching = false; } };
    void refresh(); const timer = window.setInterval(refresh, 3000);
    return () => { live = false; window.clearInterval(timer); };
  }, [projectId, storageKey]);
  const save = async () => {
    if(!snapshot || locked.current || (!pending.current && !content.trim())) return;
    locked.current = true; setBusy(true); setError(''); setSaved('');
    try {
      if(!pending.current) pending.current = { operationKey: `desktop:${crypto.randomUUID()}`, expectedRevision: snapshot.revision, materialIds: selected, content: content.trim() };
      localStorage.setItem(storageKey, JSON.stringify(pending.current));
      await saveBenchDecision(projectId, pending.current);
      pending.current = null; localStorage.removeItem(storageKey); setContent(''); setSelected([]); setSaved('Decisão salva no PC e nas memórias deste projeto.');
      setSnapshot(await getBench(projectId));
    } catch(e) {
      if(e instanceof ApiError && e.status === 409) { pending.current = null; localStorage.removeItem(storageKey); setSnapshot(await getBench(projectId).catch(() => snapshot)); }
      setError(e instanceof Error ? e.message : 'Falha ao confirmar. Tente novamente com o mesmo pedido.');
    } finally { locked.current = false; setBusy(false); }
  };
  const toggle = (id: string) => { if(pending.current) return; setSelected(ids => ids.includes(id) ? ids.filter(x=>x!==id) : ids.length < 3 ? [...ids,id] : ids); };
  return <section className="bench-view" aria-label="Bancada criativa">
    <header><div><span className="bench-eyebrow">AURORA / BANCADA CRIATIVA</span><h1>{snapshot?.project.name || 'Abrindo projeto…'}</h1><p>Referências do celular, ideias no espaço e decisões no seu PC.</p></div><button onClick={onClose}>Voltar à conversa</button></header>
    <p className="bench-instruction">No Telegram: <code>/bancada {snapshot?.project.name || 'nome do projeto'}</code>. Depois envie uma foto ou <code>/referencia sua ideia</code>.</p>
    {error && <p role="alert" className="bench-notice">{error}</p>}{saved && <p role="status" className="bench-notice">{saved}</p>}
    <div className="bench-columns"><div><h2>Referências <small>{snapshot?.materials.length || 0}</small></h2><p>Selecione até três materiais para vincular à decisão.</p>
      <div className="bench-materials">{snapshot?.materials.map(m=><button key={m.id} className={`bench-material ${selected.includes(m.id)?'selected':''}`} aria-pressed={selected.includes(m.id)} onClick={()=>toggle(m.id)} disabled={busy || Boolean(pending.current)}><ReferenceImage material={m}/><strong>{m.title}</strong><span>{m.note || m.fileName}</span><small>{m.source} · {new Date(m.createdAt).toLocaleString('pt-BR')}</small></button>)}</div>
      {snapshot && !snapshot.materials.length && <p className="bench-empty">A bancada está pronta para a primeira referência. Envie uma foto ou ideia pelo Telegram.</p>}
    </div><aside><h2>Decisão em construção</h2><label htmlFor="bench-decision">O que você decidiu?</label><textarea id="bench-decision" maxLength={12000} value={content} disabled={busy || Boolean(pending.current)} onChange={e=>setContent(e.target.value)} placeholder="Escreva a decisão depois de revisar as referências…"/><p>{selected.length} referência(s) vinculada(s). Salvar cria uma memória no projeto.</p><button className="bench-confirm" onClick={()=>void save()} disabled={busy || !snapshot || !content.trim()}>{busy?'Confirmando no PC…':pending.current?'Recuperar confirmação':'Confirmar decisão no PC'}</button>
      <h2>Decisões salvas</h2>{snapshot?.decisions.map(d=><article key={d.id} className="bench-decision"><p>{d.content}</p><small>{d.materialIds.length} referência(s) · {new Date(d.createdAt).toLocaleString('pt-BR')}</small></article>)}
    </aside></div>
  </section>;
}
