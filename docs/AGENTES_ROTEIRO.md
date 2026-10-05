# Agentes de tarefas: roteiro (decidido em 04/10/2026)

Os agentes funcionam como "funcionários" da Aurora. Cada um tem uma missão, as ferramentas e pastas do seu trabalho, um gatilho e uma entrega conferível com histórico. Quatro tipos foram escolhidos:

- agentes **por setor** da empresa;
- agentes **pessoais** do dia a dia;
- **rotinas agendadas**;
- um **orquestrador**.

**Autonomia:** a mesma do modo Auto do chat. Livre dentro da pasta do agente; pergunta antes de apagar, sair da pasta, instalar ou usar a rede.

## Fase A: modelo servido pelo llama-server (cópias em paralelo)

O Ollama não roda o qwen3.5 em paralelo. Já o llama-server que vem com o Ollama faz 4 respostas em 1,6× o tempo de uma (`docs/AVALIACAO_EMPRESA_2026-10-04.md`).

- [x] A Aurora sobe e acompanha o llama-server do Ollama (`app/llamaServer.js`), rodado de dentro de `lib/ollama/<cuda_v13|cuda_v12|vulkan>` (cai para a CPU se preciso), com os pesos que o Ollama já baixou, 4 vagas, flash attention e KV q8. Sobe em ~3 s, responde com chamada de ferramenta nativa e desliga sozinho após 10 min parado, para liberar a GPU para jogos.
- [x] Só as chamadas do agente vão para o llama-server (`LOCAL_CHAT_BASE_URL`); embeddings, fichas e o resto continuam no Ollama. Se o servidor não sobe, tudo fica no Ollama. `local_chat_engine=ollama` desliga.
- [x] `probeParallelCopies` funciona nos dois motores.
- [ ] Medir: avaliação da empresa com a escalada ligada (acerto e tempo), comparando com a base de 1 resposta. **Interrompida em 04/10:** com o Crimson Desert aberto, a GPU caiu para ~2 tok/s. Refazer com a GPU livre.

## Fase B: estrutura de agentes

- [x] **Definição** (`app/agents.js`): nome, tipo, missão, setor, pasta de trabalho, ferramentas e gatilho (manual, horário ou pasta). Cada agente é um projeto, com a pasta como espaço de trabalho e a missão como instruções. Rotas em `/api/agents`.
- [x] **Execução:** um turno de chat no projeto do agente (contexto, travas, cópias e professor iguais ao chat), em modo Auto, com a busca restrita ao setor e só as ferramentas dele. Um agente faz uma tarefa por vez, em segundo plano.
- [x] **Histórico** (`agent_runs`): pedido, situação, arquivos entregues, passos, travas, revisão e cópias.
- [x] **Avaliação (05/10):** `npm run agents:eval -- --db <banco.db> --runs 5` (`app/agentTaskBattery.js`, `scripts/agent-tasks.mjs`). São três tarefas com gabarito tirado das próprias planilhas do `F:\EmpresaIA`, e a nota vem do **arquivo entregue**, não do que o agente diz:
  - **RH:** planilha de quem começa as férias em outubro;
  - **Financeiro:** planilha dos títulos com mais de 30 dias de atraso;
  - **Controladoria:** relatório Word das áreas com desvio acima de 5%.

  Para cada tarefa, quatro checagens: formato certo, todos os itens certos, nenhum item a mais, e a resposta diz onde está o arquivo.
  - **Resultado:** com `qwen3.5:4b`, sem professor, 5 rodadas, deu **96,7%** (58/60) e **13 de 15 tarefas perfeitas**. A primeira rodada tinha dado 83% e 1 de 3.
  - **O que a avaliação mostrou e foi corrigido:**
    - **Comparar de cabeça:** o modelo comparava números e datas de cabeça, e boletos com 10 dias de atraso entravam na lista de "mais de 30". Agora o `read_file` filtra por comparação (`"Dias em atraso>30"`, `"Início>=01/10/2026; Início<=31/10/2026"`, números brasileiros e datas), entende o jeito como o modelo escreve (`"Coluna=Dias em atraso>30"`) e, depois de ler uma planilha inteira, lembra que o filtro existe.
    - **Releitura em laço:** o `read_file` montava 12 mil caracteres, mas o executor corta em 4.500, e o aviso "continue com offset" se perdia. O modelo relia a mesma coisa até a trava de repetição. A leitura agora vem em pedaços que cabem no corte, e numa planilha cortada o aviso sugere o filtro e mostra as colunas.
    - **Subpasta duplicada:** um caminho que repete o nome da pasta do agente (`fin-1/x.csv` dentro de `fin-1`) criava `fin-1\fin-1`. Isso foi corrigido na resolução de caminhos, para qualquer ferramenta.
    - **Lista de entregas:** a lista de arquivos entregues passou a usar o caminho que a ferramenta informou.
    - **Gravação negada:** quando uma gravação fora da pasta é negada ou fica sem resposta, o erro diz onde o agente pode salvar sem pedir.
  - **Erros que restam:** às vezes um título com 21 dias entra na lista de "mais de 30" (quando o modelo não usa o filtro), e às vezes a resposta não cita o arquivo.

