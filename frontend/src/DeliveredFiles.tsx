import { useState } from 'react';
import { canOpenFiles, deliveredFiles, openDeliveredFile, showDeliveredFile, type AgentStep } from './api';
import Icon from './Icon';

/** The files an answer delivered, so "onde está?" isn't needed: open it or show it in Explorer. */
export default function DeliveredFiles({ steps, files: given }: { steps?: AgentStep[]; files?: string[] }) {
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
        {canOpenFiles() && <span className="delivered-file-actions">
          <button type="button" onClick={() => act(() => openDeliveredFile(file))}>Abrir</button>
          <button type="button" onClick={() => act(() => showDeliveredFile(file))}>Mostrar na pasta</button>
        </span>}
      </div>;
    })}
    {error && <p className="delivered-file-error" role="alert">{error}</p>}
  </div>;
}
