# Ciclo 1 — implementação e verificação

20/09/2026. [Plano](PLANO_MELHORIA_MEDIDA.md).

## Implementado e ativo na prévia

- `runLocal` coleta tokens, cache e durações; o refinamento soma a geração inicial e todas as tentativas, inclusive respostas rejeitadas. Uso desconhecido permanece explicitamente desconhecido, com subtotal conhecido separado.
- O chat persiste a evidência de execução junto da mensagem. A migração adiciona uma coluna sem apagar dados. Workflows também registram métricas de suas chamadas, além do orçamento acumulado existente.
- Diagnósticos estáticos percorrem todos os scripts inline e registram alvo, esperado e observado. Detectam sintaxe, reatribuição de const e referências a IDs ausentes quando a criação dinâmica de elementos não torna a inferência insegura.
- HTML completo recebe reparos por JSON com trechos `before`/`after`. O aplicativo aplica somente alvos literais únicos, rejeita sobreposição e remoção de IDs existentes, e preserva o restante do documento. O contexto de reparo pode conter apenas o script envolvido, sem reenviar CSS e marcação irrelevantes.
- O refinamento detecta artefatos repetidos, mantém no máximo duas tentativas e fornece o motivo de rejeição na tentativa seguinte. Novos erros estáticos ou ausência de progresso impedem substituir a versão anterior.
- Um teste que apenas abre o HTML agora resulta em `needs_review`, com nível de inicialização. Não concede aprovação funcional ao workflow. Automatizar essa aprovação exige os testes de comportamento da etapa, ainda pendentes.

Prévia atualizada: http://127.0.0.1:8788. Banco preservado com backup em `app/data/economy-preview-before-cycle1.db`. Instalação original da porta 8787 não foi substituída. A seleção continua no modo padrão anterior; as proteções e a telemetria descritas acima estão ativas na prévia.

## Reparo com modelo real

[Evidências finais](../reports/cycle1-local-repairs-final/results.json).

| Defeito controlado | Antes | Depois | Chamadas de reparo |
|---|---|---|---:|
| Contador reatribuía uma const | Falha | Clique incrementa corretamente | 2 |
| Código procurava ID inexistente | Falha | Clique incrementa corretamente | 1 |
| Declaração com erro de sintaxe | Falha | Clique incrementa corretamente | 1 |

**3/3 recuperados, quatro chamadas reais ao Qwen2.5-Coder 1.5B e 1.256 tokens no total.** Os HTMLs iniciais foram fixtures com defeitos controlados, não gerações novas do modelo. A validação executou o botão em Chromium e verificou o valor e os erros JavaScript. Uma edição com alvo incorreto foi rejeitada antes de uma nova tentativa válida. É uma evidência pequena de reparo localizado; não demonstra resolução de erros arbitrários nem sucesso em projetos completos.

## Seleção de contexto: implementada, ainda experimental

A opção `HARNESS_CONTEXT_POLICY=selective-v1` ativa filtros determinísticos de domínio, tecnologia, capacidade solicitada e relevância; consulta sem instruções genéricas de apresentação; seleção compatível de skills; deduplicação; até três memórias completas e 1.800 caracteres de referências. Pode retornar zero referências. Não há chamada adicional de IA para decidir a seleção.

A versão `selective-v1` foi submetida a outra bateria de 36 execuções e 72 chamadas, mantendo as tarefas, avaliador e correção por reescrita completa do experimento anterior. Portanto, esse ensaio mede a seleção candidata, não o novo reparo localizado. Código correspondente aos hashes foi arquivado em `reports/memory-selective-v1-2026-09-20/source/`.

| Configuração | Tokens totais | Nota final média | Aprovações |
|---|---:|---:|---:|
| Histórico: recuperação anterior | 135.145 | 32,2 | 0/18 |
| Candidata: sem memórias | 72.628 | 31,5 | 0/18 |
| Candidata: recuperação seletiva | 90.354 | 30,6 | 0/18 |

Houve redução histórica de **33,1% nos tokens** do braço com recuperação, mas nenhuma aprovação completa. Frente ao controle contemporâneo sem memória, o braço seletivo ainda consumiu mais tokens. A comparação histórica mistura a alteração de skills e a de recuperação e não estima o efeito causal de memória isoladamente.

Nove pares tiveram prompts iniciais idênticos porque não havia memória incluída; quatro desses pares produziram respostas diferentes apesar da mesma semente. Eles foram identificados como controles A/A no dashboard. Essa variação, a amostra pequena e o compartilhamento do computador com testes do sistema limitam conclusões sobre qualidade e tempo. Não houve tentativa de esconder ou excluir resultados ruins.

**Decisão: não promover a seleção candidata ao padrão.** Após o ensaio, dois problemas do conjunto de desenvolvimento foram ajustados em `selective-v1.1`: reconhecer movimento no pedido Godot/CharacterBody e evitar confundir um app de tarefas com uma solicitação de planejamento. A auditoria de regressão ficou em 9/9 consultas, mas a versão 1.1 ainda não passou por uma nova campanha completa. Esse conjunto pequeno não comprova as metas de precisão/recall do plano.

- [Dashboard da seleção candidata](http://127.0.0.1:8791)
- [Arquivo do dashboard](../reports/memory-selective-v1-2026-09-20/dashboard.html)
- [Comparação histórica e controles A/A](../reports/cycle1-comparison.json)
- [Auditoria de recuperação](../reports/cycle1-selection-audit/results.json)

## Verificação

- **203 testes automatizados passaram**, incluindo contagem de tentativas rejeitadas, integração do chat, persistência de métricas, cancelamento, edição ambígua, regressão estática, limites, migração, workflows e comportamento anterior no modo padrão.
- **97 verificações do relatório** passaram: totais, notas, aprovações, custos, denominadores zero e exportação.
- Uma mensagem real pelo servidor atualizado retornou `PRONTO`, registrou uma chamada local, 1.473 tokens de entrada e quatro de saída, e preservou a telemetria na mensagem. [Evidência](../reports/cycle1-product-smoke.json).
- Os testes com modelo local não chamaram professor ou API paga. Os custos do dashboard continuam sendo simulações explicitamente identificadas.

## Próximas pendências do plano

1. Conectar contratos de tarefa e testes funcionais ao executor: reinício, persistência, filtros e cálculos. Sem isso, o reparo estático não identifica muitos dos defeitos da bateria.
2. Validar reparos em falhas naturais de gerações e em mais defeitos controlados; proteger comportamentos por testes, além dos IDs e diagnósticos estáticos.
3. Ampliar a avaliação de recuperação com consultas rotuladas e reservar casos inéditos antes de promover a versão seletiva.
4. Integrar estruturas reutilizáveis, evolução em etapas e reutilização de artefatos aprovados, medindo seus ganhos separadamente.
5. Aprendizado de memórias verificadas, comparação com o 3B e avaliação inédita permanecem para os ciclos seguintes.

Essas pendências não foram marcadas como concluídas. O ciclo atual entrega a infraestrutura e um mecanismo de reparo local verificável; a meta de aprovação de projetos completos continua aberta.
