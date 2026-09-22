# Avaliação Qwen3 MoE por SSD

Experimento separado do aplicativo: não substitui silenciosamente o modelo padrão e não altera pesos, conversas ou configurações do Ollama. Qwen2.5 permanece somente como referência explícita da avaliação, fora do catálogo normal do Aurora.

Campanha de 21/09/2026 concluída. [Resultados medidos e decisão](QWEN3_MOE_RESULTS.md).

## Perguntas e protocolo

- O Qwen3-Coder 30B MoE entrega mais tarefas corretas que o antigo Qwen2.5-Coder 1.5B?
- Qual o efeito de limitar a residência do executor a 20%, 30%, 40% e 50% de 16 GiB (3,2 / 4,8 / 6,4 / 8 GiB)?
- Quanto tempo, memória, leitura de disco e tokens são necessários por entrega aprovada?

Reutiliza os 12 pedidos e contratos de `scripts/training/heldout-v2.mjs`, com sementes 211 e 419: 24 casos por perfil, 120 no total. Jogo, página, aplicativo e BI, seis casos por área. Quatro verificações adicionais de retenção por perfil. As referências são executadas no navegador antes das respostas dos modelos. É um conjunto de regressão já observado, não uma avaliação independente nem uma medida de precisão geral.

Os dois modelos passam pelo mesmo código atual de workflow e pelo mesmo executor CPU. Memória e skills ficam desligadas nesta comparação para isolar a troca do modelo. Até duas tentativas; 1536 tokens de saída por chamada; contexto 8192; quatro chamadas / 22000 tokens por tarefa; 120 segundos por chamada / 180 segundos por tarefa. Temperatura 0,2; top-k 40; top-p 0,9; penalidade de repetição 1; oito threads; uma geração por vez. Saídas truncadas, falhas funcionais e timeouts são preservados.

O relatório antigo de treinamento v2 usava Ollama e GPU; seus tempos não são um controle para este ensaio CPU. A nova execução do modelo antigo é a referência pareada. Tokens de modelos diferentes usam vocabulários diferentes: não significam a mesma quantidade de texto nem cobrança de API. Chamadas interrompidas têm contagem incompleta identificada, além dos tokens parciais recebidos.

## Memória e SSD: o alcance real do limite

`ssd-monitor.py` inicia somente o servidor do experimento, aplica `SetProcessWorkingSetSizeEx` com `QUOTA_LIMITS_HARDWS_MAX_ENABLE` e confirma o máximo por `GetProcessWorkingSetSizeEx`. Registra amostras a cada 250 ms e o pico acumulado informado pelo Windows. Não pede privilégios adicionais, não limpa caches globais e não encerra outros programas.

Esse teto é **do working set do processo**. Páginas do modelo retiradas dele podem continuar no cache standby do Windows. Por isso também medimos memória disponível, compromisso e `SystemCache` (standby + working set do sistema). Essas métricas incluem outros aplicativos e se sobrepõem; não some RSS e cache para alegar uso exclusivo do modelo. CPU i9 / 31,8 GiB com teto no processo **não equivale a uma máquina física de 16 GB**.

As primeiras duas consultas curtas distinguem processo frio e aquecido; o cache do sistema não está controlado. Não chamamos a primeira de “SSD frio”. Contadores físicos de leitura são do NVMe inteiro, incluindo outros processos. Page faults podem ser resolvidos sem tocar no disco.

O patch Swap-MoE evita carregar previamente todos os especialistas. Não usamos fixação do roteamento, remoção de especialistas nem alterações de metadados. O limite é aplicado ao processo completo, incluindo pesos residentes, KV e buffers, não apenas a um número estimado de especialistas. `--expert-cache-size` do patch não foi usado como garantia de RAM em nenhuma campanha promovida: sua estimativa não substitui medição do Windows. Na rodada 2 (abaixo), `--expert-prefetch` passou a ser usado nas campanhas promovidas; `--expert-keep-recent` e `--expert-cache-size` foram testados apenas no diagnóstico exploratório e não trouxeram ganho adicional no cap testado, então não entraram nas campanhas de 24 tarefas.

## Reprodução

Windows x64, Visual Studio 2022 C++, CMake, Node e dependências já instaladas do Aurora. Python com `psutil` no ambiente isolado `.venv-training`. Requer os dois GGUF originais instalados no Ollama e aproximadamente 20 GB adicionais livres num SSD. Nenhum peso é versionado ou redistribuído pelo script.

