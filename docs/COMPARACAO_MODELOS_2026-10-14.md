# Comparação de modelos (14/10/2026, RTX 4090 24 GB, 32 GB)

Bateria nova (`--set novos`, 20 cenários, 58 checagens), 2 rodadas por modelo (116 checagens), llama-server do Ollama 0.34.2,
modelos em `F:\Modelos_Aurora\ollama`. Relatórios: `reports/battery/estudo2-*.json`.

| Modelo | Nota | Mediana por pedido | Arquivo | Situação |
|---|---|---|---|---|
| **qwen3.5:4b** (padrão) | 111/116 (95,7%); 57/58 na rodada da manhã | 3 s | 3,4 GB | segue o padrão |
| qwen3.8:27b | 113/116 (97,4%) | 8 s | 18 GB | empata com o 4b, 5× maior |
| qwen3.5:9b | 112/116 (96,6%) | 6 s | 6,6 GB | empata com o 4b, 2× maior |
| muse-glimmer:30b (Meta) | 111/116 (95,7%) | 22 s | 18 GB | lento |
| ornith:9b | 109/116 (94,0%) | 4 s | 5,6 GB | |
| gemma4:26b | 104/116 (89,7%) | 3 s | 18 GB | |
| granite4.1:8b | 100/116 (86,2%) | 5 s | 5 GB | |
| qwen3.5:2b | 78–83% | — | 1,9 GB | segue o da máquina fraca |
| lfm2.5:8b (8B, 1B ativo) | 61/116 (52,6%) | 5 s | 5,2 GB | responde sem ler a planilha, pede permissão |
| nemotron-3.5-lightning:30b | — | — | 25 GB | não cabe em 24 GB: recarrega a cada pedido |
| qwen3.6:35b | — | — | 23 GB | 2 cenários em 18 min |

**Variação entre rodadas:** o mesmo 4b fez 98% e 95,7%. Diferenças de até ~3 pontos são ruído; nenhum modelo supera o 4b.

**Modelos sem template de conversa no GGUF** (`ministral-3`, `gpt-oss`, `lfm2.5`): o llama-server caía num template genérico
sem ferramentas e o modelo nunca as via (ministral-3:3b: 0 chamadas em 50 turnos, 43,1%). Desde o commit 1c861fb o Harness
escolhe sozinho: o template do GGUF se ele tem ferramentas, senão o oficial da arquitetura (`app/templates`), senão o modelo
fica no Ollama. Resultados com o template automático (bateria nova, 2 rodadas):

| Modelo | Nota | Mediana por pedido |
|---|---|---|
| ministral-3:3b | 96/116 (82,8%), antes 43,1% | 3 s |
| ministral-3:8b | 98/116 (84,5%) | 5 s |
| ministral-3:14b | 105/116 (90,5%) | 8 s |
| gpt-oss:20b | 101/116 (87,1%) | 3 s |

Nenhum supera o qwen3.5:4b; o ministral-3:3b empata com o qwen3.5:2b (78–83%) com 3,0 GB contra 1,9 GB.

## Ideias de outros projetos (15/10)

- **Tradutor de intenção (toolshim do Goose):** não feito. Nas falhas do qwen3.5:2b e do 4b, nenhum turno terminou
  narrando a ação sem chamar ferramenta; as falhas do 2b são de raciocínio (contas, filtros, laços de 15 chamadas).
- **Receitas de passos que deram certo (Hermes):** medidas e não incluídas. 3 pares receitas globais × desligadas no
  qwen3.5:2b, 2ª rodada: 45, 54, 48 contra 50, 45, 46 (média 49 × 47), com a receita presente em só 1–2 de 50 respostas:
  ruído. Duas coisas achadas no caminho: a bateria abre um projeto por cenário e rodada (memória de projeto nunca volta), e
  o seletor de memórias trata a palavra "receita" como assunto de BI. Código guardado em `F:\Modelos_Aurora\patches`.
