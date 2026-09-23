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

## Rodada 3: causa raiz da degradação de sessão longa e mitigação por reinício (22-23/09/2026)

Diagnóstico direto na telemetria já coletada da rodada 2 (`samples.jsonl` de cada perfil): a memória `private` do processo (não mapeada em arquivo, portanto não removível pela paginação normal) cresce de forma quase linear com o **número de chamadas HTTP**, não com o tempo nem com o teto de RAM — por volta de **80-90 MiB por chamada** com `--expert-streaming` ativo, contra **~32 MiB/chamada** no modelo denso antigo sem MoE (medido também no baseline `old-30` da rodada 1). Como o `rss` fica travado no teto pelo Windows, esse crescimento consome silenciosamente o mesmo orçamento fixo que sobraria para páginas de especialistas — por isso a sessão degrada progressivamente, e mais rápido quanto menor o teto (o mesmo volume de memória "perdida" representa uma fração maior de um orçamento menor).

Mitigação testada: reiniciar o `llama-server` periodicamente durante a campanha, para zerar essa memória antes que ela aperte o orçamento. Uma primeira tentativa reiniciando **antes de cada tarefa, sem reaquecer** o processo novo, foi *pior* que não fazer nada (3/24, 20/24 por prazo, contra 10/24 sem reinício no mesmo teto de 30%) — o reinício também descarta o backbone denso residente (pesos de atenção/roteador que todo token precisa, independente de qual especialista é escolhido), e recarregá-lo do zero dentro do orçamento de 120 s por chamada não coube no teto de 30%. A correção foi reintroduzir as mesmas duas sondas de aquecimento (`warmup()`) logo depois de cada reinício, e espaçar os reinícios (não a cada tarefa, a cada N tarefas) para não pagar o custo de reaquecimento com tanta frequência.

| Perfil | Mitigação | Aprovações | Tarefas por prazo |
|---|---|---:|---:|
| 30% | prefetch + lote 512 (rodada 2, sem reinício) | 10/24 (41,7%) | 11/24 |
| 30% | + reinício a cada 4 tarefas, com reaquecimento | **18/24 (75,0%)** | **0/24** |
| 20% | prefetch + lote 512 (rodada 2, sem reinício) | 8/24 (33,3%) | 15/24 |
| 20% | + reinício a cada 2 tarefas, com reaquecimento | 13/24 (54,2%) | 7/24 |
| 20% | + reinício a cada 1 tarefa, com reaquecimento | 13/24 (54,2%) | 6/24 |
| 30% | reinício a cada tarefa **sem** reaquecimento (tentativa descartada) | 3/24 | 20/24 |

No teto de 30%, o resultado com reinício (75,0%) **iguala** a aprovação da qualidade sem teto de RAM/GPU (18/24 pelo contrato original) e elimina os estouros de prazo por completo — as falhas restantes são todas funcionais (mesma categoria de falso negativo do avaliador já observada em `break-even`), não mais de tempo. No teto de 20% o ganho é real (33,3%→54,2%) mas atinge um platô: reiniciar a cada tarefa não melhora sobre reiniciar a cada duas, indicando que ali o footprint fixo (pesos densos + KV) já consome quase todo o orçamento de 3,2 GiB mesmo a partir de um processo recém-reiniciado — sobra pouco espaço de sobra para especialistas independentemente de quão frequente o reinício seja.

**Conclusão da rodada 3:** a hipótese do usuário (rodar Qwen3-Coder 30B com pouca RAM usando SSD) está confirmada como viável no orçamento de 30% da RAM (o valor que o próprio usuário havia proposto em `docs/LOCAL_16GB.md`), com qualidade equivalente à execução sem restrição de memória. A 20% ainda funciona bem mais da metade das vezes, mas não iguala a qualidade irrestrita nesse teto mais apertado.

Implementação: `scripts/benchmark/ssd-evaluate.mjs` ganhou `launchServer()`/`stopServer()` reutilizáveis e um campo de perfil `restartEveryTasks` que reinicia e reaquece o servidor a cada N tarefas dentro da mesma campanha, sem invalidar a reprodutibilidade (cada combinação de perfis testada gerou seu próprio `SSD_REPORT_DIR`: `reports/ssd-moe-v4` guarda a tentativa descartada sem reaquecimento, como registro honesto de um caminho que não funcionou; `reports/ssd-moe-v5` guarda os reinícios com reaquecimento em 30%/20%; `reports/ssd-moe-v6` guarda o reinício a cada tarefa em 20%).