```powershell
powershell -NoProfile -File scripts/benchmark/prepare-ssd.ps1
node scripts/benchmark/ssd-evaluate.mjs old-30
node scripts/benchmark/ssd-evaluate.mjs moe-30
node scripts/benchmark/ssd-evaluate.mjs moe-20
node scripts/benchmark/ssd-evaluate.mjs moe-40
node scripts/benchmark/ssd-evaluate.mjs moe-50
node scripts/benchmark/ssd-report.mjs
node scripts/benchmark/ssd-report.mjs --serve
```

Execute um perfil por vez; porta do servidor 18795, painel 18796, ambos em loopback. A ordem é fixa e consta em `preparation.json`; efeitos de ordem/cache são uma limitação. O runner congela fontes, contratos e parâmetros em `manifest.json`; para outro experimento, use `SSD_REPORT_DIR` diferente. Não edite os scripts/fontes congelados durante a campanha. Resultados já concluídos não são sobrescritos em retomadas. A retomada reinicia o servidor e mede novas sondas; não é adequada para comparar carregamento frio entre sessões sem registrar esse fato.

Nesta máquina os modelos originais ficam no HD F:. Cópias conferidas por SHA-256 foram usadas em C:, Kingston SNV2S1000G NVMe (`PhysicalDrive4`). Para reproduzir em outro computador, adapte o identificador do disco no runner **antes** de congelar o experimento.

Evidências em `reports/ssd-moe-v1/`: manifesto, configuração de lançamento, identidade do processo, logs do servidor, amostras JSONL, respostas completas, contratos, histórico de correções e resumos. O diretório é local e ignorado pelo Git. `dashboard.html` funciona offline; o servidor do painel atualiza os números a cada dez segundos. O relatório final deve informar cobertura completa e separar aprovação funcional de incapacidade de concluir por tempo.

Energia: tarifa inicial editável de R$ 1,00/kWh. Potência fica em branco até ser informada; `horas × watts / 1000 × tarifa` é simulação, não custo medido. Não temos medição da tomada nem inferimos consumo total a partir da GPU desligada.

Após concluir os cinco perfis CPU e os três controles de qualidade, atualize os arquivos com `node scripts/benchmark/ssd-report.mjs`. O relatório para apresentação é gerado por `python scripts/build-ssd-benchmark-report.py`, em `output/pdf/Aurora_Qwen3_MoE_RAM_SSD.pdf`; o gerador recusa uma campanha incompleta. Requer ReportLab e as fontes Segoe UI do Windows. As páginas devem ser renderizadas e inspecionadas antes de compartilhar. O PDF separa os resultados originais da auditoria posterior e identifica os custos como cenários.

## Controle adicional e auditoria do validador

Ao observar timeouts nos ensaios CPU, foi acrescentada uma campanha separada pelo Ollama, sem teto de RAM e com GPU disponível. Reutiliza os 24 casos e os mesmos orçamentos para `old` (Qwen2.5-Coder 1.5B original), `current` (Qwen3.5 4B, padrão atual do Aurora) e `moe` (Qwen3-Coder 30B). Rodar com a campanha CPU pausada ou encerrada, para evitar competição por recursos: `node scripts/benchmark/ssd-quality-control.mjs old`, depois `current` e `moe`. O carregamento inicial admite até dez minutos e fica separado das tarefas; uma falha ao preparar o modelo impede pontuar a qualidade. Evidências em `reports/ssd-quality-control-v1/`.

Esse controle usa o runtime normal do app, com temperatura/sementes/contexto/orçamentos iguais, mas os demais padrões de amostragem e templates de cada modelo permanecem no Ollama. Portanto não isola exclusivamente os pesos ou o efeito do teto de RAM. Não comprova desempenho em SSD/16 GB e foi decidido após os primeiros timeouts, não fazia parte do manifesto inicial.

A auditoria `ssd-semantic-review.mjs` reexecuta os arquivos preservados dos três modelos com três ajustes específicos: leitura numérica de campos de formulário, botão desabilitado permitido apenas na ação extra depois da chegada e seleção de linhas visíveis no último teste de busca. Não gera nem modifica artefatos. As pontuações originais permanecem registradas ao lado da revisão posterior. Referências e controles negativos verificam que arredondamento incorreto, botão desabilitado antes da hora e texto errado ainda falham. Trata-se de uma auditoria dessa bateria, não de um novo teste independente ou validador genérico pronto para produção. Evidências em `reports/ssd-semantic-review-v1/`.

## Ajuste exploratório e retomada

