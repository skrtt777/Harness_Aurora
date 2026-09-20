# Auditoria do Harness Aurora — 20/09/2026

> Registro histórico do diagnóstico inicial. As correções posteriores e seus testes estão em [CORRECOES_0.1.13.md](CORRECOES_0.1.13.md). O texto abaixo descreve o estado anterior às correções.

## Resultado

A base compila e os testes existentes passam, mas há falhas importantes fora da cobertura atual. As prioridades são isolar a execução de código gerado, corrigir a continuidade das conversas, evitar inconsistência entre conversa selecionada e exibida, recuperar o funcionamento do OCR e validar os caminhos específicos do aplicativo Electron instalado.

Esta é uma revisão com propostas de correção. Nenhuma correção foi aplicada ao código de produção. O único documento acrescentado ao repositório nesta auditoria é este relatório. A alteração preexistente em `frontend/package-lock.json` foi preservada.

## Base examinada e método

- Repositório local: `C:\Users\lucas\Documents\Harness\Harness_Aurora`.
- Commit: `2d46c200aa81bd7856333ee5453c4d2b7e422da7`.
- Versão declarada: `0.1.12`. Os instaladores encontrados em `release/` são da versão `0.1.11`; portanto não representam integralmente o código atual.
- Ambiente: Windows, Node `v24.1.0`, npm `11.3.0`.
- Revisão dos módulos de `app/`, componentes e utilitários de `frontend/src/`, Electron/preloads, configuração de build, esquema/migração SQLite, pacotes de comunidade e cobertura dos testes. Documentação e roadmaps foram consultados para comparar comportamento e intenção.
- Reproduções adicionais em bancos SQLite e diretórios temporários, com provedores simulados e navegador Edge sem interface. Não foram usadas conversas pessoais nem chamadas autenticadas aos modelos.

O termo **reproduzido** indica execução de um cenário controlado. **Estático** indica uma conclusão sustentada pelo fluxo de código e, quando aplicável, pelo código/documentação da dependência; não equivale a teste completo do instalador.

## Verificações executadas

| Verificação | Resultado |
| --- | --- |
| `npm test` | 141 testes: 133 passaram, 8 foram pulados porque o Chromium gerenciado não estava disponível |
| `test/browserAgent.test.js` com `CHROMIUM_EXECUTABLE_PATH` apontando para o Edge instalado | 22 passaram, nenhum pulado; inclui os 8 casos antes pulados |
| `npm run test:memory` | 6 passaram |
| `npm run frontend:build` | TypeScript e Vite passaram |
| `npm run check` | Passou; esse comando verifica somente a sintaxe de `app/server.js` |
| `npm audit --json`, raiz e frontend | Nenhuma vulnerabilidade conhecida reportada em ambos, nesta consulta |
| Reproduções adicionais | Confirmaram escapes de isolamento, inconsistência de UI, perda na importação e outros defeitos descritos abaixo |

O build emite aviso sobre o chunk de `MemoryScene`, aproximadamente 945,71 kB minificado / 254,02 kB gzip. A cena já é carregada com `lazy()`: não é correto tratar todo esse custo como carregamento obrigatório do chat inicial.

Os testes existentes não cobrem integralmente a interface, o contrato real do OCR ou o aplicativo empacotado. A ausência de alertas no `npm audit` não elimina falhas no código do aplicativo.

## Achados prioritários

### 01 — Crítica: o sandbox JavaScript permite alcançar o processo Node

**Local:** `app/jsSandbox.js:98`, `app/jsSandbox.js:153`; chamado automaticamente por `app/localRefine.js:125`.

O contexto recebe funções e objetos criados fora da VM. Foi possível alcançar o `process` real por uma função de `console`, usando apenas a leitura de `process.version` como prova. Resultado: `Error: v24.1.0`. Não foi necessário clicar em “Executar”: a revisão automática de respostas HTML já chama esse caminho.

**Impacto:** código gerado ou influenciado por conteúdo não confiável pode sair das restrições pretendidas e alcançar recursos do processo. No desktop, esse código roda no processo principal do Electron.

