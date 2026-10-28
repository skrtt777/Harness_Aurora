import { useCallback, useEffect, useState } from 'react';
import { cancelCodeModel, downloadCodeModel, getCodeModel, pickFolder, setCodeModel, type CodeModelInfo, type CodeModelStatus } from './api';

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1).replace('.', ',')} GB`;

/**
 * Settings → Editor de código → the code models (app/codeModel.js). "Padrão": the small coder for the gray
 * suggestion (when downloaded) and the chat model for Ctrl+I. "Forte": Qwen3-Coder 30B-A3B for both,
 * the video card holding what fits and the rest in RAM. Each one is downloaded into a folder chosen by
 * the person (a drive with room), with progress; nothing changes until the person picks it.
 */
export default function CodeModelPanel() {
  const [status, setStatus] = useState<CodeModelStatus | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(() => getCodeModel().then(setStatus).catch(() => setError('Não foi possível ler os modelos de código.')), []);
  useEffect(() => { void refresh(); }, [refresh]);
  const busy = (m?: CodeModelInfo) => Boolean(m?.download && !m.download.done && !m.download.error);
  const downloading = busy(status?.models?.fim) || busy(status?.models?.strong);
  useEffect(() => {
    if (!downloading) return undefined;
    const id = setInterval(() => void refresh(), 1000);
    return () => clearInterval(id);
  }, [downloading, refresh]);
  const act = (fn: () => Promise<CodeModelStatus>) => { setError(''); fn().then(setStatus).catch((e: Error) => setError(e.message)); };
  const chooseDir = async () => { const dir = await pickFolder(); if (dir) act(() => setCodeModel({ dir })); };
  if (!status?.models) return <p className="section-desc">{error || 'Carregando…'}</p>;
  const { fim, strong } = status.models;

  const row = (which: 'fim' | 'strong', m: CodeModelInfo, title: string, what: string, extra?: JSX.Element) => {
    const d = m.download;
    const pct = d ? Math.min(100, Math.round((100 * d.received) / (d.total || m.bytes))) : 0;
    return <div className="vscode-editor code-model" key={which}>
      <div>
        <strong>{title}</strong>
        <small>{m.installed ? `${m.name} instalado${m.running ? ' · em uso' : m.loading ? ' · carregando…' : ''}` : `${m.name} · ${gb(m.bytes)} · licença ${m.license}`}</small>
        <small>{what}</small>
        {busy(m) && d && <div className="code-model-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /><small>{pct}% · {gb(d.received)} de {gb(d.total || m.bytes)}</small></div>}
        {d?.error && <small className="settings-error">{d.error}</small>}
      </div>
      <div className="vscode-actions">
        {!m.installed && !busy(m) && <button className="btn btn-primary" onClick={() => act(() => downloadCodeModel(which))}>Baixar ({gb(m.bytes)})</button>}
        {busy(m) && <button className="btn btn-ghost" onClick={() => act(() => cancelCodeModel(which))}>Cancelar</button>}
        {extra}
      </div>
    </div>;
  };

  return <div className="code-models">
    <div className="code-model-profile" role="radiogroup" aria-label="Modelo de código">
      <label className={status.profile === 'padrao' ? 'on' : ''}>
        <input type="radio" name="code-profile" checked={status.profile === 'padrao'} onChange={() => act(() => setCodeModel({ profile: 'padrao' }))} />
        <span><b>Padrão</b><small>Leve e rápido: o modelo do chat no Ctrl+I e, se baixado, o coder de 1,5B nas sugestões.</small></span>
      </label>
      <label className={status.profile === 'forte' ? 'on' : ''}>
        <input type="radio" name="code-profile" checked={status.profile === 'forte'} disabled={!strong.installed} onChange={() => act(() => setCodeModel({ profile: 'forte' }))} />
        <span><b>Forte</b><small>{strong.installed ? 'Qwen3-Coder 30B-A3B no Ctrl+I e nas sugestões: código mais certo. Usa a placa de vídeo no que couber e a RAM no resto.' : 'Baixe o modelo forte abaixo para escolher.'}</small></span>
      </label>
    </div>
    {row('fim', fim, 'Autocompletar mais preciso', 'Sugestões em cinza mais certas e mais rápidas no perfil Padrão (medido: 77% → 87% de acerto, 0,5 s → 0,13 s).',
      fim.installed ? <button className="btn btn-ghost" onClick={() => act(() => setCodeModel({ enabled: !status.enabled }))}>{status.enabled ? 'Desligar' : 'Ligar'}</button> : undefined)}
    {row('strong', strong, 'Modelo de código forte', 'Para quem tem 20 GB ou mais entre placa de vídeo e RAM. Cada palavra usa só 3B dos 30B de parâmetros, por isso continua rápido.')}
    <small className="code-model-dir">Pasta dos modelos: {status.dir} <button type="button" className="link-button" disabled={downloading} onClick={() => void chooseDir()}>Trocar pasta</button></small>
    {error && <small className="settings-error" role="alert">{error}</small>}
  </div>;
}
