# Estudo: agente forte em casa sem um mega computador (03/10/2026)

**Pergunta:** para que qualquer pessoa tenha um agente forte em casa, a Aurora deve criar a própria LLM ou adaptar um modelo grande para rodar com pouca RAM, CPU e GPU?

**Resposta curta:** não treinar do zero. O caminho é **um modelo aberto MoE grande, executado de forma esparsa**, mais **a inteligência do próprio Harness** (memórias, travas, professor) e, por cima, um **adaptador LoRA treinado com as correções do professor**. A "nossa LLM" é esse conjunto, não um pré-treino próprio.

## 1. Por que não treinar uma LLM do zero

| Opção | Custo | O que entrega |
|---|---|---|
| nanochat (Karpathy) | ~US$ 48 (2 h num nó 8×H100) | Nível GPT-2: conversa, mas não é agente |
| Modelo pequeno "de produção" do zero (1–3B) | US$ 50 mil–150 mil | Abaixo dos modelos abertos que já existem de graça |
| 7–13B do zero | US$ 150 mil–500 mil | Idem |

Os laboratórios já publicam de graça modelos treinados com orçamento milhares de vezes maior (Qwen 3.5/3.6, Gemma 4, gpt-oss). A vantagem que só a Aurora tem não está nos pesos. Está no **ciclo de aprendizado com o usuário** (professor, memórias, bateria), e esse ciclo funciona sobre qualquer modelo.

## 2. O truque que muda tudo: MoE (poucos parâmetros ativos)

Um modelo *Mixture of Experts* tem muitos parâmetros, mas cada token usa só uma fração deles. Na prática:
- **Computação:** custa como o tamanho ativo.
- **Qualidade:** fica perto do tamanho total.
- **Memória:** o modelo inteiro precisa caber em algum lugar.

| Modelo (2026) | Total / ativo | Ponto forte | Memória (4 bits) |
|---|---|---|---|
| Qwen3.6-35B-A3B (abr/2026, Apache 2.0) | 35B / 3B | SWE-bench Verified 73,4%, Terminal-Bench 2.0 51,5%, MCPMark 37,0 (fontes secundárias; o blog oficial não carregou) | ~20 GB |
| gpt-oss-20b (MXFP4 nativo) | 21B / 3,6B | Roda em 16 GB: 17,8 tok/s num Mac mini M4 16 GB; 32,5 tok/s com 5950X + 7800XT | ~13 GB |
| Gemma 4 E4B / E2B (abr/2026) | ~4B / 2B efetivos | As tabelas de embedding por camada (PLE) ficam no armazenamento, não na RAM; chamada de função nativa | 4,5 / 2,9 GB |
| Qwen3.5 4B (padrão atual da Aurora) | 4B denso | — | ~3,4 GB |

**Evidência do próprio projeto** (`docs/QWEN3_MOE_RESULTS.md`, 21–22/09): na bateria de jogo, página, aplicativo e BI, o Qwen3-Coder 30B MoE aprovou **75% (95,8% na auditoria)** contra **29–37%** do Qwen3.5 4B. O salto de qualidade de um MoE grande é real para o nosso uso.

## 3. Como rodar o MoE grande em máquina comum

