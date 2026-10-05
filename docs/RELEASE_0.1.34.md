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
- **Barra lateral limpa:** as conversas dos agentes ficam na tela Agentes, e a barra lateral não ganha mais um projeto por agente.

## Conversa

- **A resposta aparece enquanto é escrita**, em vez de só no fim. O primeiro texto surge em cerca de 3 segundos.
- **Conversas longas:** a Aurora lembra o que você disse sobre si (seu nome, seu trabalho) durante toda a conversa. Ao voltar a um assunto ("voltando ao kit de mídia…"), ela retoma o arquivo certo, e não o último citado.

## Agentes mais certeiros com planilhas

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
| Testes automáticos | 436 passaram, 0 falhas |
| Conversas reais, inclusive uma de 10 turnos (3 rodadas) | 98,7% |
| Agentes de 7 setores, conferindo o arquivo entregue (5 rodadas) | 95% |
| Rotina de pasta, do arquivo chegar até a entrega | 93,8% |
| "Feche o mês" pela equipe | plano certo em 100%, 87,9% no total |
| Agentes pessoais (organizar uma pasta, corrigir código até os testes passarem) | 92% |
| Pesquisa na web com resumo e fontes | 91,7% |
