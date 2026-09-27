# Usar Aurora Presence no Quest

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
