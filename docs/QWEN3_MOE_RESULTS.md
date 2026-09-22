# Qwen3 MoE: resultados de 21/09/2026

Campanha concluída: **120 casos CPU + 72 casos no controle Ollama**, usando 12 tarefas de jogo, página, aplicativo e BI, com duas sementes por tarefa. Houve ainda três casos exploratórios de lote e 32 verificações básicas de retenção. Memórias e skills ficaram desligadas para comparar os modelos. [Protocolo e reprodução](QWEN3_MOE_BENCHMARK.md).

## Qualidade: controle com GPU disponível

| Modelo | Contrato original | Auditoria posterior dos mesmos arquivos | Tokens medidos | Chamadas |
|---|---:|---:|---:|---:|
| Qwen2.5-Coder 1.5B, referência antiga | 0/24 | 0/24 | 48.624 | 48 |
| Qwen3.5 4B, padrão atual | 7/24 (29,2%) | 9/24 (37,5%) | 47.069 | 41 |
| Qwen3-Coder 30B MoE | 18/24 (75,0%) | 23/24 (95,8%) | 32.422 | 30 |

O MoE ganhou **45,8 pontos percentuais** sobre o padrão atual pelo contrato original e usou **31,1% menos tokens** nesta bateria, incluindo correções. Tokenizers diferentes impedem tratar essa diferença como economia equivalente de computação ou energia. O controle usa o runtime normal do aplicativo, com GPU disponível, sem teto de RAM; não comprova desempenho em computadores de 16 GB.

| Aprovação pelo contrato original | Jogo | Página | Aplicativo | BI |
|---|---:|---:|---:|---:|
| Antigo 1.5B | 0/6 | 0/6 | 0/6 | 0/6 |
| Atual 4B | 2/6 | 1/6 | 3/6 | 1/6 |
| MoE 30B | 4/6 | 4/6 | 6/6 | 4/6 |

A auditoria reexecutou artefatos preservados com ajustes específicos no avaliador: ler campos numéricos, aceitar o botão desabilitado após a chegada e verificar linhas visíveis na busca. Referências e controles negativos foram validados. As pontuações originais permanecem intactas. **Não é um teste independente nem uma medida de precisão geral.** As pontuações revisadas acima se referem aos artefatos finais; as primeiras respostas obtiveram os mesmos totais.

Cinco respostas iniciais do MoE já corretas sofreram reparos desnecessários, consumindo **5.421 tokens adicionais (16,7% do total)**. No modelo atual foram duas respostas e 2.547 tokens. O desperdício foi observado; a economia em produção depende de corrigir e validar o harness.

## CPU com pesos no SSD

| Perfil | Teto do processo | Aprovações | Tarefas encerradas por prazo | Mediana da tarefa | Primeiro token inicial, mediana* |
|---|---:|---:|---:|---:|---:|
| Antigo 1.5B | 4,8 GiB | 0/24 | 0/24 | 20,3 s | 2,0 s |
| MoE 20% | 3,2 GiB | 0/24 | 24/24 | 120,0 s | 78,8 s |
| MoE 30% | 4,8 GiB | 0/24 | 24/24 | 120,0 s | 85,2 s |
| MoE 40% | 6,4 GiB | 0/24 | 24/24 | 120,0 s | 102,8 s |
| MoE 50% | 8,0 GiB | 0/24 | 24/24 | 120,0 s | 90,0 s |

*Apenas chamadas que chegaram a produzir o primeiro token. Muitas terminaram antes disso; cobertura completa no painel. Prazo de 120 s por chamada e 180 s por tarefa, com até duas tentativas. O perfil de 30% concluiu uma primeira resposta com falha funcional e atingiu o prazo na correção; nenhuma tarefa foi aprovada. Falhas por prazo não demonstram que uma resposta completa seria incorreta. Todos os perfis passaram em 4/4 verificações básicas de retenção.

Não há percentual vencedor demonstrado para esse orçamento. O maior modelo respondeu melhor no controle com GPU, mas a configuração CPU/SSD avaliada não entregou tarefas aprovadas no prazo.

O teto foi aplicado ao **working set do processo**, com picos aproximados de 3,2 / 4,8 / 6,4 / 8 GiB. Pequenos excessos de 76 / 80 / 72 / 72 KiB foram registrados e preservados. O cache do Windows ficou fora do teto. O computador possui i9-14900K, aproximadamente 31,8 GiB físicos e NVMe Kingston; GPU desativada neste bloco. Isso não simula integralmente hardware de 16 GB. Cache não foi limpo, carga externa não foi isolada e o perfil de 20% foi pausado e retomado.

O ajuste exploratório de lote 128 para 512, em três pedidos escolhidos após as falhas, completou o contador de palavras em 117,7 s; seu primeiro token caiu de 84,6 s para 54,9 s. Os outros dois pedidos atingiram o prazo. É uma pista para otimizar a leitura do pedido, não um ganho geral comprovado. A matriz principal manteve lote 128.

## Rodada 2: mitigações Swap-MoE (22/09/2026)

