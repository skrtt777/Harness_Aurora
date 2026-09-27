# AuroraXR

Base de desenvolvimento XR da Aurora, criada a partir do template Virtual Reality instalado da Unreal Engine 5.8.

**Versao MR / Quest 3:** painel animado com lista de opcoes, controle por pinca
e passthrough OpenXR. Veja [configuracao, gestos e limites](Docs/QUEST3-MR.md).

## Abrir
Abra AuroraXR.uproject na Unreal Engine 5.8. O projeto agora inclui modulos C++;
em outra maquina, compile AuroraXREditor em Development antes de abrir.
Mapa inicial MR: /Game/Aurora/Maps/L_AuroraMR.
Sala VR anterior: /Game/Aurora/Maps/L_AuroraWorkspace.
O mapa original do template permanece em /Game/XRFramework/Levels/L_XRTemplate.
A inicializacao automatica em VR esta desabilitada para permitir abrir no desktop.
Para testar em headset, configure o runtime OpenXR do dispositivo e use VR Preview.

## Estado inicial
- Sala Aurora com paineis de conversa, memoria e controles, materiais proprios e mesa com cubos interativos do template.
- Paineis sao sinalizacao de prototipo; ainda nao sao interfaces clicaveis nem exibem dados reais.
- Iluminacao propria dinamica e copias de meshes sem Nanite para o renderer forward VR.
- Gerador da cena: Scripts/build_workspace.py, executado no editor; recusa sobrescrever um mapa existente.
- Assets oficiais copiados de XRFramework, XRMannequins, VRSpectator, Weapons e LevelPrototyping.
- Configuracoes de renderizacao e Enhanced Input preservadas do template instalado.
- OpenXR, rastreamento de maos e olhos habilitados conforme o template; disponibilidade depende do hardware.
- Python e Editor Scripting habilitados para automacao do editor.
- Execucao remota Python restrita ao loopback local, TTL 0.
- Targets: Windows para preview e Android/Quest 3 para a experiencia MR. A validacao fisica no headset e uma etapa separada do build.
- Ainda nao existe conexao com o backend/chat/memoria do Harness Aurora.

## Organizacao
Content/XRFramework e os demais pacotes sao a base original da Epic.
Conteudo proprio da Aurora deve ficar em Content/Aurora.
Binaries, Intermediate, Saved e DerivedDataCache ficam fora do Git.
Os assets .uasset/.umap devem permanecer versionados; caches nao substituem esses arquivos.

## Proximos passos
1. Definir o headset e o alvo: PC VR, standalone ou AR/passthrough.
2. Construir a sala Aurora e os paineis de interacao.
3. Conectar a interface XR a API existente, com estados de conexao e erro.
4. Validar interacoes e desempenho no headset.

Os assets copiados seguem os termos da Unreal Engine/Epic aplicaveis ao template.
