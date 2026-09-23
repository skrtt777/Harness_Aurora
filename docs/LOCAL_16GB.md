# Aurora para computadores com até 16 GB

## Aplicado nesta etapa

- Catálogo sugerido somente Qwen3 ou superior: Qwen3.5 0,8B, 2B, 4B, 9B e Qwen3-Coder 30B.
- Padrão Qwen3.5 4B. Escolhas persistidas de Qwen1/2 e aliases conhecidos dos experimentos Aurora 1,5B resolvem para esse padrão; seus arquivos, notas e evidências históricas são preservados.
- A configuração avançada continua aceitando modelos personalizados. Um alias personalizado não comprova a família de seus pesos. O override de desenvolvimento `LOCAL_MODEL` permanece disponível para reproduzir estudos antigos; o catálogo do aplicativo não oferece esses modelos.
- Respostas diretas por padrão para tags Qwen3, usando `think: false`. Desenvolvedores podem habilitar `LOCAL_THINK=true`. Isso não altera os pesos e precisa ser avaliado por tarefa.
- Tamanhos de download e estimativas de RAM são distinguidos no seletor. As estimativas não certificam velocidade em hardware popular.

## SSD: capacidade não é velocidade de inferência

O disco armazena os pesos; CPU/GPU precisam acessar os dados em memória para calcular. Leitura sob demanda pode reduzir a residência em RAM/VRAM, mas as transferências repetidas custam tempo. Mapear um arquivo em memória não limita por si só a RAM usada: o sistema operacional mantém páginas em cache.

Usar CPU libera VRAM, mas ainda exige RAM. Descarregar o modelo ocioso libera memória entre pedidos, não reduz o pico durante a geração. Quantização dos pesos e do cache, contexto menor e menos concorrência atuam em partes diferentes desse consumo.

Um modelo de 300 GB em SSD não é a meta padrão para computadores com 16 GB. A prioridade é concluir tarefas corretamente com modelos de poucos GB. Foi compilado um executor experimental de Qwen3-Coder MoE por SSD, separado da distribuição do app. O limite medido é do processo, não do cache total do sistema. [Protocolo, scripts e limites da avaliação](QWEN3_MOE_BENCHMARK.md).

**Atualização de 22-23/09/2026:** a primeira campanha (20–50% de 16 GiB) não aprovou nenhuma tarefa por estourar o prazo — o executor só usava paginação padrão do SO, sem nenhuma das mitigações do próprio patch. Uma segunda rodada testou `--expert-prefetch` combinado com lote de prefill maior: 17/24 em 50% (8 GiB), mas com degradação progressiva em 30%/20% (10/24 e 8/24) — a sessão longa ia batendo o prazo cada vez mais. Diagnosticado: a memória "privada" do processo (não removível por paginação) cresce ~80-90 MiB por chamada com `--expert-streaming` ativo, e como o teto de RAM é fixo, isso rouba espaço do que sobraria para especialistas. A correção foi reiniciar o `llama-server` periodicamente (a cada poucas tarefas, reaquecendo o backbone denso depois de cada reinício): no orçamento de **30% que o usuário havia proposto acima**, isso levou o resultado a **18/24 (75%), igualando a qualidade sem limite de RAM/GPU e sem nenhum estouro de prazo**. Em 20% o ganho foi real mas menor (13/24, 54%) — ali o footprint fixo já consome quase todo o orçamento de 3,2 GiB mesmo com o processo recém-reiniciado. Nada disso confirma funcionamento num PC físico de 16 GB (o teste roda numa máquina com 31,8 GiB reais, só o working-set do processo é limitado). Detalhes e números completos em [resultados](QWEN3_MOE_RESULTS.md).

## Próximas etapas propostas, ainda não implementadas

### Orçamento proposto pelo usuário: 30% da RAM

