# Plano de melhoria do Aurora orientado pelos testes

Data: 20/09/2026. Estado: [primeiro ciclo](CICLO1_ECONOMIA_RESULTADOS.md) e [integração de testes funcionais do ciclo 2](CICLO2_VALIDACAO_RESULTADOS.md) implementados e testados. Telemetria, diagnósticos, contratos de navegador e reparos locais estão ativos na prévia. O ciclo 2 recuperou 2/4 defeitos controlados com o modelo 1.5B; isso ainda não valida geração de projetos completos. A seleção candidata segue experimental por não ter passado no critério de qualidade. Generalização dos testes, aprendizado verificado e comparação de modelos permanecem pendentes.

## Objetivo

Aumentar a proporção de entregas funcionais do modelo local, reduzindo o gasto por entrega aprovada. A memória deve ser opcional e útil; recuperar muitos registros não é, por si só, sucesso. O harness controla estado, orçamento, reaproveitamento e testes para poupar trabalho do modelo.

Base: [relatório A/B](../reports/memory-ab-2026-09-20/README.md), [resultados](../reports/memory-ab-2026-09-20/results.json) e [dashboard](../reports/memory-ab-2026-09-20/dashboard.html).

## Evidências e hipóteses

| Evidência observada | Consequência para o plano |
|---|---|
| Sem memória: 37,3/100 e 1/18 aprovados. Com memória: 32,2/100 e 0/18. | A qualidade básica também precisa melhorar; remover memória não resolve o produto. |
| Memória aumentou tokens em 81,0% e tempo de geração em 36,5%. | Medir o custo incremental do contexto e permitir recuperação vazia. |
| O BI recebeu memórias de áudio, FPS e Snake. A landing recebeu várias memórias de jogos. | Corrigir relevância e compatibilidade antes de ampliar o acervo. |
| Skills `browser-game`, `bi-analysis` e `task-decomposition` entraram juntas nos exemplos revisados de domínios diferentes. | Avaliar o roteamento de skills separadamente do efeito de memórias. |
| 31/35 correções produziram HTML idêntico; nenhuma recuperou aprovação. | Detectar ausência de mudança e trocar a estratégia de reparo. |
| Falhas incluem controles obrigatórios ausentes, acesso a elemento inexistente, estado incorreto e reatribuição de const. | Validar contratos e comportamento, não só sintaxe ou abertura da página. |
| Quatro chamadas com memória atingiram o teto de saída; nenhuma sem memória. | Tratar truncamento como falha e investigar saídas menores/modulares. Não prova, isoladamente, que o contexto causou o truncamento. |

O ensaio utilizou seis tarefas pequenas, três sementes e uma biblioteca focada em jogos. O intervalo exploratório da diferença de nota inclui zero. Não demonstra que toda memória prejudica, nem que o modelo 1.5B é incapaz de qualquer tarefa. A hipótese de sobrecarga de contexto precisa de novos testes controlados.

## Ordem de execução

### P0 — Instrumentação e referência confiável

**Entregas**

- Preservar o experimento original, seus artefatos e suas notas. Correções no avaliador recebem nova versão e reavaliação explícita, sem substituir silenciosamente resultados antigos.
- Usar a mesma telemetria no benchmark, no chat e nos workflows: cada chamada, entrada, saída, cache do modelo, tempo, motivo de repetição, truncamento e resultado da validação. `refineLocalAnswer` hoje retorna o resultado corrente; é necessário agregar também o custo das chamadas anteriores no chat.
- Separar consulta de memória, reutilização de artefato e cache de tokens. São três mecanismos diferentes e terão indicadores diferentes.
- Melhorar as evidências do avaliador: requisito, ação, esperado, observado e controle/arquivo envolvido. Trocar mensagens como `false` e timeout genérico por diagnósticos objetivos.
- Distinguir erro de contrato explícito (por exemplo, ID obrigatório ausente) de comportamento funcional e qualidade visual. Não relaxar os requisitos do teste original depois de ver os resultados.
- Construir uma suíte de desenvolvimento e reservar uma suíte inédita de aceitação. Congelar pedidos, critérios, sementes e orçamento antes de cada campanha.

