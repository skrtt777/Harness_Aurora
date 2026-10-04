# Avaliação por setor e várias cópias do modelo (04/10/2026)

## Acervo

`F:\EmpresaIA`: Alvorada Alimentos Ltda, empresa **fictícia** gerada por `scripts/gerar_empresa_ia.py` (`F:/Anaconda/python.exe`, semente fixa).
- 15 setores, 45 PDFs e planilhas coerentes entre si; data de referência 04/10/2026.
- Distratores: orçamento de 2025 ao lado do de 2026, "férias" num processo do Jurídico, nomes repetidos, e uma pergunta sem documento (home office).
- 49 perguntas com a resposta esperada em `app/empresaIaQuestions.json`, fora da pasta da empresa.

Rodar: `LOCAL_MODEL=qwen3.5:4b node scripts/empresa-eval.mjs --db <cópia.db> [--samples 5] [--only RH]`. Cada setor vira uma fonte do seu departamento, e `HARNESS_NOW` fixa "hoje". O relatório sai em `reports/empresa/`.

## O que a avaliação achou e foi corrigido

| Problema | Efeito | Correção |
|---|---|---|
| Datas do Excel lidas como número serial (46299) | impossível responder "esse mês" | `xlsxText` formata datas, percentuais e colunas vazias |
| Data de hoje só em "que dia é hoje" | "esse mês" e "este ano" sem referência | `clockObservation` também em pedidos relativos |
| `read_file` parava na linha 43 de 115 | "ninguém entra de férias em outubro" | `filter: "Coluna=texto"`; planilha pequena entra inteira na busca automática, e cai para trechos se não couber |
| Categoria lembrada de outro acervo ("RH/Eventos") | busca vazia | busca de novo sem a categoria |
| Nome do arquivo não pesava na busca | "férias" trazia o fluxo de caixa | bônus quando o pedido cita palavras do nome do arquivo |
| Trava de documento inventado: "Ata **da** Reunião" e "Admissões **e** Desligamentos" | a IA desmentia uma resposta certa | comparação por palavras; a linha inteira é testada antes de ser cortada no " e " |

## Várias cópias (qwen3.5:4b, GPU, flash attention + KV q8, `OLLAMA_NUM_PARALLEL=5`)

| Estratégia | Certas | Cópias por pergunta |
|---|---|---|
| 1 resposta (média das 5 amostras) | 83% | 1 |
| Consenso de 3 | 43/49 (88%) | 3 |
| **Consenso de 5** | **45/49 (92%)** | 5 |
| Escalada 1→2→4→5 (para quando as primeiras concordam) | 44/49 (90%) | **2,7 em média** |
| Pelo menos uma das 5 certa (teto) | 47/49 (96%) | — |

- **Tempo (corrigido em 04/10 à noite):** o Ollama **não roda o qwen3.5 em paralelo** ("model architecture does not currently support parallel requests"), então as cópias entram em fila. A mediana foi de 9,8 s com 5 cópias, contra 1,8 s com uma resposta. O "11,3 s contra 7,9 s" anterior estava errado: os 7,9 s por cópia já incluíam a espera na fila.
- **Paralelo de verdade:** o llama-server que vem no Ollama, rodado de dentro de `lib/ollama/cuda_v13` (senão não acha a GPU), faz 4 respostas juntas em **1,6×** o tempo de uma na GPU e em 1,4× na CPU. No Ollama, o mesmo teste deu 3,4–3,7×. O llama.cpp CUDA de `F:\Modelos_Aurora` não carrega o GGUF do qwen3.5 baixado pelo Ollama (`rope.dimension_sections`).
- **Setor certo:** os documentos usados vieram do setor da pergunta em 47/48.
- **Como escolhe:** o consenso (`app/consensus.js`) fica com a resposta que mais concorda com as outras em números, datas e nomes.

**Conclusão:** a ideia de várias cópias do 4b funciona em acerto: ganha uns 9 pontos, e a escalada fica quase no mesmo nível com metade das cópias. Em tempo, ela só compensa se as cópias rodarem juntas, e para isso é preciso servir o modelo pelo llama-server com vagas paralelas, não pelo Ollama. Com o Ollama, a escalada custa ~2,7× o tempo de uma resposta.

**Ainda erram:**
- O agente às vezes procura o arquivo na pasta do projeto em vez de usar os documentos da empresa (producao-1, fiscal-2).
- Comparações entre linhas de planilha: "qual área está mais acima do orçamento" (controladoria-2).
- O 4b confundiu "a pagar" com "a receber" (financeiro-1).

**Próximo passo:** levar a escalada para o app.
1. Medir na primeira execução quantas vagas paralelas o PC aguenta.
2. Ligar a escalada só em pedidos sobre a empresa, contas e ações de risco.
3. Chamar o professor pago quando as 5 não concordarem.
