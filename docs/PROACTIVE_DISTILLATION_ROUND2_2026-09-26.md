# Destilação proativa — segunda rodada, 26/09 (B.1 do roadmap)

Repete exatamente o método da primeira rodada
(`docs/PROACTIVE_DISTILLATION_2026-09-26.md`): mesmas 12 tarefas de
`engine-tasks.mjs`, mesmo modelo local padrão, mesmo professor (Codex),
mesmo mecanismo (`app/correction.js`, sem alteração). Objetivo: saber se o
efeito de recuperação visto na rodada 1 (50%) se repete, ou foi sorte de
amostra pequena.

## Resultado

- **6/12 falharam localmente** (mesmo número da rodada 1, mas **conjunto
  parcialmente diferente**: `board, faq, stock, expenses, tasks, weighted`
  contra `board, stock, tasks, record, faq, discount` da rodada 1).
  Interseção: `board, faq, stock, tasks` falharam nas duas rodadas — falhas
  persistentes, não ruído pontual. `expenses` e `weighted` só falharam
  agora; `record` e `discount` só falharam na rodada 1 — isso é o
  não-determinismo do modelo local já documentado (a própria rodada 1 já
  tinha um dry-run horas antes marcando 7/12 em vez de 6/12).
- **6/6 correções do Codex funcionaram**, 17 memórias salvas (algumas
  tarefas geraram 2, não 3, desta vez).
- Teste de fechamento (reexecução com `knowledgeMode:'memory'`, sem gastar
  nada a mais): **3/6 recuperadas** (`board`, `expenses`, `weighted`) — a
  mesma proporção agregada da rodada 1 (3/6), mas de novo um conjunto
  diferente: `faq` recuperou na rodada 1 e **não** recuperou agora; `stock`
  e `tasks` continuam sem recuperar nas duas rodadas.

## Leitura honesta

O efeito agregado (~50% de recuperação) **se repetiu** — isso é evidência
real de repetibilidade, não um acaso de uma rodada só. Mas a recuperação
**não é determinística por tarefa**: a mesma tarefa (`faq`) foi recuperada
numa rodada e não na outra. Duas falhas (`stock`, `tasks`) resistem à
memória nas duas rodadas — sinal de que, para essas duas, o problema não é
"faltava saber a regra", é outra coisa (ex.: `tasks` já tinha sido notado na
rodada 1 gerando um elemento não editável para `#title` mesmo com a memória
dizendo o contrário — a memória existir não garante que o modelo a aplique).

## Qualidade das memórias

As memórias das duas rodadas são princípios gerais, não regras coladas ao
enunciado de uma tarefa específica — ex.: "use `getComputedStyle(el).display`
em vez de `element.style` para ler visibilidade definida por CSS",
"formatar en-US sem separador de milhar com `useGrouping:false`", "um
`<select>` com estado inicial declarado precisa do atributo `selected`
explícito, não a ordem das opções decidindo por padrão" (esta última virou
a base do novo candidato de KERNEL testado em `docs/KERNEL_AB_SELECT_2026-09-26.md`).
Há bastante duplicação de conteúdo entre as duas rodadas (a mesma lição de
formatação numérica apareceu 4 vezes ao todo, por exemplo) — esperado, já
que reusamos as mesmas 12 tarefas.

## Decisão sobre B.2 (importar memórias pro banco real)

**Não executada nesta rodada — decisão consciente, não esquecimento.**
Motivo: as duas rodadas gravaram memórias num banco de benchmark isolado
(`app/data/benchmarks/proactive-distillation-live-*/distill.db`), nunca no
banco real que o aplicativo instalado usa. Ao investigar onde fica esse
banco real, `app/db.js` mostra que o caminho padrão (`app/data/harness.db`,
dentro do repositório) **não existe neste ambiente** — o app real, quando
executado via Electron, recebe `HARNESS_DB_FILE` do processo principal
apontando para o diretório de dados do usuário do Electron
(`app.whenReady()`), que pode estar em outro lugar do disco e, se o app
estiver aberto agora, com o arquivo em uso.

Escrever direto num banco SQLite que o aplicativo real pode ter aberto ao
mesmo tempo é um risco real de corrupção — diferente de tudo mais feito
nesta campanha (que sempre usou bancos de benchmark isolados e descartáveis).
Por isso, a decisão foi **não adivinhar o caminho e não escrever
automaticamente**. Em vez disso, esta rodada deixa uma lista curada e
deduplicada das memórias de maior qualidade das duas rodadas (abaixo), para
o usuário revisar e decidir como importar — manualmente pela própria UI de
memórias da Aurora, ou me passando o caminho exato do `harness.db` real
(com o app fechado) para eu importar com segurança.

### Lista curada para promoção a memória global (10 itens, deduplicados)

1. Para formatar números em en-US sem separador de milhar, use
   `toLocaleString('en-US', { useGrouping: false })` ou
   `Intl.NumberFormat('en-US', { useGrouping: false }).format(valor)`.
2. `element.style` só lê estilos inline; use
   `getComputedStyle(element).display` para consultar o display efetivo
   quando a visibilidade inicial é definida por CSS.
3. O texto exigido para uma resposta deve estar no elemento da resposta,
   mesmo quando esse elemento começa escondido.
4. Um controle de alternância deve mostrar o elemento no primeiro clique
   quando ele começa oculto, e inverter a visibilidade em cada clique
   seguinte.
5. Quando um requisito exige preencher um seletor, esse seletor deve
   identificar um controle editável (input de texto, textarea, etc.), nunca
   um elemento só de exibição.
6. Um resultado dependente de um `<select>` deve ser calculado na
   inicialização e recalculado no evento `change`.
7. Para preservar texto literal do usuário sem interpretar HTML, use
   `createElement` e atribua o texto por `textContent`, nunca `innerHTML`
   nem remoção de tags por regex.
8. Quando o painel/controle deve começar num estado específico declarado no
   pedido, marque a opção correspondente com `selected` (ou `.value`
   explícito antes do primeiro cálculo) — não deixe a ordem das opções no
   HTML decidir o estado inicial por padrão.
9. Antes de acumular uma entrada numérica, verifique que ela é finita e
   maior que zero, e que a soma permanece finita.
10. Para manter um valor após recarregar a página, salve cada atualização em
    `localStorage` e restaure um valor validado antes da primeira
    renderização, usando zero como padrão seguro se a leitura falhar.

## Limites

- Testado só com Codex como professor, só em `qwen3.5:4b`. Claude como
  professor e outros modelos ainda não testados numa segunda rodada.
- Amostra pequena (6 tarefas por rodada); a repetibilidade do agregado
  (50%/50%) é um sinal positivo, mas duas rodadas não bastam para uma
  confiança estatística forte por tarefa individual.
- Item 8 da lista curada gerou uma hipótese de melhoria de KERNEL.md,
  testada separadamente e com rigor (nos dois extremos de modelo) em
  `docs/KERNEL_AB_SELECT_2026-09-26.md` — ver esse doc para o resultado
  antes de tratar o item 8 como validado além da própria memória.
