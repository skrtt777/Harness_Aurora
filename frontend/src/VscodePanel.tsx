import { useCallback, useEffect, useState } from 'react';
import { downloadVsix, getVscode, installVscode, openExternalUrl, type VscodeStatus } from './api';

/**
 * Settings → Editor de código: the Aurora extension that comes with the Harness, and each editor found
 * on this PC (VS Code, Cursor, Windsurf…) with the version it has. "Instalar" or "Atualizar" runs the
 * editor's own installer; nothing is installed without the click.
 */
export default function VscodePanel() {
  const [status, setStatus] = useState<VscodeStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const refresh = useCallback(() => getVscode().then(setStatus).catch(() => setError('Não foi possível procurar os editores.')), []);
  useEffect(() => { void refresh(); }, [refresh]);
  const install = (id: string) => {
    setBusy(id); setError(''); setNote('');
    installVscode(id).then((r) => { setNote(r.message); return refresh(); }).catch((e: Error) => setError(e.message)).finally(() => setBusy(null));
  };
  if (!status) return <p className="section-desc">{error || 'Procurando editores neste computador…'}</p>;
  const version = status.vsix?.version;

  return <div className="vscode-panel">
    <ul className="vscode-features">
      <li><b>Painel próprio</b> (✦ na barra lateral): converse com a Aurora sem precisar do Copilot, veja o comprovante de cada número e o histórico da pasta.</li>
      <li><b>Ctrl+I</b> no código: ela muda só o trecho selecionado e você aceita ou recusa cada parte.</li>
      <li><b>Autocompletar</b> em cinza enquanto você digita, pelo modelo local (Tab aceita).</li>
      <li><b>Erro no terminal</b>: "Corrigir com a Aurora" aparece na barra de status.</li>
    </ul>
    {!status.vsix && <p className="section-desc">Esta instalação não trouxe a extensão. Atualize o Harness para a versão mais nova.</p>}
    {status.vsix && !status.editors.length && <div className="vscode-editor">
      <div><strong>Nenhum editor encontrado</strong><small>Instale o VS Code (gratuito) e volte aqui para instalar a Aurora nele com um clique.</small></div>
      <div className="vscode-actions">
        <button className="btn btn-primary" onClick={() => void openExternalUrl('https://code.visualstudio.com/download')}>Baixar o VS Code</button>
        <button className="btn btn-ghost" onClick={() => void refresh()}>Procurar de novo</button>
      </div>
    </div>}
    {status.vsix && status.editors.length > 0 && <div className="vscode-editors">
      {status.editors.map((e) => <div className="vscode-editor" key={e.id}>
        <div>
          <strong>{e.name}</strong>
          <small>{e.installed ? (e.update ? `Aurora ${e.installed} instalada · ${version} disponível` : `Aurora ${e.installed} instalada · em dia`) : 'Aurora não instalada'}</small>
        </div>
        {(!e.installed || e.update) && <button className="btn btn-primary" disabled={busy !== null} onClick={() => install(e.id)}>{busy === e.id ? 'Instalando…' : e.installed ? `Atualizar para ${version}` : 'Instalar'}</button>}
        {e.installed && !e.update && <button className="btn btn-ghost" disabled={busy !== null} onClick={() => install(e.id)} title="Instala de novo a mesma versão">{busy === e.id ? 'Instalando…' : 'Reinstalar'}</button>}
      </div>)}
    </div>}
    {status.vsix && <p className="section-desc vscode-download">
      Outro editor ou outro computador? <button type="button" className="link-button" onClick={() => { setError(''); downloadVsix(version ?? null).then(() => setNote(`Extensão ${version} baixada. No editor: Extensões (Ctrl+Shift+X) → ⋯ → "Instalar do VSIX…" e escolha o arquivo.`)).catch((e: Error) => setError(e.message)); }}>Baixar a extensão (.vsix {version})</button>
    </p>}
    {note && <p className="settings-saved" role="status">{note}</p>}
    {error && <p className="settings-error" role="alert">{error}</p>}
  </div>;
}
