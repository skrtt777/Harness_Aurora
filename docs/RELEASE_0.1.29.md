# Aurora 0.1.29: documentos escaneados, conversas longas sem fontes inventadas e IA paga revisando a organização

## Documentos escaneados e imagens

- **PDF escaneado:** uma página sem texto é desenhada e lida pelo OCR local (Tesseract, português e inglês), em cerca de 1 s por página. Num PDF misto, só as páginas escaneadas passam pelo OCR.
- **Imagens com texto:** `.png`, `.jpg`, `.bmp` e `.webp` entram no conhecimento da empresa e podem ser lidas no chat ("resuma esse print.png").
- **Mapa do conhecimento:** marca os documentos "lidos por OCR".

## Conversas longas

- **Documento inventado:** se a IA local cita um documento que não existe ("veja o Manual de Viagens.pdf"), a resposta volta para ela antes de chegar a você. Ela passa a responder só com o que os documentos dizem.
- **Leitura sem esperar:** documentos de uma pasta de conhecimento cadastrada são lidos sem pedir autorização. Antes, a leitura ficava 2 minutos esperando. Alterar arquivos nessa pasta continua pedindo.
- **Bateria do agente:** passa a ter três conversas de RH com 20 turnos ao todo. Elas incluem seguimentos, "valeu" no meio, políticas que não existem, o comunicado escaneado e alguém contradizendo o documento.

## IA paga revisa a organização

Em Configurações → Conhecimento, use **"Revisar com IA paga"**:

- **O que é enviado:** só as fichas de cada documento (título, resumo, categoria, palavras-chave), nunca o texto dos documentos.
- **Pastas não liberadas para IA paga:** a Aurora pergunta antes de enviar.
- **Sugestões:** aparecem uma a uma, com o motivo. Nada muda até você aceitar.
- **Correções aceitas:**
  - continuam valendo quando a pasta é reindexada;
  - viram exemplos que a IA local segue ao fichar os próximos documentos.
- **Custo:** conta no mesmo limite diário do professor.

## Verificação

- `npm test`: 361 testes passaram, 0 falhas.
- **Bateria do agente:** `qwen3.5:4b`, 23 tarefas, 3 rodadas finais, numa cópia do banco real.

  | Medida | Resultado |
  |---|---|
  | Tarefas | 61/69 |
  | Turnos das conversas longas | 58/60 (antes das correções, 51/60) |
  | Perguntas de RH | 20/21 |

- **Revisão real com o Codex:** 7 fichas da amostra de RH em 27 s, com 10 sugestões. Uma delas corrigiu "Solicitação de licenças" para "Como solicitar férias".
- **Ainda falha:** um "sim" genérico, sem citar documento, para uma política que não existe (2 de 3 rodadas). Detalhes em `docs/CONHECIMENTO_EMPRESA.md`.
