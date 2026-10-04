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
- [ ] **Avaliação:** tarefas com resultado conferível no `F:\EmpresaIA`. Exemplos: "planilha com quem sai de férias em outubro", "lista de inadimplentes acima de 30 dias", "resumo do orçamento por área".

## Fase C: agentes por setor

- [ ] RH, Financeiro e Controladoria primeiro (onde a avaliação já existe), depois os demais setores.

## Fase D: rotinas agendadas e gatilhos

- [ ] Horário marcado (por exemplo, toda segunda às 8h) e arquivo novo numa pasta, com fila, limite de execuções e aviso quando terminar.

## Fase E: orquestrador

- [ ] Divide um pedido grande ("fecha o mês") entre os agentes, junta as entregas e confere as dependências.

## Fase F: agentes pessoais

- [ ] Organizar arquivos e downloads, pesquisar na web e resumir, programar e testar um projeto.
