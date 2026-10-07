# Acelerador do modelo local (07/10/2026)

Estudo do [Strata](https://github.com/Niko1221/Strata), um motor que roda um modelo de 125 bilhões de parâmetros num PC
gamer, para acelerar o modelo que a Aurora já usa (qwen3.5:4b no llama-server do Ollama). Nada do Strata foi copiado ou
executado: só as ideias, testadas uma a uma com o mesmo modelo, na mesma máquina (RTX 4090, i9-14900K, 32 GB).

## O modelo

`node scripts/gguf-info.mjs qwen3.5:4b`: arquitetura `qwen35`, 32 camadas, uma de atenção a cada 4 (as outras são
recorrentes, do tipo DeltaNet), e uma camada MTP (`mtp.*`) que adivinha o próximo token. Por ser recorrente, o estado
salvo de uma conversa só pode ser **estendido**, nunca cortado de volta: isso decide como o cache tem de ser feito.

## O que funcionou: partida instantânea

Ideia do Strata: "guardar a conversa e ler só o que é novo". Dentro de um turno o llama-server já fazia isso (cada passo
do agente só acrescenta: 100% de prefixo comum, log de 752 pedidos). O que faltava era **entre reinícios**: o servidor
para depois de 10 minutos parado, e a volta relia os ~7 mil tokens fixos (lista de ferramentas + regras).

`app/llamaCache.js`: o começo fixo é cortado exatamente no fim das regras (`AGENT.md`), lido numa vaga livre sem gerar
nada, salvo em `llama-cache/` ao lado do banco (`--slot-save-path`, ~180 MB) e restaurado em todas as vagas quando o
servidor sobe. Uma chave por arquivo de modelo e versão do servidor; se as regras mudarem, a primeira resposta mostra
que o cache não serviu e ele é aprendido de novo. Só aprende com o servidor parado (na CPU, ler o começo leva ~60 s).

| Medição (`scripts/cache-lab.mjs`, cenário real) | Antes | Depois |
|---|---|---|
| Primeira resposta após reiniciar, só CPU | 68–74 s | 1,3 s |
| Primeira resposta após reiniciar, RTX 4090 | 0,9 s | 0,2 s |
| Turno inteiro do agente (planilha de estoque), só CPU | 285 s | 109 s |
| Tokens lidos no 1º pedido da sessão seguinte | 7.603 | 763 |

O primeiro jeito de aprender (o começo comum de dois pedidos seguidos) falhou: dois passos do mesmo turno têm em comum
também a hora e a pergunta, e o estado salvo não servia na sessão seguinte. Daí o corte no fim das regras.

## O que não funcionou (não repetir)

`scripts/spec-bench.mjs` (`LLAMA_SPEC=off LLAMA_CACHE=off`, cada configuração passada à parte):

| Ideia | GPU | CPU | Decisão |
|---|---|---|---|
| MTP do próprio modelo (`--spec-type draft-mtp`) | conversa 148 → 92 tokens/s | 10,2 → 6,4 tokens/s e texto diferente | não usar |
| MTP + n-gramas | igual aos n-gramas na cópia, pior na conversa | 8,1 tokens/s | não usar |
| N-gramas (`ngram-mod`, o padrão) | cópia de tabela 147 → 353 tokens/s | conversa igual | mantido |
| Threads (6, 8, 12, 16, 24) | — | 9,6 a 10,6 tokens/s: limite é a memória | padrão (16) |
| Blocos de leitura (`-ub` 256 a 2048) | leitura já é 0,8 s | 67 s (256) a 78 s (2048) | padrão (512) |

No Strata o MTP rende 1,6–1,8x porque o modelo é enorme e cada passo custa caro; num modelo de 4B a conferência extra
custa quase tanto quanto o ganho.

## Ferramentas

- `scripts/gguf-info.mjs <modelo>`: o que o arquivo do modelo diz de si (camadas, MTP).
- `scripts/cache-lab.mjs <pedido.json>`: partida a frio com e sem o estado salvo (`LLAMA_FORCE_CPU=1` para só CPU).
- `scripts/spec-bench.mjs`: velocidade de escrita por configuração; `AGENT_REQUEST=<pedido.json>` inclui um pedido real.
- `LLAMA_CACHE=off` desliga a partida instantânea; `LLAMA_CACHE_DIR` muda a pasta.
