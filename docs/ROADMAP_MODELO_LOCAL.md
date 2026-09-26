# Roadmap: modelo local próprio da Aurora

Este documento existe porque a linha do tempo ficou confusa: várias
iniciativas paralelas (KERNEL.md, destilação proativa, LoRA v1/v2/v3, a ideia
do Qwen3-Coder 30B) aconteceram na mesma sessão, cada uma com seu próprio
doc. Este arquivo é o mapa de tudo isso — de onde veio a ideia, o que já foi
testado e por quê, o que aprendemos, e o caminho daqui pra frente. É o
documento que vamos seguir a partir de agora.

## 1. De onde veio a ideia (o "porquê" inicial)

Você viu um vídeo mostrando um prompt de sistema detalhado transformando um
modelo pequeno/barato num assistente muito melhor, e quis aplicar essa ideia
à Aurora. Isso puxou dois fios diferentes:

1. **Melhorar o que já existe** (o modelo local pequeno de hoje, via prompt
   de sistema, memória e fine-tuning) — caminho barato, reversível, já em
   andamento.
2. **Ambição maior**: pegar o Qwen3-Coder 30B (um modelo grande, MoE) e
   "customizar por completo" pra virar a Aurora — um "Frankenstein". Você
   mesmo pausou essa ideia ao perguntar "e o que temos agora, o que pode ser
   feito?" — foi aí que voltamos pro caminho 1.

## 2. O que já foi tentado, em ordem, e por quê

### 2.1 KERNEL.md (prompt de sistema) — teste A/B, 25/09
**Por quê:** é o experimento mais barato e reversível (só texto, sem treino)
pra testar o princípio do vídeo.
- Testado só em `llama3.2:3b` (modelo fraco): ganho real, 2/24 → 6/24.
- **Adotado** a princípio.

### 2.2 KERNEL.md revertido — 26/09
**Por quê:** faltava testar no modelo padrão real (`qwen3.5:4b`), não só no
fraco.
- No modelo padrão: **piorou**, 13/24 → 8/24. Causa identificada: o reforço
  que ajuda um modelo fraco a lembrar de casos de borda fez um modelo já
  competente promover o caso de borda pro estado *inicial*, errado.
- **Revertido.** Lição gravada: todo candidato futuro de KERNEL.md precisa
  ser testado nos dois extremos (fraco e padrão) antes de adotar.

### 2.3 Destilação proativa — primeira rodada ao vivo, 26/09
**Por quê:** o mecanismo de correção pelo "professor" (Codex/Claude) já
existia, mas só rodava quando o usuário clicava "Revisar" depois de um erro
real. A ideia foi aplicar o mesmo mecanismo em lote, antecipando erros
conhecidos em vez de esperar o uso real.
- 6/12 tarefas falharam localmente → 6/6 correções do professor funcionaram
  → memórias salvas (isoladas, não no banco real ainda).
- Teste de fechamento: das 6 que falhavam, **3 passaram** depois de ativar
  a memória (`knowledgeMode:'memory'`) — recuperação real de 50%, sem gastar
  nada além do que já tinha sido gasto.
- **Resultado parcialmente positivo**, mas testado uma única vez, só com
  Codex, só em `qwen3.5:4b`, e as memórias **não foram importadas** pro
  banco real do usuário ainda.

### 2.4 LoRA v1 (fine-tuning real) — 21/09
**Por quê:** tentativa original de ensinar o modelo local pequeno
(Qwen2.5-Coder-1.5B) a corrigir os próprios erros de código via ajuste de
pesos, não só prompt.
- 200 exemplos, rank 16, 3 épocas. Resultado: **3/24 vs. 4/24 da base** —
  pior, não melhor. Retenção mantida (3/4). Jogo/página/app pioraram; só BI
  melhorou (ganho pontual, não generalizável).
- **Não promovido.**

### 2.5 Reavaliação do LoRA v1/v2 — 25/09
**Por quê:** descobrimos um bug no avaliador (`assertNumber`/`assertText`
lendo `innerText()`, sempre vazio em `<input>`) e precisávamos saber se ele
tinha inflado os vereditos negativos de v1/v2.
- Revalidamos 191 execuções salvas com o avaliador corrigido: **zero
  mudanças**. Os vereditos negativos de v1 e v2 continuam corretos — não foi
  o avaliador que os prejudicou.

