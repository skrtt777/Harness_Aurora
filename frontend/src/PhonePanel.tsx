import { useCallback, useEffect, useState } from 'react';
import { connectTelegram, disconnectTelegram, getTelegram, openExternalUrl, testTelegram, type TelegramStatus } from './api';

/**
 * Celular (Telegram): talk to the Aurora from the phone and get the agents' news there. The person
 * makes their own bot (BotFather), pastes its token, and links their chat with a code; only that
 * chat is heard. Off until then.
 */
export default function PhonePanel() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const refresh = useCallback(() => getTelegram().then(setStatus).catch(() => setError('Não foi possível carregar.')), []);
  useEffect(() => { void refresh(); }, [refresh]);
  // Waiting for the code to arrive from the phone.
  useEffect(() => {
    if (!status?.configured || status.linked) return undefined;
    const id = setInterval(() => void refresh(), 3000);
    return () => clearInterval(id);
  }, [status?.configured, status?.linked, refresh]);
  const act = (fn: () => Promise<unknown>) => { setBusy(true); setError(''); setNote(''); fn().catch((e: Error) => setError(e.message)).finally(() => setBusy(false)); };
  if (!status) return <p className="section-desc">{error || 'Carregando…'}</p>;
  const link = status.bot && status.pairCode ? `https://t.me/${status.bot}?start=${status.pairCode}` : null;

  return <div className="phone-panel">
    {!status.configured && <>
      <ol className="phone-steps">
        <li>No Telegram, abra o <button type="button" className="link-button" onClick={() => openExternalUrl('https://t.me/BotFather')}>@BotFather</button>, mande <code>/newbot</code> e escolha um nome para o seu bot.</li>
        <li>Ele responde com um token (algo como <code>123456789:ABC…</code>). Cole aqui:</li>
      </ol>
      <form className="phone-connect" onSubmit={(e) => { e.preventDefault(); act(() => connectTelegram(token).then((s) => { setStatus(s); setToken(''); })); }}>
        <input className="field mono" aria-label="Token do bot" placeholder="Token do bot" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
        <button className="btn btn-primary" disabled={busy || !token.trim()}>{busy ? 'Conectando…' : 'Conectar'}</button>
      </form>
    </>}
    {status.configured && !status.linked && <div className="phone-pair" role="status">
      <p>Agora ligue o seu chat: {link
        ? <>toque em <button type="button" className="link-button" onClick={() => openExternalUrl(link)}>abrir @{status.bot} no Telegram</button> e depois em <b>Iniciar</b>.</>
        : <>mande este código para o seu bot:</>}</p>
      <p className="phone-code">Código: <b>{status.pairCode}</b></p>
      <small>Esperando a mensagem chegar…</small>
    </div>}
    {status.configured && status.linked && <div className="phone-linked">
      <p><span className="phone-dot" aria-hidden="true" />Ligado ao seu Telegram{status.bot ? ` (@${status.bot})` : ''}. Mande mensagens para o bot como faria aqui; os agentes também avisam por lá.</p>
      <div className="form-actions">
        <button className="btn" disabled={busy} onClick={() => act(() => testTelegram().then((r) => setNote(r.sent ? 'Mensagem de teste enviada.' : 'Não foi possível enviar.')))}>Mandar teste</button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => { if (window.confirm('Desconectar o celular? O bot para de responder.')) act(() => disconnectTelegram().then(setStatus)); }}>Desconectar</button>
      </div>
    </div>}
    {status.configured && status.error && <p className="settings-error">Telegram: {status.error}</p>}
    {note && <p className="settings-saved">{note}</p>}
    {error && <p role="alert" className="settings-error">{error}</p>}
    <p className="section-desc phone-privacy">As mensagens passam pelos servidores do Telegram. Só o chat ligado é atendido, e o computador precisa estar ligado com a Aurora aberta.</p>
  </div>;
}
