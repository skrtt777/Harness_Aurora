# Aurora Presence — execução

## Direção corrigida — Harness original e MoE no armazenamento

- [x] Identificar o executor e os pesos exatos do experimento MoE do repositório.
- [x] Remover o caminho alternativo de conversa Quest do servidor principal.
- [x] Compilar o executor original com adaptações Android ARM64.
- [x] Separar os pesos do APK e compartilhar configuração entre Java/Node.
- [x] Verificar regressão do Harness: 277 testes passaram, 8 ignorados.
- [ ] Concluir e verificar o download dos pesos de 18,6 GB.
- [ ] Testar inferência MoE no Quest com medição de RAM, armazenamento e temperatura.
- [ ] Identificar transcrição, contexto e resposta do caso de horário/oração.
- [ ] Validar qualidade e repetição em dez turnos e com MR ativo.
- [ ] Instalar a versão validada preservando banco e professores existentes.

Detalhes em [QUEST_MOE_PORT.md](../../../docs/QUEST_MOE_PORT.md).
As otimizações da versão densa abaixo são históricas, não validação da proposta MoE.

## Atualização 0.7.1 — otimização e Pocket TTS

- [x] Filtrar contexto de conversa do Quest; manter papéis e histórico em ordem, sem respostas órfãs.
- [x] Preservar memórias relevantes, exigir contexto inteiro para requisitos e validar tokens de prompts grandes.
- [x] Testar regressão: 277 passaram, 8 ignorados, nenhuma falha.
- [x] Compilar e instalar 0.7.1 por Wi-Fi; manter 95 memórias e correções.
- [x] Comparar pergunta no aparelho: 28,977 s → 3,519 s, com correção do resultado matemático. Formato estrito ainda falha.
- [x] Integrar Kyutai Pocket TTS português/Alba ao fluxo de voz no PC: 2,375 s contra 13,953 s na mesma frase com Qwen.
- [x] Testar WAV, transcrição e chamada pelo nome via TLS usando a voz Pocket.
- [ ] Avaliar a voz com o headset vestido, medir latência/temperatura junto do MR e ampliar avaliação de qualidade.
- [ ] Portar Pocket TTS para Android e validar voz inteiramente no Quest.

Detalhes e limites em OTIMIZACAO-QUEST.md. As seções seguintes são histórico.

## Atualização 0.7 — Harness original embarcado

- [x] Empacotar Node/SQLite e backend original no sandbox Android; modelo local via llama.cpp.
- [x] Importar cópia íntegra do banco: 1 projeto, 8 conversas e 90 memórias, sem alterar o banco do PC.
- [x] Consultar Claude e Codex pelo mecanismo original para revisar a arquitetura do porte.
- [x] Preservar correção e memórias dos professores, com relay autenticado para as CLIs do PC.
- [x] Instalar APK 0.7.0 (código 8) por Wi-Fi e gerar resposta local na instalação final.
- [x] Validar revisão Claude desde o Quest e gravação de três memórias no banco embarcado.
- [x] Validar revisão Codex desde o Quest e consultar novamente as duas memórias criadas.
- [x] Refazer menu pelas quatro capturas de referência; conferir captura estereoscópica no Quest.
- [ ] Melhorar qualidade e latência do modelo pequeno: teste final levou 70,967 s e exigiu correção do professor.
- [ ] Portar voz, reconhecimento do nome e OCR para funcionamento sem PC.
- [ ] Validar conforto, seleção manual e temperatura em uso prolongado com o headset vestido.

Evidências e limites em PORTE-HARNESS-QUEST.md. As seções seguintes preservam o histórico.

