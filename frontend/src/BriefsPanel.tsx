import { useCallback, useEffect, useState } from 'react';
import { deleteBrief, listBriefs, saveBrief, setBriefEnabled, type Brief } from './api';

const NEW_BRIEF = `---
name: meu-briefing
title: Nome do tipo de entrega
triggers: [palavras que ativam, outra palavra]
options: [Primeira opção de ajuste, Segunda opção]
---
Decida sozinho: o que a Aurora escolhe quando a pessoa não diz (formato, tom, estrutura).
Pergunte só se: o único caso em que vale perguntar antes.
Estrutura: as partes de uma entrega completa, na ordem.
Confira antes de entregar: o que conferir (nada inventado, contas certas…).`;

const SOURCE: Record<Brief['source'], string> = { bundled: 'Da Aurora', user: 'Seu', edited: 'Editado por você' };

/**
 * Briefings: a short request ("faz um convite pro niver") comes out complete because the briefing
 * of its kind says what to decide, when to ask and what a full delivery has. Here the person sees
 * them, turns one off, edits one or writes their own (saved in the app's data folder).
 */
export default function BriefsPanel() {
  const [briefs, setBriefs] = useState<Brief[] | null>(null);
  const [editing, setEditing] = useState<{ text: string; isNew: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const refresh = useCallback(() => listBriefs().then(setBriefs).catch(() => setError('Não foi possível carregar os briefings.')), []);
  useEffect(() => { void refresh(); }, [refresh]);
  const act = (fn: () => Promise<unknown>, done = '') => {
    setBusy(true); setError(''); setNote('');
    fn().then(() => { setNote(done); return refresh(); }).catch((e: Error) => setError(e.message)).finally(() => setBusy(false));
  };
  if (!briefs) return <p className="section-desc">{error || 'Carregando…'}</p>;

  if (editing) return <form className="briefs-editor" onSubmit={(e) => { e.preventDefault(); act(() => saveBrief(editing.text).then(() => setEditing(null)), 'Briefing salvo.'); }}>
    <p className="section-desc">Em <code>triggers</code>, as palavras do pedido que ativam este briefing (sem acento). As quatro partes do texto dizem à Aurora como entregar; a resposta termina com as <code>options</code> como botões.</p>
    <textarea className="field mono briefs-text" aria-label="Texto do briefing" value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} spellCheck={false} />
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="briefs-actions">
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setEditing(null); setError(''); }}>Cancelar</button>
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
    </div>
  </form>;

  return <div className="briefs-panel">
    <div className="briefs-actions"><button className="btn btn-primary btn-sm" onClick={() => { setNote(''); setEditing({ text: NEW_BRIEF, isNew: true }); }}>Novo briefing</button></div>
    {note && <p className="section-desc" role="status">{note}</p>}
    {error && <p className="field-error" role="alert">{error}</p>}
    <ul className="briefs-list">
      {briefs.map((b) => <li key={b.name} className={`briefs-item${b.disabled ? ' off' : ''}`}>
        <div className="briefs-head">
          <strong>{b.title}</strong>
          <span className="briefs-source">{SOURCE[b.source]}{b.disabled ? ' · desligado' : ''}</span>
        </div>
        <p className="briefs-triggers">Ativa com: {b.triggers.slice(0, 8).join(', ')}{b.triggers.length > 8 ? '…' : ''}</p>
        <div className="briefs-buttons">
          <button className="btn btn-text btn-sm" disabled={busy} onClick={() => { setNote(''); setEditing({ text: b.text, isNew: false }); }}>Editar</button>
          <button className="btn btn-text btn-sm" disabled={busy} onClick={() => act(() => setBriefEnabled(b.name, b.disabled), b.disabled ? 'Ligado.' : 'Desligado: a Aurora não usa mais este briefing.')}>{b.disabled ? 'Ligar' : 'Desligar'}</button>
          {b.source !== 'bundled' && <button className="btn btn-text btn-sm" disabled={busy} onClick={() => act(() => deleteBrief(b.name), b.source === 'edited' ? 'Voltou ao texto original da Aurora.' : 'Briefing apagado.')}>{b.source === 'edited' ? 'Voltar ao original' : 'Apagar'}</button>}
        </div>
      </li>)}
    </ul>
  </div>;
}
