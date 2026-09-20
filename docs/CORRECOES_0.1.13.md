# Correções 0.1.13 — 20/09/2026

Os 30 achados da auditoria inicial foram tratados. A arquitetura permanece Electron + HTTP nativo + SQLite + React/Vite, com dados locais e comunidade somente pull. Não foram alteradas conversas ou memórias pessoais para testar as mudanças.

## Correções por achado

| Auditoria | Correção aplicada |
| --- | --- |
| 01 | Removida a execução de código gerado em `node:vm`. Autorrevisão usa Acorn e análise de escopos, sem avaliar JavaScript. |
| 02 | Preview com origem opaca, CSP `sandbox` também ao abrir no navegador, iframe sem `allow-same-origin`; IPC valida janela/frame e aceita somente HTTP/HTTPS para links. Navegações e popups do Electron são restringidos. |
| 03 | Token aleatório por servidor, bootstrap de sessão protegido, validação de Host/Origin/Fetch Metadata e tipo de conteúdo. Setup passou a POST autenticado. |
| 04 | Histórico persistido de usuário/assistente entra no prompt, dentro do orçamento de contexto. |
| 05 | Respostas antigas de carregamento/envio/correção não substituem a conversa selecionada. Operações e rascunhos são separados por conversa. |
| 06 | OCR solicita `blocks` do Tesseract 7 e converte blocos/parágrafos/linhas em palavras com caixas reais. |
| 07 | Checagem de sintaxe não inicia subprocesso. Playwright e CLIs npm usam o runtime Node do Electron de forma explícita; módulos necessários são desempacotados. |
| 08 | Perfil do navegador e cache OCR ficam em `userData`, fora do ASAR. |
| 09 | Stream de setup via fetch, sem reconexão automática; preparação e pulls concorrentes são compartilhados. |
| 10 | Importação validada e transacional no backend; deduplicação inclui proprietário do escopo e relações são remapeadas mesmo para memórias existentes. |
| 11 | Um turno por conversa, limpeza por identidade, sinal de cancelamento em recuperação/Local/CLIs/revisão/professor. No Windows, encerramento inclui a árvore do subprocesso CLI. |
| 12 | Prompt completo limitado; instruções/memórias não fazem o limite estourar. Mensagens maiores que o orçamento são recusadas com explicação, antes da gravação. |
| 13 | Falha assíncrona de `spawn` do Ollama é capturada e propagada sem derrubar o app. |
| 14 | Inicialização SQLite usa uma única promessa compartilhada; conexão só é publicada após migrações bem-sucedidas. |
| 15 | Edição invalida vetor antigo; gravação assíncrona exige revisão correspondente e registra modelo. Vetores ausentes/legados são reconstruídos incrementalmente durante buscas disponíveis. |
| 16 | Contexto fechado é removido do cache, página fechada é recriada, apenas um agente controla o navegador, tarefas são limitadas e a UI recupera execução ativa. |
| 17 | Validação de objetos, campos, tags, tamanho em bytes, JSON/UTF-8 e método HTTP antes de mutações. Corpos excessivos recebem 413. |
| 18 | Todas as configurações são validadas antes de uma transação única; leitura respeita a mesma precedência de ambiente. |
| 19 | Campo de modelo personalizado tem estado real, erros visíveis e bloqueio durante preparação. |
| 20 | Parser de pull processa a última linha sem newline, exige evento de sucesso e setup confirma a tag instalada. |
| 21 | Nome sem tag equivale apenas a `:latest`, não a qualquer versão instalada. |
| 22 | Timeouts cobrem respostas completas e inatividade de downloads; pulls não se multiplicam. OCR tem thread supervisora terminável inclusive durante inicialização. |
| 23 | Constantes/imports/escopos são analisados pelo parser, sem remoção de imports nem DOM falso; mapas de importação não são tratados como JavaScript. |
| 24 | Erros de envio e de CRUD ficam visíveis; rascunho só é limpo após sucesso. |
| 25 | `CODEX_MODEL` vira argumento real; `.env` do projeto é carregado em desenvolvimento. Resolvedor respeita executável explicitamente configurado. |
| 26 | Disponibilidade de CLI é detectada; autenticação é explicitamente não verificada até conversar. Local verifica servidor/modelo. Removido aviso inicial que declarava Codex obrigatório. |
| 27 | Resposta é persistida e retornada antes da extração. Estado da extração e IDs criados são persistidos e atualizados na UI; interrupção não perde a resposta. |
| 28 | Novos artefatos usam ID imutável da conversa; há leitura de compatibilidade do caminho antigo. Renomear não quebra novos previews. |
| 29 | Atlas aceita sincronização vazia e descarta resultados obsoletos. |
| 30 | Respostas vazias/erros/estruturas inválidas não viram sucesso. Correção exige resposta Local, tem vínculo com a mensagem original e não pode ser aplicada duas vezes. |

