# Comparação de modelos (03–04/10/2026, RTX 4090 24 GB, i9-14900K, 32 GB)

Bateria do agente (23 tarefas, 3 rodadas por modelo, cópia do banco real), modelos em `F:\Modelos_Aurora\ollama`.

| Modelo | Tarefas | Turnos (conversas) | Rodada | Geração | Memória | Situação |
|---|---|---|---|---|---|---|
| **qwen3.5:4b** (atual) | **67/69** | **60/60** | **~79 s** | 151 tok/s | 3,5 GB | o melhor custo-benefício |
| gemma4:e4b | 51/69 | 55/60 | ~72 s | 145 tok/s | — | pior: erra edição, memória e conversas |
| gpt-oss:20b | 37/46 nas 2 rodadas válidas | 36/40 | ~62 s | — | 13 GB | 1ª rodada travou com o jogo aberto |
| qwen3.6:35b (MoE 35B-A3B) | 23/23, 19/23, 13/23, 19/23 | 20/20 em todas | 160–1.372 s | 83–85 tok/s | 22,5 GB (20 GB na GPU) | acerta muito, mas as rodadas foram lentas demais |
| gemma4:26b | sem resultado | — | — | 22 tok/s | 18 GB | não terminou nenhuma rodada |

**Por que o MoE de 35B ficou lento:** não era só o modelo. Duas falhas da Aurora o recarregavam na GPU a cada minuto, e cada recarga levava de 60 a 170 s:
- o modelo de embeddings disputava a memória de vídeo, o que foi corrigido mandando os embeddings para a CPU;
- a ficha dos documentos usava um contexto diferente do agente, o que foi corrigido com um contexto único e prazo de 300 s.

Mesmo sem as recargas, a melhor rodada dele levou 160 s, o dobro do 4B, e ele ocupa quase toda uma GPU de 24 GB. Para o objetivo de rodar em computador comum, **não serve como padrão**.

**Decisão (04/10):** otimizar o **qwen3.5:4b**, que já acerta 67/69 com 3,5 GB.

## Otimização do qwen3.5:4b (estudo noturno de 04/10, refeito à tarde)

O PC desligou na última fase; as rodadas perdidas por cópia de banco corrompida (`-wal` velho reaproveitado) foram refeitas com `overnight-qwen-opt.mjs --only`.

| Configuração | Tarefas | Memória | Geração |
|---|---|---|---|
| 4b, padrão, GPU | 44/46 | 8,4 GB | 139 tok/s |
| **4b + flash attention + cache KV q8, GPU** | **64/69** | **3,3 GB** | **157 tok/s** |
| 4b Q8_0 (mais preciso), GPU | 42/46 | 5,2 GB | 107 tok/s |
| 4b Q3_K_M, GPU | 60/69 | 2,9 GB | 141 tok/s |
| 4b Q2_K, GPU | 0/69 | 2,6 GB | quebra o modelo |
| 4b, só CPU (16 threads) | 21/23 | 3,3 GB | ~11 tok/s, ~20 min por rodada |
| 4b Q3_K_M, só CPU | 21/23 | 2,9 GB | ~13 tok/s |
| 4b, só CPU, 8 threads | 21/23 | 3,3 GB | ~11 tok/s |
| Decodificação especulativa (0.8b de rascunho), CPU | — | — | 10,2 tok/s contra 10,7 sem rascunho: não ajuda |

**Decisão:** padrão = qwen3.5:4b com `OLLAMA_FLASH_ATTENTION=1` e `OLLAMA_KV_CACHE_TYPE=q8_0` (mesma qualidade, menos da metade da memória). Q3_K_M só para máquina com pouca RAM; Q2_K descartado. Num PC sem placa de vídeo, 8 threads bastam. (O llama-server do Ollama renomeou `--draft-max` para `--spec-draft-n-max`.)