**Correção:** retirar execução não confiável desse processo. Usar um ambiente com restrições reais de arquivos, rede e recursos, ou um renderer isolado sem acesso à API/IPC privilegiado. Um subprocesso Node comum, sozinho, não constitui isolamento suficiente. Manter análise de sintaxe como operação separada.

**Evidência:** reproduzido. A documentação do [Node sobre `vm`](https://nodejs.org/api/vm.html) também declara que o módulo não é uma barreira de segurança.

### 02 — Crítica: o preview compartilha a origem e os privilégios da interface

**Local:** `frontend/src/ChatView.tsx:57`, `app/server.js:644`, `electron/main.js:165`.

O iframe permite simultaneamente scripts e mesma origem, e seu HTML é servido pelo mesmo backend da interface. Em um navegador real, o frame conseguiu ler o documento pai e consultar `/api/conversations`. “Abrir no navegador” também abre o HTML na origem da API, sem a restrição do iframe.

**Impacto:** código do preview pode ler conversas/memórias e executar operações na API. No Electron, o acesso ao pai ainda expõe a ponte `harness`; `shell:open-external` não valida origem do emissor nem restringe protocolos. A prova executada verificou DOM/API; não abriu protocolos externos.

**Correção:** servir previews em origem separada e sem acesso à API, remover `allow-same-origin` quando possível, definir CSP apropriada e validar emissor/protocolo em IPC. A proteção precisa valer também ao abrir o preview externamente.

**Evidência:** reproduzido para DOM/API; análise estática da ponte IPC. Referência: [segurança do Electron](https://www.electronjs.org/docs/latest/tutorial/security).

### 03 — Alta: a API aceita gravações de origens externas sem autenticação

**Local:** `app/server.js:216`, `app/server.js:254`, rotas de gravação e `/api/local/setup`.

Um POST com `Origin: https://untrusted.example` e `Content-Type: text/plain` criou um projeto e recebeu HTTP 201. Não há token, validação de Origin/Host nem exigência de JSON para mutações. Além disso, um GET pode iniciar instalação/download do Ollama.

**Impacto:** falta uma barreira na aplicação contra requisições indesejadas ao serviço local. Um site externo conseguir efetuar a requisição depende também das proteções de acesso à rede local do navegador; o teste confirmou a aceitação pelo servidor, não um ataque remoto completo em todos os navegadores.

**Correção:** validar origem e Host, exigir tipos/métodos corretos, adotar autenticação local compatível com a arquitetura e separar “iniciar instalação” de “acompanhar progresso”. Isolar primeiro o preview: token acessível na mesma origem não resolve o achado 02.

### 04 — Alta: o chat não envia o histórico da conversa ao modelo

**Local:** `app/server.js:135`, `app/server.js:140`, `app/codex.js:66`, `app/claude.js:34`, `app/local.js:34`.

O prompt contém apenas instruções do projeto, memórias selecionadas e a mensagem atual. As mensagens anteriores ficam no banco, mas não entram na geração. Codex usa sessões efêmeras; Claude não persiste sessão; Ollama recebe uma geração independente.

**Reprodução:** após informar um identificador em um turno local, a pergunta “qual era o identificador?” gerou exatamente um prompt com essa pergunta, sem o identificador anterior.

**Impacto:** pedidos como “continue”, “corrija o código acima” e referências ao turno anterior falham. A extração de alguns fatos não substitui o histórico; no modo Local nem essa extração automática ocorre.

**Correção:** carregar uma janela de mensagens com papéis, preservar código/contexto recente e aplicar orçamento explícito ao histórico e às memórias. Acrescentar teste de conversa com pelo menos dois turnos.

### 05 — Alta: a interface mistura conversa selecionada e conversa exibida

**Local:** `frontend/src/AppShell.tsx:122`, `frontend/src/AppShell.tsx:189`, `frontend/src/AppShell.tsx:196`, `frontend/src/AppShell.tsx:243`.

Respostas assíncronas chamam `setActiveConversation` sem verificar se a conversa ainda está selecionada. Reproduzi: enviar em A, selecionar B, concluir A. Resultado: barra lateral em **Conversa B**, cabeçalho/conteúdo em **Conversa A**.

**Impacto:** o usuário vê uma conversa e pode enviar a mensagem seguinte para outra. Correção de resposta e carregamento inicial possuem a mesma classe de corrida.

**Correção:** guardar dados e requisições por ID, ignorar respostas obsoletas e validar o ID ativo antes de atualizar o painel. O estado de envio/cancelamento também deve pertencer ao turno, não à seleção atual.

### 06 — Alta: o OCR nunca fornece as caixas de palavras esperadas pelo agente

**Local:** `app/ocr.js:65`, `app/ocr.js:68`; dependência `tesseract.js` 7.

`worker.recognize(image)` pede somente texto por padrão, e o código procura `data.words`. A dependência instalada retorna o detalhamento em `blocks` quando solicitado; não gera a antiga lista de palavras no nível superior. Assim, `words` fica vazio e cliques por texto falham.

**Correção:** solicitar `{ text: true, blocks: true }`, percorrer blocos/parágrafos/linhas e extrair palavras com coordenadas. Acrescentar um teste com a fixture de OCR e a biblioteca real, com os dados de idioma disponíveis localmente.

**Evidência:** contrato confirmado no código instalado (`src/createWorker.js`, `src/worker-script/utils/dump.js`, tipos) e nas [mudanças oficiais do Tesseract](https://github.com/naptha/tesseract.js/issues/993). Os testes existentes verificam caixas construídas manualmente, não esse contrato.

### 07 — Alta: subprocessos pressupõem que `process.execPath` é Node

**Local:** `app/localRefine.js:47`, `app/browserAgent.js:70`.

O verificador de sintaxe e o instalador do Playwright executam `process.execPath` como se fosse o binário Node. No processo principal do desktop ele é o executável Electron/Harness. Não é configurado um modo Node nem há um runtime separado; o verificador de sintaxe também não estabelece timeout.

**Impacto:** funcionalidades que passam nos testes Node podem abrir outra instância, falhar ou ficar aguardando no aplicativo instalado. O bloqueio de instância única não transforma o executável em Node.

**Correção:** usar um mecanismo de processo utilitário/runtime apropriado ao Electron, com timeout e arquivos de apoio acessíveis no pacote. Validar ambos os caminhos no artefato empacotado. Referências: [processo Electron](https://www.electronjs.org/docs/latest/api/process) e [processos utilitários/fuses](https://www.electronjs.org/docs/latest/tutorial/fuses).

**Evidência:** estático; não foi executado o instalador para validar esses subprocessos nesta auditoria.

### 08 — Alta: o perfil do navegador é gravado dentro do pacote do aplicativo

**Local:** `app/browserAgent.js:13`, `app/browserAgent.js:95`, `electron/main.js:185`.

O perfil padrão usa `app/data/browser-profile` relativo ao módulo. No build com ASAR isso resolve para dentro de `app.asar`, que não é um diretório gravável. O Electron ajusta `HARNESS_DB_FILE`, mas não `BROWSER_AGENT_PROFILE_DIR`.

**Correção:** configurar o perfil em `app.getPath('userData')` e aplicar a mesma política aos caches do OCR e arquivos temporários. Testar persistência do login e abertura do navegador no pacote. Referência: [limitações de escrita em ASAR](https://www.electronjs.org/docs/latest/tutorial/asar-archives).

**Evidência:** estático, condicionado ao caminho padrão no aplicativo empacotado.

### 09 — Alta: o setup do Ollama reconecta depois de terminar

**Local:** `frontend/src/api.ts:227`, `frontend/src/LocalSetupPanel.tsx:49`, `app/server.js:359`.

`LocalSetupPanel` recebe `done`/`failed`/`error`, mas não fecha o `EventSource`. Quando o servidor encerra o stream, o navegador reconecta e chama novamente a rota que executa o setup. O comentário em `api.ts` assume incorretamente que encerrar do lado servidor impede reconexão.

**Reprodução:** uma conclusão `done` produziu uma segunda requisição `/api/local/setup`, sem intervenção do usuário.

**Correção:** fechar explicitamente em estados terminais, limpar em desmontagem e evitar múltiplos setups concorrentes no backend. Idealmente iniciar uma tarefa por POST e acompanhar um identificador estável por SSE.

### 10 — Alta: importação descarta memórias válidas e perde relações

**Local:** `frontend/src/MemoryView.tsx:299`, `frontend/src/MemoryView.tsx:340`, `frontend/src/MemoryView.tsx:364`.

A chave de deduplicação inclui escopo, título e conteúdo, mas não `projectId`/`conversationId`. Memórias iguais em conversas diferentes são indevidamente consideradas a mesma. Registros pulados também não entram em `idMap`, impedindo relações entre memórias novas e memórias já existentes.

**Reprodução na UI:** um pacote que deveria criar duas memórias e uma relação criou apenas uma memória e zero relações. A UI anunciou que duas já existiam.

**Correção:** incluir o proprietário do escopo na identidade, mapear IDs também para registros existentes e validar todo o pacote antes de gravar. Mover a importação para operação transacional no backend facilita recuperação e consistência.

### 11 — Alta: cancelamento não interrompe corretamente todos os estados do turno

**Local:** `app/localRefine.js:166`, `app/pendingTurns.js:13`, `app/pendingTurns.js:27`, `app/server.js:132`, `frontend/src/AppShell.tsx:229`.

Ao cancelar uma revisão, `refineLocalAnswer` retorna o resultado anterior com `ok:true`; o backend salva sucesso. Reproduzi um cancelamento que persistiu `<script>const x = ;</script>` como resposta Local normal.

Turnos sobrepostos na mesma conversa substituem o controlador anterior. Quando o primeiro termina, apaga o segundo do mapa: a segunda tarefa continua sem poder ser cancelada. Codex/Claude não têm controlador, embora a UI também mostre “Cancelar”. Ao trocar de conversa, o botão usa o ID recém-selecionado.

**Correção:** identificar turnos individualmente, serializar ou rejeitar duplicados, propagar cancelamento em todas as etapas/provedores e validar o sinal antes de persistir sucesso. Abranger seleção de memórias no `try/finally` de limpeza.

### 12 — Alta: o limite de contexto não é respeitado

**Local:** `app/server.js:70`, `app/server.js:93`.

Somente a mensagem atual é truncada. Instruções e memórias não têm orçamento. Quando elas esgotam o limite, `available` vira zero e `slice(-0)` devolve a mensagem inteira.

**Reprodução:** limite 1.000, prompt final com 2.051 caracteres, mantendo todo o pedido. Com memórias/templates grandes a discrepância aumenta.

**Correção:** reservar espaço para a tarefa e para o histórico, limitar cada seção, tratar zero explicitamente e considerar orçamento em tokens. Não descartar silenciosamente o começo do pedido, que pode conter a restrição principal.

### 13 — Alta: falha ao iniciar Ollama pode derrubar o processo

**Local:** `app/ollamaSetup.js:108`.

`spawn` não tem listener de `error`. A função async retorna o processo antes do erro assíncrono; um `try/catch` externo não captura esse evento.

**Reprodução em subprocesso isolado:** `OLLAMA_BIN` inexistente causou `Unhandled 'error' event`, `ENOENT` e encerramento com código 1.

**Correção:** aguardar o evento `spawn`, tratar `error` e devolver falha estruturada ao setup. Cobrir executável ausente, falta de permissão e remoção após a detecção inicial.

## Outros bugs e inconsistências

### 14 — Média: inicialização concorrente abre várias conexões SQLite

**Local:** `app/db.js:143`.

Entre `if (instance)` e sua atribuição há `await mkdir`. Quatro chamadas simultâneas abriram **quatro instâncias distintas**. `Promise.all` de configurações já oferece um cenário natural de concorrência na inicialização.

**Correção:** armazenar e compartilhar a promessa de inicialização, publicando a conexão somente depois de schema/migrações concluídos. Fechar a conexão em falhas e no encerramento.

### 15 — Média: editar memória pode conservar um embedding do texto antigo

**Local:** `app/store.js:252`, `app/store.js:320`, `app/embeddings.js:73`.

Se o texto muda e o Ollama está indisponível, o vetor anterior não é invalidado. Foi reproduzido: conteúdo alterado, embedding antigo mantido. A busca passa a comparar um vetor que representa outro assunto.

Também não há reindexação das memórias criadas sem embedding; baixar o modelo depois não as atualiza automaticamente. Modelo/dimensão/versão do embedding não ficam registrados.

**Correção:** invalidar ao alterar, registrar versão/hash do texto e do modelo, aplicar resultado apenas à versão atual e criar uma fila de reindexação para pendências.

### 16 — Média: navegador fechado continua no cache; tarefas concorrentes dividem a página

**Local:** `app/browserAgent.js:119`, `app/server.js:389`, `app/agentRuns.js:18`.

Após fechar o contexto, `getOrLaunchBrowserContext` devolveu o mesmo objeto com `page.isClosed() === true`. Não há limpeza por evento `close`. Além disso, cada chamada de início cria um run, mas todos reutilizam a mesma página; voltar à aba perde o ID local e permite iniciar outro run.

**Correção:** invalidar o cache ao fechar, serializar tarefas por contexto e permitir recuperar o run ativo. Dar expiração aos runs concluídos: limitar passos por run não limita o tamanho do mapa de runs.

### 17 — Média: validação HTTP ocorre tarde ou de forma incompleta

**Local:** `app/server.js:216`, `app/server.js:496`, `app/store.js:263`.

Casos reproduzidos: JSON `null` retorna 500; `tags` como objeto lança erro **depois** de inserir uma memória; PUT em `/messages` executa um turno e salva mensagens, pois a rota não verifica o método.

O limite do corpo é checado só depois de recebê-lo inteiro. A soma de chunks de Buffer diretamente em string também não preserva necessariamente caracteres UTF-8 divididos entre chunks. A construção de URL fica fora do `try` do handler.

**Correção:** schema de entrada, limites em bytes durante leitura, decodificação incremental correta, 400/413/415/405 consistentes e validação antes de toda gravação. Incluir a construção da URL no tratamento de erro.

### 18 — Média: atualizar configurações pode retornar erro após salvar metade

**Local:** `app/server.js:291`.

Reproduzi um PUT com provedor válido e professor inválido. Recebeu 400, mas o provedor já havia sido alterado para `claude`.

**Correção:** validar todos os campos primeiro e persistir a atualização em uma transação. Usar a mesma resolução de configuração efetiva no GET e no PUT, inclusive quando houver override por variável de ambiente.

### 19 — Média: o campo de modelo personalizado não funciona nas configurações

**Local:** `frontend/src/SettingsView.tsx:172`.

`ModelPicker` recebe `customModel=""` e um setter vazio. Reproduzi digitação de `qwen-custom:7b`: o valor continuou vazio e o modelo não pôde ser escolhido.

**Correção:** adicionar estado editável, exibir erros e impedir trocas concorrentes enquanto o download estiver ativo. O seletor dentro da conversa usa estado; o defeito está na reutilização pela tela de configurações.

### 20 — Média: download incompleto pode ser reportado como sucesso

**Local:** `app/ollamaSetup.js:214`.

`pullModel` descarta o conteúdo restante sem quebra de linha ao chegar ao fim e não exige um evento final de sucesso. Uma resposta com `{"error":"download interrupted"}` sem newline retornou `{ok:true}` na reprodução.

**Correção:** processar o último fragmento, exigir sucesso explícito e confirmar a presença do modelo. Tratar desconexão, stream truncado e falha de leitura como erro.

### 21 — Média: detectar `latest` aceita indevidamente qualquer tag instalada

**Local:** `app/ollamaSetup.js:189`.

Com apenas `llama3.2:1b` instalado, a consulta por `llama3.2:latest` retornou true. As condições `tag === undefined` e `tag === 'latest'` aceitam qualquer tag com o mesmo nome-base.

**Correção:** normalizar ausência de tag para `latest` e comparar o identificador completo. Caso exista resolução de alias, consultar essa informação explicitamente.

### 22 — Média: operações do Ollama/embedding podem ficar pendentes sem limite adequado

**Local:** `app/ollamaSetup.js:177`, `app/ollamaSetup.js:196`, `app/embeddings.js:95`, `app/ocr.js:37`.

`isModelPulled` e `pullModel` não recebem timeout/sinal. No embedding, o timer é removido após os headers, antes de consumir JSON. Um servidor que responde headers e deixa o corpo pendente ultrapassa esse timeout. A seleção de memórias ocorre antes do `try/finally` do turno e não recebe seu sinal de cancelamento.

O timeout de inicialização do OCR não termina o worker subjacente e não é limpo ao vencer a inicialização normal.

**Correção:** cobrir a operação completa com prazo/sinal, timeout de inatividade para streams, limpeza de workers e deduplicação de downloads. Testar headers sem corpo, conexão interrompida e cancelamento durante busca de memória.

### 23 — Média: o verificador de código rejeita JavaScript válido

**Local:** `app/jsSandbox.js:134`, `app/localRefine.js:63`.

A remoção de imports não cria bindings equivalentes: `import { OrbitControls } ...` seguido de `new OrbitControls(...)` vira uma referência inexistente. `document.querySelector`, APIs legítimas não simuladas e imports multilinha também não são tratados corretamente. O heurístico de `const` não analisa escopo e pode confundir atribuição de propriedade com reatribuição da variável.

**Impacto:** a revisão pode gastar várias gerações tentando “corrigir” código que estava válido e degradar a resposta.

**Correção:** análise sintática com parser e teste em navegador realmente isolado. Separar “API não suportada pelo verificador” de “defeito demonstrado no código”. Isso deve ocorrer depois da correção de segurança do achado 01.

### 24 — Média: erro de envio pode desaparecer e o rascunho é limpo antes da confirmação

**Local:** `frontend/src/api.ts:126`, `frontend/src/AppShell.tsx:189`, `frontend/src/ChatView.tsx:214`.

`sendMessage` converte exceções em `{ok:false}`, mas `handleSend` ignora o retorno. A UI limpa o rascunho imediatamente. Falhas que aconteçam antes da persistência da mensagem — por exemplo erro de validação, corpo excessivo ou falha de rede — podem deixar o usuário sem texto e sem explicação visível.

**Correção:** verificar o resultado, mostrar erro, preservar/restaurar o rascunho e representar a mensagem otimista com estado enviado/falhou. Tratar também erros de carregar, renomear e excluir, hoje frequentemente deixados como rejeições sem UI.

### 25 — Média: `CODEX_MODEL` é mostrado, mas não é usado ao executar

**Local:** `app/codex.js:12`, `app/codex.js:66`; `.env.example`, `package.json:11`.

`buildProviderConfig` anuncia o modelo configurado; `runCodex` não adiciona esse modelo aos argumentos. O comportamento difere de `runClaude`, que o transmite.

Além disso, o projeto oferece `.env.example`, mas os scripts não carregam um arquivo `.env`. Copiar o exemplo não configura o processo automaticamente; é necessário exportar variáveis no ambiente atual.

**Correção:** encaminhar a seleção de modelo usando a interface suportada do CLI e definir/documentar como o ambiente é carregado. Testar os argumentos enviados com um executável simulado, sem chamadas pagas.

### 26 — Média: a UI declara provedores prontos sem verificar instalação/autenticação

**Local:** `app/codex.js:13`, `app/claude.js:13`, `frontend/src/SettingsView.tsx:47`, `electron/main.js:42`.

Codex e Claude retornam sempre `configured:true`. O startup do Electron verifica somente Codex e pode mostrar aviso de que o chat não funciona mesmo quando Claude/Local são utilizáveis. A verificação também não tem timeout e trata diversos erros como disponibilidade.

**Correção:** diferenciar instalado, autenticado, disponível e indisponível; limitar o tempo das verificações e evitar que um provedor opcional bloqueie a abertura do aplicativo.

### 27 — Média: resposta só é salva depois da extração de memória

**Local:** `app/server.js:187`, `app/server.js:196`.

Embora o comentário descreva salvar a resposta antes da extração, a ordem real é inversa. Para Codex/Claude, a segunda chamada pode levar até 45 segundos, além dos embeddings das memórias criadas. Nesse intervalo a resposta já foi obtida, mas ainda não foi persistida nem mostrada.

**Impacto:** latência extra e perda da resposta já gerada caso o processo encerre durante a extração.

**Correção:** persistir e disponibilizar a resposta primeiro; processar memórias em tarefa acompanhável e atualizar seus metadados depois. Preferir streaming com estados claros.

### 28 — Média: renomear a conversa quebra previews já materializados

**Local:** `app/sandboxCode.js:86`, `app/server.js:640`.

O caminho usa o título atual, que pode mudar. Na reprodução, o arquivo estava acessível antes de renomear e `readSandboxFile` passou a retornar `null` depois. Conversas com o mesmo título também compartilham a pasta, contrariando a separação por conversa anunciada.

**Correção:** identificar a pasta pelo ID imutável, usando o título apenas como informação amigável, ou persistir o caminho do artefato.

### 29 — Média: sincronizar um Atlas agora vazio mantém memórias antigas na tela

**Local:** `frontend/src/NeuralAtlas.tsx:222`.

Quando a API retorna `[]`, o código altera apenas `connected` e o aviso; não executa `setMemories([])`. Se todas as memórias forem removidas por outra aba/processo, sincronizar conserva o grafo antigo.

**Correção:** atualizar a coleção também quando vazia, limpar seleção e impedir respostas de sincronização obsoletas de substituírem dados atuais.

### 30 — Média: respostas inválidas dos provedores podem virar sucesso vazio

**Local:** `app/codex.js:77`, `app/claude.js:17`, `app/claude.js:47`, `app/correction.js:67`, `app/server.js:522`.

Os parsers retornam texto vazio em saída inválida; os wrappers preservam `ok:true` quando o processo encerra com sucesso. `correctLocalAnswer` também retorna sucesso com JSON inválido/sem resposta, e o endpoint grava uma mensagem substituta em vez de indicar falha de correção.

O endpoint de correção não verifica que a conversa é Local nem que a mensagem apontada é uma resposta Local; somente a UI restringe esses casos.

**Correção:** validar estrutura e resultado útil, tratar indicadores de erro do provedor e conferir provedor/papel da mensagem no backend antes de chamar o professor. Relacionar a correção à mensagem original por ID para evitar ambiguidades e métricas incorretas.

## Melhorias recomendadas após estabilizar os bugs

1. **Testes e integração contínua.** Automatizar backend, TypeScript, testes de memória e alguns fluxos reais de UI. Adicionar teste do pacote Electron com dados temporários: iniciar, gerar código, verificar sintaxe, abrir navegador, executar OCR, reiniciar e confirmar persistência. O teste `test/server.test.js:1156` inicia o agente real em background; deve injetar um runner para não tentar download de navegador durante uma suíte comum.
2. **Memória confiável.** Deduplicar extrações com identidade adequada; registrar origem/versão; explicitar como uma correção substitui um fato antigo. Usar um limiar de relevância: hoje os 12 melhores candidatos entram mesmo sem correspondência significativa. Comparar resultados com um conjunto de perguntas conhecido antes de trocar o algoritmo.
3. **Desempenho mensurável.** Medir tempo de geração, seleção de memórias, revisão e extração separadamente. Evitar consultas repetidas a `/version` e `/tags` a cada memória, cachear disponibilidade por curto período e calcular embeddings em fila. Paginar listagens e usar busca SQLite apropriada conforme o volume.
4. **Melhorias do chat.** Streaming, Markdown/código com cópia, rascunho por conversa, opção de repetir envio e edição das instruções do projeto. O backend armazena instruções, mas a UI atual só permite nomear/renomear projetos.
5. **Backup e recuperação.** Exportar/restaurar projetos, conversas e mensagens além das memórias. Oferecer prévia da importação, especialmente quando escopos serão convertidos para global. Avisar explicitamente que excluir projeto também remove memórias de escopo projeto.
6. **Agente de navegador.** Diferenciar tarefa concluída de tarefa bloqueada: o prompt orienta `finish` nos dois casos, mas o loop anuncia sucesso em ambos. Definir limites de ações e confirmações para operações relevantes, respeitar cancelamento antes de executar uma ação e reduzir dependência de correspondência aproximada por OCR quando houver DOM acessível.
7. **Acessibilidade e layout.** Ações de conversa/projeto aparecem somente no hover; disponibilizá-las por foco/teclado e toque. Na versão estreita do Atlas, a barra com importar/exportar/sincronizar é ocultada. Rever textos de 8–10 px, animações do chat sob preferência de movimento reduzido e foco do menu móvel.
8. **Manutenção.** Dividir o servidor em serviços/rotas, introduzir migrações versionadas, reduzir exceções silenciosas e registrar erros sem prompts/dados sensíveis. Remover ou documentar código legado como `frontend/src/history.ts`. Atualizar os roadmaps: embeddings, progresso e lazy loading já existem em parte, apesar de itens antigos ainda descrevê-los como totalmente pendentes.
9. **Métrica de economia.** O percentual atual mede chamadas estimadas evitadas, não tokens nem dinheiro. Rotular assim até persistir usage/custos reais; considerar correções repetidas e diferenças de tamanho entre requisições.

## Ordem sugerida de correção

| Etapa | Foco | Critério de saída |
| --- | --- | --- |
| 1 | Isolamento: 01–03 | Código gerado sem acesso ao processo, ao DOM principal ou à API; mutações da API protegidas |
| 2 | Chat: 04, 05, 11, 12, 24, 27, 30 | Conversas de vários turnos, troca de conversa durante envio e cancelamento funcionam com testes |
| 3 | Desktop/agente: 06–09, 13, 16, 20–23 | Fluxo validado dentro do pacote Electron com OCR real e falhas de instalação controladas |
| 4 | Dados/configuração: 10, 14, 15, 17–19, 25, 26, 28, 29 | Importação preserva identidade/relações; gravações consistentes; estados da UI correspondem aos dados |
| 5 | Produto e desempenho | Medições de latência, backup, acessibilidade, busca e melhorias de UX |

## Evidências adicionais e limites

Scripts de reprodução ficaram em diretório temporário separado:

`C:\Users\lucas\AppData\Local\Temp\harness-audit-dff4f67b448d499c9c460545db8fc540`

- `probes.mjs`: VM, orçamento de contexto, ausência de histórico, validação, embeddings, tags de modelo, download truncado, concorrência, cancelamento, rename de preview e HTTP.
- `browser-probes.mjs`: isolamento do iframe, troca de conversa durante resposta, modelo personalizado, importação e reconexão SSE, usando a UI compilada e respostas controladas.
- `lifecycle-probes.mjs`: reutilização incorreta de contexto Chromium fechado.
- `spawn-probe.mjs`: erro de inicialização do Ollama em processo descartável; encerra com código 1 intencionalmente para demonstrar a falha não tratada.

Não foram validados nesta auditoria: autenticação e qualidade das respostas de Codex/Claude/Ollama reais; download/instalação completos do Ollama; OCR completo com download dos idiomas; auto-update e instalador Electron da versão 0.1.12. Os achados específicos de empacotamento foram identificados por revisão estática e documentação oficial e precisam de smoke test do pacote ao serem corrigidos.

Os problemas descritos são defeitos no código e nos cenários testados. A auditoria não demonstrou comprometimento prévio da máquina nem perda já ocorrida nos dados pessoais do usuário.
