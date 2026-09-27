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

### 1. Disponibilidade por recurso (27/09/2026)
- **O quê:** estado separado para conversa local, voz, chamada por nome, OCR e professores.
- **Por quê:** mostrar corretamente o que funciona quando o PC está indisponível.
- **Formato esperado:** estado por recurso (`disponível`, `indisponível`, `verificando`), local de execução (`Quest`/`PC`) e motivo curto. Reaproveitar o contrato existente quando possível.
- **Resposta do Claude:** aceito. Entra depois da paridade do modelo local. O contrato será publicado em "Avisos do backend para o visual".

## Avisos do backend para o visual

Mudanças de API, eventos ou dados que afetam a interface.

### 1. Resposta parcial durante a geração (27/09/2026)
- `GET /conversations/:id/pending` agora retorna `{stage, partial}`. `partial` é o texto gerado até o momento, ou `null`.
- `AuroraHarnessClient` já preenche `Panel->BodyText` com o parcial seguido de " …" a cada consulta (~1 s), sem mudar a página atual. A resposta final substitui esse texto como antes.
- Motivo: no Quest com o MR aberto, um turno leva cerca de 95 s, a maior parte lendo o contexto. Assim que a geração começa, o texto aparece aos poucos.
- Para o visual, opcional: indicar que o texto ainda está sendo gerado, com estilo ou animação, e decidir se a paginação acompanha a última página enquanto o texto cresce.

### 2. Rota PC primeiro (27/09/2026)
- O status do painel agora pode ser: "Procurando o PC…", "Harness / IA no PC", "Harness / IA no Quest" ou "PC indisponível • preparando o Harness no Quest…".
- Ao trocar de rota, a conversa aberta muda, porque cada rota tem o próprio banco. Opcional para o visual: um indicador discreto e permanente de PC ou Quest.