## Atualização 0.6 — direção SAO corrigida
- [x] Menu transparente com ícones circulares, navegação lateral, seleção âmbar e animação.
- [x] Remover toda HUD fixa; ajustes X/Y e tamanho passam ao menu flutuante.
- [x] Implementar chamada por nome, pausa persistente, suspensão por foco e descarte de fala não endereçada.
- [x] Testar filtragem com texto e áudio, autenticação e ausência de diário para detecção.
- [x] Substituir a voz por Qwen3-TTS na GPU, conferir síntese/transcrição e medir latência.
- [x] Compilar e instalar 0.6.0 via ADB Wi-Fi; conexão autenticada e microfone confirmados no log do Quest.
- [ ] Avaliação do usuário: transparência no ambiente, conforto dos menus, chamada com a própria voz e naturalidade do novo timbre.

Detalhes atuais em INTERFACE-SAO.md. As seções abaixo preservam o histórico das seis frentes.

Conceito aprovado pelo usuário em 26/09/2026. Execução autorizada dos seis objetivos; escolhas de preferência ficam para o final. Estados só são concluídos com evidência. Documento de conceito: CONCEITO-AURORA-PRESENCE.md.

## 1. Conectar Quest e Harness — conexão validada
- [x] Preparar script de ativação/reconexão ADB Wi-Fi com conferência de serial.
- [x] Ativar ADB Wi-Fi e testar instalação, leitura de versão, logs e captura pelo transporte sem fio.
- [x] Criar ponte XR versionada sem expor a sessão local do Harness.
- [x] Implementar TLS, pareamento temporário, identidade e revogação por dispositivo.
- [x] Reutilizar a instância e os dados reais do Harness em execução.
- [x] Implementar cliente no aplicativo e configuração de conexão.
- [x] Validar consulta real pelo Quest e recusa de cliente não autenticado.
- [x] Compilar integração espacial nativa OpenXR com Unreal 5.8.3; câmera validada no aparelho. Restauração física de âncora é acompanhada no objetivo 5.

## 2. Conversas reais
- [x] Implementar listagem, retomada e criação de conversas no contexto selecionado.
- [x] Enviar mensagem com identificação única e resultado recuperável.
- [x] Implementar progresso real, cancelamento e recuperação por identificador, com teste de deduplicação e estado incerto após reinício da ponte.
- [x] Conferir continuidade da conversa na interface do PC (Playwright contra o Harness instalado).

## 3. Voz e presença
- [x] Atualização 0.4.0: substituir SAPI pela voz neural local Kokoro/pf_dora; testar síntese, transcrição e prévia pelo cliente Unreal.
- [x] Capturar microfone com indicação explícita de escuta; captura do Quest chegou ao serviço de transcrição.
- [x] Transcrever português e sintetizar resposta com motor validado no PC (Whisper base / Microsoft Maria).
- [x] Implementar alternância entre escuta/reprodução, interrupção e encerramento ao recolher painel; não enviar transcrição cancelada.
- [x] Construir núcleo visual, anéis, animação de entrada e estados da Aurora; captura revisada no Quest.
- [ ] Validar conversa falada no aparelho físico.

## 4. Painel e manipulação espacial
- [x] Atualização 0.5.0 compilada: largura/altura independentes, abas Tamanho/Posição e persistência testadas em PIE.
- [x] Instalar 0.5.0 por Wi-Fi; Quest confirmou a versão e conectou ao Harness.
- [ ] Conferir conforto e encaixe manual às bordas com o headset vestido.
- [x] Atualização 0.4.0: controles X/Y com prévia, limites, restauração e persistência; botões e reinício testados em PIE, APK instalado no Quest.
- [x] Implementar visor periférico inspirado na perspectiva de capacete: centro transparente, entrada animada e estados reais do Harness, voz e mãos.
- [x] Separar visor passivo do painel espacial interativo; manter gesto de chamada e oferecer modo reduzido com preferência persistida.
- [ ] Validar nitidez, amplitude do visor e conforto em sessão prolongada no aparelho vestido (VISOR-AURORA.md).
- [x] Substituir opções demonstrativas por ações reais.
- [x] Apresentar cartão de conteúdo paginado e listas reais; legibilidade final depende de uso com o headset vestido.
- [x] Implementar selecionar, arrastar, reposicionar e recolher o painel/cartão de conteúdo.
- [x] Preservar visibilidade durante perda de tracking (testes de gesto passaram).
- [ ] Validar mãos e conforto no headset.

