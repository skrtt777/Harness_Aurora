import { useEffect, useRef, useState } from 'react';
import { openArtifact, type Artifact, type OpenArtifact } from './api';
import Markdown from './Markdown';

function previewDocument(content: string) {
  const doc = new DOMParser().parseFromString(content, 'text/html');
  const policy = doc.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'";
  doc.head.prepend(policy);
  return '<!doctype html>' + doc.documentElement.outerHTML;
}

export default function ArtifactPanel({ conversationId, artifacts, selectedId, onSelect, onClose }: {
  conversationId: string; artifacts: Artifact[]; selectedId: string | null;
  onSelect: (id: string) => void; onClose: () => void;
}) {
  const [file, setFile] = useState<OpenArtifact | null>(null);
  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [revision, setRevision] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const cache = useRef(new Map<string, OpenArtifact>());
  useEffect(() => {
    closeRef.current?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onClose]);
  useEffect(() => {
    let stale = false;
    setFile(null); setError(''); setFeedback(''); setMode('preview');
    if (!selectedId) return;
    const cached = cache.current.get(selectedId);
    if (cached) { setFile(cached); return; }
    openArtifact(conversationId, selectedId).then(value => {
      if (!stale) { cache.current.set(selectedId, value); setFile(value); }
    }).catch(e => { if (!stale) setError(e.message); });
    return () => { stale = true; };
  }, [conversationId, selectedId, revision]);
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setFeedback('Copiado'); }
    catch { setFeedback('Não foi possível copiar. Selecione o texto para copiá-lo.'); }
  };
  const download = () => {
    if (!file) return;
    const url = URL.createObjectURL(new Blob([file.content], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = file.name; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const canPreview = file && (file.previewable || ['md', 'markdown'].includes(file.language));
  return <aside className="artifact-panel" aria-label="Arquivos da conversa">
    <header className="artifact-heading"><div><strong>Arquivos</strong><span>{artifacts.length} nesta conversa</span></div>
      <button ref={closeRef} onClick={onClose} aria-label="Fechar arquivos" className="quiet-button">✕</button></header>
    <nav className="artifact-files" aria-label="Selecionar arquivo">
      {artifacts.length === 0 && <p>Os arquivos criados pela Aurora aparecerão aqui.</p>}
      {[...artifacts].reverse().map((artifact, index) => <button key={artifact.id} className={selectedId === artifact.id ? 'selected' : ''} onClick={() => onSelect(artifact.id)} title={artifact.relativePath} aria-pressed={selectedId === artifact.id}>
        <span className="file-symbol">◇</span><span><strong>{artifact.name}</strong><small>{artifact.relativePath}</small></span>
        {index === 0 && <em>Recente</em>}
      </button>)}
    </nav>
    {error && <div role="alert" className="artifact-error">{error}<button onClick={() => setRevision(x => x + 1)}>Tentar novamente</button></div>}
    {!file && selectedId && !error && <p className="artifact-loading" role="status">Abrindo arquivo…</p>}
    {file && <>
      <div className="artifact-toolbar">
        <div role="group" aria-label="Modo de visualização">
          {canPreview && <button aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>Visualizar</button>}
          <button aria-pressed={mode === 'source' || !canPreview} onClick={() => setMode('source')}>Código</button>
        </div>
        <div><button onClick={() => void copy(file.content)}>Copiar</button><button onClick={download}>Baixar</button></div>
      </div>
      <div className="artifact-surface">
        {mode === 'preview' && file.previewable ? <iframe key={`${file.id}-${revision}`} srcDoc={previewDocument(file.content)} title={`Prévia de ${file.name}`} sandbox="allow-scripts allow-pointer-lock" referrerPolicy="no-referrer" />
          : mode === 'preview' && canPreview ? <div className="artifact-document"><Markdown>{file.content}</Markdown></div>
          : <pre tabIndex={0}><code>{file.content}</code></pre>}
      </div>
      <footer className="artifact-footer"><button title="Copiar caminho completo" onClick={() => void copy(file.filePath)}>{file.filePath}</button>
        {file.previewable && <button onClick={() => setRevision(x => x + 1)}>Reiniciar prévia</button>}
        <span role="status">{feedback}</span></footer>
    </>}
  </aside>;
}
