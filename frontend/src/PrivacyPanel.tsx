import { useState } from 'react';
import { eraseSubject, exportSubject, searchSubject, type SubjectSearch } from './api';

const SCOPE: Record<string, string> = { global: 'todas as conversas', project: 'só no projeto', conversation: 'só na conversa' };

/**
 * Privacidade (LGPD): the protections that work on their own, and the titular's rights (art. 18):
 * find what the Aurora keeps about a person or a client, take a copy, erase it.
 */
export default function PrivacyPanel() {
  const [term, setTerm] = useState('');
  const [result, setResult] = useState<SubjectSearch | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const search = async () => {
    setBusy(true); setError(''); setNote(''); setConfirming(false);
    try { setResult(await searchSubject(term.trim())); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível buscar.'); }
    finally { setBusy(false); }
  };
  const download = async () => {
    setBusy(true); setError('');
    try {
      const data = await exportSubject(result!.term);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = `dados-${result!.term.replace(/[^\w-]+/g, '_').slice(0, 40)}.json`; a.click();
      URL.revokeObjectURL(url);
      setNote('Cópia salva na pasta de downloads.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível exportar.'); }
    finally { setBusy(false); }
  };
  const erase = async () => {
    setBusy(true); setError('');
    try {
      const done = await eraseSubject(result!.term);
      setNote(`Apagado: ${done.memoriesDeleted} memória(s) excluída(s), ${done.messagesRedacted} mensagem(ns) e ${done.conversationsRenamed} título(s) com o dado substituído${done.profileRedacted ? ', e o "Sobre você" corrigido' : ''}.`);
      setResult(await searchSubject(result!.term));
      setConfirming(false);
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível apagar.'); }
    finally { setBusy(false); }
  };

  return <div className="privacy-panel">
    <div className="privacy-guarantees">
      <h4>O que a Aurora já faz sozinha</h4>
      <ul>
        <li><strong>Cada projeto é separado.</strong> O que a Aurora aprende sobre um cliente, um salário ou um CPF fica no projeto (ou na conversa) em que apareceu, e não aparece em outro projeto.</li>
        <li><strong>Nada de cliente vai para a memória compartilhada.</strong> Nomes, valores, CNPJ, CPF, e-mails e telefones bloqueiam o envio para a memória central.</li>
        <li><strong>O professor recebe os dados mascarados.</strong> Na revisão automática pelo Claude ou Codex, CPF, CNPJ, e-mail, telefone e contas vão como [CPF], [e-mail]…, e as memórias com dados pessoais ficam no computador.</li>
        <li><strong>Sem dado pessoal na internet.</strong> A Aurora não pesquisa na web um CPF, CNPJ, e-mail ou telefone.</li>
      </ul>
    </div>

    <form className="privacy-search" onSubmit={(e) => { e.preventDefault(); if (term.trim().length >= 3) void search(); }}>
      <label htmlFor="privacy-term">Buscar tudo o que a Aurora guarda sobre uma pessoa ou empresa</label>
      <div className="privacy-row">
        <input id="privacy-term" className="field" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Nome, CPF, CNPJ ou e-mail" autoComplete="off" />
        <button className="btn btn-primary" disabled={busy || term.trim().length < 3}>{busy && !result ? 'Buscando…' : 'Buscar'}</button>
      </div>
    </form>

    {error && <p className="field-error" role="alert">{error}</p>}
    {note && <p className="section-desc" role="status">{note}</p>}

    {result && <div className="privacy-result">
      {result.total === 0
        ? <p className="section-desc">Nada guardado sobre “{result.term}”.</p>
        : <>
          <p><strong>{result.total}</strong> registro(s) com “{result.term}”: {result.memories.length} memória(s), {result.conversations.reduce((n, c) => n + c.messages, 0)} mensagem(ns) em {result.conversations.length} conversa(s){result.profile ? ' e no "Sobre você"' : ''}.</p>
          {result.memories.length > 0 && <ul className="privacy-list">{result.memories.map((m) => <li key={m.id}><strong>{m.title}</strong> <span className="privacy-scope">{SCOPE[m.scope] || m.scope}</span><br /><span className="privacy-excerpt">{m.excerpt}</span></li>)}</ul>}
          {result.conversations.length > 0 && <ul className="privacy-list">{result.conversations.map((c) => <li key={c.id}>Conversa “{c.title}”: {c.messages} mensagem(ns)</li>)}</ul>}
          <div className="privacy-actions">
            <button className="btn btn-ghost" disabled={busy} onClick={() => void download()}>Exportar uma cópia (JSON)</button>
            {!confirming
              ? <button className="btn btn-danger" disabled={busy} onClick={() => setConfirming(true)}>Apagar tudo sobre “{result.term}”</button>
              : <span className="privacy-confirm" role="alert">Apagar de vez? As memórias são excluídas e o dado é removido das conversas. Não dá para desfazer.
                <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => void erase()}>{busy ? 'Apagando…' : 'Sim, apagar'}</button>
                <button className="btn btn-text btn-sm" disabled={busy} onClick={() => setConfirming(false)}>Cancelar</button></span>}
          </div>
        </>}
    </div>}
  </div>;
}
