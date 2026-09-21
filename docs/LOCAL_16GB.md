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

Um modelo de 300 GB em SSD não é a meta padrão para computadores com 16 GB. A prioridade é concluir tarefas corretamente com modelos de poucos GB. Um executor de pesos por SSD permanece experimento separado e não foi implementado nesta etapa.

## Próximas etapas propostas, ainda não implementadas

### Orçamento proposto pelo usuário: 30% da RAM

Usar 30% da memória física como ponto inicial de calibração, não como percentual do arquivo do modelo. Num computador com 16 GiB, o alvo é 4,8 GiB; com 8 GiB, 2,4 GiB. Esse alvo precisa incluir pesos residentes, contexto, ativações e buffers do executor. O espaço restante pode ser destinado ao cache de especialistas. A interface e o cache de arquivos do sistema também precisam ser medidos para não esconder consumo fora do executor.

`cache de especialistas = máximo(0, alvo de RAM - memória fixa medida - contexto - buffers - margem de segurança)`

Se as partes obrigatórias não couberem, escolher um modelo/contexto menor. Não prometer funcionamento só porque o arquivo está no SSD. Manter blocos reutilizados na RAM e buscar especialistas ausentes sob demanda; antecipar leituras dentro do mesmo orçamento. Nunca congelar ou remover especialistas necessários para ganhar velocidade sem tratar isso como alteração do modelo e reavaliar qualidade.

A seleção inicial entre 20%, 30%, 40% e 50% deve comparar tarefas iguais, com execução fria e quente, concorrência fixa e medições da memória total. Após escolher 30%, a execução normal não deve aumentar o limite sem uma escolha explícita; sob pressão do sistema deve reduzir o cache, pausar ou oferecer modelo menor. No Ollama atual, esse alvo não é um teto de memória aplicado.

Referências para a investigação: [LLM in a Flash, Apple](https://machinelearning.apple.com/research/efficient-large-language) e [Swap-MoE](https://github.com/ek15072809/Swap-MoE). O segundo é um projeto externo experimental que altera llama.cpp; suas alegações de limite e desempenho precisam de reprodução. Não foi instalado ou incorporado. A opção de fixar roteamento pode alterar a qualidade e não faz parte do caminho inicial proposto.

1. Perfil econômico com orçamento de RAM, contexto e saída; impedir truncamento silencioso ao reduzir contexto.
2. Fila única de geração e descarregamento por ociosidade. Não encerrar modelos usados por outros aplicativos.
3. Quantização de cache e distribuição CPU/GPU somente em runtimes compatíveis, com avaliação de qualidade. Configurações globais do Ollama exigem cuidado por afetarem outros clientes.
4. Cache de resultados validados e busca seletiva de memórias em SSD, ampliando os mecanismos existentes.
5. Backend experimental para MoE com cache de especialistas, leituras antecipadas e limite de residência; validar com pesos reais antes de prometer economia.

## Critérios de avaliação

Testar máquinas reais com 8 e 16 GB, SSD SATA e NVMe, sem GPU dedicada. Limitar memória ou desabilitar GPU em um i9/4090 é um ensaio controlado, não representa um notebook comum.

Medir pico de memória do processo e do sistema, pressão/paginação, VRAM, bytes lidos, tempo de carregamento, primeira resposta, tokens/s e tarefas aprovadas. Separar execução fria de quente e geração de treino. Energia total do computador exige medição adequada; R$ 1,00/kWh continua hipótese editável.

Fontes: [modelos Qwen3.5 no Ollama](https://ollama.com/library/qwen3.5), [memória, concorrência e cache no Ollama](https://docs.ollama.com/faq), [parâmetros de geração](https://docs.ollama.com/api/generate), [llama.cpp](https://github.com/ggml-org/llama.cpp).
