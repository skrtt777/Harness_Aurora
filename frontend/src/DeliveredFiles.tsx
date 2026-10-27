import { useState } from 'react';
import { canOpenFiles, deliveredFiles, openDeliveredFile, showDeliveredFile, type AgentStep, type Proof } from './api';
import Icon from './Icon';

/** The files an answer delivered, so "onde está?" isn't needed: open it or show it in Explorer. */
/** A delivered document's comprovante, as a badge: every number proven, or which ones have no source. */
function DocumentSeal({ proof }: { proof: Proof }) {
  const missing = [...new Set(proof.claims.filter((c) => c.status === 'sem-prova').map((c) => c.raw))];
  const title = missing.length ? `Sem fonte: ${missing.join(', ')}` : `Todos os números vêm de ${proof.sources.join(', ') || 'contas com os dados lidos'}`;
  return <span className={`document-seal ${proof.seal}`} title={title}>
    <span aria-hidden="true">{proof.seal === 'comprovado' ? '✓' : '!'}</span>
    {proof.seal === 'comprovado' ? `${proof.proven} de ${proof.total} números comprovados` : `${missing.length} número${missing.length === 1 ? '' : 's'} sem fonte`}
  </span>;
}

export default function DeliveredFiles({ steps, files: given, proofs = [] }: { steps?: AgentStep[]; files?: string[]; proofs?: { file: string; proof: Proof }[] }) {
  const files = given ?? deliveredFiles(steps);
  const [error, setError] = useState('');
  if (!files.length) return null;
  const act = (fn: () => Promise<unknown> | undefined) => { setError(''); Promise.resolve(fn()).catch((e: Error) => setError(e.message)); };
  return <div className="delivered-files">
    {files.map((file) => {
      const name = file.split(/[\\/]/).pop() || file;
      return <div key={file} className="delivered-file" title={file}>
        <Icon name="file" size={16} />
        <span className="delivered-file-name"><strong>{name}</strong><small>{file.slice(0, file.length - name.length - 1)}</small></span>
        {(() => { const p = proofs.find((d) => d.file === file); return p ? <DocumentSeal proof={p.proof} /> : null; })()}
        {canOpenFiles() && <span className="delivered-file-actions">
          <button type="button" onClick={() => act(() => openDeliveredFile(file))}>Abrir</button>
          <button type="button" onClick={() => act(() => showDeliveredFile(file))}>Mostrar na pasta</button>
        </span>}
      </div>;
    })}
    {error && <p className="delivered-file-error" role="alert">{error}</p>}
  </div>;
}
