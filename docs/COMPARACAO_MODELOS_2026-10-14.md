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

**Modelos sem template de conversa no GGUF** (`ministral-3` 3b/8b/14b, `gpt-oss:20b`, `lfm2.5:8b`): o llama-server cai num
template genérico sem ferramentas e o modelo nunca as vê (ministral-3:3b: 0 chamadas em 50 turnos, 43,1%, nota descartada).
Templates oficiais em `F:\Modelos_Aurora\templates`; teste com
`LLAMA_SERVER_EXTRA_ARGS="--chat-template-file F:/Modelos_Aurora/templates/ministral-3.jinja"`. Pendente: rodar a bateria
dos ministral e do gpt-oss assim. Se algum vencer, o Harness precisa escolher o template sozinho.
