import { useEffect, useRef } from 'react';
import Icon from './Icon';
import './welcome.css';

/**
 * "O que há de novo": once after an update, a few plain lines about what changed, so the new things
 * are found (the computer map, for one, is off until the person turns it on). Never on a first
 * install: the welcome guide covers that.
 */
export const NEWS: Record<string, { title: string; items: [string, string][] }> = {
  '0.1.40': {
    title: 'Peça no chat, a Aurora faz nos programas',
    items: [
      ['Excel junto com você', '"Abre o Excel", "cria uma planilha de estoque com as colunas Produto, Quantidade e Preço": a Aurora monta na sua frente, com fórmulas que calculam de verdade, pergunta se está certo, formata em reais e salva onde você pedir.'],
      ['Word junto com você', '"Abre o Word e escreve um orçamento para o cliente Marcos": título, texto e tabela aparecem no documento. "Acrescenta o prazo no final", "salva em PDF": ela faz.'],
      ['Qualquer programa', 'Calculadora, Access, o sistema da empresa: a Aurora abre, olha a tela, faz os passos e confere o resultado na tela antes de responder. Você só confirma.'],
      ['Seus dados protegidos', 'O que é de uma empresa não aparece para outra. CPF, salário e dados de clientes não vão para a memória geral. Em Configurações → Privacidade você encontra, exporta ou apaga os dados de uma pessoa (LGPD).'],
      ['Sempre com sua autorização', 'Antes de mexer num programa, a Aurora pergunta uma vez. Ela nunca mexe nas configurações e na segurança do Windows, nem no terminal ou no gerenciador de tarefas, e no modo Plano só observa.'],
    ],
  },
  '0.1.39': {
    title: 'A Aurora ficou mais rápida',
    items: [
      ['Volta na hora', 'Quando a Aurora fica um tempo parada e você volta a falar com ela, a primeira resposta não demora mais. Em computadores sem placa de vídeo, passou de mais de um minuto para cerca de um segundo.'],
      ['Respostas mais diretas', 'Depois de criar um arquivo, a Aurora diz em duas frases onde ele está e o principal resultado, sem repetir tudo. Convites, recados e e-mails saem direto na conversa, sem abrir arquivo nem site.'],
      ['Tarefas mais rápidas', 'Nos testes, as tarefas de empresa ficaram 45% mais rápidas com placa de vídeo e 24% mais rápidas só com o processador, com a mesma qualidade.'],
      ['E-mails e relatórios mais completos', 'O e-mail de cobrança já vem com o cliente e o valor certos, e com um prazo como "nos próximos 5 dias úteis" em vez de um campo em branco. Os relatórios trazem os valores exatos da planilha.'],
    ],
  },
  '0.1.38': {
    title: 'Peça do seu jeito: a Aurora completa o resto',
    items: [
      ['Pedidos curtos, entregas completas', '"Faz um convite pro niver da minha filha", "monta um relatório das vendas", "faz um orçamento pro cliente": a Aurora decide o formato, o tom e a estrutura, não inventa data nem preço e já entrega pronto.'],
      ['Opções para ajustar', 'No fim da resposta aparecem botões como "Versão para imprimir em PDF" ou "Versão mais formal". A recomendada tem uma ★. É só tocar.'],
      ['Briefings', 'Em Configurações → Briefings você vê como a Aurora entrega cada tipo de pedido, desliga, edita ou cria os seus (ex.: o orçamento da sua loja).'],
      ['Continuação certa', 'Depois de "quantos pedidos estão em aberto?", um "faz uma planilha com eles" usa a mesma planilha, sem deixar linha de fora.'],
      ['Mais cuidado', 'Se você disser que não está bem, a Aurora conversa com calma e indica o CVV (188). Salário e CPF de colegas não aparecem no chat. E ela não diz que apagou ou moveu algo sem ter feito.'],
    ],
  },
  '0.1.37': {
    title: 'A Aurora agora conhece você e o seu computador',
    items: [
      ['Aurora no celular', 'Em Configurações → Celular, ligue o seu Telegram: converse com a Aurora de qualquer lugar, mande e receba arquivos, veja os avisos dos agentes e autorize ações com um toque.'],
      ['Mapa do computador', 'Ligue em Configurações → Pastas: a Aurora aprende onde ficam seus documentos, fotos e projetos (só os nomes, sem abrir nada) e acha qualquer arquivo na hora.'],
      ['Sobre você', 'Em Memória ou Configurações → Geral: o que você contar de si vale em todas as conversas, e dá para corrigir ou fazer esquecer.'],
      ['Agentes que só avisam quando importa', 'O modelo "Resumo da manhã" confere o que chegou no computador e só manda notificação se houver novidade. E na conversa (ou no celular) dá para pedir a um agente ("peça ao agente financeiro a lista de cobrança") ou à equipe inteira ("peça para a equipe fechar o mês").'],
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