**Aceite:** totais do chat correspondem à soma das chamadas; nenhuma chamada de reparo fica fora da conta; nenhuma tarefa recebe aprovação funcional por mera ausência de erro ao abrir. Reproduzir ao menos um caso aprovado, um erro de DOM, um erro de cálculo e uma falha de reinício pela integração real do aplicativo.

**Arquivos principais:** `app/local.js`, `app/localRefine.js`, `app/server.js`, `app/workflows.js`, `scripts/benchmark/`.

### P1 — Contexto pequeno e pertinente

**Entregas**

- Extrair da tarefa domínio, tecnologia, capacidade e restrições. Começar com regras e metadados locais; não acrescentar uma chamada de IA obrigatória para classificar cada pedido.
- Retirar o texto genérico de formatação da consulta de busca, sem removê-lo dos requisitos enviados ao modelo. Separar capacidades desejadas de coisas explicitamente proibidas: mencionar áudio para proibi-lo não deve favorecer uma memória de áudio.
- Ajustar a seleção de skills: usar apenas as pertinentes. Regras gerais do harness ficam no kernel curto ou no código de execução, evitando repetir uma skill genérica em toda chamada.
- Adicionar compatibilidade de domínio/tecnologia, deduplicação e um limiar de relevância calibrado. Memórias transversais continuam possíveis quando forem aplicáveis. Não preencher uma cota com registros fracos.
- Experimento inicial: zero a três memórias, teto aproximado de 400–600 tokens para referências e conteúdo completo de cada bloco. A contagem real será conferida pelo Ollama. Esses limites são candidatos, não números finais garantidos.
- Registrar por que cada referência foi selecionada ou rejeitada e quantos tokens acrescentou. Não gerar resumos novos de todas as memórias a cada pedido.

**Aceite de recuperação:** em um conjunto rotulado de consultas positivas e negativas, precisão das referências selecionadas ≥ 85%, recuperação de pelo menos uma referência essencial ≥ 90% nas consultas que possuem resposta e abstenção correta ≥ 90% nas consultas sem referência adequada. Esses indicadores serão medidos separadamente para evitar que retornar sempre vazio pareça sucesso.

**Aceite no produto:** reduzir em pelo menos 50% o contexto de referência frente ao braço com memória atual, sem reduzir aprovações na suíte de desenvolvimento. Comparar com e sem memória usando exatamente o mesmo novo roteamento de skills. Se não houver ganho, manter memória desligada naquele tipo de tarefa.

**Arquivos principais:** `app/store.js`, `app/skills.js`, `app/economy.js`; metadados versionados da biblioteca.

### P2 — Correções locais que produzam progresso

**Entregas**

- Guardar uma cópia da última versão funcional antes de cada alteração.
- Localizar a falha e enviar somente o trecho necessário, as interfaces envolvidas e o diagnóstico estruturado, em vez de exigir a reescrita de toda a página em todo reparo.
- Preferir operações de edição com alvo e texto anterior verificáveis, ou substituição completa de um módulo pequeno. Não presumir que um modelo pequeno será confiável produzindo um diff livre.
- O harness aplica a edição somente quando o alvo coincide, executa o teste que falhou e os testes de regressão pertinentes. Mantém a nova versão apenas quando corrige o problema sem regressões conhecidas.
- Comparar hashes do artefato antes/depois. Se o modelo não alterou nada e a falha persiste, não repetir a mesma chamada. Permitir uma mudança de estratégia dentro do orçamento: diagnóstico mais localizado, divisão da etapa ou modelo local alternativo já disponível.
- Truncamento, edição inválida ou falta de progresso recebem estado explícito. Não salvar essas saídas como solução aprovada.

**Aceite:** zero reparos idênticos aceitos como correção; zero regressões conhecidas promovidas; recuperar pelo menos 50% de um conjunto separado de defeitos controlados de DOM, estado, persistência e cálculos, com no máximo duas tentativas. Medir também reparos em falhas naturais das gerações, sem confundir a taxa desses dois conjuntos.

