import Icon from './Icon';
import BrandMark from './BrandMark';
import { auroraBackdropOn, setAuroraBackdrop } from './auroraBackdrop';
import { useState } from 'react';

/** ?view=ui — every chat piece in each state, same markup as ChatView/Sidebar, no backend. */
export default function UiGallery() {
  const [backdrop, setBackdrop] = useState(auroraBackdropOn);
  return <div className="app-shell">
    <aside className="sb">
      <div className="sb-top"><BrandMark /></div>
      <div className="sb-new"><button className="sb-new-main"><Icon name="compose" size={15} /><span>Nova conversa</span></button></div>
      <nav className="sb-nav" aria-label="Páginas">
        <button className="sb-link active"><Icon name="memory" size={15} /><span>Memória</span><span className="sb-count">1.204</span></button>
        <button className="sb-link"><Icon name="briefcase" size={15} /><span>Agentes</span></button>
        <button className="sb-link"><Icon name="office" size={15} /><span>Escritório</span></button>
      </nav>
      <div className="sb-scroll"><section className="sb-group">
        <div className="sb-group-head"><span>Conversas</span></div>
        <div className="sb-row active"><button className="sb-row-main"><span className="sb-row-title">Galeria de componentes</span><span className="sb-row-meta">agora</span></button></div>
        <div className="sb-row"><button className="sb-row-main"><span className="sb-row-title">Relatório de vendas</span><span className="sb-row-meta">2 h</span></button></div>
      </section></div>
    </aside>
    <main className="app-main">
      <div className="conversation-workspace"><section className="chat-page">
        <header className="chat-page-head"><div className="conversation-heading"><span className="conversation-title">Galeria de componentes</span><span className="badge">IA local</span></div>
          <div className="conversation-controls"><label className="row-control">Fundo animado <input type="checkbox" className="switch" checked={backdrop} onChange={(e) => { setAuroraBackdrop(e.target.checked); setBackdrop(e.target.checked); }} /></label></div>
        </header>
        <div className="chat-messages">
          <article className="chat-message user" aria-label="Você"><div className="chat-bubble-wrap"><div className="chat-content">Organiza a pasta de notas fiscais por mês e me mostra o total.</div></div></article>

          <article className="chat-message assistant" aria-label="Aurora">
            <div className="chat-avatar" aria-hidden="true"><img className="aurora-symbol" src="/brand/aurora-symbol.png" alt="" width="1254" height="1254" /></div>
            <div className="chat-bubble-wrap">
              <details className="agent-actions" open><summary>3 ações executadas</summary>
                <ol className="agent-steps">
                  <li className="agent-step done"><span className="agent-step-icon" aria-hidden="true">✓</span>Listar pasta C:\Notas</li>
                  <li className="agent-step done"><span className="agent-step-icon" aria-hidden="true">✓</span>Mover 42 arquivos</li>
                  <li className="agent-step failed"><span className="agent-step-icon" aria-hidden="true">✕</span>Ler nota-0193.pdf</li>
                </ol>
              </details>
              <div className="chat-content"><p>Pronto: <strong>42 notas</strong> em 9 pastas por mês. O total é <code>R$ 18.430,00</code>.</p></div>
            </div>
          </article>

          <div className="chat-message assistant pending" role="status">
            <div className="chat-avatar" aria-hidden="true"><img className="aurora-symbol" src="/brand/aurora-symbol.png" alt="" width="1254" height="1254" /></div>
            <div className="pending-response">
              <ol className="agent-plan">
                <li className="done"><span className="plan-check" role="img" aria-label="Feito" /><span className="plan-text">Ler as planilhas</span></li>
                <li className="in_progress"><span className="plan-check" role="img" aria-label="Em andamento" /><span className="plan-text">Somar por cliente</span></li>
                <li className="pending"><span className="plan-check" role="img" aria-label="Pendente" /><span className="plan-text">Gerar o gráfico</span></li>
              </ol>
              <ol className="agent-steps">
                <li className="agent-step done"><span className="agent-step-icon" aria-hidden="true">✓</span>Abrir vendas.xlsx</li>
                <li className="agent-step running"><span className="agent-step-icon" aria-hidden="true">…</span>Executar soma_clientes.py</li>
              </ol>
              <span className="pending-stage"><small>Conferindo a resposta…</small><span className="typing-dots" aria-hidden="true"><span /><span /><span /></span></span>
            </div>
          </div>

          <div className="chat-message assistant pending">
            <div className="chat-avatar" aria-hidden="true"><img className="aurora-symbol" src="/brand/aurora-symbol.png" alt="" width="1254" height="1254" /></div>
            <div className="pending-response">
              <div className="agent-approval" role="alertdialog" aria-label="Autorização necessária">
                <p>A Aurora quer executar este comando:</p>
                <code>python soma_clientes.py --entrada vendas.xlsx</code>
                <small>Roda na pasta do projeto, sem acesso à rede.</small>
                <div className="agent-approval-actions"><button type="button" className="btn btn-ghost btn-sm">Negar</button><button type="button" className="btn btn-sm">Sempre permitir “python”</button><button type="button" className="btn btn-primary btn-sm">Permitir</button></div>
              </div>
            </div>
          </div>
        </div>
        <div className="composer-area"><form className="chat-composer" onSubmit={(e) => e.preventDefault()}><textarea rows={1} placeholder="Peça algo à Aurora" aria-label="Mensagem" /></form></div>
      </section></div>
    </main>
  </div>;
}
