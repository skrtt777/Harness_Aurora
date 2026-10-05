import { useState } from 'react';
import { pickFolder, type Project } from './api';
import Icon from './Icon';

// Project folder + instructions: the folder is where the agent works (and, in
// Auto mode, the limit of what it does without asking); an AURORA.md inside it
// is read on every message, like CLAUDE.md for Claude Code.
export default function ProjectSettings({ project, onSave, onClose }: {
  project: Project;
  onSave: (patch: { name: string; workspaceDir: string; instructions: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [workspaceDir, setWorkspaceDir] = useState(project.workspaceDir || '');
  const [instructions, setInstructions] = useState(project.instructions || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="project-settings" role="dialog" aria-modal="true" aria-label="Configurar projeto" onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError('');
      try { await onSave({ name: name.trim() || project.name, workspaceDir: workspaceDir.trim(), instructions }); onClose(); }
      catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar.'); }
      finally { setBusy(false); }
    }}>
      <h2>Configurar projeto</h2>
      <label>Nome<input value={name} onChange={event => setName(event.target.value)} disabled={busy} /></label>
      <label>Pasta deste projeto
        <span className="project-folder-row">
          <input value={workspaceDir} onChange={event => setWorkspaceDir(event.target.value)} placeholder="Ex.: C:\Users\você\Projetos\meu-app" disabled={busy} />
          <button type="button" disabled={busy} onClick={async () => { const chosen = await pickFolder().catch(() => null); if (chosen) setWorkspaceDir(chosen); }}><Icon name="folder" size={13} /> Escolher…</button>
        </span>
        <small>Nas conversas deste projeto, a Aurora guarda, organiza e edita os arquivos aqui sem precisar pedir. Fora dela, sempre pede.</small>
      </label>
      <label>Instruções do projeto<textarea rows={6} value={instructions} onChange={event => setInstructions(event.target.value)} placeholder="Ex.: responda em inglês; use TypeScript; rode npm test antes de concluir." disabled={busy} /></label>
      {error && <p className="memory-form-error">{error}</p>}
      <div className="project-settings-actions"><button type="button" onClick={onClose} disabled={busy}>Cancelar</button><button className="primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button></div>
    </form>
  </div>;
}
