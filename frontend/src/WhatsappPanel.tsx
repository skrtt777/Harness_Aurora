import { useCallback, useEffect, useState } from 'react';
import { disableWhatsapp, enableWhatsapp, getWhatsapp, testWhatsapp, type WhatsappStatus } from './api';

/**
 * WhatsApp (app/whatsapp.js): the same phone conversation as Telegram, through WhatsApp Web on this
 * computer. Read the QR with the phone; then the Aurora answers in "Mensagem para você" (your own chat),
 * and nobody else who writes to you talks to her. A number of its own pairs by code instead.
 */
export default function WhatsappPanel() {
  const [status, setStatus] = useState<WhatsappStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const refresh = useCallback(() => getWhatsapp().then(setStatus).catch(() => setError('Não foi possível carregar.')), []);
  useEffect(() => { void refresh(); }, [refresh]);
  // While the QR is on the screen or the connection comes up, follow it.
  useEffect(() => {
    // Also while it reconnects (linked but not connected now): the status comes back by itself.
    if (!status || (status.status === 'desligado' && !status.linked) || (status.status === 'conectado' && status.linked)) return undefined;
    const id = setInterval(() => void refresh(), 2000);
    return () => clearInterval(id);
  }, [status, refresh]);
  const act = (fn: () => Promise<unknown>) => { setBusy(true); setError(''); setNote(''); fn().catch((e: Error) => setError(e.message)).finally(() => setBusy(false)); };
  if (!status) return <p className="section-desc">{error || 'Carregando…'}</p>;
  const on = status.status !== 'desligado' || status.linked;

  return <div className="phone-panel" aria-label="WhatsApp">
    {!on && <>
      <p className="section-desc">Ligue para ler um QR code com o celular (WhatsApp → Aparelhos conectados → Conectar um aparelho). Depois, fale com a Aurora em <b>Mensagem para você</b>, a conversa consigo mesmo.</p>
      <div className="form-actions">
        <button className="btn btn-primary" disabled={busy} onClick={() => act(() => enableWhatsapp(false).then(setStatus))}>Ligar o WhatsApp</button>
        <button className="btn btn-ghost" disabled={busy} title="Para um número só da Aurora: quem mandar o código passa a ser atendido" onClick={() => act(() => enableWhatsapp(true).then(setStatus))}>Usar um número só da Aurora</button>
      </div>
    </>}
    {on && status.status === 'aguardando_qr' && status.qr && <div className="phone-pair" role="status">
      <p>No celular: WhatsApp → <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b>, e leia este código:</p>
      <img className="whatsapp-qr" src={status.qr} alt="QR code para conectar o WhatsApp" width={240} height={240} />
      <small>Esperando a leitura…</small>
    </div>}
    {on && status.status === 'conectando' && <p className="section-desc" role="status">Conectando ao WhatsApp…</p>}
    {on && status.status === 'desligado' && status.linked && <p className="section-desc" role="status">Reconectando ao WhatsApp…{status.lastClose ? ` (última queda: ${status.lastClose.reason})` : ''}</p>}
    {on && status.status === 'conectado' && !status.linked && status.pairCode && <div className="phone-pair" role="status">
      <p>Do seu celular, mande este código para o número {status.number ? <b>+{status.number}</b> : 'da Aurora'}:</p>
      <p className="phone-code">Código: <b>{status.pairCode}</b></p>
      <small>Esperando a mensagem chegar…</small>
    </div>}
    {on && status.status === 'conectado' && status.linked && <div className="phone-linked">
      <p><span className="phone-dot" aria-hidden="true" />Ligado ao WhatsApp{status.number ? ` (+${status.number})` : ''}. {status.mode === 'proprio' ? 'Escreva para a Aurora em "Mensagem para você"' : 'A conversa que mandou o código fala com a Aurora'}; é a mesma conversa do Telegram, e as autorizações chegam como "responda sim ou não".</p>
      <div className="form-actions">
        <button className="btn" disabled={busy} onClick={() => act(() => testWhatsapp().then((r) => { if (r.sent) setNote('Mensagem de teste enviada — veja em "Mensagem para você".'); else setError(`Não foi possível enviar: ${r.error || 'o WhatsApp recusou'}.`); }))}>Mandar teste</button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => { if (window.confirm('Desconectar o WhatsApp deste computador?')) act(() => disableWhatsapp().then(setStatus)); }}>Desconectar</button>
      </div>
    </div>}
    {on && <button className="btn btn-ghost btn-sm" hidden={status.status !== 'desligado'} disabled={busy} onClick={() => act(() => enableWhatsapp(false).then(setStatus))}>Reconectar</button>}
    {status.error && <p className="settings-error">WhatsApp: {status.error}</p>}
    {note && <p className="settings-saved">{note}</p>}
    {error && <p role="alert" className="settings-error">{error}</p>}
    <p className="section-desc phone-privacy">Funciona pelo WhatsApp Web neste computador (não é a API oficial do WhatsApp Business). O login fica só aqui; o computador precisa estar ligado com a Aurora aberta.</p>
  </div>;
}
