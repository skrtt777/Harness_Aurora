# Aurora 0.1.34: agentes que trabalham por você

## Nova tela: Agentes

Os agentes são "funcionários" da Aurora. Cada um tem uma missão e uma pasta de trabalho, e entrega arquivos.

- **Criar:** um agente pessoal (organizar arquivos, programar, pesquisar) ou de um setor da empresa. Com as pastas da empresa cadastradas, dá para criar um agente por setor de uma vez.
- **Rodar agora:** escreva o pedido. A última entrega aparece com os botões **Abrir** e **Mostrar na pasta**, e você pode ver o histórico e a conversa completa.
- **Trabalhar sozinho:**
  - num horário ("às 8h, de segunda a sexta");
  - a cada tantos minutos;
  - **quando chegar um arquivo numa pasta**. Os arquivos que já estavam lá não disparam o agente.

  Quando termina, o Windows mostra uma notificação. Cada agente roda uma tarefa por vez e no máximo 24 vezes por dia sozinho.
- **Pedido para a equipe:** um pedido grande ("feche o mês de setembro") é dividido entre os agentes. Você confere e ajusta o plano antes de começar, e no fim sai um resumo em Word com a entrega de cada um.
  - **Uma tarefa pode usar o que outra entregou:** "o Financeiro gera a planilha e depois a Controladoria faz o relatório com ela". A tarefa seguinte espera a anterior e pode ler a entrega dela.
- **Modelos prontos:** "Organizar Downloads", "Notas que chegam numa pasta" (cada nota em PDF vai para uma planilha) e "Pesquisador". O modelo preenche o formulário e você só escolhe a pasta.
- **Andamento ao vivo:** enquanto um agente trabalha, o cartão mostra a etapa, os passos e o texto sendo escrito.
- **Exportar histórico:** um botão gera uma planilha com todas as execuções (quando, qual agente, pedido, situação, arquivos e erro), para conferência e auditoria.
- **Barra lateral limpa:** as conversas dos agentes ficam na tela Agentes, e a barra lateral não ganha mais um projeto por agente.

## Conversa

- **A resposta aparece enquanto é escrita**, em vez de só no fim. O primeiro texto surge em cerca de 3 segundos.
- **Navegador:** a Aurora preenche e envia formulários com mais segurança. Ela acha o campo pelo nome que vê na página e não diz "enviei" sem ter clicado em Enviar.
- **"Onde está?"** depois de uma entrega responde com o caminho do arquivo, em vez de refazer o documento.
- **Mais estável:** se a conexão com o modelo local cai no meio de uma resposta, a Aurora refaz o pedido em vez de mostrar "fetch failed".
- **Conversas longas:** a Aurora lembra o que você disse sobre si (seu nome, seu trabalho) durante toda a conversa. Ao voltar a um assunto ("voltando ao kit de mídia…"), ela retoma o arquivo certo, e não o último citado.

## Agentes mais certeiros com planilhas

- **Ordenar e somar:** a Aurora ordena uma planilha ("qual contrato vence primeiro", "quem mais vendeu") e mostra a soma das colunas de valores das linhas filtradas ("quanto ainda falta pagar"), em vez de fazer essas contas de cabeça.
- **Pedido de arquivo sobre a empresa:** um "faça um relatório" com dados da empresa saía às vezes como "não consegui criar". Corrigido.
- **Filtro que compara:** a Aurora filtra uma planilha comparando números e datas ("mais de 30 dias de atraso", "entrega até 15/10", "desvio acima de 5%"), valores diferentes ("não resolvidos") e duas colunas ("saldo abaixo do mínimo"). Antes ela comparava de cabeça e errava.
- **Planilha grande:** é lida em pedaços com o aviso de como continuar. Antes a Aurora relia a mesma parte sem sair do lugar.
- **Formato certo:** "planilha" sai em Excel, "relatório" sai em Word. Uma planilha nunca é gravada como texto num .xlsx que o Excel não abre.

## Organizar arquivos e programar

- **Mover e renomear:** a Aurora move e renomeia arquivos para organizar uma pasta. Ela nunca sobrescreve nem apaga, e sugere o nome certo quando você escreve errado.
- **Subpastas do projeto:** dentro de um projeto, "Documentos/" é uma subpasta dele, e não a sua pasta Documentos.
- **Editar código:** a edição aceita o trecho mesmo com outra indentação, o que antes fazia a Aurora desistir.

## Medição

| O quê | Resultado |
|---|---|
| Testes automáticos | 444 passaram, 0 falhas |
| Conversas reais: documento, planilha, 10 turnos, navegador e honestidade (3 rodadas) | 98,9% |
| Agentes de 7 setores e rotina de pasta, conferindo o arquivo entregue (3 rodadas) | 97,9% |
| Perguntas sobre a empresa fictícia (49, 2 rodadas) | 96,9% (era 83%) |
| Modelo "Notas que chegam numa pasta" (duas notas chegando em momentos diferentes) | 3 de 3 rodadas perfeitas |
| Pedidos para a equipe ("feche o mês"; tarefa que usa a entrega de outra) | plano certo em 100%; 87,9% e 90,5% |
| Agentes pessoais (organizar uma pasta, corrigir código até os testes passarem) | 92% |
| Pesquisa na web com resumo e fontes | 91,7% |
