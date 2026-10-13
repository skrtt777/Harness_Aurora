import { useEffect, useRef } from 'react';
import Icon from './Icon';
import './welcome.css';

/**
 * "O que há de novo": once after an update, a few plain lines about what changed, so the new things
 * are found (the computer map, for one, is off until the person turns it on). Never on a first
 * install: the welcome guide covers that.
 */
export const NEWS: Record<string, { title: string; items: [string, string][] }> = {
  '0.1.44': {
    title: 'Citações conferidas',
    items: [
      ['Conferência de citações', 'Em pedidos jurídicos, cada artigo, lei ou súmula citado (na resposta ou no documento) precisa estar no que a Aurora leu nesta resposta, na página da própria lei. O que não estiver volta para ela confirmar no site oficial, e o que sobrar sai com um aviso claro.'],
      ['Leis com o artigo certo', 'A leitura de páginas traz o trecho do que se procura ("Art. 4") numa lei longa, e os acentos dos sites do governo não vêm mais quebrados.'],
      ['Sem escapar para outro idioma', 'Se um trecho da entrega sai em outro alfabeto (como chinês) por engano, ela reescreve em português.'],
      ['Power BI cobrado', 'Num pedido de Power BI, a entrega só termina com o painel montado.'],
      ['Scripts que falham mostram onde', 'Quando um script Python ou Node dá erro, a Aurora recebe o código em volta da linha do erro para corrigir.'],
      ['Filtros exatos', 'Quando a lista gravada não bate com o filtro, ela é orientada a usar as linhas exatas do filtro.'],
    ],
  },
  '0.1.43': {
    title: 'A Sede da Aurora',
    items: [
      ['Um escritório com departamentos', 'O Escritório virou a Sede: Recepção, Arquivo, Biblioteca, os departamentos (Jurídico, Financeiro, Pessoas, Comercial e Marketing, TI e Código, Operações), Revisão, Conferência e Expedição. Cada pessoa fica na sala do que está fazendo de verdade.'],
      ['Cada pedido é uma ficha', 'Ao lado da planta, cada pedido mostra a etapa (o pedido, o time trabalha, a entrega), as estações por onde passou e a ordem de serviço: o que entregar e as regras.'],
      ['Recepção de verdade', 'Antes de trabalhar, a Aurora monta a ordem de serviço do pedido: arquivos e formato, a pasta, regras como "mais de 300 em cada linha", rodar e mostrar o resultado, citar só fonte oficial.'],
      ['Expedição de verdade', 'Antes de responder, a entrega é conferida: o formato pedido foi gravado, o que era para rodar rodou e a resposta diz onde está o arquivo.'],
      ['Regras de cada departamento', 'Jurídico, Financeiro, Pessoas, Comercial e Operações têm o próprio checklist: no Jurídico, leis só de fonte oficial e prazo com a data final; no Financeiro, valores exatos e vencido separado do a vencer.'],
      ['Menos entregas perdidas', 'Nome de arquivo com > ou : não falha mais, tabelas longas não aparecem como "cortadas" no meio, e quando a Aurora lê demais ela é levada a gravar a entrega.'],
    ],
  },
  '0.1.42': {
    title: 'A Aurora programa, aprende e tem um RH',
    items: [
      ['Aurora no VS Code', 'Instale a extensão (vscode/aurora-harness-0.2.0.vsix) e escreva @aurora no chat do VS Code: ela usa a pasta aberta como projeto. /explicar, /corrigir com os erros do painel Problemas, /testes e /revisar suas mudanças. No fim, Ver diferenças e Desfazer.'],
      ['Sites e APIs de verdade', '"Crie um site sobre jogos" sai com menu, cena 3D, cartões com filtro e busca, e Java e C++ se você pedir. "Crie uma API de tarefas" sai com rotas, validação e testes que já rodam. A Aurora confere a página no computador e no celular antes de responder.'],
      ['Código conferido', 'Cada arquivo de código é checado na hora em que é gravado. Se o pedido cita um arquivo que não existe, ou ela diz que rodou sem ter rodado, ela volta e faz.'],
      ['Ela aprende sozinha', 'Quando não sabe algo ou um erro se repete, ela pesquisa a documentação, escreve uma lição curta e guarda na memória.'],
      ['Um escritório para todos e o RH', 'O Escritório agora é uma sala só. Helena e Otávio, do RH, dão nota aos agentes pelas entregas reais: estrela para os bons, plano de melhoria para os fracos e substituto para quem não melhora. Recontratar desfaz.'],
      ['Desfazer também apaga o que ela criou', 'O Desfazer de uma resposta agora apaga os arquivos que ela criou, se você não mexeu neles depois, e devolve os editados como estavam.'],
      ['Planilhas e Power BI sem erro', 'Regras como "mais de 300 funcionários em cada departamento" são conferidas em cada linha, e pedidos grandes são divididos entre subagentes.'],
    ],
  },
  '0.1.41': {
    title: 'Veja seus agentes trabalhando',
    items: [
      ['Escritório dos agentes', 'Na barra lateral, Escritório: uma sala em pixel art para cada projeto, onde cada pessoinha é uma conversa, um agente ou um professor de verdade. Quem trabalha digita no computador, quem lê arquivos vai à estante, quem roda comandos vai ao servidor e quem espera sua autorização levanta a mão.'],
      ['Uma equipe que se mexe', 'Quem termina leva o papel ao chefe e vai tomar um cafezinho. O chefe faz ronda e cobra quem precisa refazer, e o Claude ou o Codex entram para revisar na sala de reunião. Quem está livre descansa no sofá e conversa. A sala segue a hora do dia e cresce com a equipe.'],
      ['Cada sessão com seu nome', 'Cada conversa em andamento ganha um nome próprio, com a letra do título ("Metas de outubro" vira Mariana). Clique numa pessoa para ver o que ela faz e abrir a conversa.'],
      ['Power BI com a sua operação desenhada', 'O painel mostra o lugar da sua área (docas e caminhões, guichês, caixas, máquinas) desenhado pelos dados: cada item aparece uma vez, onde está, com a mesma contagem dos cartões. Ao clicar num item, ele acende na cena.'],
      ['O que mudou desde a última atualização', 'A Aurora escreve no BI o que mudou a cada atualização, com alertas. Ela também mostra o mapa do Brasil por estado e uma simulação "e se" separada dos números reais.'],
      ['Aurora no óculos (Quest)', 'O app de realidade virtual foi refeito: a operação do Power BI vira uma maquete na sua mesa, que você pode pegar com a mão. E dá para pedir à Aurora um cenário de brincadeira, como uma fazenda, uma cidade medieval ou uma praia.'],
    ],
  },
  '0.1.40': {
    title: 'Peça no chat, a Aurora faz nos programas',
    items: [
      ['Excel junto com você', '"Abre o Excel", "cria uma planilha de estoque com as colunas Produto, Quantidade e Preço": a Aurora monta na sua frente, com fórmulas que calculam de verdade, pergunta se está certo, formata em reais e salva onde você pedir.'],
      ['Word junto com você', '"Abre o Word e escreve um orçamento para o cliente Marcos": título, texto e tabela aparecem no documento. "Acrescenta o prazo no final", "salva em PDF": ela faz.'],
      ['Power BI completo', '"Faz um Power BI com a planilha de vendas": a Aurora monta o modelo (calendário, relações, medidas como faturamento, ticket médio, margem e comparação com o ano anterior) e um painel com visão geral, detalhamento e tendência, e abre no Power BI já com os dados.'],
      ['Pergunte ao seu Power BI', 'Com um relatório aberto: "qual produto vendeu mais em 2026?", "cria uma medida de lucro por pedido". A Aurora consulta e altera o modelo, confere cada medida e desfaz o que der erro.'],
      ['PowerPoint junto com você', 'Capa, tópicos, tabelas e gráficos montados na sua frente, com notas do apresentador. Salva em .pptx ou PDF.'],
      ['Qualquer programa', 'Calculadora, Access, o sistema da empresa: a Aurora abre, olha a tela, faz os passos e confere o resultado na tela antes de responder. Você só confirma.'],
      ['Navegador mais certeiro', 'Busca direto nos resultados do site, preenche o formulário inteiro de uma vez e vai no ritmo de uma pessoa. Se um site pedir "não sou um robô", ela para e pede para você resolver.'],
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
