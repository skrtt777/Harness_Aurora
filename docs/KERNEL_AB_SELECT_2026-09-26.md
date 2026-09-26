# KERNEL.md — novo candidato ("select inicial explícito"), 26/09 (B.3)

Segue a lição de `docs/KERNEL_AB_2026-09-26_revert.md`: todo candidato novo
precisa ser testado nos dois extremos (modelo fraco e o padrão curado,
`qwen3.5:4b`) antes de qualquer adoção. Este candidato é diferente do
revertido — em vez de reforçar "confira casos de borda" de forma genérica
(que fez `qwen3.5:4b` promover a borda ao estado inicial, o bug exato que
causou a reversão), instrui de forma mecânica e específica: um `<select>`
com estado inicial declarado no pedido precisa do atributo `selected`
explícito, não a ordem das opções decidindo por padrão. A mesma lição
surgiu independentemente na destilação proativa (item 8 da lista curada em
`docs/PROACTIVE_DISTILLATION_ROUND2_2026-09-26.md`).

## Resultado agregado

| Modelo | Base (já conhecido) | Candidato novo |
|---|---:|---:|
| `llama3.2:3b` (fraco) | 2/24 | 2/24 — sem mudança |
| `qwen3.5:4b` (padrão) | 13/24 | 13/24 — sem mudança |

À primeira vista, empate nos dois extremos parece "seguro" (nenhuma
regressão agregada). **Mas o empate esconde uma troca, não uma ausência de
efeito** — daí a importância de olhar por tarefa, não só o total.

## Por tarefa, nas duas tarefas que motivaram o candidato

No modelo padrão (`qwen3.5:4b`):

| Tarefa | Base | Candidato |
|---|---:|---:|
| `board` (jogo) | 0/2 | **2/2** (ganho real) |
| `weighted` (bi) | 2/2 | **1/2** (regressão parcial) |

No modelo fraco (`llama3.2:3b`): `board` 0/2→0/2 e `weighted` 0/2→0/2 — sem
efeito em nenhum dos dois, nem ganho nem regressão.

## Decisão

**Não adotado.** O critério estabelecido depois da reversão anterior é
"nenhuma regressão, checada por tarefa" — não só o total agregado. Este
candidato passa no total agregado (empate nos dois modelos), mas causa uma
regressão real e mensurável em `weighted` no modelo padrão (2/2→1/2),
mascarada por um ganho equivalente em `board` no mesmo total. Um total
empatado que escondia uma piora real teria sido adotado por engano se a
verificação tivesse parado no agregado.

## Achado que vale registrar

`weighted` já tinha regredido (2/2→0/2) com o candidato genérico revertido,
e regride de novo (2/2→1/2), ainda que parcialmente, com um candidato bem
mais estreito e mecânico. Isso sugere que **qualquer menção no prompt de
sistema sobre seleção/estado inicial** introduz ruído específico nessa
tarefa — não é só a formulação genérica de "casos de borda" que causa isso.
A hipótese muda: talvez `weighted` seja sensível de um jeito que prompt
engineering neste KERNEL não resolve sem custo em outro lugar; se essa
tarefa continuar sendo prioridade, o caminho mais promissor não é mais
tentar uma terceira redação de KERNEL, e sim a memória/destilação (que já
recuperou `weighted` com sucesso na segunda rodada de destilação proativa,
sem tocar no prompt de sistema global).

## Reprodução

```powershell
$env:KERNEL_AB_ID="kernel-ab-select-2026-09-26"; $env:KERNEL_AB_MODEL="llama3.2:3b"; node scripts/benchmark/kernel-ab.mjs candidate
$env:KERNEL_AB_ID="kernel-ab-select-2026-09-26"; $env:KERNEL_AB_MODEL="qwen3.5:4b"; node scripts/benchmark/kernel-ab.mjs candidate
```

Relatórios brutos em `reports/kernel-ab-select-2026-09-26/` (não
versionado). `app/runtime-policy/KERNEL.md` permanece no texto original,
sem alteração.
