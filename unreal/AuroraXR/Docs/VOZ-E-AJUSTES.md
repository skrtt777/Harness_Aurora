# Aurora 0.4.0 — voz neural e posição do visor

## Usar no Quest

1. Abra a mão esquerda para chamar o painel.
2. No rodapé, selecione **AJUSTAR HUD** com a pinça direita.
3. **Esquerda/Direita** regulam X; **Descer/Subir** regulam Y. Cada toque altera um grau e o resultado aparece imediatamente no visor.
4. **Restaurar posição** zera X e Y. **Concluir** retorna ao conteúdo anterior.
5. **Ouvir nova voz da Aurora** reproduz uma frase de apresentação sem criar uma conversa nem abrir o microfone. Recolher o painel interrompe a reprodução.

O ajuste muda somente a posição do visor em relação à cabeça. O painel e a âncora espacial permanecem independentes. Limites: X de −10° a +10°, Y de −8° a +8°, para manter o visor recuperável dentro da região de visão prevista. Os valores são salvos no aplicativo deste headset em `Saved/aurora-hud-layout.json`. O modo completo/reduzido continua separado. Não há perfis de pessoas dentro da Aurora nesta versão.

## Nova voz

Motor local **Kokoro-82M**, voz feminina brasileira **pf_dora**, WAV mono PCM16 a 24 kHz. O modelo fica residente no PC para evitar carregamento em cada frase. A síntese não envia o texto para serviços externos. O serviço escuta apenas em 127.0.0.1:8791; o Quest continua usando a ponte autenticada HTTPS.

A voz Microsoft Maria do Windows deixou de ser o motor ativo. Se o serviço neural falhar, a resposta textual continua disponível e o aplicativo informa a indisponibilidade de áudio; não muda silenciosamente para a voz antiga.

Fontes do motor e modelo: [Kokoro ONNX](https://github.com/thewh1teagle/kokoro-onnx), [vozes do Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md). A voz pf_dora é um preset do modelo, sem clonagem de uma voz fornecida pelo usuário.

## Instalação no PC

- O atalho **Aurora Presence - PC** agora inicia também `scripts/xr-tts.py`.
- `scripts/setup-xr-voice.ps1` instala dependências fixadas e baixa os pesos verificando seus hashes SHA-256.
- Pesos fora do repositório: `%APPDATA%/Harness Aurora XR/kokoro` (cerca de 354 MB).
- Dependências adicionadas: kokoro-onnx 0.4.9 e soundfile 0.14.0.
- `scripts/check-xr-voice.mjs` verifica síntese e inteligibilidade por transcrição local. Isso não substitui a avaliação subjetiva do timbre pelo usuário.

## Validação de desenvolvimento

- Builds Win64 e Android ARM64 ASTC concluídos; APK instalado por ADB com Success. Quest confirmou versionCode 5 / versionName 0.4.0.
- APK: `Saved/Builds/Quest3/Android_ASTC/AuroraXR-arm64.apk`, 184.879.162 bytes, SHA-256 `9496D912D4FE554E5E8D474DD4C23B3BE33DD7E5B92445C405CB04AA15595DE3`.
- `Saved/AdjustDevice.log`: autenticação do Quest e localização da âncora confirmadas após instalar.
- `Saved/HUDAdjustmentValidation.json`: teste dos botões reais em PIE, quatro direções, limites, reset, JSON salvo e restauração X=2/Y=3 após reiniciar. Posição do PC restaurada a zero no final.
- `Saved/HUDAdjustment00000.png`: interface de ajustes inspecionada na Unreal.
- `Saved/NeuralVoiceValidation.json`: frase sintetizada em 1131 ms, áudio de 314.412 bytes e transcrição correta em português. Amostra: `Saved/NeuralVoiceSample.wav`.
- Botão de prévia executado pelo cliente Unreal em PIE; operação speak concluída pela ponte e resultado identificado como engine=kokoro-82m, voice=pf_dora, local=true. Log `Saved/AdjustPreview.log`.
- Oito testes direcionados passaram: cinco de segurança/recuperação da ponte e três de validação/falha da nova síntese.
- Ainda depende de uso físico: preferência pelo timbre, conforto dos deslocamentos, seleção por mãos e restauração das preferências após reiniciar o Quest. A restauração já foi testada em PIE; não foi apresentada como teste humano no headset.
