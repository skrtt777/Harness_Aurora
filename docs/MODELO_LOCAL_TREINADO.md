# Modelo Aurora local: primeiro ajuste real

Experimento executado em 21/09/2026. **O modelo foi treinado, mas não ficou melhor no conjunto reservado. Não foi promovido a padrão.**

## Artefatos reais

- Base oficial: Qwen/Qwen2.5-Coder-1.5B-Instruct, revisão `2e1fd397ee46e1388853d2af2c993145b0f1098a`, licença Apache 2.0 preservada.
- Treinamento LoRA em GPU local RTX 4090, 18.464.768 parâmetros ajustáveis, rank 16, três épocas, perda somente nos tokens de resposta.
- 200 exemplos de treino: 80 gerações HTML, 80 correções JSON e 40 respostas curtas de retenção. Os exemplos de código derivam de dez famílias com oito variações; não são 200 habilidades independentes. Os 40 exemplos de desenvolvimento usam as mesmas famílias com outros valores e IDs.
- Cem casos de referência e suas versões defeituosas foram executados no navegador. Somente pares com referência aprovada, defeito reproduzido e edição exata válida entraram no conjunto.
- Treinamento e seleção por perda de desenvolvimento: 165,25 s. Pico de memória **alocada pelo PyTorch**, 5,13 GB; não representa toda a VRAM ocupada ou requisitos mínimos do computador.
- Adaptador real: `models/local-training/aurora-lora-v1/adapter/adapter_model.safetensors`, cerca de 74 MB.
- Pesos incorporados: `models/local-training/aurora-lora-v1/merged/model.safetensors`. Comparação com a base identificou alterações em 196 tensores. Base original preservada.
- Arquivo portátil: `models/local-training/candidate-q4_k_m.gguf`, cerca de 986 MB. Registrado no Ollama como `aurora-local:1.5b-v1`, **experimental**.
- O arquivo `weight-delta.json` registra hashes e quantidade de valores alterados. O manifesto registra dependências, dataset e execução. Alterações de pesos não equivalem a ganho de capacidade.

## Avaliação e decisão

Antes do treino, foram fixados 12 desafios novos, duas sementes por desafio, orçamento idêntico e quatro testes simples de retenção. Os desafios combinam componentes relacionados ao currículo, mas suas referências não foram usadas para treinar. A amostra é pequena e não representa precisão geral.

| Métrica | Original | Treinado |
|---|---:|---:|
| Aprovação funcional | 4/24 (16,7%) | 3/24 (12,5%) |
| Tokens totais, inclusive falhas | 43.435 | 38.398 |
| Chamadas ao modelo | 44 | 45 |
| Tempo dos ciclos | 63,94 s | 50,64 s |
| Tokens por aprovação | 10.858,75 | 12.799,33 |
| Retenção simples | 3/4 | 3/4 |

Houve 11,6% menos tokens totais, mas **17,9% mais tokens por aprovação**. Jogo passou de 1/6 a 0/6; página de 1/6 a 0/6; app de 2/6 a 0/6; BI de 0/6 a 3/6. O ganho pontual em BI não justifica substituir o modelo para uso geral.

Uma segunda comparação importou também a base sem treino, com a mesma versão do conversor, quantização Q4_K_M, template, prompts e sementes. Primeira tentativa: controle 4/24; treinado 3/24. Portanto, a conversão diferente do GGUF antigo não explica uma suposta melhoria. Nenhuma correção do modelo recuperou uma falha inicial nesta campanha.

Critérios prévios: pelo menos 70% de aprovação, ganho de 15 pontos percentuais, nenhuma regressão por área, retenção de pelo menos 3/4 sem regressão, tokens até 120% da base e melhora diante do controle de conversão. A candidata falhou no critério global e permanece experimental. A queda da perda de desenvolvimento de 0,847 para 0,00261 indica ajuste ao currículo, não generalização comprovada.

