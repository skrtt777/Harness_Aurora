# Aurora Presence 0.2.0 — validação de desenvolvimento

Registro histórico da integração 0.2.0. O APK mais recente e a validação do visor 0.3.0 estão em VALIDATION-VISOR.md; o arquivo do APK no diretório de builds foi atualizado.

Data: 26/09/2026. Aparelho identificado pelo ADB: Quest 3S. Engine: Unreal 5.8.3. Pacote: com.aurora.xr, versionCode 3.

## Pacote entregue

- APK: `Saved/Builds/Quest3/Android_ASTC/AuroraXR-arm64.apk`.
- Tamanho: 184.861.394 bytes.
- SHA-256: `44D504FCC7A8B9038E2440E7739A4DEA885090799C6BEACA0F77873194789FE4`.
- Build Editor Win64 e BuildCookRun Android ARM64 ASTC concluídos com sucesso.
- Última instalação: adb install -r retornou Success; aplicativo iniciado no aparelho.
- Última correção: gesto de chamar desativa o seguimento da âncora anterior antes de reposicionar, evitando que o painel volte à posição antiga no quadro seguinte. Após instalar, conexão TLS e localização da âncora foram confirmadas novamente em `Saved/PresenceDevice-final.log`.
- A compilação é Development; diagnóstico por arquivo provisionado via USB está excluído em builds Shipping.

## Evidência obtida

| Área | Verificação | Evidência |
|---|---|---|
| TLS e identidade | Quest autenticado na ponte; bVerifyPeer=true | Logs do aparelho; mensagens “Aurora XR authenticated connection ready” |
| Segurança da ponte | Cliente sem token recusado, origem web recusada, pareamento de uso único, cinco tentativas, revogação | `test/xr-bridge.test.js`, 5 testes aprovados |
| Continuidade | Mesmo requestId não repete gravação; IDs conflitantes recusados; pendência após reinício torna-se incerta | Testes da ponte; journal persistente |
| Conversa real | Native Quest concluiu conversation → message → speak | `Saved/PresenceDevice-first.log` |
| Desktop | Mensagem enviada pelo Quest visível na interface do Harness instalado | `Saved/PresenceDesktopValidation.json` e captura local `PresenceDesktop.png` |
| Memória | Quest concluiu gravação; mesmo ID e conteúdo recuperados do Harness | `Saved/PresenceDesktopValidation.json` |
| Voz do PC | Microsoft Maria produziu WAV pt-BR e Whisper transcreveu corretamente a frase controlada | `Saved/PresenceIntegration.json` |
| Microfone do Quest | Captura nativa iniciada e WAV encaminhado ao serviço, operação transcribe completa | `Saved/PresenceDevice-voice.log`; gravação curta de diagnóstico, sem alegar qualidade da voz humana |
| Câmera | Camera2 obteve imagem; observe → message → speak completou no dispositivo | `Saved/PresenceDevice-first.log` |
| OCR controlado | Texto “Projeto Aurora: testar realidade mista.” reconhecido corretamente em imagem sintética | `Saved/PresenceOCR.json`; repetido com cache privado |
| Âncoras | Criação, gravação local e localização; recuperação após reinício do aplicativo | `Saved/PresenceDevice-voice.log` e `Saved/PresenceDevice-restored.log` |
| Aparência | Núcleo/anéis e painel com resposta real revisados em captura estéreo do aparelho | `Saved/PresenceQuest.png`; não substitui avaliação de conforto |
| Gestos | Hold deliberado, rearme, histerese, perda de tracking | `Saved/PresenceAutomation/index.json`, 2 testes aprovados |
| Regressão Harness | 266 testes: 258 aprovados, 8 ignorados, 0 falhas | `tmp/xr-regression.log` |

## Desempenho

Amostra de 1024 intervalos de frames do aplicativo no Quest: média 13,887 ms, p95 14,707 ms, estimativa 72,01 FPS. Amostra posterior manteve média 13,887 ms, p95 14,358 ms (`Saved/PresencePerformance-final.json`). São intervalos de jogo medidos por relógio monotônico; não são medição de GPU nem garantia de ausência de reprojeção. A última correção do gesto não foi submetida a uma nova sessão prolongada. Relatório inicial: `Saved/PresencePerformance.json`.

## Escopo efetivo

- Conexão à instância instalada do Harness, usando o mesmo banco e provedores. A API desktop continua em loopback.
- Ponte HTTPS com credenciais por dispositivo; chave privada e journal em `%APPDATA%/Harness Aurora XR`.
- Transcrição local Whisper base e síntese local Microsoft Maria. Conversas usam o provedor configurado no Harness; provedores remotos podem utilizar internet.
- Projeto Aurora Presence e memória com o conceito aprovado criados no Harness.
- Um painel/cartão paginado reposicionável, presença geométrica animada e âncora local nativa OpenXR.
- Visão inicial por captura explícita e OCR. Sem reconhecimento geral de objetos e sem MRUK/segmentação de mesas e paredes.
- Atalho **Aurora Presence - PC** na área de trabalho. Uso: PRESENCE-USO.md.

## Pendências que não foram declaradas concluídas

1. Conversa natural com voz humana no headset vestido, incluindo interrupção e qualidade da transcrição em português no ambiente real.
2. Precisão/conforto de seleção e arraste com mãos em diferentes distâncias e iluminações.
3. Leitura controlada de uma anotação física: captura real foi validada; acurácia da anotação foi verificada em imagem sintética.
4. Ensaio completo de desconexão durante inferência, cancelamento durante fala/captura e recuperação em uso físico. A lógica e a deduplicação possuem testes; o ensaio completo no usuário não foi realizado.
5. Sessão física de pelo menos 15 minutos, frame time de GPU, conforto e relocalização após mover o headset pelo cômodo.
6. Coleção de cartões independentes, detecção automática de superfícies, revisão avançada/workflows no Quest e reconhecimento geral de objetos são evoluções além desta primeira interface integrada.

Nenhuma decisão de preferência do usuário foi necessária para concluir esta implementação inicial. Os itens acima requerem validação física ou evolução adicional, não uma confirmação genérica de permissão.
