# Coordenação Claude × Codex

Divisão definida pelo usuário em 27/09/2026. O Claude orquestra: executa o backend e aciona o Codex por `codex exec`, numa sessão dedicada ao visual.

## Escopos

**Codex: visual e layout**
- `unreal/AuroraXR/Content/Aurora/**`: materiais, meshes, mapas e widgets
- Menus, painéis, animações, posição, tamanho e transparência da UI, conforto visual
- Apresentação em `AuroraMRPanel`, `AuroraHelmetHUD` e `AuroraMRPawn`
- `frontend/**`: aparência, CSS, componentes e UX
- Pode compilar e instalar o APK para testar o visual com o `aurora-runtime.zip` existente. Não roda `bundle-quest-runtime.py` nem `prepare-quest-*`.

**Claude: todo o backend**
- `app/**`, `scripts/**`, `test/**` (exceto os testes de UI do frontend) e `package.json`
- `AuroraRuntime.java`, `AuroraHarnessClient.*`, `*_UPL.xml`, `ThirdParty/QuestRuntime/**`, `Saved/MoePort/**` e `Saved/Standalone/harness/**`
- Modelo local, llama.cpp, contexto, memórias, embeddings, voz/TTS, ponte XR e empacotamento

Ninguém reverte o trabalho do outro. Commits de backend ficam com o Claude.

## Pedidos do visual para o backend

Formato: data, o quê, por quê e o formato esperado. O Claude responde logo abaixo de cada pedido.

_(nenhum ainda)_

## Avisos do backend para o visual

Mudanças de API, eventos ou dados que afetam a interface.

_(nenhum ainda)_
