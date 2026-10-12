# Usar Aurora Presence no Quest

## Bancada criativa — primeiro experimento, 10/10/2026

Esta revisão implementa o percurso referência → revisão → decisão persistida
no projeto do PC. É uma primeira fatia técnica da direção Aurora Bancada, com
foco em ideias e projetos criativos e entrada pelo Telegram. Ainda não é uma
bancada que reconhece automaticamente a mesa nem um conjunto de cartões
independentes no ambiente. As seções seguintes preservam o histórico do HUD.

### Estado da instalação e validação

- Código do backend, adaptador Telegram, interface desktop e cliente Quest
  implementado no checkout. O Harness desktop instalado e a ponte habitual
  ainda não foram atualizados com estas rotas.
- Prévia desktop em banco temporário, sem conta Telegram e sem invocar modelos.
  Seleção de imagem e gravação de decisão conferidas no navegador.
- APK compilado e instalado no Quest 3S. A prévia usa ponte HTTPS separada,
  projeto identificado como **TESTE ISOLADO** e cópia de segurança privada da
  configuração anterior. Microfone e chamada por nome ficam desativados nesta
  prévia. Não houve envio de mensagens reais pelo Telegram nesta validação.
- 15 testes de bancada/Telegram/ponte e 86 de servidor/Atlas passaram. Cinco
  testes Unreal passaram; renderização do widget conferida no PC. Builds do
  frontend, editor Windows e APK Android concluídos.
- Conferência física concluída para este percurso: o usuário confirmou abertura
  e legibilidade; a referência de imagem apareceu no passthrough do Quest. Uma
  decisão confirmada no aparelho apareceu na interface desktop e na API do PC,
  com uma memória de mesmo conteúdo e uma referência vinculada. Não foi usado
  o comando de diagnóstico para confirmar essa decisão.
- O aviso inicial do sistema sobre câmeras/microfone foi superado durante a
  sessão. Ao encerrar, a configuração e a sessão anteriores do Quest foram
  restauradas e os dois servidores isolados foram parados.
- Conforto prolongado, voz, reconexão física e o Telegram real continuam sem
  validação nesta revisão. A amostra do log de frames não mede a latência total
  nem constitui avaliação de estabilidade em uso prolongado.

Evidências locais, fora do controle de versão: `Saved/BenchNodeTests.log`,
`BenchRegression.log`, `BenchFrontendBuild.log`, `BenchUnrealTests.log`,
`BenchQuestBuild.log`, `BenchQuestPreview.png` e `BenchQuestHardware.png`.
`Saved/BenchHardwareValidation.json` registra IDs e conferência da memória;
`Saved/BenchHardwareLog.txt` contém as amostras de conexão e frames.
A captura final mostra o desktop com o resultado visto através do passthrough;
a referência na interface MR também foi conferida em captura durante a sessão.
Capturas do ambiente são locais e não devem ser publicadas automaticamente.

### Uso após atualizar também o desktop e a ponte

1. No Telegram já pareado, envie `/bancada` e escolha com `/bancada nome exato`
   ou `/bancada ID`. Fotos e documentos passam a ser referências desse projeto;
   `/referencia sua ideia` guarda texto. Mensagens comuns continuam na conversa
   do celular. `/bancada sair` desativa a captura para o projeto.
2. No projeto do PC, abra **Bancada**. Escolha até três referências, escreva uma
   decisão e confirme. O resultado fica na bancada e nas memórias do projeto.
3. No Quest conectado ao PC, escolha o projeto e abra **Bancada**. Navegue pelas
   referências. Diga **registrar decisão**, seguido da ideia, ou use **Revisar
   resposta** para preparar a última resposta da conversa. Leia o conteúdo e
   use **Confirmar decisão**. Esta versão vincula uma referência por decisão
   no Quest. A revisão de voz depende dos serviços de voz da instalação normal;
   ela não foi validada nesta prévia isolada.
4. Só a confirmação positiva do PC representa uma decisão salva. Se a resposta
   se perder, repita a confirmação: o pedido conserva seu identificador. Uma
   revisão desatualizada exige conferir o conteúdo antes de confirmar de novo.

### Contrato e limites deste experimento