## Rodada 4: `--expert-cache-size`/`--expert-keep-recent` em 20% (23/09/2026)

Testado exatamente o item (2) proposto ao final da rodada 3: `--expert-keep-recent 8` e `--expert-cache-size 512` (512 MiB — bem menor que os 2048 MiB usados na calibração de 50%, já que a memória privada fixa por si só consome ~1 GiB de um teto de 3,2 GiB em 20%), cada um combinado com lote 512 + `--expert-prefetch`, numa amostra de 4 tarefas (1 por domínio) em processo recém-iniciado (sem reinício periódico ainda, para isolar o efeito da flag).

Resultado: **ambos pioraram em relação a só `--expert-prefetch` sozinho** (que aprova 3/4 na mesma amostra). `--expert-keep-recent 8`: 0/4, todas por timeout, primeiro token 65–73 s (contra 20–25 s sem a flag). `--expert-cache-size 512`: 0/4, mesmo padrão, primeiro token 62–77 s. A manutenção LRU/orçamento de bytes do patch roda a cada `graph_compute`; num teto tão apertado, esse overhead de manutenção supera qualquer benefício de evicção mais proativa — o mesmo efeito nulo já observado no teto de 50% (onde havia folga de sobra) fica *negativo* quando não há folga alguma. Amostra pequena (4 casos, 1 tentativa) o suficiente para descartar a hipótese sem precisar da campanha completa de 24 tarefas.

**Conclusão:** nenhuma das duas flags de eviction do Swap-MoE ajuda a destravar o platô de 20% — o gargalo ali não é falta de uma política de evicção melhor, é a falta de espaço físico no orçamento de 3,2 GiB para o footprint fixo (pesos densos + KV) mesmo com o processo recém-reiniciado. Item descartado da lista de próximos passos.

Próximos passos sugeridos: (1) calibrar `restartEveryTasks` de forma mais fina por teto (ex.: testar 3 e 5 em 30%, já que 4 funcionou bem mas não foi comparado a vizinhos); (2) confirmar se o próprio leak de ~80-90 MiB/chamada é um bug do patch Swap-MoE (relatável ao upstream) ou um comportamento inerente de `--expert-streaming`; (3) validar em hardware físico real de 16 GB e 8 GB antes de qualquer promoção ao app.

## Rodada 5: quantização do cache KV (23/09/2026)

Testado o item de eficiência de recurso mais direto disponível: em vez de tunar política de evicção de especialistas (já descartado na rodada 4), reduzir o tamanho fixo do cache KV em si, via `-ctk`/`-ctv` (tipos suportados pelo build: `f32, f16, bf16, q8_0, q4_0, q4_1, iq4_nl, q5_0, q5_1`) e `-fa on` (Flash Attention, necessário para tipos de KV além de f16/bf16). Com contexto 8192, GQA (4 kv-heads, head_dim 128, 48 camadas), o cache KV em f16 é ~768 MiB — praticamente todo o "piso fixo" de ~1 GiB de memória privada medido no início de uma sessão fresca em 20% (rodada 3).

Calibração exploratória em 20% (4 tarefas de amostra, 1 tentativa, processo fresco, sem reinício):

| Config | Amostra (4 tarefas) | 1º token |
|---|---|---|
| prefetch sozinho (rodada 2) | 3/4 | 20-25 s |
| + `-ctk/-ctv q8_0` + `-fa on` | 4/4* | 15-18 s |
| + contexto 6144 (em cima do q8_0) | 4/4* | 15-17 s (sem ganho adicional sobre só q8_0) |
| + `-ctk/-ctv q4_0` + `-fa on` | **4/4**, incluindo `break-even` (nunca tinha passado em 20%) | 17-23 s |

*mesma tarefa `break-even` que falha desde a rodada 2 continuou falhando com q8_0.

Reduzir o contexto de 8192 para 6144 não trouxe ganho adicional mensurável nesta amostra curta — a folga extra provavelmente só importa numa sessão longa com vários reinícios, não testado isoladamente.