Usar 30% da memória física como ponto inicial de calibração, não como percentual do arquivo do modelo. Num computador com 16 GiB, o alvo é 4,8 GiB; com 8 GiB, 2,4 GiB. Esse alvo precisa incluir pesos residentes, contexto, ativações e buffers do executor. O espaço restante pode ser destinado ao cache de especialistas. A interface e o cache de arquivos do sistema também precisam ser medidos para não esconder consumo fora do executor.

`cache de especialistas = máximo(0, alvo de RAM - memória fixa medida - contexto - buffers - margem de segurança)`

Se as partes obrigatórias não couberem, escolher um modelo/contexto menor. Não prometer funcionamento só porque o arquivo está no SSD. Manter blocos reutilizados na RAM e buscar especialistas ausentes sob demanda; antecipar leituras dentro do mesmo orçamento. Nunca congelar ou remover especialistas necessários para ganhar velocidade sem tratar isso como alteração do modelo e reavaliar qualidade.

A seleção inicial entre 20%, 30%, 40% e 50% deve comparar tarefas iguais, com execução fria e quente, concorrência fixa e medições da memória total. Após escolher 30%, a execução normal não deve aumentar o limite sem uma escolha explícita; sob pressão do sistema deve reduzir o cache, pausar ou oferecer modelo menor. No Ollama atual, esse alvo não é um teto de memória aplicado.

Referências para a investigação: [LLM in a Flash, Apple](https://machinelearning.apple.com/research/efficient-large-language) e [Swap-MoE](https://github.com/ek15072809/Swap-MoE). O segundo foi compilado em uma cópia isolada de llama.cpp para a avaliação; continua fora do instalador do Aurora. Suas alegações de memória não equivalem a um teto global medido no Windows. A opção de fixar roteamento pode alterar a qualidade e não foi utilizada.

1. Perfil econômico com orçamento de RAM, contexto e saída; impedir truncamento silencioso ao reduzir contexto.
2. Fila única de geração e descarregamento por ociosidade. Não encerrar modelos usados por outros aplicativos.
3. Quantização de cache e distribuição CPU/GPU somente em runtimes compatíveis, com avaliação de qualidade. Configurações globais do Ollama exigem cuidado por afetarem outros clientes.
4. Cache de resultados validados e busca seletiva de memórias em SSD, ampliando os mecanismos existentes.
5. Backend experimental para MoE com cache de especialistas, leituras antecipadas e limite de residência; validar com pesos reais antes de prometer economia. **Leituras antecipadas (`--expert-prefetch`) validadas com pesos reais em 22/09/2026**; a degradação de sessão longa em 30%/20% foi diagnosticada (memória privada crescendo por chamada) e mitigada com reinício periódico do servidor, chegando a **75% de aprovação em 30%** — ver atualização acima. Cache de especialistas por orçamento de bytes (`--expert-cache-size`) e retenção explícita dos mais recentes (`--expert-keep-recent`) foram testados sem o reinício periódico e não ajudaram no teto de 50%; ainda não foram testados em conjunto com o reinício nos tetos mais apertados, onde poderiam ajudar a superar o platô observado em 20%.

## Critérios de avaliação

Testar máquinas reais com 8 e 16 GB, SSD SATA e NVMe, sem GPU dedicada. Limitar memória ou desabilitar GPU em um i9/4090 é um ensaio controlado, não representa um notebook comum.

Medir pico de memória do processo e do sistema, pressão/paginação, VRAM, bytes lidos, tempo de carregamento, primeira resposta, tokens/s e tarefas aprovadas. Separar execução fria de quente e geração de treino. Energia total do computador exige medição adequada; R$ 1,00/kWh continua hipótese editável.

Fontes: [modelos Qwen3.5 no Ollama](https://ollama.com/library/qwen3.5), [memória, concorrência e cache no Ollama](https://docs.ollama.com/faq), [parâmetros de geração](https://docs.ollama.com/api/generate), [llama.cpp](https://github.com/ggml-org/llama.cpp).
