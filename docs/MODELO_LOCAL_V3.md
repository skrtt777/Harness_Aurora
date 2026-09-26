# Aurora local v3

A candidata não atingiu os critérios de promoção e permanece experimental. O
resultado desta rodada é pior que o da v2, não melhor — ver "Resultado final"
abaixo.

## Mudanças nesta rodada

- Mesma base oficial Qwen2.5-Coder-1.5B-Instruct e mesma revisão da v1/v2. A
  base original foi preservada.
- 288 exemplos de treino / 40 de desenvolvimento (v2 tinha 256/40): 89
  gerações HTML, 89 correções JSON, 72 funções JavaScript e 38 exemplos de
  retenção/formato. 33 famílias de comportamento de navegador (30 na v2) e 24
  famílias de funções (20 na v2).
- Três famílias novas, desenhadas a partir de falhas realmente medidas nesta
  sessão (não hipotéticas): um controle com estado que deve iniciar em um
  valor "normal" e não na borda (reproduz a regressão vista no teste A/B do
  KERNEL com qwen3.5:4b); um contador com dois limites (mínimo e máximo)
  juntos, não só um lado; um campo que precisa continuar editável mesmo
  depois de aplicado, nunca substituído por um elemento só de exibição
  (reproduz falhas já vistas em engine-tasks.mjs).
- Mesma receita de treino da v2: LoRA rank 8, 9.232.384 parâmetros ajustáveis,
  taxa 0,00002, duas épocas, mesmo formato ChatML real do Ollama. Única
  variável deliberada desta rodada: o dataset maior — a receita não mudou,
  então qualquer efeito medido é atribuível ao tamanho/composição dos dados,
  não a outro ajuste. Tempo de treino: 157,25 s; perda de desenvolvimento
  inicial 0,840 → melhor 0,621; pico alocado pelo PyTorch: 5,20 GB.
- Duas épocas avaliadas em 24 tarefas de desenvolvimento já observadas (12 de
  heldout-v2 + 12 de engine-tasks.mjs), 1 semente. Seleção pela regra
  publicada (aprovação funcional, depois retenção, depois tokens, depois
  época anterior): **e1** venceu com 4/24 aprovações contra 2/24 da e2 — a
  regra decide pelo primeiro critério antes de olhar retenção, então e1 foi
  selecionada mesmo com retenção pior (2/4 contra 3/4 da e2 e 4/4 do controle
  não treinado). Isso já era um sinal de alerta antes do teste final.
- 8 desafios novos (elevador, estoque, acordeão, moeda, lista de tarefas,
  cronômetro, margem, ranking), nunca observados antes desta rodada,
  distintos tanto dos 12 de heldout-v2 quanto das famílias de treino da v3.
  Duas sementes (211, 419). As referências destes desafios não entraram no
  treinamento nem na seleção de época.

## Resultado final em desafios novos

O treinamento não demonstrou ganho de qualidade — pelo contrário, a
candidata teve desempenho **pior** que a base sem treino e também pior que o
controle de conversão (mesmo pipeline de exportação/quantização, sem
nenhuma alteração de peso real):

| Métrica | Original instalado (base) | Base equivalente sem treino (controle) | Aurora v3 (candidata) |
|---|---:|---:|---:|
| Execuções aprovadas | 3/16 (18,8%) | 2/16 (12,5%) | 1/16 (6,3%) |
| Primeira tentativa | 3/16 | 2/16 | 1/16 |
| Tokens totais | 27.946 | 28.803 | 27.632 |
| Chamadas | 29 | 30 | 31 |
| Tempo total | 43,2 s | 53,3 s | 46,6 s |
| Retenção simples | 3/4 | 4/4 | 3/4 |

Diferença de aprovação candidata vs. base: **-12,5 pontos percentuais**
(pior, não melhor). Intervalo descritivo de 95% por bootstrap pareado por
tarefa (3.000 reamostragens, resample dos 8 desafios com reposição, 2
sementes cada): **[-37,5; 0,0]** pontos — o intervalo não cruza para o lado
positivo em nenhum ponto testado; o melhor caso observado no bootstrap é
"sem diferença", nunca "ganho".

Por domínio (2 tarefas × 2 sementes = 4 execuções por domínio):

- jogo (elevador, estoque): 3/4 na base, 1/4 no controle, **1/4 na
  candidata** — regressão de domínio frente à base (3→1).
- pagina (acordeão, moeda): 0/4 na base, 1/4 no controle, 0/4 na candidata.
- app (lista de tarefas, cronômetro): 0/4 em todos os três.
- bi (margem, ranking): 0/4 em todos os três.

Controle de conversão com a mesma revisão, template e quantização: 2/16 sem
treino real e apenas 1/16 com treino — a candidata perdeu até para o
controle não treinado, o que indica que o treino desta rodada não apenas
falhou em ajudar, como prejudicou.

## Critérios de promoção

- Não passou: Pelo menos 70% dos cenários (obteve 6,3%).
- Não passou: Ganho de pelo menos 15 pontos percentuais (obteve -12,5pp).
- Não passou: Nenhuma área piora (domínio "jogo" caiu de 3/4 para 1/4).
- Passou: Retenção mínima de 3/4 (obteve 3/4, igual à base; não há queda
  numérica, embora a pergunta que falhou tenha mudado — ver Limites).
