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

- [ ] RH, Financeiro e Controladoria primeiro (onde a avaliação já existe), depois os demais setores.

## Fase D: rotinas agendadas e gatilhos

- [ ] Horário marcado (por exemplo, toda segunda às 8h) e arquivo novo numa pasta, com fila, limite de execuções e aviso quando terminar.

## Fase E: orquestrador

- [ ] Divide um pedido grande ("fecha o mês") entre os agentes, junta as entregas e confere as dependências.

## Fase F: agentes pessoais

- [ ] Organizar arquivos e downloads, pesquisar na web e resumir, programar e testar um projeto.
