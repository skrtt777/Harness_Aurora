# Aurora local v2

A candidata não atingiu todos os critérios e permanece experimental.

## Mudanças nesta rodada

- Mesma base oficial Qwen2.5-Coder-1.5B-Instruct e mesma revisão da v1. A base original foi preservada.
- 256 exemplos: 80 gerações HTML, 80 correções JSON, 60 funções JavaScript e 36 exemplos de retenção/formato.
- 30 famílias de comportamento de navegador, com 80 referências corretas e defeitos reproduzidos; 20 famílias de funções com 120 verificações executadas. Variações de IDs e valores não são habilidades independentes.
- Treino no formato ChatML realmente usado pelo Ollama no Harness, sem mensagem de sistema implícita adicional. A v1 usava o template do Hugging Face que inseria essa mensagem.
- LoRA rank 8, 9.232.384 parâmetros ajustáveis, taxa 0,00002 (cinco vezes menor), duas épocas. Tempo: 134,3 s; pico alocado pelo PyTorch: 5,1 GB. Não representa consumo total de VRAM ou requisito mínimo da máquina.
- Duas versões intermediárias avaliadas em 24 tarefas de desenvolvimento já observadas. Seleção: e2; ordem dos critérios: aprovação funcional, retenção, tokens e época anterior. As referências dos novos desafios finais não entram no treinamento nem na seleção.

## Resultado final em desafios novos

O treinamento não demonstrou ganho de qualidade: 2/24 na base equivalente e 2/24 na candidata. A retenção caiu de 4/4 para 3/4. Tokens sem comparação conclusiva frente à base equivalente.

| Métrica | Original instalado | Base equivalente sem treino | Aurora v2 |
|---|---:|---:|---:|
| Execuções aprovadas | 0/24 | 2/24 | 2/24 |
| Primeira tentativa | 0/24 | 2/24 | 2/24 |
| Tokens totais | 48.852 | 46.260 + estimativa | 43.499 |
| Chamadas | 48 | 46 | 45 |
| Tempo total | 72,1 s | 70,7 s | 73,8 s |
| Tokens por aprovação | — | incompleto | 21.749,5 |
| Retenção simples | 4/4 | 4/4 | 3/4 |

Comparação secundária com o original instalado: diferença de aprovação: 8,3 pontos percentuais. Intervalo descritivo de 95% por bootstrap pareado por tarefa: [0, 20,8] pontos. Economia total de tokens: 11%. Valores menores não significam melhoria quando a aprovação também cai.

- jogo: 0/6 na base e 2/6 na candidata.
- pagina: 0/6 na base e 0/6 na candidata.
- app: 0/6 na base e 0/6 na candidata.
- bi: 0/6 na base e 0/6 na candidata.

Controle de conversão com a mesma revisão, template e quantização: 2/24 sem treino e 2/24 com treino na primeira tentativa.

## Critérios de promoção

- Passou: Mesmos pedidos e orçamento.
- Não passou: Pelo menos 70% dos cenários.
- Não passou: Ganho de pelo menos 15 pontos percentuais.
- Passou: Nenhuma área piora.
- Não passou: Retenção de respostas e JSON.
- Passou: Tokens até 120% da base.
- Não passou: Melhora frente à base com a mesma conversão.

Os limiares anteriores foram preservados: aprovação mínima de 70%, ganho de 15 pontos percentuais, nenhuma regressão por área, retenção mínima de 3/4 sem regressão, tokens até 120% da base e ganho frente ao controle de conversão. O modelo não é promovido apenas por ter nome próprio ou pesos diferentes.

## Evidências e reprodução

- Dashboard: http://127.0.0.1:8794. Arquivos: reports/model-training-v2/.
- Modelo Ollama: aurora-local:1.5b-v2. Digest: e039212f09b75b835c408909aede266e31a9116df59f9c63c41bd173f09c16c1.
- Adaptador selecionado: models/local-training/aurora-lora-v2/epoch-2/adapter_model.safetensors.
- Pesos incorporados e GGUF: models/local-training/aurora-lora-v2/export-e2/. Alterações reais observadas em 196 tensores, registradas em weight-delta.json.
- scripts/training/build-dataset-v2.mjs gera e valida os dados; train-lora-v2.py treina; export-v2.py incorpora os adaptadores e exporta; evaluate-v2.mjs avalia; select-v2.mjs fixa a candidata antes do teste final.
- Manifesto original e código arquivado, decisão de seleção, hashes, logs, todas as respostas e validações são preservados. Os diretórios de treino recusam sobrescrita. Para nova experiência, criar IDs novos e reservar novos desafios.
- Houve uma correção de escape na expressão regular da referência do contador de palavras, detectada na pré-verificação antes de qualquer resposta final de modelo. Requisitos, contratos e limiares ficaram idênticos. Manifesto inicial e alteração estão preservados em manifest-initial.json e amendments.json.
- No desenvolvimento da época 2, o Ollama interrompeu uma correção por repetição excessiva. A falha foi preservada e contabilizada, sem reexecução; 2.347 tokens foram estimados e cobrados no orçamento. A seleção foi corrigida para aceitar essa falha registrada, sem alterar a ordem por aprovações. O controle final também teve uma correção interrompida, mantida como falha, com 2.502 tokens estimados adicionais. Original instalado e candidata têm uso integralmente medido.
- O teste final desta rodada já foi observado. Não reutilizá-lo para escolher outro checkpoint e continuar chamando-o de teste independente.

## Limites

- O controle final teve uma correção interrompida, mantida como falha: 2.502 tokens estimados além dos 46.260 medidos. Não há conclusão exata de economia frente ao controle. Original instalado e candidata têm contagem completa.
- 12 tarefas novas com duas sementes: amostra pequena, não precisão geral.
- As tarefas de desenvolvimento já foram observadas; seus resultados não são o teste final.
- Componentes relacionados aparecem no treino; referências dos desafios finais foram excluídas.
- Resultados da v1 e da v2 usam desafios finais diferentes e não devem ser comparados diretamente.
- Energia é uma simulação editável. Hardware usado: RTX 4090; desempenho em máquinas menores não foi medido.

Treinamento, preparação e seleção mudaram juntos nesta rodada. A comparação mostra o efeito da receita completa; não isola qual mudança foi responsável por cada diferença. A tarifa de R$ 1,00/kWh e potência de 300 W no dashboard são hipóteses editáveis, não medição real. Não houve API paga de geração.