Dashboard: `http://127.0.0.1:8793`. Evidências em `reports/model-training-v1/`. A simulação de energia começa em R$ 1,00/kWh e 300 W, ambos editáveis; não houve medição na tomada nem chamadas pagas de geração. Tempo de avaliação não inclui instalação, exportação e trabalho de preparação.

## Uso no Harness

A prévia em `http://127.0.0.1:8788` usa seleção automática. Sem uma versão própria aprovada e instalada, utiliza a base estável `qwen2.5-coder:1.5b`. O relatório da candidata aparece em Configurações → IA local → Treinamento local. A escolha manual ficou em uma seção avançada. O aplicativo instalado na porta 8787 não foi atualizado neste experimento.

Uma release automática exige decisão aprovada e digest exato do modelo instalado. Se os pesos forem removidos ou substituídos, o aplicativo volta à base. Configuração explícita em `LOCAL_MODEL` tem precedência; escolha manual persistida vem em seguida. Para voltar à política automática, use “Usar seleção automática”.

O comando `node scripts/training/activate-model.mjs --activate`, com `HARNESS_DB_FILE` explícito, verifica os hashes das evidências, recalcula a decisão e confere o digest instalado. **Ele rejeita a candidata atual.** `--record-only` grava somente o relatório, sem promover o modelo. Não existe treinamento automático a partir de conversas nem ativação automática de saídas não verificadas.

## Reproduzir e evoluir

O ambiente isolado está em `.venv-training` (Python 3.10, PyTorch 2.6.0 CUDA 12.4, Transformers 4.51.3, PEFT 0.15.2). Os pesos e dependências grandes estão ignorados pelo Git; nenhuma chave ou conversa pessoal entra no dataset.

1. `scripts/training/download-base.py`: baixa a base oficial e registra sua revisão. Para repetir exatamente esta experiência, use a revisão do manifesto, pois o script resolve a revisão atual em uma instalação nova.
2. `node scripts/training/build-dataset.mjs`: gera e valida o currículo. O artefato histórico contém os hashes dos dados usados; não sobrescreva dados para uma nova versão sem identificá-la.
3. `scripts/training/train-lora.py --run <novo-id>`: treina sem sobrescrever a base nem uma execução existente. Seleciona checkpoint por perda de desenvolvimento.
4. `llama.cpp/convert_hf_to_gguf.py` exporta pesos incorporados para F16; `llama-quantize` converte para Q4_K_M. Fonte usada: `ce8caa6e60a03093351d6016a818720e0d46f0fb`; binário Windows b11065, hash no arquivo de proveniência. O Ollama 0.34.2 instalado não aceita `--quantize Q4_K_M` para importação direta de Safetensors; por isso a conversão é externa.
5. `register-model.mjs` registra os GGUFs sem publicar na internet. Nesta primeira versão, nomes e caminhos de avaliação são fixados em v1; uma campanha nova exige outro ID, nomes e referências reservadas. Não retreine repetidamente contra este teste e continue chamando-o de independente.
6. `evaluate-model.mjs` e `compare-weights.mjs` executam a avaliação. O código usado foi arquivado em `reports/model-training-v1/source`; o runner recusa código alterado. A integração posterior da seleção automática é separada da medição congelada.
7. `report-model.mjs` calcula resultados; `activate-model.mjs` permite registrar ou promover somente uma candidata aprovada.

Próximo experimento recomendado: ampliar diversidade de tarefas e respostas verificadas, reservar novas famílias de teste, reduzir repetição de templates e comparar checkpoints com menor intensidade de ajuste. Testar a base 3B como controle separado pode mostrar se o limite é capacidade; não atribuir a um treinamento os ganhos de simplesmente trocar de tamanho. Não há evidência aqui de capacidade equivalente a um modelo grande.

Referências técnicas: [modelo oficial](https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct), [LoRA/PEFT](https://huggingface.co/docs/peft/main/package_reference/lora), [importação no Ollama](https://docs.ollama.com/import), [llama.cpp](https://github.com/ggml-org/llama.cpp).
