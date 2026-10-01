# Aurora 0.1.28: arquivos citados no chat, conhecimento em escala e comandos confiáveis no Windows

## Arquivos citados na conversa

- **Localização e leitura:** "Resuma o MARU_MEDIA_KIT_PDF_FINAL" (nome solto, nome com extensão ou caminho colado) localiza o arquivo no projeto, Área de Trabalho, Documentos, Downloads ou OneDrive e lê o conteúdo antes de responder.
- **Continuidade:** o arquivo continua anexado nas mensagens seguintes ("quanto custa o pacote X?", "e com exclusividade?").
- **Caminhos errados:** `read_file`, `open` e `search_files` encontram o arquivo pelo nome quando o caminho vem errado (pasta errada, `$env:USERPROFILE`, barras duplicadas, acento corrompido).
- **Erros que não se repetem:** o histórico só repete as ações que deram certo, então um link inventado não volta a ser tentado.
- **Instruções mais claras:** para resumir, a IA lê o arquivo (`open` só mostra na tela) e nunca inventa links nem caminhos.
- **Chamada de ferramenta como texto:** uma chamada escrita em JSON quebrado no fim da resposta passa a ser executada.

## Conhecimento da empresa em escala

Testado com uma pasta de 3.030 documentos e 50 mil trechos:

| Operação | Antes | Agora |
|---|---|---|
| Remover uma fonte | não terminava | 1,3 s |
| Buscar | comparava todos os vetores a cada mensagem | ~90 ms |

- **Migração:** o índice antigo é migrado sozinho, em cerca de 1 s.
- **Embeddings em lote:** a indexação ficou mais rápida.
- **Busca automática:** só para pedidos de informação, nunca para saudações ou ordens de ação.

## Privacidade

Num chat com Codex ou Claude, um documento de pasta restrita não é lido nem anexado sem a sua autorização.

## Comandos no Windows

- **Ferramentas do Windows primeiro no PATH:** um `find` do Git chegou a varrer o disco C: inteiro por 2 minutos.
- **Acentos corretos:** a saída do PowerShell passa a ser em UTF-8.

## Verificação

- `npm test`: 356 testes passaram, 0 falhas.
- **Bateria do agente** (20 tarefas, numa cópia do banco real): 20/20 e 19/20, em 49 s (antes, 310 s).
- **Cenário real com `qwen3.5:4b`:** resumo do media kit, preço de pacote e soma com adicional, todos corretos, de 1 a 7 s.
