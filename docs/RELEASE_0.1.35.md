# Aurora 0.1.35: mais rápida e mais certeira

## Extensões (MCP)

- **Conecte a Aurora a outros serviços:** em Configurações → Agente → Extensões, adicione servidores MCP prontos (e-mail, agenda, Notion, bancos de dados…). O agente passa a usar as ferramentas deles.
- **Com segurança:** ferramentas que só leem rodam direto; as que alteram algo sempre pedem sua autorização (ou são recusadas no modo Plano). O que uma extensão devolve conta como conteúdo de fora: um comando depois disso pede autorização, porque um e-mail pode trazer instruções escondidas.

## Mais rápida

- **Respostas longas até 5 vezes mais rápidas.** O modelo local passa a usar *decodificação especulativa por n-gramas*: quando a resposta repete trechos que já estão na conversa (linhas de uma planilha que viram uma tabela no documento, por exemplo), vários tokens saem de uma vez. O texto é o mesmo.
  - Com placa de vídeo: copiar 40 linhas de planilha caiu de 12,4 s para 3,4 s.
  - Sem placa de vídeo: de 8,5 para 40 tokens por segundo.
  - Os agentes de setor terminaram a bateria 19% mais rápido.
- **O modelo se prepara enquanto você digita:** numa conversa local, ao primeiro caractere o modelo carrega e já lê as instruções fixas. Num PC sem placa de vídeo, a primeira resposta caiu de 55 s para 10 s.

## Organizar arquivos

- **Organizar uma pasta numa vez só:** "organize meus Downloads" separa todos os arquivos soltos por tipo (Documentos, Planilhas, Imagens, Vídeos, Instaladores…) numa única ação. Subpastas e downloads em andamento ficam como estão, nada é apagado nem sobrescrito.
- **Desfazer:** a resposta que moveu ou editou arquivos, no chat ou num agente, mostra **Desfazer**. Os arquivos voltam ao lugar e à versão de antes. Um arquivo que você mudou depois, ou um novo que ocupou o lugar antigo, nunca é sobrescrito.
- **Substituir não perde mais o conteúdo:** quando a Aurora regrava um arquivo que já existia, a versão anterior fica guardada (por 30 dias) para o Desfazer.
- **Mover vários de uma vez:** a Aurora move uma lista de arquivos para a mesma pasta numa ação só.

## Agentes

- **Autorizar sem sair da tela:** quando um agente precisa de autorização, o cartão dele mostra o pedido com **Permitir** e **Negar**. Se a janela está minimizada, o Windows avisa e o clique abre o pedido. Antes, o pedido expirava sem ninguém ver.
- **Desligou no meio?** Um trabalho cortado porque a Aurora fechou ou o PC desligou aparece como "interrompido" ao abrir de novo, em vez de "trabalhando" para sempre.
- **Primeiros passos:** sem nenhum agente, a tela já mostra os modelos prontos.

- **Equipe mais certeira:** o plano não inventa mais que uma tarefa espera outra (só quando o pedido diz "primeiro… depois…"), e um agente que listou os dados na resposta em vez de gravar a planilha é cobrado a gravar. Fechamento do mês: 93,9% (era 72,7% a 87,9%); tarefa que usa a entrega de outra: 100%.
- **Registro de ações:** Configurações → Agente → Exportar registro gera uma planilha com tudo o que a Aurora fez no computador, em qualquer conversa (arquivos, comandos, formulários), com data e resultado.

- **A notificação leva à tela Agentes:** clicar em "<agente> terminou" abre a tela dos agentes.
- **A resposta sempre diz onde está o arquivo:** se o agente entregou um documento e não disse onde, a Aurora acrescenta o caminho.

## Navegador

- **Formulários de contato enviados de verdade:** apertar Enter na caixa de mensagem só pulava uma linha, mas a Aurora dizia que tinha enviado. Agora o formulário é enviado como se você clicasse em Enviar.

## Perguntas sobre a empresa

- **Menos respostas certas desmentidas:** duas travas de conferência acusavam erro onde não havia, e o modelo se retratava. "Compra de 50 mil" respondida com R$ 50.000,00 não é mais "valor inventado", e um arquivo com artigo no nome ("Treinamentos NR a Vencer.xlsx") não é mais "documento inventado".
- **"Quem está de férias agora?"** usa o período de hoje (início até hoje e fim depois de hoje), e não quem começa no mês.
- **Conversa longa demais:** em vez de parar com erro de contexto, a Aurora resume os resultados antigos e continua.

- **Endereço trocado:** se você pede para abrir um endereço e o modelo tenta abrir a mesma página em outro site (inventado), a Aurora abre o endereço que você escreveu. Assim seus dados não vão para um site que você não pediu.

## Planilhas

- **CSV também:** filtrar e ordenar agora funciona em arquivos .csv e .tsv (com ";" ou ",", e aspas), não só em Excel.
- **Condições como você falou:** "mais de 30 dias" e "acima de 5%" viram o filtro certo nas colunas da planilha, em vez de a Aurora escolher as linhas de olho.
- **Datas como você falou:** "até 15/10", "a partir de", "antes de" e "depois de" decidem a comparação, mesmo que o modelo escreva o filtro de outro jeito. "Esse mês", "mês que vem" e "em outubro" viram o período certo.
- **Linhas que faltaram:** ao gravar um documento, a Aurora confere se todas as linhas filtradas entraram e avisa quais ficaram de fora.
- **Pastas da empresa:** um caminho como "Jurídico\Contratos Vigentes.xlsx", do jeito que o mapa da empresa mostra, é encontrado na pasta da empresa.

## Medição

| O quê | Resultado |
|---|---|
| Testes automáticos | 487 passaram, 0 falhas |
| Conversas reais: documento, planilha, 10 turnos, navegador e honestidade (5 rodadas) | 97,3% |
| Agentes de setor, conferindo o arquivo entregue (3 rodadas) | 99% (23 de 24 perfeitas) |
| Perguntas sobre a empresa fictícia (49) | 96% a 100% em três rodadas (eram 92% a 96,9%) |
| Pedido para a equipe: fechamento do mês / tarefa que usa a entrega de outra | 100% / 95,2% (eram 72,7–87,9% / 85,7–90,5%) |
| Agentes pessoais (organizar pasta, corrigir código) | 86,7% a 100%; com pesquisa na web, 96,3% |
| "Organizar Downloads" com 30 arquivos, de ponta a ponta | 3 de 3 perfeitas, em 2 a 6 s; o Desfazer devolveu os 29 |
| Extensão MCP com o modelo local (ler agenda, criar evento pedindo autorização) | 6 de 6 |
| Velocidade: copiar 40 linhas para um documento | 12,4 s → 3,4 s com placa de vídeo; 8,5 → 40 tokens/s no processador |
| Primeira resposta num PC sem placa de vídeo | 55 s → 10 s |