### 2.6 LoRA v2 — 21/09 (antes da reavaliação, mas cronologicamente aqui)
**Por quê:** tentativa de corrigir v1 usando o template ChatML real do
Ollama (v1 usava o template do Hugging Face, que inseria uma mensagem de
sistema implícita extra) e uma taxa de aprendizado 5x menor.
- 256 exemplos. Resultado: **2/24 empatado com a base sem treino** — sem
  ganho de 15 pontos percentuais exigido. Retenção caiu de 4/4 para 3/4.
- **Não promovido.** O próprio doc da v2 apontou o tamanho do dataset (256
  exemplos) como possível fator limitante — essa hipótese motivou a v3.

### 2.7 A ideia do Qwen3-Coder 30B "Frankenstein" — pausada, 26/09
**Por quê:** você queria ir direto pro modelo grande. Antes de gastar tempo
e dinheiro (61GB de download), fizemos uma checagem de realidade:
- Arquitetura MoE incompatível com os scripts de treino atuais (feitos para
  modelo denso 1.5B) — exigiria reescrever a infraestrutura de treino do
  zero.
- RTX 4090 (24GB VRAM) insuficiente para treinar um 30B em precisão
  completa.
- Já existe um experimento anterior e separado (não desta sessão) testando
  rodar MoE grande com pesos em SSD sob teto de RAM: **0/24 aprovações** em
  todos os perfis testados (CPU+SSD), contra 75–95,8% com GPU e sem teto —
  ou seja, o modelo é bom, mas o *runtime* de streaming sob RAM limitada não
  está pronto.
- **Você mesmo pausou** essa ideia ao perguntar "e o que temos agora?" —
  decisão registrada, não abandonada para sempre, só fora de escopo até que
  A e B (seção 4) estejam resolvidos.

### 2.8 LoRA v3 (dataset maior) — 26/09, concluído agora
**Por quê:** testar diretamente a hipótese da v2 — que o dataset de 256
exemplos era o fator limitante.
- 288 exemplos (32 a mais, incluindo 3 famílias novas desenhadas a partir de
  bugs reais medidos nesta sessão), mesma receita de treino da v2.
- Resultado no teste final blind (8 desafios novos): **1/16 (6,3%)** — pior
  que a base sem treino (3/16) e pior que o controle de conversão sem peso
  treinado (2/16). Regrediu no domínio "jogo".
- **Não promovido.** A hipótese "dataset maior resolve" **não se
  confirmou** — na verdade o resultado ficou pior que v1 e v2.

## 3. Diagnóstico honesto (o que os 3 fracassos de LoRA, juntos, nos dizem)

Três rodadas (v1: rank 16/3 épocas/200 exemplos; v2: rank 8/2 épocas/256
exemplos/template corrigido; v3: mesma receita da v2/288 exemplos) falharam
todas, e a v3 — com *mais* dados — foi a *pior* das três. Isso descarta
"tamanho do dataset" como causa raiz. As hipóteses que sobram, ainda não
testadas isoladamente:

- **A receita de LoRA em si** (rank/alpha, taxa de aprendizado, número de
  épocas) pode estar errada para esse tamanho de modelo — nunca variamos
  essas variáveis isoladamente com o mesmo dataset, sempre mudamos dataset e
  receita juntos ou o dataset sozinho.
- **O modelo base (1.5B) pode ser pequeno demais** para absorver o
  currículo sem overfitting local que prejudica capacidades gerais — v1
  usava rank 16 (mais capacidade de ajuste) e teve queda de perda de
  desenvolvimento de 0,847 para 0,00261, sinal clássico de memorização, não
  generalização.
- **Prompt de sistema (KERNEL) e memória/destilação**, em contraste, **já
  mostraram ganho real e mensurável** (KERNEL: 2/24→6/24 no modelo fraco;
  destilação: recuperação de 50% das falhas) — são os dois únicos
  mecanismos desta sessão com evidência positiva concreta até agora.

## 4. Como deve ficar (objetivo final)

Um destes dois desfechos, decidido com evidência, não por desistência nem
por otimismo:

- **(A)** Um modelo local com fine-tuning que bate a base sem treino e o
  controle de conversão num teste blind novo, de forma consistente — só
  então é promovido a padrão; **ou**
- **(B)** Uma conclusão documentada e definitiva de que fine-tuning LoRA
  neste modelo de 1.5B não compensa o esforço frente a prompt de
  sistema + memória/destilação, e o investimento futuro vai todo para esses
  dois mecanismos (que já têm ganho comprovado), deixando fine-tuning
  arquivado até haver uma mudança maior disponível (outro modelo base, mais
  hardware, ou infraestrutura de treino nova).

