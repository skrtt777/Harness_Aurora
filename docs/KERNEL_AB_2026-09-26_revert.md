# KERNEL.md — revertido após teste no modelo padrão real (2026-09-26)

Segue `docs/KERNEL_AB_2026-09-25.md`. Aquele teste rodou só em `llama3.2:3b`
(o que já estava baixado nesta máquina) e mostrou ganho (2/24 → 6/24). Faltava
testar no modelo curado padrão de verdade, `qwen3.5:4b` — não estava baixado
ontem; baixado hoje e testado com o mesmo harness (`kernel-ab.mjs`, mesmas 12
tarefas, mesmas 2 sementes).

## Resultado no modelo padrão (qwen3.5:4b)

| Braço | Aprovadas |
|---|---:|
| Atual (antes da mudança de ontem) | 13/24 (54%) |
| Candidato (as duas frases adicionadas ontem) | 8/24 (33%) |

**Piora, não ganho.** Consistente nas duas sementes na tarefa `weighted`
(2/2 → 0/2), então não é ruído de amostra pequena — é um efeito real.

## Causa identificada

Inspecionando o artefato gerado: o modelo (já competente o bastante pra não
precisar do reforço) colocou a opção "Empty (None)" como **primeira/padrão**
do `<select>`, em vez de "Todos os grupos" como o enunciado pedia como estado
inicial. Isso zera `#revenue` logo de cara e reprova o requisito de estado
inicial.

Hipótese com boa evidência (não é só especulação): a frase nova pedia
explicitamente "confira... casos de borda" — um modelo mais forte, que já
lida bem com casos de borda por padrão, parece ter interpretado isso como
"destaque o caso de borda", colocando-o como estado inicial em vez de tratá-lo
só como uma interação possível. O mesmo reforço que ajuda um modelo fraco (que
tende a *esquecer* casos de borda) pode atrapalhar um modelo que já lida bem
com eles.

## Decisão

**Revertido.** `KERNEL.md` voltou ao texto original de antes de 2026-09-25.
`qwen3.5:4b` é o modelo curado recomendado pelo seletor — uma piora nele pesa
mais do que o ganho medido num modelo que não é o padrão. Os dois arquivos de
harness (`kernel-ab.mjs`, `kernel-candidate.mjs`) continuam no repositório
como ferramenta reutilizável para a próxima tentativa.

## Lição pra próxima tentativa

Qualquer novo candidato de `KERNEL.md` precisa ser testado **nos dois
extremos** (um modelo claramente mais fraco e o padrão curado atual) antes de
ser adotado — um resultado só num modelo não é suficiente, como este caso
mostrou na prática, não só em teoria.