Protocolo completo em [QWEN3_MOE_BENCHMARK.md](QWEN3_MOE_BENCHMARK.md#diagnóstico-rodada-2-mitigações-swap-moe-22092026). A rodada 1 (acima) só usou `--expert-streaming` puro, sem nenhuma das mitigações do próprio patch. Diagnóstico exploratório (4 tarefas de amostra, 1 tentativa) achou que `--expert-prefetch` combinado com lote de prefill 512 já resolve a maior parte do problema sozinho — somar `--expert-keep-recent 8` (valor recomendado pela documentação do patch) não melhorou nada no teto de 50%, então não entrou nas campanhas promovidas.

Campanha completa (24 tarefas, mesmos contratos/orçamentos da rodada 1, batch 512 + `--expert-prefetch`):

| Perfil (tuned) | Teto do processo | Aprovações | Tarefas por prazo | Mediana da tarefa | 1º token inicial, mediana | Decode (tok/s) |
|---|---:|---:|---:|---:|---:|---:|
| 50% | 8,0 GiB | 17/24 (70,8%) | 1/24 | 93,7 s | 28,6 s | 5,74 |
| 30% | 4,8 GiB | 10/24 (41,7%) | 11/24 | 120,0 s | 27,7 s | 4,29 |
| 20% | 3,2 GiB | 8/24 (33,3%) | 15/24 | 120,0 s | 24,7 s | 3,29 |

Comparação com a rodada 1, mesmos tetos, sem as flags de mitigação: 0/24 em todos os quatro perfis, 24/24 por prazo, primeiro token 78–103 s. As duas mitigações tiraram o executor de "não aprova nada" para "aprova a maioria" no teto mais generoso e para "aprova uma fração relevante" nos tetos mais apertados. No teto de 50%, a aprovação (70,8%) já se aproxima da obtida com GPU e sem teto de RAM (75,0% pelo contrato original, 95,8% após auditoria, mesmos pesos e contratos). Todos os perfis passaram em 4/4 verificações de retenção.

Padrão novo, ausente na rodada 1: nos tetos de 30% e 20%, as primeiras tarefas da sessão (rodadas sequencialmente no mesmo processo `llama-server`, sem reinício) passam de forma consistente, e depois de certo ponto a sessão degrada e passa a bater o prazo repetidamente (11/24 timeouts a 30%, 15/24 a 20%, contra 1/24 a 50%). Não foi possível observar isso na rodada 1 porque nada passava desde o início. Causa não diagnosticada; hipóteses não verificadas: acúmulo de fragmentação de memória, de page faults ou de pressão do cache de KV ao longo de uma sessão longa sob teto de working-set apertado. Não foi testado se reiniciar o servidor entre tarefas, ou mudar a ordem de execução, altera esse padrão.

**O que isso muda:** a hipótese do usuário — rodar modelos grandes com pouca RAM usando SSD — tem agora evidência real de viabilidade parcial, deixando de ser um "não funciona" categórico. Mas o teto mais realista para um PC de 16 GB (30%, ~4,8 GiB) ainda erra mais da metade das tarefas, majoritariamente por essa degradação de sessão longa ainda não diagnosticada, não por falta de qualidade do modelo. Nada disso foi testado em hardware físico de 16 GB de verdade — a máquina de teste tem 31,8 GiB reais, só o working-set do processo é limitado.

Próximos passos sugeridos, nesta ordem: (1) diagnosticar a degradação de sessão longa a 20–30% (fragmentação, page faults acumulados ou pressão de KV cache entre tarefas); (2) testar `--expert-keep-recent`/`--expert-cache-size` especificamente como mitigação desse problema nos tetos apertados — a rodada 2 só avaliou essas flags no teto de 50%, onde já havia folga suficiente sem elas; (3) testar reinício periódico do `llama-server` entre tarefas; (4) validar em hardware físico real de 16 GB e 8 GB antes de considerar qualquer promoção ao app.

Evidências: `reports/ssd-moe-v2/` (perfil 50% tuned), `reports/ssd-moe-v3/` (perfis 30%/20% tuned), `reports/ssd-moe-calibration-v2/` (diagnóstico exploratório).

## Decisão e entregáveis

O padrão do aplicativo permanece inalterado. O executor MoE/SSD foi compilado e testado isoladamente, fora do instalador. Não houve treinamento, alteração dos pesos ou remoção de especialistas.

Prioridades atualizadas após a rodada 2: diagnosticar a degradação de sessão longa nos tetos de 20–30% (ver seção acima); corrigir falsos negativos do avaliador (ex.: `break-even` falhando por leitura de campo, não por lógica incorreta — observado em ambas as rodadas); validar memória total e energia em máquinas físicas de 16 GB antes de promover qualquer perfil para o público geral.

- Painel local rodada 1 (baseline, sem mitigações): `reports/ssd-moe-v1/dashboard.html`, também servido em `http://127.0.0.1:18796` (`SSD_REPORT_DIR` padrão).
- Painel rodada 2, perfil 50% tuned: `reports/ssd-moe-v2/dashboard.html` (`SSD_REPORT_DIR=reports/ssd-moe-v2`).
- Painel rodada 2, perfis 30%/20% tuned: `reports/ssd-moe-v3/dashboard.html` (`SSD_REPORT_DIR=reports/ssd-moe-v3`).
- Dados e respostas: `reports/ssd-moe-v1`, `ssd-moe-v2`, `ssd-moe-v3`, `ssd-quality-control-v1`, `ssd-semantic-review-v1`, `ssd-moe-calibration-v1` (rodada 1) e `ssd-moe-calibration-v2` (rodada 2).
- PDF: `output/pdf/Aurora_Qwen3_MoE_RAM_SSD.pdf`, gerado por `scripts/build-ssd-benchmark-report.py`.
- Energia: tarifa editável de **R$ 1,00/kWh**; potência não medida. O painel pede uma hipótese de watts. O PDF usa 100 W somente como exemplo de cálculo, não como custo real.

Os diretórios de evidências, pesos e binários são locais e ignorados pelo Git. SHA-256 do manifesto CPU: `c690dfa6c4acf88bb9e0043cd14fcc73a4429775c9000c138cf533803f304154`.
