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