## Fase C: agentes por setor

- [x] **RH, Financeiro e Controladoria** (fase B), e depois **Compras, Jurídico, TI e Logística** (05/10). Cada setor tem um modelo de missão (`SECTOR_TEMPLATES` em `app/agents.js`) e uma tarefa na avaliação, e cada tarefa testa um tipo diferente de raciocínio:
  - **Compras:** entrega até 15/10, um corte por data;
  - **Jurídico:** contratos que terminam em 2026;
  - **TI:** chamados não resolvidos, pelo "diferente de";
  - **Logística:** produtos abaixo do estoque mínimo, comparando duas colunas da mesma linha.

  O filtro do `read_file` ganhou `!=` e a comparação entre colunas (`"Saldo<Estoque mínimo"`).
  - **Resultado:** com as 7 tarefas, 5 rodadas, deu **95%** (133/140) e **28 de 35 tarefas perfeitas**.
  - **Erro que resta (Compras):** o modelo escreve `"Entrega prevista=15/10/2026"` quando o pedido é "até 15/10". Um lembrete simples foi ignorado 5 vezes em 5. Agora a resposta do filtro mostra quantas linhas daria cada leitura ("até" dá 7, "a partir de" dá 9); falta medir esse efeito.
  - **Também corrigido:**
    - o `write_file` recusa .xlsx, .docx, .pdf e .pptx (gravava texto num .xlsx que o Excel não abre) e manda usar o `write_document`;
    - uma resposta que só repete o pedido volta para o modelo fazer a tarefa.
- [ ] Os demais setores (Administrativo, Comercial, Diretoria, Fiscal, Marketing, Produção, Qualidade, SSMA) ganham uma tarefa na avaliação quando houver uma rotina pedida de verdade.

## Fase D: rotinas agendadas e gatilhos

- [x] **Agendador (`app/agentScheduler.js`, 05/10).** Ele roda só no app desktop e confere a cada 30 s:
  - **Horário:** "às HH:MM nos dias X", uma vez por dia a partir do horário, ou "a cada N minutos".
  - **Arquivo novo numa pasta (com padrão, ex.: `*.pdf`):** os arquivos que já estão lá quando o gatilho é ligado não disparam; só os que chegarem depois ou forem salvos de novo. Os novos que chegam juntos vão numa execução só, com o nome de cada um. Trocar a pasta conta como observação nova.
  - **Limites:** uma execução por agente de cada vez e no máximo 24 automáticas por dia por agente.
  - **Aviso:** ao terminar, o Windows mostra uma notificação com o resultado e o número de arquivos entregues; clicar nela abre o app.
- [x] **Tela "Agentes"** (`frontend/src/AgentsView.tsx`): criar um agente (pessoal ou de setor, missão, pasta de trabalho e gatilho), rodar agora com um pedido, ver a última entrega com os botões Abrir e Mostrar na pasta, o histórico e a conversa completa, mudar quando ele trabalha, desligar e apagar. Com as pastas da empresa cadastradas, cria um agente por setor de uma vez. Antes disso, os agentes só existiam pela API.

## Fase E: orquestrador

- [x] **Orquestrador (`app/orchestrator.js`, 05/10).** Funciona em três passos:
  1. **Plano:** o modelo local divide um pedido grande ("feche o mês") entre os agentes que existem. Um esquema JSON limita o plano aos nomes reais e exige o formato de cada entrega (planilha, relatório em Word, PDF, texto). O prompt manda copiar os critérios, períodos e números do pedido com as mesmas palavras. Se o modelo não der um plano válido, cada agente de setor citado no pedido recebe o pedido inteiro.
  2. **Revisão:** você confere e edita cada tarefa na tela "Agentes" (Pedido para a equipe).
  3. **Execução:** duas tarefas de cada vez. Uma falha não para as outras, e no fim sai um **resumo em Word** feito por código (quem fez o quê, os arquivos e as pendências).
- [x] **Avaliação** (`scripts/orchestrator-eval.mjs`): um pedido "feche o mês" para RH, Financeiro e Controladoria, conferindo o plano, cada arquivo contra o gabarito da fase B e o resumo.
  - **Resultado (3 rodadas):** o **plano veio certo em 100%** das rodadas e a nota foi 87,9%.
  - **O que a avaliação corrigiu:**
    - o plano reescrevia o critério ("até o fim de setembro"), e o agente recalculava os dias de atraso errado;
    - o plano trocava "planilha" por "lista", e o agente entregava outro formato.
  - **Erro que resta:** às vezes o agente acrescenta uma segunda aba com linhas que não se encaixam.
- [ ] Dependências entre tarefas (uma usar a entrega da outra). Por enquanto, as tarefas são independentes.

## Fase F: agentes pessoais

- [ ] Organizar arquivos e downloads, pesquisar na web e resumir, programar e testar um projeto.
