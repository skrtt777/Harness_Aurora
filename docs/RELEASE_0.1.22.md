# Aurora 0.1.22 — Auditoria de UI/UX e atualização diagnosticável

## Correções

- **Avaliador de contratos** (`app/functionalTests.js`): `assertNumber`/`assertText` liam `innerText()`, que é sempre vazio em `<input>`/`<textarea>` — qualquer resposta com campo de saída somente-leitura reprovava indevidamente. Passou a usar `.inputValue()` para esses elementos.
- **Catálogo de skills**: a busca (aba "Skills e regras") mostrava as 98 mil entradas cruas do índice da Hermes por padrão, incluindo muitas fora do português/inglês e sem relação com programação. Agora mostra por padrão só as fontes curadas (~2.100), com opção explícita de ver tudo.
- **Atualização automática**: a checagem rodava uma vez no início e qualquer falha era descartada em silêncio, sem log nem aviso. Agora o estado (verificando/atualizado/baixando/pronto/erro) fica visível na aba Configurações, com botão para checar e instalar manualmente.

## Interface

Resultado de uma auditoria completa do aplicativo:

- Logo trocado (gradiente cromado → marca plana em SVG).
- Ícones da barra lateral e da Memória unificados (fim da mistura de emoji com símbolos unicode).
- Memória, Atlas 3D, Teste, Agente do navegador e Skills promovidos para fora do menu "Ferramentas" recolhido — sempre visíveis.
- Conteúdo do chat limitado a uma coluna de 900px (antes esticava borda a borda em telas largas); Configurações e Agente do navegador centralizados.
- Skills usadas em cada resposta do modelo local agora aparecem como marcadores na própria mensagem.
- Atlas 3D (bundle de ~950KB) agora carrega sob demanda, não em toda conversa.

## Verificação

Suíte completa: 252/252 testes do aplicativo e 6/6 da memória visual aprovados. Build de produção (`tsc -b && vite build`) sem erros. Teste do aplicativo empacotado (`scripts/smoke-electron.mjs`) aprovado, incluindo persistência após reinício.

```powershell
npm ci
npm --prefix frontend ci
npm run check
npm run frontend:build
npm test
npm run test:memory
npm run dist
node scripts/smoke-electron.mjs "release/win-unpacked/Harness Aurora.exe"
```

## Instalação e atualização

Baixe `Harness-Aurora-Setup-0.1.22.exe` na release e execute o instalador, ou atualize pelo próprio aplicativo (Configurações → Atualizações). Conversas e memórias permanecem em `%APPDATA%\Harness Aurora\`.

O instalador não possui assinatura digital de editor; o Windows pode exibir um aviso ao executá-lo. Confira os hashes em `SHA256SUMS.txt`, publicado junto ao instalador.

## Limites conhecidos

- O ciclo completo de baixar/instalar do novo fluxo de atualização não foi verificado ponta a ponta contra um release real mais novo antes desta publicação — só o comportamento de checagem/estado e a ausência fora do Electron.
- Os 3 itens de maior escopo da auditoria de UI (tema claro, telemetria de latência, modo Comparação entre provedores) ficaram fora desta versão — cada um precisa de uma rodada de design própria.
