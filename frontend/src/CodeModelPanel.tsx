import { useCallback, useEffect, useState } from 'react';
import { cancelCodeModel, downloadCodeModel, getCodeModel, pickFolder, setCodeModel, type CodeModelStatus } from './api';

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1).replace('.', ',')} GB`;

/**
 * Settings → Editor de código → Autocompletar mais preciso: the small code model of the gray suggestion
 * (app/codeModel.js). Download it into a folder chosen by the person (a drive with room), with progress;
 * turn it on or off. Without it, the suggestion uses the chat model.
 */
export default function CodeModelPanel() {
  const [status, setStatus] = useState<CodeModelStatus | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(() => getCodeModel().then(setStatus).catch(() => setError('Não foi possível ler o modelo de código.')), []);
  useEffect(() => { void refresh(); }, [refresh]);
  const downloading = Boolean(status?.download && !status.download.done && !status.download.error);
  useEffect(() => {
    if (!downloading) return undefined;
    const id = setInterval(() => void refresh(), 1000);
    return () => clearInterval(id);
  }, [downloading, refresh]);
  const act = (fn: () => Promise<CodeModelStatus>) => { setError(''); fn().then(setStatus).catch((e: Error) => setError(e.message)); };
  const chooseDir = async () => { const dir = await pickFolder(); if (dir) act(() => setCodeModel({ dir })); };
  if (!status) return <p className="section-desc">{error || 'Carregando…'}</p>;
  const d = status.download;
  const pct = d ? Math.min(100, Math.round((100 * d.received) / (d.total || status.bytes))) : 0;

  return <div className="vscode-editor code-model">
    <div>
      <strong>Autocompletar mais preciso</strong>
      <small>{status.installed
        ? `${status.name} instalado${status.enabled ? (status.running ? ' · em uso' : ' · liga na próxima sugestão') : ' · desligado'}`
        : `Baixe o ${status.name} (${gb(status.bytes)}, licença ${status.license}): as sugestões em cinza ficam mais certas e mais rápidas (medido: 77% → 87% de acerto, 0,5 s → 0,13 s).`}</small>
      <small>Pasta: {status.dir} <button type="button" className="link-button" disabled={downloading} onClick={() => void chooseDir()}>Trocar pasta</button></small>
      {downloading && d && <div className="code-model-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /><small>{pct}% · {gb(d.received)} de {gb(d.total || status.bytes)}</small></div>}
      {d?.error && <small className="settings-error">{d.error}</small>}
      {error && <small className="settings-error" role="alert">{error}</small>}
    </div>
    <div className="vscode-actions">
      {!status.installed && !downloading && <button className="btn btn-primary" onClick={() => act(downloadCodeModel)}>Baixar ({gb(status.bytes)})</button>}
      {downloading && <button className="btn btn-ghost" onClick={() => act(cancelCodeModel)}>Cancelar</button>}
      {status.installed && <button className="btn btn-ghost" onClick={() => act(() => setCodeModel({ enabled: !status.enabled }))}>{status.enabled ? 'Desligar' : 'Ligar'}</button>}
    </div>
  </div>;
}