- Passou: Tokens até 120% da base (27.632/27.946 = 98,9%).
- Não passou: Melhora frente ao controle de conversão (candidata 1/16 <
  controle 2/16).

Os limiares são os mesmos publicados desde a v1: aprovação mínima de 70%,
ganho de 15 pontos percentuais, nenhuma regressão por área, retenção mínima
de 3/4 sem regressão, tokens até 120% da base e ganho frente ao controle de
conversão. **4 de 6 critérios falharam.** O modelo não é promovido apenas
por ter nome próprio ou pesos diferentes.

## Evidências e reprodução

- Arquivos: `reports/model-training-v3/`.
- Modelo Ollama candidato: `aurora-local:1.5b-v3` (cópia de
  `aurora-local:1.5b-v3-e1`). Digest:
  `dd2f433cb9e23fc2325f0e725538c19d0b2e6d0c6b4199042f13c9536c7e1cf8`.
- Adaptador selecionado:
  `models/local-training/aurora-lora-v3/epoch-1/adapter_model.safetensors`.
- Pesos incorporados e GGUF:
  `models/local-training/aurora-lora-v3/export-e1/`.
- `scripts/training/curriculum-v3.mjs` define as 3 famílias novas;
  `scripts/training/build-dataset-v3.mjs` gera e valida os dados (verificado
  mecanicamente via navegador antes de qualquer treino);
  `scripts/training/train-lora-v3.py` treina; `scripts/training/export-v3.py`
  incorpora os adaptadores, exporta e registra no Ollama;
  `scripts/training/heldout-v3.mjs` reexporta os 8 desafios finais e traz um
  conjunto de retenção próprio, distinto do da v2;
  `scripts/training/final-tasks-v3.mjs` define e verifica os 8 desafios
  finais (cada referência passou seu próprio contrato antes de qualquer
  execução de modelo); `scripts/training/evaluate-v3.mjs` congela o
  manifesto (com hash de todas as fontes envolvidas) e avalia cada braço
  pelo pipeline de produção real (`createWorkflow`/`runWorkflow`, sem modo de
  conhecimento).
- Seleção de checkpoint registrada em
  `reports/model-training-v3/selection.json`, incluindo os números de e1, e2
  e o controle, com a nota explícita sobre a regressão de retenção de e1
  observada já na etapa de desenvolvimento.
- Manifesto congelado (`reports/model-training-v3/manifest.json`) inclui o
  hash de todas as fontes usadas nesta rodada; o script recusa continuar se
  qualquer uma mudar depois do congelamento.

## Limites

- 8 tarefas novas com duas sementes: amostra pequena, não é medida de
  precisão geral.
- As 24 tarefas de desenvolvimento (12 de heldout-v2 + 12 de
  engine-tasks.mjs) já foram observadas nesta sessão; seus resultados
  serviram só para escolher a época, nunca como teste final.
- A retenção da candidata (3/4) e a da base (3/4) têm a mesma contagem, mas
  falharam em perguntas diferentes (base errou "sort-v3", candidata errou
  "plain-v3") — não é uma regressão pelo critério de contagem usado, mas
  também não é evidência de estabilidade real; é ruído em uma amostra de 4.
- Resultados da v1, v2 e v3 usam conjuntos de desafios finais diferentes e
  não devem ser comparados número a número entre versões — só cada versão
  contra sua própria base/controle.
- Treinamento e dataset mudaram juntos nesta rodada (o dataset ficou maior E
  ganhou 3 famílias novas ao mesmo tempo); a comparação mostra o efeito
  agregado, não isola qual dos dois fatores pesou mais.
- Hardware usado: RTX 4090; desempenho em máquinas menores não foi medido.
- Não houve API paga de geração nesta rodada — todo o dataset é autoral e
  verificado mecanicamente (execução em navegador real via Playwright), não
  destilado de nenhum modelo professor.

## Leitura honesta do resultado

A hipótese de entrada desta rodada — motivada pelo próprio texto da v2, que
apontava o tamanho do dataset (256 exemplos) como possível fator limitante —
era que um dataset maior (288) e mais diverso resolveria ou pelo menos
reduziria o problema. **Essa hipótese não se confirmou.** A candidata não só
não superou a base sem treino como ficou atrás até do controle de
conversão, e regrediu no único domínio em que a base tinha desempenho
razoável ("jogo", 3/4 → 1/4). O sinal mais forte de alerta veio antes mesmo
do teste final: na seleção de checkpoint, e1 só venceu por aprovações
funcionais, já com retenção pior que a do modelo não treinado — um padrão
consistente com overfitting em uma fração do dataset ou com o LoRA rank 8
sendo insuficiente para absorver 288 exemplos de 4 categorias diferentes sem
prejudicar capacidades gerais do modelo base. Um tamanho de dataset maior,
por si só, não é a causa raiz do problema recorrente nas três rodadas (v1,
v2, v3); as próximas hipóteses a testar, se este caminho for retomado,
teriam de mudar outra variável isolada por vez (rank/alpha do LoRA, taxa de
aprendizado, número de épocas, ou revisão da própria receita de treino) —
não outro aumento de dataset.
