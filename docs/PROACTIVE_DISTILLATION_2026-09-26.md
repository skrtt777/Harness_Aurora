# Destilação proativa — primeira rodada ao vivo, 2026-09-26

## Ideia

O "professor" (Codex/Claude corrigindo o modelo local) hoje só age quando o
usuário clica "Revisar" depois de um erro real numa conversa de verdade.
Isso significa que o conhecimento se acumula devagar, um erro de cada vez, na
velocidade do uso real. A destilação proativa aplica o mesmo mecanismo
(`app/correction.js`, sem nenhuma mudança) mas em lote e antecipado: roda um
conjunto de tarefas conhecidas contra o modelo local, manda cada falha pro
professor, e salva as memórias resultantes — sem esperar o usuário tropeçar
nelas primeiro.

Ferramenta: `scripts/benchmark/proactive-distillation.mjs`. Por padrão faz
dry-run (grátis, só mostra quantas chamadas um `--live` gastaria); só chama o
professor de verdade com a flag explícita `--live <codex|claude>`.

## Rodada 1 (qwen3.5:4b, professor Codex)

- 12 tarefas de `engine-tasks.mjs`, mesmo pipeline de produção.
- 6/12 falharam localmente (a variação normal do modelo — o dry-run horas
  antes tinha marcado 7/12, a diferença é a não-determinismo natural do
  modelo local entre execuções, não um bug).
- 6/6 correções do Codex bem-sucedidas. 18 memórias salvas (3 por tarefa, o
  máximo permitido), num projeto isolado ("Destilação proativa..."), não no
  banco real do usuário — essa rodada usou um banco de dados de benchmark
  separado.
- Custo real: 6 chamadas pagas ao Codex.

## Teste de fechamento: a memória realmente ajuda?

Sem gastar nada a mais (só modelo local): reexecutei as 6 tarefas que
falharam, agora com `knowledgeMode:'memory'` (a memória recém-criada
disponível).

**3 das 6 passaram agora** (`record`, `faq`, `discount`) — recuperação real de
50%. As outras 3 (`board`, `stock`, `tasks`) continuaram falhando, por razões
diferentes das originais em alguns casos — ex.: `tasks` ainda gerou um
elemento não-editável pra `#title`, apesar da memória dizer explicitamente
que esse id precisa ser um campo editável. A memória existir não garante que
o modelo a aplique com sucesso todas as vezes.

## Exemplos de memórias salvas (qualidade real, não genéricas demais)

- "Para exibir números com convenções en-US sem separador de milhar,
  configure explicitamente `useGrouping: false` em `toLocaleString`."
- "Um resultado dependente de um select deve ser calculado na inicialização
  e recalculado no evento `change` do select."
- "Quando um requisito exige preencher `#title`, esse id deve identificar um
  campo editável cujo `value` seja lido pela ação de adicionar."

## Limites e próximos passos

- Testado só uma vez, só com Codex como professor, só em `qwen3.5:4b`. Não
  sabemos se Claude produziria memórias diferentes/melhores, nem se o efeito
  se repete numa segunda rodada.
- As memórias desta rodada estão isoladas num banco de benchmark — **não
  entraram no banco real do usuário**. Importar de verdade (pra elas
  passarem a influenciar conversas reais) é uma decisão separada, ainda não
  tomada.
- Cada rodada `--live` tem custo real e crescente com o tamanho do conjunto
  de tarefas — usar com moderação, não como rotina automática sem supervisão.