## Validação

- `npm test`: **167 aprovados, zero falhas e zero pulados**, incluindo navegador real, UI, SQLite temporário e subprocessos CLI fictícios.
- `npm run test:memory`: **6 aprovados**.
- `npm run check`: aprovado.
- `npm run frontend:build`: aprovado, inclusive TypeScript.
- `npm run dist`: instalador NSIS Windows x64, publicação desativada.
- `scripts/smoke-electron.mjs`: smoke test em desenvolvimento e no executável empacotado, com `userData`/SQLite temporários. Verifica interface, ponte IPC permitida/proibida, comportamento de X, OCR real, sintaxe, provedor CLI fictício e Playwright CLI sob Electron. Reinício do pacote confirmou a persistência do projeto de teste.
- Workflow de CI Windows acrescentado para executar build e as quatro verificações. Os resultados acima são da validação local; a execução remota pode ser acompanhada na aba Actions do GitHub.

Na implementação, uma rodada inicial revelou um fallback incorreto para o Claude instalado e acionou o CLI real com dados sintéticos. Isso foi comunicado e corrigido. A suíte final usa executáveis fictícios ou ausentes e contém uma regressão que proíbe esse fallback. Nenhum teste depende de consumir modelos pagos.

## Mudanças de comportamento importantes

- A autorrevisão é **análise estática**, não prova de que um jogo funciona. Execução real continua sendo uma ação explícita no botão Executar, em navegador isolado da API.
- Importação de memória com projeto/conversa inexistente é rejeitada integralmente, em vez de ampliar silenciosamente o escopo para global. JSON aceito pela API tem limite de 1 MB; a UI limita o arquivo a 990 KB.
- O token da API dura apenas enquanto o servidor está aberto. Clientes HTTP externos devem obter uma sessão local e enviar `x-harness-token`; a interface faz isso automaticamente.
- Memória automática pode aparecer alguns instantes depois da resposta. Falha/interrupção da extração é indicada, mas a resposta continua salva. Não há reexecução paga automática após reiniciar.
- A autenticação dos CLIs não é prometida com base apenas no executável encontrado. A sessão já existente continua sendo usada; nenhuma API key nova é solicitada.
- A métrica da sidebar foi rotulada como chamadas estimadas evitadas, não economia comprovada de tokens/dinheiro.
- O X continua escondendo a janela. Para atualizar/reabrir com o código novo, use **Sair** na bandeja antes de executar o instalador.

## Entrega e limites

Instalador: `release/Harness Aurora Setup 0.1.13.exe`. O executável empacotado foi testado, mas o instalador não foi executado sobre a instalação pessoal. Código e artefatos preparados para publicação na release `v0.1.13`.

- Tamanho: 129.979.747 bytes (Windows x64).
- SHA-256: `A7982BB5EB108790614D3A47878A77C02D924163C9A08FE5B43F924C665FE3AE`.
- Assinatura Authenticode: **NotSigned**. Não há certificado de assinatura configurado; isso não foi mascarado pelo log de empacotamento.
- `npm audit --omit=dev --audit-level=moderate`, raiz e frontend: zero vulnerabilidades reportadas na verificação.

Os avisos de bundle grande do Atlas/WebGL e de SQLite experimental continuam aparecendo e não impediram testes/build. A visualização 3D permanece experimental. Não foi feita uma avaliação extensa da qualidade dos modelos nem dos sites que o agente pode operar.

As propostas de expansão da seção "Melhorias recomendadas após estabilizar os bugs" da auditoria não são todas implementações desta versão: streaming, renderização Markdown mais rica, backup integral de projetos/conversas, instruções de projeto na UI, confirmação de ações relevantes do agente, paginação e avaliação quantitativa de relevância continuam sendo trabalho de produto posterior. Esta versão prioriza os 30 defeitos enumerados, proteção dos dados, testes e empacotamento.

Os arquivos de idiomas baixados durante validação foram retirados da raiz do repositório e preservados em uma pasta temporária de validação OCR. O diff preexistente de `frontend/package-lock.json` foi preservado.
