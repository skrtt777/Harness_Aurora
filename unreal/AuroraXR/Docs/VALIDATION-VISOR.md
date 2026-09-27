# Visor Aurora 0.3.0 — validação

Registro da versão 0.3.0. A versão 0.4.0, instalada posteriormente, acrescenta voz neural e posição X/Y; pacote e testes atuais estão em VOZ-E-AJUSTES.md.

Data local: 26/09/2026. Unreal 5.8.3. Quest 3S, pacote com.aurora.xr.

## Compilação e instalação

- Editor Win64: compilação concluída, `Saved/HelmetEditorBuild.log`.
- Android ARM64 ASTC: build, cook e empacotamento concluídos, `Saved/HelmetQuestBuild.log`.
- `adb install -r`: Success. Package Manager confirmou versionCode 4 e versionName 0.3.0.
- APK: `Saved/Builds/Quest3/Android_ASTC/AuroraXR-arm64.apk`, 184.869.526 bytes.
- SHA-256: `38D6F9A16C65C8CF475418F984C1B9920EBE04AC3C07DC15B991DF00BBEF4EB5`.

## Verificação realizada

- Dois testes de gestos existentes passaram, zero falhas: `Saved/HelmetAutomation/index.json`.
- Prévia real do widget na Unreal, em PIE: visor completo e reduzido capturados e inspecionados. Centro livre, elementos nas bordas e estado de conexão real visível.
- Capturas locais: `Saved/HelmetDesktop00001.png` e `Saved/HelmetMinimal00000.png`. Fundo preto é a prévia desktop sem passthrough; não representa o ambiente no Quest.
- Troca de modo acionada pela área real do botão do painel; escrita da preferência conferida.
- Reinício de PIE restaurou o modo reduzido; nova seleção retornou ao completo. Relatório: `Saved/HelmetUIValidation.json`. Preferência do PC deixada em completo.

## Revisão no Quest — bloqueio resolvido

Após a instalação, o Quest estava em repouso. Ao acordá-lo por ADB, o sistema mostrou “Pressione o botão liga/desliga para habilitar as câmeras e os microfones”. A captura `Saved/HelmetQuest.png` registra essa tela do sistema, não o visor da Aurora. A atividade da Aurora ficou suspensa atrás da interface do sistema. Foi solicitada a ação física ao usuário.

Após o usuário ligar o Quest, a captura estéreo `Saved/HelmetQuest-awake.png` confirmou o visor completo nos dois olhos, centro transparente, passthrough ativo, Harness conectado e estados das mãos. `Saved/HelmetQuest-minimal.png` confirmou o modo reduzido. A troca foi acionada pelo diagnóstico de desenvolvimento, não por uma pinça humana. O botão real já havia sido verificado em PIE.

O arquivo de preferência no Quest e `Saved/HelmetDevice-awake.log` confirmaram minimal → full. Aplicativo deixado em modo completo. O log também confirma autenticação e localização da âncora. As capturas do ambiente permanecem locais, fora do Git.

`Saved/HelmetPerformance.json`: 1024 amostras, média 13,887 ms, p95 14,163 ms, estimativa 72,01 FPS de jogo; GPU não medida. A captura não comprova conforto nem nitidez percebida com o headset vestido. Os testes anteriores de backend e hardware continuam históricos em VALIDATION-PRESENCE.md.

## Próxima conferência física

1. Concluído: câmeras/microfones reativados e Aurora MR aberta.
2. Conferir se o visor acompanha a visão com centro livre e textos legíveis nos dois olhos.
3. Chamar o painel com a palma esquerda e alternar completo/reduzido pela pinça direita.
4. Conferir o indicador real do microfone ao usar Falar e Parar, além da atualização do projeto escolhido.
5. Reabrir o aplicativo e conferir preferência do visor e âncora do painel; avaliar conforto em sessão prolongada.