## 5. Projetos, memórias e persistência espacial
- [x] Implementar listagem de projetos/memórias e consulta das referências reais da resposta.
- [x] Salvar decisão no mesmo Harness; memória criada pelo Quest conferida por ID e conteúdo no PC.
- [x] Implementar consulta de artefatos de texto da conversa; comando de voz “mostre os arquivos”.
- [x] Separar posições/âncoras dos registros de conhecimento (UUID no Quest, dados no Harness).
- [x] Restaurar posição somente após localização válida; âncora salva e localizada novamente após reiniciar o aplicativo.
- [x] Conferir IDs e conteúdo entre PC e Quest.

## 6. Visão e validação integrada
- [x] Implementar captura explícita de imagem do ambiente com permissão de câmera; operação observe completada no Quest.
- [ ] Validar leitura de uma anotação e envio do texto com sua origem ao Harness.
- [x] Distinguir leitura OCR de reconhecimento geral de objetos. Nenhum reconhecimento geral foi declarado pronto.
- [ ] Testar falhas, cancelamento, reconexão e restauração espacial.
- [x] Compilar e instalar APK integrado; testar os percursos automatizados de conversa, memória, câmera e âncora no Quest.
- [ ] Executar percurso completo com o usuário usando voz e mãos, sem comandos de diagnóstico.
- [x] Medir amostra inicial no Quest 3S: aproximadamente 72 FPS de jogo; GPU e estabilidade prolongada ainda não aferidas.
- [x] Registrar evidências, limitações e escolhas finais pendentes em VALIDATION-PRESENCE.md.

## Decisões adotadas
- Preservar o backend desktop e sua autenticação local; ponte separada com lista restrita de operações.
- Dados e provedores permanecem no PC; headset é cliente nativo.
- Respostas completas com progresso real inicialmente; sem streaming fictício.
- Nenhuma opção é declarada pronta apenas por existir na interface.

## Evidências e pendências
- Bloqueio do Quest resolvido após o usuário ligar o aparelho: visor completo/reduzido conferido em capturas estéreo com passthrough e conexão ativos. Modo completo restaurado. Amostra: 72,01 FPS de jogo; GPU não medida. Conforto e interação humana continuam pendentes.
- Atualização visual 0.3.0 instalada (versionCode 4): visor de capacete e modo reduzido. Builds Win64/Android e dois testes de gesto passaram; layout, botão e persistência entre sessões conferidos em PIE. Revisão binocular aguarda o botão físico solicitado pelo próprio Quest para reativar câmeras/microfones. Ver VALIDATION-VISOR.md.
- APK 0.2.0 instalado no Quest 3S; cliente confirmou TLS com verificação de certificado habilitada.
- Teste real no Quest completou conversation → message → speak e captura → observe.
- Saved/PresenceIntegration.json: teste com Harness instalado, síntese local e transcrição pt-BR.
- Saved/PresenceOCR.json: leitura correta de anotação sintética; isso não substitui o teste de legibilidade de uma anotação física.
- Regressão: 266 testes, 258 aprovados, 8 ignorados, zero falhas; tmp/xr-regression.log.
- Unreal: 2 testes de gesto aprovados; Saved/PresenceAutomation/index.json.
- Projeto Aurora Presence e memória do conceito aprovado criados no Harness real.
- Inicialização do microfone corrigida e captura validada no Quest. Âncora criada/salva/localizada novamente após reinício.
- Saved/PresenceDesktopValidation.json confirma mensagem do Quest visível no desktop e memória idêntica.
- Saved/PresencePerformance.json: 1024 amostras, média 13,887 ms, p95 14,707 ms, estimativa 72,01 FPS de jogo; GPU não medida.
- Todos os seis objetivos possuem implementação nesta versão. Os itens abertos são testes de uso físico e de falhas completos, não declarações de prontidão já comprovadas.
