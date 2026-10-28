import { useEffect, useRef } from 'react';
import Icon from './Icon';
import './welcome.css';

/**
 * "O que há de novo": once after an update, a few plain lines about what changed, so the new things
 * are found (the computer map, for one, is off until the person turns it on). Never on a first
 * install: the welcome guide covers that.
 */
export const NEWS: Record<string, { title: string; items: [string, string][] }> = {
  '0.1.55': {
    title: 'O comprovante e a resposta viva',
    items: [
      ['O comprovante', 'Cada número que a Aurora diz vem com a prova: passe o mouse e veja a planilha, a célula e a linha de onde ele veio, ou a conta que o gerou. O que não tem fonte fica marcado. Baixe o comprovante em CSV para o Excel.'],
      ['A resposta viva', 'Se a planilha mudar depois da resposta, o número antigo aparece riscado com o novo ao lado, e as contas que dependem dele são refeitas. Um clique em "Refazer com os dados novos" atualiza a resposta.'],
      ['Respostas que mudaram', 'A tela inicial mostra as respostas de qualquer conversa cuja planilha mudou depois. Um clique abre a conversa.'],
    ],
  },
  '0.1.54': {
    title: 'O chip de memória, modelos fortes mais fáceis e uma Aurora mais certeira',
    items: [
      ['Chip de memória', 'Em Memória → Mapa Vivo, sua memória vira um chip: cada célula é uma memória de verdade. Dê zoom de 1× a 1200×, veja a linha do tempo, o calor de uso, compare duas memórias e traga de volta as esquecidas no Arquivo.'],
      ['Modelos fortes mais fáceis', 'Hermes e OpenClaw também podem ajudar, sempre sem ver seus dados. A Aurora testa cada motor sozinha e diz em palavras simples o que falta. O Claude ficou mais barato com o cache de prompt.'],
      ['Contas, boletos e pastas', 'Ela confere boletos com o extrato, faz contas exatas, divide por pessoa, cria pastas e move arquivos por tipo, e procura dentro dos arquivos quando o nome não bate.'],
      ['Mais segura', 'Um arquivo com ordens escondidas não muda nada. Apagar, mesmo que seja movendo arquivos, pede confirmação, e o salário de um colega fica restrito também em trechos de planilha.'],
      ['Skills e outros harness', 'Use as skills do Claude Code, do Codex e do OpenClaw, e traga as memórias do Hermes e do OpenClaw em Memória → De outro harness. Os agentes periódicos ganharam horário de silêncio.'],
    ],
  },
  '0.1.53': {
    title: 'O Mapa Vivo, a Zeladora e o WhatsApp funcionando',
    items: [
      ['Mapa Vivo', 'Em Memória → Mapa Vivo, sua memória vira um mar vivo: cada pensamento é uma célula, cada memória uma luz dentro dela. Passe o mouse para mexer a água e clique nela para fazer uma onda.'],
      ['A Zeladora', 'Uma água-viva que cuida das suas memórias sozinha: lê, liga as parecidas, junta as repetidas numa só (sem perder nada) e marca valores que não batem. Tudo pode ser desfeito, e o botão ⌖ a chama para uma seção.'],
      ['Converse vendo o mapa', 'O chat fica ao lado do mapa: veja a Aurora buscar e consultar as memórias enquanto responde.'],
      ['WhatsApp', 'Corrigido: o WhatsApp caía e reconectava sem parar, e por isso não enviava nem respondia. Se ele ainda aparecer desligado, clique em Reconectar em Configurações → Celular.'],
    ],
  },
  '0.1.52': {
    title: 'WhatsApp, qualquer modelo e o modo top secret',
    items: [
      ['WhatsApp', 'Em Configurações → Celular, leia o QR e converse com a Aurora em "Mensagem para você". É a mesma conversa do Telegram: a resposta volta por onde você escreveu.'],
      ['Qualquer modelo por chave', 'Em Configurações → Modelos: Claude, OpenAI, OpenRouter, Gemini ou um endpoint da empresa. Eles trabalham como o Claude Code e o Codex, sem ver seus dados.'],
      ['Top secret', 'Em "Seus dados", escolha Censurados: os documentos vão com nomes, CPF, valores e números trocados por marcas, e a resposta volta aqui com os valores reais.'],
      ['Termos sigilosos e o que saiu', 'Em Configurações → Privacidade, liste os nomes que nunca podem sair (viram [SIGILO 1]) e veja tudo o que já foi enviado a uma IA paga.'],
    ],
  },
  '0.1.51': {
    title: 'Claude e Codex ajudam de verdade, sem ver seus dados',
    items: [
      ['Ajuda ativa', 'Com o Claude ou o Codex instalado, pedidos de apresentação, planilha, documento, gráfico, análise das planilhas ou correção de código vão primeiro para eles. A Aurora local cuida da conversa e assume quando eles não conseguem.'],
      ['Seus dados ficam aqui', 'Eles trabalham numa cópia das suas planilhas com nomes, CPFs e valores falsos e escrevem um programa, que a Aurora roda aqui nos dados reais. Se uma tarefa precisar ler um documento de verdade, ela pergunta antes.'],
      ['Professor sem ver o conteúdo', 'A revisão das entregas mostra ao professor só o que a Aurora fez e os erros, com nomes e números trocados por marcas.'],
      ['Agentes com Claude ou Codex', 'Cada agente pode trabalhar com a Aurora local, com o Claude ou com o Codex, sempre sem ver seus dados. No Escritório, o Claude e o Codex aparecem trabalhando ao lado de quem passou a tarefa.'],
      ['Você escolhe', 'Em Configurações → Professor: quando eles entram (ajuda ativa ou só se a local falhar), se seus dados podem sair e quantas chamadas por dia.'],
    ],
  },
  '0.1.50': {
    title: 'Anexe qualquer arquivo, inclusive Power BI',
    items: [
      ['Anexos de qualquer formato', 'Um botão de clipe no campo de mensagem anexa vários arquivos de uma vez. Antes, um arquivo fora da lista (como um .pbix) sumia sem aviso; agora a Aurora sempre sabe o que foi anexado.'],
      ['Power BI lido sem abrir o programa', 'De um .pbix a Aurora lê as páginas e os visuais do relatório; de um .pbit, também as tabelas, colunas, medidas com o DAX e os relacionamentos. Código (.py, .sql, .dax, .yaml…) também é lido.'],
      ['Aurora do chat sem giros bruscos', 'Começar a digitar ou enviar fazia a aurora do fundo girar de uma vez. Agora ela acelera aos poucos.'],
      ['Escritório mais leve', 'O Escritório redesenhava o andar inteiro na taxa máxima do monitor. Agora desenha 30 quadros por segundo, com cerca de 4 vezes menos trabalho.'],
    ],
  },
  '0.1.49': {
    title: 'Visual novo: aurora fria no chat e na memória',
    items: [
      ['Paleta fria com aurora no fundo', 'O chat ganhou uma paleta fria sobre preto com um destaque ciano e, ao fundo, uma aurora boreal feita de 0 e 1. Ela liga e desliga em Configurações > Geral.'],
      ['Atlas da memória em aurora', 'Na vista "Aurora" do Atlas, cada assunto é um véu de partículas e cada memória um ponto de luz: a altura mostra o uso, e uma memória usada acende com uma onda.'],
      ['Bancada criativa', 'No chat de um projeto, "Abrir bancada criativa" mostra as referências enviadas pelo Telegram (/bancada, /referencia). Ligue até três a uma decisão e ela vira memória do projeto.'],
      ['Mais modelos locais funcionam', 'Modelos que vêm sem o modelo de conversa com ferramentas (Ministral 3, gpt-oss) agora recebem o oficial automaticamente. O Ministral 3 3B foi de 43% para 83% de acerto.'],
      ['Comandos longos sem saída perdida', 'Um servidor ou build demorado com muita saída deixava de mostrar as linhas novas. Agora a Aurora sempre vê o que veio depois e é avisada do que foi descartado.'],
    ],
  },
  '0.1.48': {
    title: 'Roda em computador fraco (8 GB, sem placa de vídeo)',
    items: [
      ['Modelo pelo computador', 'Sem placa de vídeo e com até ~10 GB de RAM, a Aurora usa o Qwen3.5 2B: cabe em 8 GB (pico de 2,7 GB) e responde 1,6× mais rápido. Nos demais, continua o 4B. Quem escolheu um modelo mantém o seu.'],
      ['Começo da conversa de volta em 38 ms', 'No processador, cada conversa nova relia 3 a 4 mil tokens (~55 s). Agora há um começo salvo para cada conjunto de ferramentas, restaurado na hora.'],
      ['Percentuais, ordem e cruzamentos certos', 'A participação de cada linha no total vem pronta. A ordem "do maior para o menor" usa a coluna certa, e uma lista fora dessa ordem é corrigida.'],
      ['Documento só com os dados de verdade', 'Um documento sobre uma planilha da pasta só é gravado depois de ela ser lida. As buscas nas pastas pessoais apontam também o que está na pasta do projeto.'],
    ],
  },
  '0.1.47': {
    title: 'Respostas que conferem: contas, listas e entregas',
    items: [
      ['Faz o que diz que fez', 'Se a resposta diz "Pronto, aplicado" sem nenhuma ferramenta ter rodado, a Aurora faz de verdade ou diz que não fez. No modo Plano, um aviso no topo diz que nada foi executado e como sair dele.'],
      ['BI do começo ao fim', '"BI", "painel" e "indicadores" trazem o Power BI. O tema e as cores pedidas (ex.: azul e amarelo) são aplicados montando o painel de novo, e a planilha do assunto entra junto.'],
      ['Contas feitas pela ferramenta', 'Somas, maior e menor, dias entre datas, ordenação, estoque abaixo do mínimo, "não entregues" e cruzamento de duas planilhas chegam prontos para a Aurora. Ela não soma de cabeça.'],
      ['Apresentações .pptx', 'Pedidos de apresentação viram um arquivo do PowerPoint de verdade, com um slide por título e tabelas.'],
      ['Código que confere a saída', 'CSV com ";" e BOM vem com o jeito certo de abrir em Python. Rodar de novo depois de corrigir não é mais barrado, e a saída que não bate com os dados é tratada como erro do código.'],
    ],
  },
  '0.1.46': {
    title: 'A Aurora leve: roda em notebook',
    items: [
      ['Muito mais leve para o modelo local', 'Cada pedido manda ao modelo só as ferramentas e as regras do assunto dele: o começo de cada pedido caiu de 12-14 mil para 5-7 mil tokens. Num computador sem placa de vídeo, a primeira resposta chega em menos da metade do tempo.'],
      ['Menos memória', 'Sem placa de vídeo, o modelo usa uma vaga só e o cache de pedidos tem limite pela memória do computador. As gerações simples usam o mesmo modelo já carregado, em vez de carregar outro.'],
      ['Sem cair no modo sem ferramentas', 'Em computador sem placa de vídeo, cada passo pode levar até 15 minutos antes de desistir. Antes, a Aurora desistia em 5 e respondia sem conseguir gravar arquivos.'],
      ['Jurídico com a lei aberta', 'Pedidos jurídicos sempre recebem a página oficial da lei e as ferramentas para lê-la.'],
    ],
  },
  '0.1.45': {
    title: 'Pedidos grandes não são mais recusados',
    items: [
      ['Projeto grande, computador menor', 'A mensagem "Requisitos ou dependências excedem o contexto" não barra mais os pedidos. Quando o projeto, os anexos e os documentos da empresa não cabem, a Aurora usa um trecho deles, avisa e lê o resto do arquivo quando precisar.'],
      ['Leis direto da fonte', 'Em pedidos jurídicos e em perguntas sobre a CLT, a Aurora já começa pela página oficial da lei no Planalto e só cita artigos que leu ali.'],
      ['A Conferência ensina', 'Cada erro que a Conferência segura vira uma lição curta na memória da Aurora, para o próximo pedido parecido.'],
      ['Filtros mais certeiros', 'Listas por condição (férias em outubro, contas a pagar até uma data) saem com as linhas exatas do filtro.'],
      ['A ordem de serviço à vista', 'Enquanto a Aurora trabalha, a conversa mostra o que ela entendeu que precisa entregar. No VS Code também (extensão 0.2.1).'],
    ],
  },
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