### 3.1 GPU pequena + RAM: atenção na GPU, especialistas na CPU
O llama.cpp permite deixar as camadas de atenção na GPU (`-ngl 99`) e os especialistas na RAM (`--n-cpu-moe`).
- **Medição publicada:** um MoE de 35B usou **menos VRAM que um denso de 8B** (3,9 GB contra 7,6 GB), com geração 4,8× mais rápida.
- **Ganho futuro:** o *cache de especialistas* (RFC #24528) mostrou +7% a +46% conforme o hardware, mas **ainda não está no llama.cpp oficial**.

### 3.2 Pouca RAM: especialistas lidos do SSD sob demanda
Antes de calcular, o roteador do MoE já sabe quais especialistas vai usar, e só esses são lidos do SSD.
- **Protótipo externo** (llama.cpp #27149): Qwen3-30B-A3B num M1 com 16 GB, usando **~1–2 GB de RAM**, a 3,8–4,7 tok/s. Outra prova de conceito chegou a 13 tok/s.
- **Leitura por camada:** caiu de 263 MB para 31 MB.
- **Nossa medição com Swap-MoE** (teto de memória do processo):

  | Teto de RAM | Tarefas aprovadas | Velocidade de geração |
  |---|---|---|
  | 8 GB | 70,8% | 5,7 tok/s |
  | 4,8 GB | 41,7% | 4,3 tok/s |
  | 3,2 GB | 33,3% | 3,3 tok/s |

  O limite dos tetos menores foi uma **degradação ao longo da sessão**, ainda sem causa conhecida, e não a qualidade do modelo.

### 3.3 Multiplicadores que se somam
| Técnica | Ganho | Estado |
|---|---|---|
| **EAGLE-3** (decodificação especulativa) | 2–3× (até 3,5–5× em código) | Já está no llama.cpp |
| **Cache de contexto (KV) em 8/4 bits** | Metade ou um quarto da memória do contexto, importante para agentes com contexto longo | q8/q4 no llama.cpp e no Ollama (`OLLAMA_KV_CACHE_TYPE`); TurboQuant só em forks |
| **Quantização dinâmica** (Unsloth Dynamic 2.0/3.0, EXL3/QTIP) | Mais qualidade por GB em 2–3 bits | Disponível (GGUF) |
| **Esparsidade de ativação** (TEAL, PowerInfer) | 1,5–1,8× com 40–50% de esparsidade | Pesquisa (ICLR 2025) |
| **Modelos ternários** (BitNet b1.58, bitnet.cpp) | 2,4–6,2× na CPU e 55–82% menos energia; 100B em "velocidade de leitura" numa CPU | Exige modelo treinado assim; os disponíveis ainda são pequenos (2B) |

## 4. Fazer o modelo aberto virar o "nosso" modelo: destilar o professor

Dois estudos de 2026 batem com o que a Aurora já faz:
- **SCoRe (ICML 2026):**
  - **Método:** o aluno executa, e o professor corrige **só o primeiro erro** da trajetória. Depois vem um treino curto com esses trechos corrigidos.
  - **Resultado:** um aluno de 7B **alcança o professor de 72B** em 12 testes de agente.
  - **Para a Aurora:** é exatamente o nosso ciclo (a local erra, o professor revisa, a local refaz). Hoje as lições viram memórias; o passo seguinte é virarem treino.
- **SFT × RL para agentes com ferramentas** (Qwen3 de 0,6B a 32B):
  - **SFT com LoRA** foi o melhor em 15 de 18 cenários.
  - **LoRA superou o ajuste completo** em todos os tamanhos, porque preserva o comportamento de agente do modelo.
  - **RL (GRPO)** ganha pouco, menos de 1 ponto, e só em transferência entre conjuntos de dados.
  - **Misturar conjuntos de dados** foi o mais robusto.

**Por que o LoRA anterior falhou** (v1/v2, 2/24, igual à base): foi treinado sobre um 1,5B fraco, com poucos dados, sem correções no formato SCoRe. A receita nova muda as três coisas:
- **Base:** MoE 35B-A3B ou 4B atual.
- **Dados:** trajetórias corrigidas pelo professor, acumuladas no uso real.
- **Treino:** SFT com LoRA e mistura de conjuntos de dados.

## 5. Arquitetura recomendada: em camadas, escolhida pelo hardware

| Máquina | Motor | Modelo |
|---|---|---|
| GPU ≥ 8 GB + RAM ≥ 32 GB | llama.cpp com atenção na GPU e especialistas na RAM, + EAGLE-3 | Qwen3.6-35B-A3B (Q4) |
| 16 GB, sem GPU dedicada | llama.cpp/Ollama | gpt-oss-20b (MXFP4) ou MoE com especialistas no SSD (depois de resolver a degradação) |
| 8 GB / notebook simples | Ollama | Gemma 4 E4B ou Qwen3.5 4B |
| Qualquer uma | — | **Cascata:** a local responde e o professor pago entra só no erro (já é o nosso ciclo) |

**Cascata:** a literatura relata **85% menos custo mantendo 95% da qualidade** do modelo forte (RouteLLM), e cascatas com estimativa de qualidade mantêm **97–99%**. As travas da Aurora (documento inventado, nomes e números, "sim" sem base) e a bateria contínua são o nosso estimador de qualidade.

## 6. Plano proposto (medido a cada passo pela bateria de 23 tarefas)

1. **Bateria com modelos candidatos neste PC:** qwen3.5:4b (base, 65/69), qwen3.6-35b-a3b, gpt-oss-20b e gemma4-e4b.
   - **Simular uma GPU menor:** limitar a VRAM (só atenção na GPU, especialistas na RAM).
   - **Registrar:** acerto, tok/s e RAM e VRAM de pico.
2. **Motor llama.cpp como segunda opção** no app, para o MoE com `--n-cpu-moe` e EAGLE-3. O Ollama faz divisão por camadas; **não confirmei** se ele já distribui especialistas MoE entre CPU e GPU. Isso precisa ser verificado antes, porque se ele já fizer, é bem mais simples.
3. **Seleção automática por hardware** (RAM, VRAM, CPU) na primeira execução, com a explicação mostrada ao usuário.
4. **Coletar trajetórias corrigidas** pelo professor no formato SCoRe (prefixo certo + correção do primeiro erro), com consentimento. Isso vira o conjunto de dados.
5. **LoRA com o conjunto do passo 4** sobre o modelo escolhido no passo 1, com mistura de conjuntos de dados. Só é adotado se ganhar na bateria.
6. **Especialistas no SSD** para máquinas de 16 GB: diagnosticar a degradação de sessão longa (reiniciar o servidor entre tarefas, olhar faltas de página e o cache de contexto), já que o protótipo externo indica que é viável.

## Fontes

- Pesquisa sobre MoE e SSD:
  - [llama.cpp — especialistas MoE no SSD (#27149)](https://github.com/ggml-org/llama.cpp/discussions/27149)
  - [llama.cpp — cache de especialistas (RFC #24528)](https://github.com/ggml-org/llama.cpp/discussions/24528)
  - [Benchmarks MoE: atenção na GPU, especialistas na CPU](https://github.com/esonhjz/llama-cpp-moe-vram-benchmarks)
  - [Guia de MoE CPU+GPU no llama.cpp](https://gist.github.com/DocShotgun/a02a4c0c0a57e43ff4f038b46ca66ae0)
  - [DALI: descarregamento de MoE em PCs (2026)](https://arxiv.org/abs/2602.03495)
  - [MoE-Infinity](https://arxiv.org/pdf/2401.14361)
  - [HybriMoE](https://arxiv.org/pdf/2504.05897)
  - [Memory-Sovereign Inference](https://arxiv.org/abs/2608.23805)
- Inferência a partir do flash:
  - [LLM in a flash (Apple)](https://arxiv.org/pdf/2312.11514)
  - [LLM Inference in a Flash! (2026)](https://arxiv.org/abs/2609.16161)
  - [AiF: processamento dentro do flash](https://dl.acm.org/doi/10.1145/3695053.3731073)
- Decodificação especulativa:
  - [EAGLE-3 no llama.cpp (PR #18039)](https://github.com/ggml-org/llama.cpp/pull/18039)
  - [Decodificação especulativa em 2026](https://dev.to/monuminu/speculative-decoding-in-2026-from-eagle-to-dflash-to-xpress-the-complete-engineers-playbook-3ald)
- Quantização:
  - [bitnet.cpp](https://arxiv.org/abs/2410.16144)
  - [BitNet b1.58 2B4T](https://arxiv.org/pdf/2504.12285)
  - [Unsloth Dynamic 2.0](https://unsloth.ai/docs/basics/unsloth-dynamic-2.0-ggufs)
  - [Unsloth Dynamic 3.0](https://unsloth.ai/docs/basics/dynamic-3.0-ggufs)
  - [QTIP](https://arxiv.org/pdf/2406.11235)
  - [LC-QAT (2 bits)](https://arxiv.org/abs/2606.10531)
  - [TurboQuant no llama.cpp](https://github.com/ggml-org/llama.cpp/discussions/20969)
  - [Comparativo de quantização do cache KV](https://anbeeld.com/articles/kv-cache-quantization-benchmarks-for-long-context)
- Esparsidade de ativação:
  - [TEAL](https://arxiv.org/abs/2408.14690)
- Modelos:
  - [Qwen3.6-35B-A3B (análise)](https://www.buildfastwithai.com/blogs/qwen3-6-35b-a3b-review)
  - [Qwen3.6-35B-A3B (especificações)](https://apxml.com/models/qwen36-35b-a3b)
  - [Gemma 4: relatório técnico](https://arxiv.org/abs/2607.02770)
  - [Gemma 4 E2B](https://huggingface.co/google/gemma-4-E2B)
  - [gpt-oss-20b: requisitos](https://intuitionlabs.ai/articles/hardware-requirements-gpt-oss-20b)
  - [Rodar gpt-oss no PC (Micro Center)](https://www.microcenter.com/site/mc-news/article/can-your-pc-run-gpt-oss-ai.aspx)
- Destilação e treino de agentes:
  - [SCoRe (ICML 2026)](https://arxiv.org/abs/2509.14257)
  - [SFT × RL para agentes com ferramentas](https://arxiv.org/abs/2609.17848)
  - [Destilar agentes em modelos pequenos (NeurIPS 2025)](https://papers.nips.cc/paper_files/paper/2025/file/99263f9bf46874e2b8b7f104b5063864-Paper-Conference.pdf)
  - [GRPO em modelos base (Modal)](https://modal.com/resources/best-open-source-base-models-grpo-fine-tuning)
- Cascata:
  - [Cascata com estimativa de qualidade (2026)](https://arxiv.org/abs/2606.27457)
  - [Roteamento e cascatas](https://tianpan.co/blog/2025-11-03-llm-routing-model-cascades)
- Custo de treino:
  - [nanochat](https://github.com/karpathy/nanochat)
  - [Custo de treinar uma LLM em 2026](https://sam-solutions.com/?p=50050)

**Ressalva:** parte dos números de modelos de 2026 (benchmarks do Qwen3.6, tok/s do gpt-oss) vem de fontes secundárias. A seleção final deve ser decidida pela nossa bateria, não pelos números publicados.