O caminho do Qwen3-Coder 30B só volta a ser considerado depois de (A) ou (B)
estarem resolvidos — não faz sentido escalar pra um modelo 20x maior antes
de entender por que o pequeno não melhora com o método atual.

## 5. Roadmap adiante, por fase

### Fase A — Isolar a variável da receita de LoRA (decisão sobre fine-tuning)
Testar rank/alpha e taxa de aprendizado variando **isoladamente**, mantendo
o MESMO dataset (v3, já pronto) — nunca mudamos essas variáveis sem também
mudar o dataset, então ainda não sabemos se a receita é o problema.
- Critério de parada: se 2–3 variações de receita não superarem o controle,
  concluir (B) da seção 4, documentar e arquivar fine-tuning por ora.
- Critério de sucesso: qualquer variação que bata o controle de forma
  consistente no teste blind vira a nova candidata a validar com mais
  rigor (mais sementes, mais tarefas).

### Fase B — Investir no que já funcionou (menor custo, ganho já comprovado)
- Rodar uma segunda rodada de destilação proativa, pra ver se o efeito de
  recuperação de 50% se repete (não testado uma segunda vez ainda).
- Decidir, com base nisso, se/como importar memórias destiladas pro banco
  real do usuário (decisão ainda não tomada).
- Testar um próximo candidato de KERNEL.md sempre nos dois extremos (modelo
  fraco e `qwen3.5:4b`) antes de adotar — lição já paga com a reversão.

### Fase C — Decisão consciente sobre o Qwen3-Coder 30B
- Só depois de A e B avançarem. Se retomado: precisa de scripts de treino
  compatíveis com arquitetura MoE (os atuais são para modelo denso) e uma
  estratégia de hardware/quantização adequada — o experimento de SSD/MoE já
  existente é o ponto de partida técnico, não recomeçar do zero.

## 6. Lista de tarefas (nesta ordem)

- [x] **A.1** — Treinada a variação de rank (rank 16, alpha 32, dobrado vs.
      o rank 8 da v2/v3) sobre o MESMO dataset-v3, mesma taxa/épocas.
      Resultado no dev set (24 tarefas já observadas), comparado ao
      controle não treinado (3/24, retenção 4/4) e à v3-e1 (4/24, retenção
      2/4):
      - rank16-e1: **3/24, retenção 3/4** — empatou com o controle, não
        superou.
      - rank16-e2: **1/24, retenção 3/4** — piorou com mais treino.
      - A perda de desenvolvimento caiu mais que na v3 (0,84→0,50 vs.
        0,84→0,62), mas o desempenho real caiu junto — mesma assinatura de
        overfitting já vista na v1 (rank 16, perda quase zero, pior
        resultado). **Dobrar a capacidade do LoRA não resolveu; nenhuma
        época bateu o controle.** Capacidade do adaptador está descartada
        como causa isolada, assim como tamanho do dataset já tinha sido
        descartado pela v3.
- [ ] **A.2** — Se A.1 não ajudar: variar taxa de aprendizado e/ou número de
      épocas, mesmo dataset. **Status:** A.1 não ajudou (ver acima). Duas
      famílias de receita já tentadas sobre o mesmo dataset (rank 8 e rank
      16) sem superar o controle, e as duas mostram o mesmo padrão: mais
      treino = perda cai, tarefa real piora. Isso já é evidência de
      overfitting estrutural, não de uma variável de receita isolada
      faltando ajustar — variar lr/épocas tende a repetir o mesmo padrão.
      Recomendação: pular A.2 e ir direto para A.3 (concluir desfecho B),
      salvo decisão do usuário em contrário.
- [ ] **A.3** — Aplicar o critério de parada: se nada em A.1/A.2 superar o
      controle, escrever a conclusão definitiva (desfecho B da seção 4) e
      arquivar fine-tuning LoRA por ora.
- [ ] **B.1** — Segunda rodada de destilação proativa (validar
      repetibilidade do efeito de 50% de recuperação).
- [ ] **B.2** — Decidir e, se aprovado, executar a importação de memórias
      destiladas para o banco real do usuário.
- [ ] **B.3** — Próximo candidato de KERNEL.md, testado obrigatoriamente nos
      dois extremos antes de qualquer adoção.
- [ ] **C** — Revisitar a decisão sobre o Qwen3-Coder 30B, só depois de A e
      B, com escopo técnico definido (scripts MoE, hardware).

Vamos seguir esta lista nesta ordem. Cada item, ao ser concluído, ganha um
doc próprio (como já é costume neste projeto) e este arquivo é atualizado
marcando o item como feito, com um resumo de uma linha do resultado.