**Arquivos principais:** `app/localRefine.js`, `app/workflowValidation.js`, integração de chat e workflows.

### P3 — Fazer o harness assumir o trabalho repetitivo

**Entregas**

- Evoluir os workflows e o cache já existentes, preservando os mecanismos de orçamento, dependências, retomada e invalidação. Não criar uma segunda implementação concorrente.
- Antes da geração, manter um contrato compacto: arquivos, interfaces, dados, comportamentos e testes de aceitação. Esse contrato permanece estável durante as etapas.
- Utilizar estruturas de projeto já verificadas para página, jogo, CRUD e BI quando forem compatíveis. O modelo preenche o comportamento específico. Registrar o uso dessas estruturas para não atribuir seu ganho à memória.
- Lista de tarefas e estados ficam no aplicativo. O modelo recebe apenas a etapa atual, suas dependências necessárias e evidências relevantes. Não precisa reescrever o plano inteiro a cada resposta.
- Cada etapa passa por testes adequados; a integração final também passa. Validar etapas isoladas não comprova que o projeto integrado funciona.
- Pedido idêntico com requisitos, dependências e versões compatíveis pode reutilizar artefato aprovado. Pedido semelhante só produz um candidato para adaptação e revalidação. Mudança em dados, regras, dependências, modelo/política relevante ou validador invalida a reutilização conforme sua compatibilidade.
- Alterações pequenas afetam apenas módulos necessários; preservar arquivos, dados e comportamento aprovados.

**Aceite:** repetir um pedido compatível exige zero novas chamadas de geração quando há artefato aprovado reutilizável; alteração de requisito impede reutilização incorreta. Nos testes de evolução de projeto, recursos anteriores continuam passando. A primeira meta de qualidade é ≥ 50% de aprovação na suíte pequena de desenvolvimento; ≥ 80% é uma meta posterior para tarefas simples suportadas, não uma promessa para qualquer projeto.

**Arquivos principais:** `app/workflows.js`, `app/artifacts.js`, `app/workflowValidation.js`, `app/server.js`.

### P4 — Aprender somente a partir de correções verificadas

**Entregas**

- Distinguir referências gerais, procedimentos testados, correções verificadas, artefatos reutilizáveis e estado do projeto. O armazenamento pode ser compartilhado, mas as regras de seleção serão diferentes.
- Uma memória de correção contém: condição de aplicação, sintoma, causa conhecida ou hipótese identificada, alteração, teste antes/depois, versões e proveniência. Uma resposta plausível não basta para gerar uma regra permanente.
- Usar preenchimento estruturado determinístico sempre que possível; qualquer chamada para extrair/resumir conhecimento entra no custo da operação.
- Deduplicar e atualizar registros existentes; manter validade por versão e relações de substituição. Uma única execução não torna uma regra universal.
- Recuperar detalhes sob demanda. O índice curto localiza o conhecimento; o corpo só entra no contexto quando necessário.
- Medir transferência: aplicar uma correção aprendida em uma nova tarefa com dados e estrutura diferentes. Durante uma campanha de avaliação, o corpus permanece congelado. Aprendizado acontece em uma campanha separada, usando somente seus dados de desenvolvimento.

**Aceite:** toda correção promovida possui evidência de teste; nenhuma falha vira memória aprovada automaticamente; duplicatas e regras superadas não são recuperadas juntas sem resolução. Para afirmar benefício de uma memória aprendida, demonstrar melhora em casos inéditos frente ao mesmo executor sem essa memória.

**Economia:** contabilizar o custo de preparar, extrair e indexar o conhecimento. Quando há economia positiva por reutilização, estimar ponto de equilíbrio = custo de preparação ÷ economia média por uso válido. Sem economia positiva, não anunciar amortização.

### P5 — Capacidade e custo do modelo local

Depois de corrigir seleção, validação e reparo, comparar o 1.5B com o 3B já instalado, nas mesmas tarefas e condições. Registrar digest, quantização, parâmetros, VRAM, tempo e tokens. Tokens de modelos diferentes não têm custo computacional idêntico; comparar também tempo, energia estimada e aprovação.