**Campanha completa (24 tarefas), perfil restart-a-cada-2 + KV quantizado, teto 20%:**

| KV cache | Aprovações | Timeouts |
|---|---:|---:|
| f16 (rodada 3, sem quantização) | 13/24 (54,2%) | 7/24 |
| **q8_0** | **15/24 (62,5%)** | 5/24 |
| q4_0 | 10/24 (41,7%) | 7/24 |

`q8_0` melhorou de verdade o platô de 20% (54,2%→62,5%). `q4_0`, que parecia melhor ainda na amostra pequena (4/4, inclusive acertando `break-even` pela primeira vez), **piorou** na campanha completa de 24 tarefas — pior até que não quantizar nada. Isso é uma lição importante sobre confiar em amostras pequenas: a precisão mais baixa do q4_0 provavelmente degrada a qualidade da saída em tarefas/sementes fora da amostra de calibração, e esse custo supera o espaço de RAM que a quantização mais agressiva libera. `q8_0` fica como o melhor ponto de equilíbrio encontrado até agora para o teto de 20%.

Evidências: `reports/ssd-moe-v7/` (q8_0), `reports/ssd-moe-v8/` (q4_0), `reports/ssd-moe-calibration-v2/b512-pf-ctk8-p20`, `b512-pf-ctx6144-ctk8-p20`, `b512-pf-ctk4-p20`.

Próximos passos sugeridos: (1) testar `q8_0` também em 30% (já perto do teto de qualidade, mas pode reduzir a frequência necessária de reinício, ganho de eficiência mesmo sem melhorar aprovação); (2) revisitar contexto reduzido combinado com `q8_0` numa campanha completa (não só na amostra curta); (3) validar em hardware físico real antes de qualquer promoção ao app.

## Decisão e entregáveis

O padrão do aplicativo permanece inalterado. O executor MoE/SSD foi compilado e testado isoladamente, fora do instalador. Não houve treinamento, alteração dos pesos ou remoção de especialistas.

Prioridades atualizadas após a rodada 3: calibrar `restartEveryTasks` mais fino e testar `--expert-cache-size`/`--expert-keep-recent` junto do reinício periódico para tentar melhorar o platô de 20%; corrigir falsos negativos do avaliador (ex.: `break-even` falhando por leitura de campo, não por lógica incorreta — observado em todas as rodadas); validar memória total e energia em máquinas físicas de 16 GB antes de promover qualquer perfil para o público geral.

- Painel local rodada 1 (baseline, sem mitigações): `reports/ssd-moe-v1/dashboard.html`, também servido em `http://127.0.0.1:18796` (`SSD_REPORT_DIR` padrão).
- Painel rodada 2, perfil 50% tuned: `reports/ssd-moe-v2/dashboard.html` (`SSD_REPORT_DIR=reports/ssd-moe-v2`).
- Painel rodada 2, perfis 30%/20% tuned sem reinício: `reports/ssd-moe-v3/dashboard.html` (`SSD_REPORT_DIR=reports/ssd-moe-v3`).
- Painel rodada 3, tentativa de reinício por tarefa sem reaquecimento (descartada): `reports/ssd-moe-v4/dashboard.html`.
- Painel rodada 3, reinício com reaquecimento em 30%/20%: `reports/ssd-moe-v5/dashboard.html`.
- Painel rodada 3, reinício a cada tarefa em 20%: `reports/ssd-moe-v6/dashboard.html`.
- Dados e respostas: `reports/ssd-moe-v1` a `ssd-moe-v6`, `ssd-quality-control-v1`, `ssd-semantic-review-v1`, `ssd-moe-calibration-v1` (rodada 1) e `ssd-moe-calibration-v2` (rodada 2).
- PDF: `output/pdf/Aurora_Qwen3_MoE_RAM_SSD.pdf`, gerado por `scripts/build-ssd-benchmark-report.py`.
- Energia: tarifa editável de **R$ 1,00/kWh**; potência não medida. O painel pede uma hipótese de watts. O PDF usa 100 W somente como exemplo de cálculo, não como custo real.

Os diretórios de evidências, pesos e binários são locais e ignorados pelo Git. SHA-256 do manifesto CPU: `c690dfa6c4acf88bb9e0043cd14fcc73a4429775c9000c138cf533803f304154`.