O PC é a fonte de verdade; decisões e memórias são gravadas na mesma transação
SQLite. As rotas autenticadas de bancada reaproveitam servidor e ponte XR.
Identificadores de operação persistidos evitam duplicação, inclusive após
reabrir o banco; revisão numérica detecta alteração concorrente. Arquivos são
copiados para `bench-assets` junto ao banco e recebem hash; snapshots públicos
não revelam caminhos locais. JPEG/PNG podem ter prévia de até 640 px; outros
arquivos aparecem por título/nota, sem leitor de documentos no Quest.

A consulta usa atualização periódica de três segundos. O Quest suspende a
atualização durante a revisão de uma decisão. Uma confirmação pendente fica
em arquivo local no Quest ou localStorage no desktop. Isso não é uma fila
geral offline: rascunhos ainda não confirmados não sobrevivem garantidamente
ao encerramento, e as imagens não têm cache persistente no headset.

Com pareamento de PC presente, perder a rede não muda silenciosamente para o
banco independente do Quest. A rota local anterior continua disponível para
instalações sem configuração de PC; não há sincronização dos dois bancos.

A prévia pode ser reproduzida com `scripts/bench-preview.mjs` (backend temporário
em 8792) e `scripts/bench-quest-preview.mjs` (ponte TLS em 8793, usando o
certificado já instalado). O segundo script é específico deste Quest. Ao
encerrar, executar `node scripts/bench-quest-preview.mjs --restore` antes de
parar a ponte de prévia. O backup privado fica no perfil Windows e não deve ser
adicionado ao repositório. Retomar a conexão antiga não atualiza o desktop.

## HUD holográfico e contornos — 10/10/2026

Os painéis têm preenchimento translúcido (28%) e cantos ciano; os controles
mantêm fundo e sombra no texto. Abra a palma esquerda e selecione **Contornos**
no canto inferior direito para alternar o destaque de arestas do passthrough.
O efeito começa desligado em cada sessão e pode permanecer ligado com o menu
recolhido. O indicador muda após a confirmação da API, não ao clicar.

É um filtro nativo de bordas da imagem real (`XrPassthroughStyleFB.edgeColor`),
não reconhecimento semântico, segmentação de objetos ou malha do ambiente.
Não cria caixas falsas nem identifica nomes. A identificação seletiva de
objetos permanece uma etapa futura. Este efeito não lê nem envia frames ao PC;
a ação separada Ler ambiente mantém seu fluxo de captura existente.

Referência: https://registry.khronos.org/OpenXR/specs/1.0/man/html/XrPassthroughStyleFB.html
Build e testes desta revisão: `Saved/HologramBuild.log`, `Saved/HologramTests.log`.
O usuário confirmou abertura por palma e legibilidade da revisão anterior;
a transparência e os contornos desta revisão ainda precisam de avaliação no Quest.

## Interface espacial — 10/10/2026

O menu agora coloca a conversa no centro, com presença azul/violeta à esquerda
 e navegação inferior: Chat, Projetos, Memórias, Entregas e Ajustes. Falar e Parar
 permanecem no painel central; ações complementares ficam à direita, sem duplicar
 os controles principais. A presença 3D permanece visível com o menu recolhido.

Os indicadores usam os estados reais de conexão, escuta, resposta falada e
 operação pendente. O rótulo identifica PC conectado, execução no Quest ou falta
 de conexão. Entregas consulta os artefatos da conversa; não há arquivos fictícios
 nem porcentagens simuladas. O leitor de artefatos continua sendo textual.

A geometria usa painéis arredondados, paleta ciano/violeta e texto mais largo.
 Os ajustes de tamanho e posição e o pareamento existentes são preservados.

Validação: build Windows/Android em `Saved/PresenceRedesignBuild.log`, testes de
 interação em `Saved/PresenceRedesignTests.log`, renderização do widget em
 `Saved/PresenceRenderTests.log`. As imagens `Saved/PresenceHome.png`,
 `PresenceSettings.png` e `PresenceConversation.png` são prévias renderizadas
 com dados de teste identificados, não capturas da visão do usuário.