Depois de concluir `old-30`, `moe-30` e a primeira semente de `moe-20`, a campanha CPU foi pausada. `ssd-calibrate.mjs 512` mediu os mesmos primeiros pedidos de dado, contador de palavras e ponto de equilíbrio com lote 512, mantendo contexto, teto, semente e amostragem. Foi uma seleção posterior de três casos; não substitui a grade original com lote 128. O contador de palavras passou em 117,7 s; os outros dois pedidos atingiram o prazo. Não é prova de ganho geral.

O controle Ollama e a auditoria foram executados nessa pausa. A grade CPU foi retomada com lote 128, completando a segunda semente de 20% antes de 40% e 50%. `interruption.json` e `resume.json` registram a decisão; `moe-20/segments/initial` preserva as sondas e a telemetria anteriores. O relatório identifica reinícios pelo contador de page faults, não soma leituras do disco durante o intervalo e interrompe as curvas em lacunas de amostragem. Cache do sistema e carga externa continuaram sem isolamento, portanto a ordem e a retomada limitam conclusões sobre o melhor percentual.

## Diagnóstico rodada 2: mitigações Swap-MoE (22/09/2026)

A rodada 1 não exercitou nenhuma das três flags de mitigação do patch (`--expert-cache-size`, `--expert-keep-recent`, `--expert-prefetch`), só `--expert-streaming` puro (mmap + paginação padrão do SO). `scripts/benchmark/ssd-calibrate.mjs` passou a aceitar um preset nomeado (`process.argv[2]`, entre `b512-pf`, `b512-kr8`, `b512-kr8-pf`, `b512-kr16-pf`, `b512-cs-pf`) combinando lote 512 com essas flags, e uma variável `SSD_CALIBRATE_PERCENT` (padrão 50) para testar outros tetos sem tocar a grade principal. Cada preset roda 1 tentativa em 4 tarefas (uma por domínio: jogo/pagina/app/bi), reaproveitando os primeiros pedidos já registrados em `reports/ssd-moe-v1/moe-50/runs/`. Evidências em `reports/ssd-moe-calibration-v2/<preset>[-p<percent>]/`.

Resultado do diagnóstico: `b512-pf` (lote 512 + `--expert-prefetch`) isolado já aprovou 3 das 4 tarefas de amostra, bem dentro do prazo (primeiro token caiu de 78–103 s para 17–26 s). `b512-kr8-pf` (adicionando `--expert-keep-recent 8`, valor recomendado pela documentação do patch — igual a `expert_used_count`) não melhorou o resultado nem o tempo no teto de 50%: mesma taxa de aprovação, tempos de parede iguais ou piores (a manutenção LRU do patch roda a cada `graph_compute`, então o custo de manutenção não se paga quando já há folga sob o teto). Por isso `b512-kr16-pf` e `b512-cs-pf` (variação de `--expert-keep-recent` e `--expert-cache-size`) não foram necessários nesta rodada. `b512-pf` foi confirmado também a 30% antes de ser promovido a campanha completa nos dois tetos; ver [resultados](QWEN3_MOE_RESULTS.md).

`scripts/benchmark/ssd-evaluate.mjs` ganhou perfis "tuned" (`moe-50-tuned-b512-pf`, `moe-30-tuned-b512-pf`, `moe-20-tuned-b512-pf`) que herdam `batch`/`expertPrefetch`/`expertKeepRecent`/`expertCacheSizeMib` do próprio objeto de perfil, sem alterar os perfis originais `moe-20/30/40/50` (que continuam disponíveis para referência do baseline). Como a lista de perfis muda o `definitions` congelado do manifesto, cada campanha "tuned" precisou de um `SSD_REPORT_DIR` novo (`reports/ssd-moe-v2` para 50%, `reports/ssd-moe-v3` para 30%/20%) — os diretórios `ssd-moe-v1`/`v2`/`v3` continuam intactos e comparáveis lado a lado.

## Fontes e versões

- llama.cpp `f5e85d43a048f3d5adefb4c5e29867d8077fba62`, [repositório](https://github.com/ggml-org/llama.cpp).
- Swap-MoE `50459bb422a01c0ba2e1da08b4d932f652f3e413`, [patch e licença MIT](https://github.com/ek15072809/Swap-MoE). Experimental, não integrado à distribuição do Aurora.
- Microsoft: [limite do working set](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-setprocessworkingsetsizeex) e [definições dos contadores de memória](https://learn.microsoft.com/en-us/windows/win32/api/psapi/ns-psapi-performance_information).

Antes de promover para o app: validar em hardware físico de 16 e 8 GB, NVMe/SATA, medir potência total, repetir a ordem dos perfis, controlar carga externa e demonstrar que o cache do sistema não oculta a necessidade de RAM adicional. Aprovar qualidade, tempo e memória conjuntamente.
