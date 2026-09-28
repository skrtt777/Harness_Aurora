import { useCallback, useEffect, useState } from 'react';
import { cancelAgentEval, getAgentEval, startAgentEval, type AgentEvalState } from './api';

// Fase 3: is the local model actually getting better? A fixed benchmark run
// on a copy of the database, with and without the learned memories.
export default function EvalPanel() {
  const [state, setState] = useState<AgentEvalState | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(() => getAgentEval().then(setState).catch(e => setError(e.message)), []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!state?.status.running) return;
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [state?.status.running, refresh]);
  const start = async (withMemories: boolean) => {
    setError('');
    try { await startAgentEval(withMemories); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao iniciar.'); }
  };
  if (!state) return <p className="settings-hint">{error || 'Carregando…'}</p>;
  const { status, runs } = state;
  return <div className="eval-panel">
    <div className="settings-actions">
      <button disabled={status.running} onClick={() => start(true)}>Avaliar com memórias</button>
      <button disabled={status.running} onClick={() => start(false)}>Avaliar sem memórias</button>
      {status.running && <button onClick={() => { void cancelAgentEval().then(refresh); }}>Cancelar</button>}
    </div>
    {status.running && <p className="settings-hint">Avaliando{status.progress ? `: tarefa ${status.progress.index + 1} de ${status.progress.total} (${status.progress.task})` : '…'}</p>}
    {error && <p className="memory-form-error">{error}</p>}
    {runs.length ? <table className="eval-runs">
      <thead><tr><th>Quando</th><th>Modelo</th><th>Memórias</th><th>Acertos</th><th>Por área</th></tr></thead>
      <tbody>{runs.map(run => <tr key={run.id} title={run.results.filter(r => !r.passed).map(r => `✕ ${r.id}: ${r.error || r.answer}`).join('\n')}>
        <td>{new Date(run.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
        <td>{run.model}</td>
        <td>{run.withMemories ? `com (${run.memoryCount})` : 'sem'}</td>
        <td><span className="eval-bar" style={{ ['--rate' as string]: `${Math.round((run.passed / Math.max(1, run.total)) * 100)}%` }} /> {run.passed}/{run.total}</td>
        <td>{Object.entries(run.summary.byArea).map(([area, v]) => `${area} ${v.passed}/${v.total}`).join(' · ')}</td>
      </tr>)}</tbody>
    </table> : <p className="settings-hint">Nenhuma avaliação ainda.</p>}
  </div>;
}
