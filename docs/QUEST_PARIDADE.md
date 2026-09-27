# Quest com a mesma mente do PC

Objetivo definido pelo usuário em 27/09/2026: o Quest roda o **mesmo Harness** do app desktop. Isso inclui o mesmo contexto, as mesmas memórias, o mesmo modelo e o mesmo comportamento. Não é uma versão reduzida.

## Diagnóstico da "IA viciada" (versão 0.7.1)

O Quest não rodava a mesma mente do PC:

| | PC (app instalado) | Quest 0.7.1 |
|---|---|---|
| Modelo | `llama3.2:3b` Q4_K_M | `qwen3.5:0.8b` Q4_0 |
| Contexto | `compactContext` + KERNEL | perfil próprio `quest-chat-v1` (removido depois) |
| Memórias | embeddings nomic (89 de 90) | só palavras, embeddings desligados |
| Amostragem | padrão do Ollama, `repeat_penalty 1.1` | temperatura 0,3 **sem penalidade de repetição** |
| Template | Ollama (`Cutting Knowledge Date`) | llama.cpp com data injetada |

## O que mudou

- `app/localLlama.js`: prompts de texto usam o template do Ollama via `/completion`. A amostragem é a mesma do PC: temperatura 0,8, top_p 0,9, top_k 40 e repeat_penalty 1,1. Contexto de 8192 e saída de até 2048 tokens.
- `app/embeddings.js`: no Quest, os vetores vêm de um `llama-server --embeddings` com o **mesmo blob** `nomic-embed-text` do Ollama. O cosseno contra o PC é de 0,9999997, então as memórias já vetorizadas continuam válidas.
- `scripts/bundle-quest-runtime.py --profile parity` (padrão): usa os blobs exatos do Ollama do PC. A integridade é conferida por SHA-256 do blob.
- `scripts/provision-quest-models.mjs`: envia os pesos para `Android/data/com.aurora.xr/files/models` e confere o SHA-256 no aparelho.
- `AuroraRuntime.java`: segundo processo para embeddings. A verificação de hash fica em cache por tamanho e data, e o runtime passou a `standalone-090-parity`.
- `scripts/compare-harness-parity.mjs`: roda a mesma conversa de 8 turnos contra qualquer Harness.

## Resultados

**PC Ollama × PC llama.cpp (simulando o Quest):** as mesmas 12 memórias, na mesma ordem, em todos os turnos. O relógio, a lembrança do "violeta" e o uso das memórias de Godot e AudioContext se comportaram igual. Os erros também são os mesmos, porque vêm do modelo 3B: 17 × 23, a recusa nas dicas de sono e o resumo genérico.

**Quest 3S (XR2 Gen 2, 8 GB, 6× Cortex-A78C):**

| Situação | Leitura do prompt | Geração | Turno típico (~1.500 tokens de contexto) |
|---|---|---|---|
| Sem MR, frio | ~32 tok/s | 11–13 tok/s | ~50 s |
| MR aberto, mmap | ~11 tok/s | **0,4 tok/s** (kswapd a 64% de CPU) | 150 s, com estouros de 240 s |
| MR aberto, `--no-mmap`, 4 threads | 16,4 tok/s | 3,7 tok/s | 95 s |

- Nas respostas do Quest com MR, a repetição de 4-gramas foi zero, e o comportamento foi o mesmo do PC nos turnos concluídos.
- 6 threads pioram: a geração cai para 2,7 tok/s porque o sistema e o rastreamento usam os mesmos núcleos. Depois de testes seguidos, o aparelho aquece e a velocidade cai.
- Com mmap, o RSS do modelo era de 4,4 GB, porque a reorganização dos pesos para ARM fica ao lado do arquivo mapeado. Com `--no-mmap`, fica em 2,9 GB.

## Próximos passos

1. Terminar a comparação de threads com o MR aberto (3/3 e 2/4). Ela foi interrompida porque a bateria do Quest acabou.
2. O gargalo agora é a **leitura do prompt**: ~1.500 tokens a 16 tok/s. Ideias, em ordem de impacto:
   - mostrar a resposta enquanto ela é gerada (streaming no Harness e no painel XR);
   - reduzir a carga de CPU do Unreal quando o menu está parado (pedido ao visual);
   - aproveitar melhor o cache de prompt entre turnos.
3. Rodar de novo `compare-harness-parity.mjs quest 18887 8787` com a configuração final e registrar aqui.
4. Só depois reavaliar o MoE 30B, que precisa de ~18,6 GB. O Quest tinha 2,6 GB livres com ele copiado; a cópia foi removida, e o original fica em `Saved/MoePort`.

## Rota principal: PC primeiro, Quest como reserva (27/09/2026)

Decisão do usuário: como só ele usa o app, o Quest conversa direto com o Harness do PC. É o mesmo app, com a mesma mente e a mesma GPU. O Harness embarcado fica como reserva.

- `AuroraHarnessClient`: ao abrir, testa o PC pareado (`aurora-connection.json`) com limite de 3 s. Sem resposta, cria `Saved/aurora-runtime-wanted` e usa o Harness do Quest quando ele responder. Depois de 2 heartbeats perdidos, cai para o Quest. Na rota do Quest, tenta o PC a cada 30 s e volta quando ele reaparece. Cada rota guarda a própria sessão (`aurora-session-pc.json` e `aurora-session-standalone.json`), porque os bancos são diferentes.
- `AuroraRuntime.java`: o Node e os dois `llama-server` (~3 GB) só rodam enquanto a flag existe.

Medido no Quest 3S:

| Situação | Resultado |
|---|---|
| PC ligado | "IA no PC". Pergunta e resposta em ~6 s; Harness embarcado desligado; 5,1 GB livres (antes 1,2 GB) |
| Ponte do PC derrubada | Flag criada em 13 s; "IA no Quest" em 16 s |
| Ponte religada | Volta para "IA no PC", derruba o runtime local e libera a RAM |

No modo PC, a mente é a do **app instalado** no PC. As melhorias do repositório (evidência nas memórias e relógio) só valem lá depois de gerar e instalar uma versão nova.
