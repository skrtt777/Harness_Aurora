# Aurora — menus espaciais

## Versão atual 0.7

Layout reconstruído pelas quatro capturas do usuário: ficha transparente à esquerda, coluna circular central e listas à direita, com seleção dourada. A figura da ficha é uma ilustração, não rastreamento corporal. A esfera decorativa foi removida. A captura `Saved/Standalone/QuestFinal.png` confirma o layout na instalação final do Quest. Professores Claude/Codex e revisão da resposta estão nos menus Projetos/Ajustes. O fechamento deixa o ambiente livre de HUD fixa. Consulte PORTE-HARNESS-QUEST.md para a nova arquitetura.

## Histórico 0.6

Direção solicitada: menus inspirados em Sword Art Online, integrados ao ambiente real. Correção posterior do usuário: menu transparente, nenhuma HUD fixa, chamada pelo nome e voz melhor. A identidade Aurora e os dados reais do Harness permanecem.

## Layout implementado

- Coluna de cinco botões circulares com ícones vetoriais: Conversar, Memórias, Projetos, Ambiente e Ajustes.
- Cartão transparente separado da coluna, seleção laranja e abertura animada. Fundo principal com alfa 0,22, superfícies de entrada com alfa 0,12, texto branco com sombra para leitura no ambiente. A tela inicial apresenta quatro entradas com descrições; a coluna permite trocar diretamente de seção.
- Conteúdo paginado, ações de voz, cancelamento, memória, posicionamento, leitura do ambiente e nova conversa.
- Nenhum elemento fixo na cabeça: HUD passiva removida. Fechar o menu oculta também a presença visual.
- Presença da Aurora menor, com cores branca e âmbar.
- Ajustes persistentes de largura, altura, eixo X, eixo Y e restauração aplicados ao menu, além da prévia da voz neural.
- Chamada por nome enquanto o app está em primeiro plano no Quest. Trechos com voz seguem via TLS ao Whisper local no PC; somente frases iniciadas por Aurora (ou Oi/Olá/Ei Aurora) ativam. Nenhum trecho dessa detecção é gravado no diário de operações ou enviado ao modelo de conversa sem ativação. O detector não é um modelo de palavra-chave executado no Quest: depende do PC e da rede.
- Botão inferior pausa/reativa a chamada por nome, com preferência persistente. Microfone é suspenso durante respostas e quando o app perde foco. Falar manualmente continua disponível.

## Uso no Quest

Diga “Aurora” e aguarde a resposta, ou “Aurora, abra o menu”. A palma esquerda também chama o menu; solte antes de repetir. Selecione com a pinça direita. O quinto botão circular abre os ajustes. O botão × recolhe e cancela a conversa em curso, mantendo a chamada por nome disponível se habilitada. A perda de rastreamento não fecha o painel.

## Validação

Compilação Win64 e testes em PIE: navegação das quatro categorias, ajustes de largura/altura, deslocamento X/Y e restauração. Capturas da direção corrigida em Saved/TransparentMenu*.png e Saved/ClearView*.png. Capturas SAOHome/SAOFinal representam a etapa anterior à correção do usuário. Dez testes Node passaram, incluindo autenticação e ausência de persistência da detecção. Teste de áudio sintetizado reconheceu a chamada e rejeitou a fala não endereçada; relatório Saved/WakeAudioValidation.json.

Voz substituída por Qwen3-TTS 1.7B VoiceDesign na GPU, com direção de voz feminina adulta e português brasileiro. Referência: https://github.com/QwenLM/Qwen3-TTS . Testes em Saved/QwenVoiceValidation.json: 2,36 segundos de áudio preparados em 5,7 segundos; 6,68 segundos preparados em 10 segundos. Transcrição conferiu as frases completas. A saudação é pré-gerada e reutilizada: chamada direta ao serviço respondeu em 23 ms após aquecimento, sem contar detecção, rede ou reprodução no Quest. Respostas faladas limitadas a aproximadamente 320 caracteres; texto completo preservado no menu. Naturalidade e sotaque ainda dependem de avaliação auditiva do usuário.

Instalação final via 192.168.0.61:5555 confirmada: versionName 0.6.0 / versionCode 7. Saved/SAOQuestTransparent.png mostra o ambiente real através dos cartões. Saved/EmptyView00000.png confirma ausência de HUD com menu fechado no editor.

O teste TLS completo com a voz nova expôs uma confusão entre Aurora e Agora no Whisper base. O reconhecedor passou para Whisper small; a repetição passou: “Aurora, abra o menu” ativou e “Estou aqui. Pode falar” não ativou. Não foi acrescentada a palavra Agora à lista de ativação. Resultado em Saved/WakeTLSValidation.json. O motor de voz permanece Qwen; nenhuma voz de fallback foi aplicada.

Os testes de coordenadas no editor não validam conforto estereoscópico ou precisão da pinça na mão do usuário. Esses pontos exigem experimentar a versão no headset.
