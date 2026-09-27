# Validação do protótipo MR — 26/09/2026

- Unreal 5.8.3: build AuroraXREditor Win64 Development concluído.
- Android ARM64 / ASTC: BuildCookRun completo, cook, stage, package e archive concluídos com ExitCode 0.
- APK atual: versão 0.1.2, versionCode 2, `Saved/Builds/Quest3/Android_ASTC/AuroraXR-arm64.apk`, 184.520.318 bytes.
- SHA-256: `2F6309D86B7BC4BBC18CB778C2F9D1BF1DB05EADFF073F5A18D873A90148634B`.
- Manifest conferido com aapt: pacote `com.aurora.xr`, label Aurora MR, ARM64, SDK mínimo 32 e target 36; features handtracking e passthrough presentes.
- Pak conferido: `Config/Android/AndroidGame.ini` incluído para inicializar em VR no Quest.
- Teste `Aurora.MR.PinchTrackingAndHysteresis`: passou, incluindo perda de tracking e necessidade de abrir os dedos antes de rearmar.
- Teste `Aurora.MR.OpenHandHoldDoesNotToggle`: passou, cobrindo gesto curto, confirmação temporal, acionamento único, perda/recuperação de tracking e rearme deliberado. Relatório dos dois testes em `Saved/Automation-v2/index.json`.
- Smoke test de estado do menu em PIE: as quatro opções selecionadas e retorno à lista passaram. Relatório local em `Saved/MRValidation.json`.
- Aparência do menu revisada por screenshot do editor. A execução em desktop utiliza mouse e não comprova hand tracking físico.
- Runtime Meta/Oculus 1.208.0 carregado com `XR_RUNTIME_JSON` apenas no processo da Unreal; extensão `XR_FB_passthrough` disponível e solicitada. O registro global continuou apontando para Virtual Desktop.

## Pendente de validação física

Após reativar o modo desenvolvedor, o ADB reconheceu o dispositivo como **Quest 3S**
(panther), autorizado. A instalação via `adb install -r` concluiu com Success e
a atividade `com.aurora.xr/com.epicgames.unreal.GameActivity` foi iniciada.

Os logs do dispositivo confirmaram `Passthrough underlay created`, carregamento
de `L_AuroraMR` e uso de `AuroraMRGameMode`, sem erro fatal na inicialização.
Evidência local em `Saved/QuestDeviceValidation.log`.

O usuário confirmou que o painel aparecia na versão inicial, mas relatou que
aparecia e sumia. Na versão 0.1.2, a pinça esquerda que alternava a visibilidade
foi substituída por mão aberta sustentada: o gesto só abre/reposiciona; fechar
exige selecionar o botão no painel. A atualização foi instalada e iniciada no Quest 3S.
A confirmação física do novo gesto está pendente. Estabilidade prolongada e frame time não foram medidos.
