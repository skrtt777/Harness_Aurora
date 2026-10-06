import { useEffect, useRef } from 'react';
import Icon from './Icon';
import './welcome.css';

/**
 * "O que há de novo": once after an update, a few plain lines about what changed, so the new things
 * are found (the computer map, for one, is off until the person turns it on). Never on a first
 * install: the welcome guide covers that.
 */
export const NEWS: Record<string, { title: string; items: [string, string][] }> = {
  '0.1.37': {
    title: 'A Aurora agora conhece você e o seu computador',
    items: [
      ['Aurora no celular', 'Em Configurações → Celular, ligue o seu Telegram: converse com a Aurora de qualquer lugar, mande e receba arquivos, veja os avisos dos agentes e autorize ações com um toque.'],
      ['Mapa do computador', 'Ligue em Configurações → Pastas: a Aurora aprende onde ficam seus documentos, fotos e projetos (só os nomes, sem abrir nada) e acha qualquer arquivo na hora.'],
      ['Sobre você', 'Em Memória ou Configurações → Geral: o que você contar de si vale em todas as conversas, e dá para corrigir ou fazer esquecer.'],
      ['Agentes que só avisam quando importa', 'O modelo "Resumo da manhã" confere o que chegou no computador e só manda notificação se houver novidade. E o cartão mostra quando cada agente trabalha de novo.'],
      ['Entregas mais certeiras', 'Planilhas e relatórios dos agentes saem com a lista certa: datas, valores e "abaixo do mínimo" são conferidos pela própria Aurora antes de gravar.'],
      ['Pastas e arquivos', 'Arraste um arquivo para a caixa de mensagem para a Aurora usá-lo. E peça "quais os maiores arquivos?" ou "tem arquivo repetido?": ela vê tamanho, data e cópias de cada pasta.'],
    ],
  },
};

const SEEN_KEY = 'aurora-seen-version';
export function seenVersion(): string | null { try { return localStorage.getItem(SEEN_KEY); } catch { return null; } }
export function markSeen(version: string) { try { localStorage.setItem(SEEN_KEY, version); } catch { /* storage off: shown again next time */ } }

export default function WhatsNew({ version, onClose }: { version: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const el = dialog.current!; el.showModal(); return () => el.close(); }, []);
  const news = NEWS[version];
  const close = () => { markSeen(version); onClose(); };
  if (!news) return null;
  return <dialog ref={dialog} className="welcome-guide whats-new" aria-labelledby="whats-new-title" onCancel={(e) => { e.preventDefault(); close(); }}>
    <header className="guide-header"><span className="guide-eyebrow">NOVIDADES DA VERSÃO {version}</span><button onClick={close} aria-label="Fechar novidades"><Icon name="close" size={14} /></button></header>
    <div className="guide-content">
      <h1 id="whats-new-title">{news.title}</h1>
      <ul className="whats-new-list">{news.items.map(([title, text]) => <li key={title}><strong>{title}</strong><p>{text}</p></li>)}</ul>
    </div>
    <footer className="guide-footer"><span /><button className="guide-primary" onClick={close}>Entendi</button></footer>
  </dialog>;
}
