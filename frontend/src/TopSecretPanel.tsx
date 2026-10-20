import { useEffect, useState } from 'react';
import { getSecretTerms, listEgress, saveSecretTerms, type EgressItem } from './api';

const KIND_LABEL: Record<string, string> = { espelho: 'cópia com valores falsos', censura: 'documentos censurados', livre: 'arquivos reais' };

/**
 * Top secret (app/blind.js): the person's secret terms — always "[SIGILO n]" on the way to a paid AI — and
 * the record of every text that went out, exactly as it went (censored), to audit.
 */
export default function TopSecretPanel() {
  const [terms, setTerms] = useState('');
  const [saved, setSaved] = useState('');
  const [items, setItems] = useState<EgressItem[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getSecretTerms().then((t) => { setTerms(t.join('\n')); setSaved(t.join('\n')); }).catch(() => setError('Não foi possível carregar os termos.'));
    listEgress().then(setItems).catch(() => setItems([]));
  }, []);
  const save = () => {
    setError('');
    saveSecretTerms(terms.split(/\r?\n|;/).map((t) => t.trim()).filter(Boolean))
      .then((t) => { setTerms(t.join('\n')); setSaved(t.join('\n')); })
      .catch((e: Error) => setError(e.message));
  };

  return <>
    <div className="section" aria-label="Termos sigilosos">
      <h3 className="section-title">Termos sigilosos</h3>
      <p className="section-desc">Nomes que nunca devem sair do computador: codinomes de projetos, clientes, produtos, pessoas. Um por linha. Quando uma tarefa vai para a IA paga, cada um vira <code>[SIGILO 1]</code>, <code>[SIGILO 2]</code>… e volta aqui com o nome real.</p>
      <textarea className="field" rows={5} aria-label="Termos sigilosos, um por linha" value={terms} onChange={(e) => setTerms(e.target.value)} placeholder={'Projeto Fênix\nCliente Alfa\nAquisição da Beta'} />
      <div className="form-actions"><button className="btn btn-primary btn-sm" disabled={terms === saved} onClick={save}>Salvar termos</button></div>
    </div>
    <div className="section" aria-label="O que saiu">
      <h3 className="section-title">O que saiu para a IA paga</h3>
      <p className="section-desc">Cada texto enviado ao Claude, ao Codex ou a outro modelo, exatamente como foi (já censurado), com os arquivos que ele pôde ler. Fica só neste computador.</p>
      {items === null && <p className="muted">Carregando…</p>}
      {items?.length === 0 && <p className="muted">Nada foi enviado ainda.</p>}
      {(items || []).map((item, i) => <div className="row egress-row" key={`${item.at}-${i}`}>
        <div className="row-text">
          <div className="row-label">{new Date(item.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {item.engine} · {item.kind}</div>
          <div className="row-desc">{KIND_LABEL[item.privacy] || item.privacy} · {item.chars.toLocaleString('pt-BR')} caracteres{item.files.length ? ` · ${item.files.length} arquivo(s)` : ''}</div>
          {open === i && <>
            <pre className="egress-text">{item.text}</pre>
            {item.files.length > 0 && <small className="muted">Arquivos que ele pôde ler: {item.files.join(', ')}</small>}
          </>}
        </div>
        <div className="row-control"><button className="btn btn-ghost btn-sm" onClick={() => setOpen(open === i ? null : i)}>{open === i ? 'Fechar' : 'Ver o texto'}</button></div>
      </div>)}
    </div>
    {error && <p role="alert" className="settings-error">{error}</p>}
  </>;
}