A prévia do jogo no Windows apresentou falha no renderizador Slate/RHI; a
 conferência visual foi feita pelo renderizador de widgets do editor. Conforto,
 escala e estabilidade com o Quest vestido exigem a conferência no aparelho.

## Atualização de 10/10/2026 — Quest como interface do PC

O Quest 3S conectado usa a ponte autenticada para a Aurora do PC. Mantenha o
Harness desktop aberto e execute `Scripts/Start-Presence.ps1`. O modelo local
configurado no PC, `qwen3.5:4b`, foi instalado e a integração de conversa,
síntese de voz e transcrição passou em `Saved/PresenceIntegration.json`.

- **Falar / Enviar fala** e **Parar** ficam no rodapé do painel central em todas
  as categorias, inclusive na tela inicial e nos ajustes.
- Abra a palma esquerda para trazer o menu. Aponte com a mão direita e junte
  polegar e indicador para selecionar; abra os dedos antes do próximo toque.
- Durante a escuta, diga **parar conversa**, **repita a resposta** ou
  **comandos de voz**. Também são aceitos “Aurora, pare!” e “como usar”.
- Parar interrompe a conversa e descarta uma mensagem ainda aguardando criação
  de conversa. A chamada por nome permanece ativa se estiver habilitada nos
  ajustes. Durante reprodução de áudio, use o botão Parar: ainda não há
  interrupção por voz simultânea à fala da Aurora.

Build Android/Win64: `Saved/VoiceControlsQuestBuild.log`. Quatro testes Unreal
passaram em `Saved/VoiceControlsTests.log`, incluindo comandos completos,
controles nas categorias e proteção contra perda de rastreamento. Instalação
por USB concluída preservando dados. Conforto e captura da voz do usuário ainda
dependem de conferência com o headset vestido.

## Histórico

**Atualização instalada 0.7.1:** contexto de conversa otimizado no Quest e voz Kyutai Pocket TTS em português, executada na CPU do PC. A voz nova substitui Qwen no iniciador padrão. Nos testes pontuais, a mesma conta caiu de 29 para 3,5 s; isso não garante o tempo de todas as respostas. Consulte [resultados e limitações](OTIMIZACAO-QUEST.md).

**Base 0.7.0:** o backend original do Harness, o modelo de texto, as conversas e as memórias executam no Quest. O menu transparente segue as quatro referências fornecidas: ficha à esquerda, ícones circulares ao centro e opções à direita, sem HUD fixa. Abra a palma esquerda para chamar e use a pinça direita para selecionar. A engrenagem ajusta tamanho e posição. Em Projetos/Ajustes, escolha Claude ou Codex e peça a revisão da última resposta. Veja [o porte e suas limitações](PORTE-HARNESS-QUEST.md).

Esta é uma versão de desenvolvimento. Voz Pocket TTS, reconhecimento do nome “Aurora”, OCR e professores ainda dependem do PC ligado na mesma rede. A geração local usa um modelo pequeno, com qualidade limitada. “Retomar contexto” permite pedir uma resposta pelo menu. O banco importado evolui separadamente no Quest; não há sincronização automática de volta ao PC.

## Histórico e instruções das versões anteriores

As notas abaixo descrevem as versões 0.3–0.6 e sua arquitetura dependente do PC; o resumo acima e PORTE-HARNESS-QUEST.md descrevem a instalação atual.

**Atualização 0.5.0 instalada por Wi-Fi:** AJUSTAR HUD possui abas **Tamanho** (largura/altura independentes) e **Posição** (X/Y). ADB sem fio foi ativado e testado; o cabo de dados pode ser retirado. Veja ENCAIXE-E-WIFI.md.

**Versão 0.4.0:** no rodapé do painel, **AJUSTAR HUD** abre os controles X/Y, **Restaurar posição** e **Ouvir nova voz da Aurora**. Os ajustes são salvos automaticamente neste headset. A voz ativa agora é Kokoro neural / pf_dora em português brasileiro, executada localmente no PC. Detalhes e evidências em VOZ-E-AJUSTES.md.