O candidato a política é: modelo menor para etapas que ele resolve; modelo local alternativo para falhas específicas ou etapas mais exigentes, sempre dentro do orçamento total do pedido. O limite deve incluir todas as tentativas anteriores, sem reiniciar a conta ao trocar o modelo. Ajuda de professor/API paga continua dependendo de ação explícita do usuário, conforme as regras existentes do produto.

**Aceite:** adotar uma política apenas se melhorar aprovação dentro do orçamento declarado, ou reduzir custo por aprovação sem piorar qualidade. Testar o perfil de hardware pretendido para o produto; resultados de velocidade da RTX 4090 não demonstram desempenho em máquinas modestas.

## Desenho dos próximos experimentos

1. Preservar A (atual sem memória) e B (atual com memória) como histórico.
2. Isolar a seleção de skills com memória desligada. Não misturar esse resultado com ganho da memória.
3. Comparar C (executor candidato sem memória) e D (o mesmo executor com memória seletiva). Kernel, skills, modelos, tarefas, parâmetros e limites iguais dentro de cada par.
4. Repetir C/D após introduzir o reparo localizado. Depois, testar estruturas reutilizáveis e execução em etapas como intervenções adicionais identificadas.
5. Adicionar teste de repetição e evolução: pedido igual, pedido com pequena mudança e pedido semelhante porém incompatível. Medir custo da primeira entrega e custo dos usos seguintes separadamente.
6. Depois de escolher a configuração na suíte de desenvolvimento, executar uma vez a aceitação inédita: inicialmente 12 novas tarefas, três por domínio, com três sementes. Congelar a configuração antes de abrir os resultados. Se ela for ajustada depois, esses casos deixam de ser inéditos e será necessário outro conjunto de aceitação.

Variar mais tarefas tem prioridade sobre repetir muitas sementes da mesma tarefa. Executar inferências sequencialmente, contrabalancear a ordem dos braços e separar aquecimento de execução normal. O teste final inclui o fluxo real do aplicativo, além das chamadas instrumentadas isoladas. Evitar rodar toda a matriz de modelos/configurações: usar testes baratos de seleção e defeitos controlados para eliminar candidatos antes da campanha completa.

## Dashboard e decisões

Manter aprovação funcional e **custo por entrega aprovada** como indicadores principais. Quando não houver aprovações, mostrar “sem entrega aprovada”, nunca custo zero. Preservar nota por dimensão como diagnóstico, evitando que um ganho cosmético oculte uma regressão funcional.

Acrescentar ao painel existente:

- aprovação inicial/final e por domínio; critérios não testados;
- recuperação após reparo, repetição sem alteração e regressões;
- precisão/abstenção da recuperação, referências incluídas e seu orçamento;
- entrada, saída, cache e custo de todas as chamadas, inclusive extração de memória;
- P50/P95 de geração e ciclo completo, tempo de testes e busca;
- reaproveitamento exato, adaptação, invalidações e usos necessários para amortizar a preparação;
- energia medida parcialmente versus custo estimado do PC, com R$ 1,00/kWh editável;
- resultado em tarefas inéditas, tamanho da amostra e dispersão, sem transformar uma média pequena em promessa geral.

**Decisão de avanço:** uma mudança só entra no padrão quando passa pelos testes de contrato e regressão, respeita o orçamento e demonstra ganho frente ao controle correspondente. Se houver troca entre qualidade e custo, documentar e escolher o perfil explicitamente; economia de tokens sozinha não autoriza entregar algo que funciona menos.

## Primeira entrega de implementação

Começar por **telemetria acumulada, diagnósticos objetivos e seleção de contexto**, nessa ordem. Em seguida, implementar detecção de reparo sem mudança e reparos localizados. Esses itens atacam desperdícios observados e permitem avaliar com confiança as etapas posteriores. Não expandir indiscriminadamente a biblioteca nem reescrever a interface para tentar resolver falhas do executor.
