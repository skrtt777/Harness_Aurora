# Aurora 0.5.0 — encaixe do visor e Wi-Fi

## Usar o encaixe

Palma esquerda → **AJUSTAR HUD**:

- **Tamanho → Largura:** Estreitar/Alargar aproxima ou afasta os grupos das laterais.
- **Tamanho → Altura:** Diminuir/Aumentar aproxima ou afasta as bordas superior e inferior.
- **Posição:** centraliza o conjunto pelos eixos X/Y.
- **Restaurar encaixe:** retorna largura/altura a 100% e posição a zero.

Largura e altura independentes de 70% a 150%, em passos de cinco pontos percentuais. Os grupos nos cantos mudam de posição sem alongar letras/círculos. O painel interativo mantém seu tamanho e localização, permitindo recuperar o visor mesmo após expandi-lo além da área visível. Use a visão dentro do headset como referência: a transmissão para o celular pode ter outro enquadramento.

As quatro preferências ficam em `Saved/aurora-hud-layout.json`. Arquivos da versão anterior conservam X/Y e recebem tamanho padrão de 100%.

## Desenvolvimento sem cabo

A Aurora conversa com o Harness por HTTPS na rede local. ADB por Wi-Fi também está ativado e foi usado para instalar o APK e ler logs sem transferência USB.

`Scripts/Connect-QuestWiFi.ps1` identifica o Quest por USB, obtém seu IPv4, ativa ADB na porta 5555, conecta por Wi-Fi e confere o serial. Após confirmar a conexão, o cabo do PC pode ser retirado e o Quest pode voltar ao carregador. PC e Quest devem compartilhar a rede local.

Nas reconexões, o script tenta o endereço salvo em `%APPDATA%/Harness Aurora XR/quest-wifi.json`. Se o IP mudar ou a depuração Wi-Fi for desativada após reiniciar, pode ser necessário reativar por USB. A instalação aceita `Install-Quest.ps1 -Serial IP:5555`.

Referências: [ADB no Meta Quest](https://developers.meta.com/horizon/documentation/unity/ts-adb/), [ADB por Wi-Fi — Android](https://developer.android.com/tools/adb).

## Validação e pendências

- Builds Win64/Android concluídos: `Saved/FitEditorBuild.log`, `Saved/FitQuestBuild.log`.
- APK 0.5.0 / versionCode 6: 184.886.166 bytes; SHA-256 `C43846F775764CE7B6534C62138F1BF826AFC4CCCAC3C4CA71E60DB6CC42DE35`.
- Prévia `Saved/FitSettings00000.png` inspecionada na Unreal.
- Testes PIE: botões de tamanho independentes de posição, abas, quatro sentidos, limites, reset e restauração de largura 120%, altura 90%, X=2/Y=−1 após reiniciar passaram.
- Script de Wi-Fi passou na validação sintática PowerShell. ADB não listou aparelhos e mDNS não encontrou depuração sem fio ativa.
- **APK 0.5.0 instalado por Wi-Fi com Success**, usando explicitamente o transporte `192.168.0.61:5555`. O Package Manager confirmou versionCode 6 / versionName 0.5.0.
- `Saved/FitDevice-wifi.log`: conexão autenticada com o Harness e localização da âncora após instalar. Logs e captura `Saved/FitQuest-wifi.png` transferidos pela mesma conexão sem fio.
- O cabo pode ser retirado do PC. A conferência de conforto e ajuste manual às bordas depende do usuário vestindo o headset.
