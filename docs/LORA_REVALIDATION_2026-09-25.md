# Reavaliação do LoRA (v1 e v2) com o avaliador corrigido — 2026-09-25

## Pergunta

O bug corrigido em `app/functionalTests.js` (`assertNumber`/`assertText` lendo `innerText()`, sempre vazio em `<input>`/`<textarea>`) afetava as métricas que descartaram os treinos `aurora-lora-v1`/`aurora-lora-v2`?

## Método

Sem chamar modelo nenhum: `scripts/benchmark/revalidate-lora-reports.mjs` reaproveita os artefatos HTML e contratos já salvos em `reports/model-training-v1/runs/` e `reports/model-training-v2/{final,dev}/runs/` (191 execuções ao todo) e roda o `validateArtifact` **atual** (com o bug corrigido) contra cada um, comparando com o veredito salvo na época.

## Resultado

**Zero mudanças em 191 execuções revalidadas.**

| Conjunto | Execuções | Aprovadas (antes) | Aprovadas (agora) | Mudanças |
|---|---:|---:|---:|---:|
| v1 | 48 | 7 | 7 | 0 |
| v2 final | 71 | 4 | 4 | 0 |
| v2 dev (checkpoints) | 72 | 12 | 12 | 0 |

Confirmado que o bug tinha oportunidade de aparecer: das 648 asserções `assertNumber`/`assertText` nesses conjuntos, 21 tinham como alvo um elemento `<input>`/`<textarea>`. Mesmo assim, nenhum veredito mudou.

## Conclusão

O descarte do LoRA v1/v2 (documentado em `docs/MODELO_LOCAL_TREINADO.md` e `docs/MODELO_LOCAL_V2.md`) **não foi afetado** pelo bug do avaliador. O veredito original (v2: 2/24 empatado com a base, sem ganho de 15 pontos percentuais exigido) permanece correto com a régua de hoje. Não há motivo, pelo menos por essa via, para reabrir os dois experimentos.

Isso não significa que fine-tuning esteja descartado como estratégia — só que essas duas tentativas específicas, do jeito que foram feitas, continuam não superando o modelo base. Uma tentativa nova precisaria de uma receita diferente (mais dados, outro rank/taxa, outra base), não uma reavaliação dos mesmos pesos.