Na versão 0.3.0, o aplicativo abre com um visor transparente inspirado em capacete: informações nas bordas e ambiente livre no centro. O painel completo aparece pelo gesto da palma esquerda. No rodapé do painel, **VISOR: COMPLETO / REDUZIDO** alterna a quantidade de informações e salva sua preferência. Recolher o painel mantém o visor e fecha o microfone. Os indicadores de mãos não controlam a visibilidade da interface.

1. No PC, execute o atalho **Aurora Presence - PC**. Ele abre o Harness instalado se necessário e inicia a ponte HTTPS e o serviço de transcrição, sem janelas de terminal.
2. Mantenha PC e Quest na mesma rede local. Abra **Aurora MR** nos aplicativos de fontes desconhecidas do Quest.
3. Mostre a palma esquerda por aproximadamente um segundo para trazer a Aurora à sua frente. Esse gesto tem prioridade sobre a posição restaurada; a posição persistida só muda ao fixar novamente. Use a pinça direita para selecionar.
4. Em **Conversar**, escolha uma conversa existente ou **Nova conversa**. Em **Projetos**, escolha **Aurora Presence** para usar o conceito aprovado.
5. Toque **Falar** para iniciar a sessão por voz. Faça uma pausa ao terminar a frase. Após a resposta, a escuta pode reabrir; o indicador mostra quando o microfone está ativo. **Parar** encerra a escuta e interrompe a fala/resposta. Sem fala detectada, a escuta encerra após 10 segundos.
6. **Guardar decisão** salva a última resposta no projeto selecionado, ou na conversa quando nenhum projeto estiver selecionado. O aplicativo confirma o resultado do Harness.
7. **Posicionar** permite mover o painel com uma pinça sustentada. Ao soltar, o aplicativo tenta criar uma âncora local. A restauração depende de o Quest conseguir localizar essa âncora; reposicione se ela não for localizada.
8. **Ler ambiente** captura um quadro da câmera para OCR no PC. É uma leitura de texto, não reconhecimento geral de objetos. A imagem não é gravada pela ponte. A transcrição pode ser enviada ao provedor da conversa; confira qual provedor está configurado no Harness.

Comandos de voz implementados: **“Abra o projeto Aurora Presence”**, **“Mostre as memórias usadas”**, **“De onde veio essa informação?”**, **“Guarde esta decisão”**, **“Mostre os arquivos”**, **“Leia esta anotação”** e **“Nova conversa”**. Pedidos livres são enviados à conversa atual. A correspondência de nomes de projetos ainda é simples; quando não houver uma identificação única, escolha pela lista.

## Conexão e dados

- Endpoint desta instalação: HTTPS na rede local, porta 8788. Nunca desabilitar validação TLS para resolver erro de conexão.
- Pareamento inicial provisionado por USB autorizado. Credenciais ficam em arquivo privado do perfil Windows e na área do aplicativo no Quest; não fazem parte do APK.
- Se o endereço do PC mudar, atualize certificado/configuração e reprovisione o Quest pelos scripts do repositório.
- `scripts/setup-xr.ps1`: certificado público para o aplicativo e chave privada no perfil do usuário.
- `scripts/start-xr.ps1`: inicia ponte e voz. Requer Harness desktop na porta local 8787.
- `scripts/pair-xr.mjs`: consome o código temporário de pareamento e envia configuração pelo ADB. A janela abre por dois minutos ao iniciar a ponte.
- `.venv-xr`: ambiente Python isolado; faster-whisper 1.2.1, modelo base local em int8.
- Voz: Kokoro-82M / pf_dora pt-BR, serviço local na porta 8791. Instalação reproduzível por `scripts/setup-xr-voice.ps1`.
- A API oferece revogação da própria identidade via DELETE autenticado `/xr/v1/device`.

## Limites atuais

- Um painel/cartão de conteúdo reposicionável; não há coleção de cartões independentes espalhados pelo cômodo.
- Posicionamento manual e âncora nativa OpenXR; MRUK e detecção automática de mesas/paredes ainda não foram integrados.
- Artefatos são exibidos como texto; aplicativos HTML não são executados no Quest.
- Sem mapa GPS, avatar humano, compartilhamento entre usuários ou IA completa no headset.
- Toda conclusão de testes e pendência física fica registrada em TODO-PRESENCE.md e VALIDATION-PRESENCE.md.
