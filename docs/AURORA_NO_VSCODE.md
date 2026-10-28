# A Aurora no VS Code (extensão 0.3)

A extensão 0.2 era só o `@aurora` dentro do chat do VS Code, e por isso dependia do Copilot Chat. A 0.3, de 27/10, tem quatro peças novas, todas pelo Harness deste computador. Nada sai do PC.

## O que tem

| Peça | Onde | Arquivo |
|---|---|---|
| **Painel próprio** | ✦ na barra lateral | `vscode/aurora/lib/panel.js`, `media/panel.js`, `media/panel.css`, `media/markdown.js` |
| **Ctrl+I com revisão no arquivo** | editor, botão direito, lâmpada | `vscode/aurora/lib/review.js`, `lib/diff.js` |
| **Autocompletar local** | editor (Tab aceita) | `vscode/aurora/lib/completion.js` → `app/codeAssist.js` |
| **Terminal como contexto** | barra de status, chip do painel, `/corrigir` | `vscode/aurora/lib/terminal.js` |
| **Abre o Harness sozinho** | ao pedir algo com o Harness fechado | `vscode/aurora/lib/workspace.js` |
| **Instalar pelo Harness** | Configurações → Editor de código | `app/vscodeExtension.js`, `frontend/src/VscodePanel.tsx`, `scripts/pack-vscode.mjs` |

- **Painel:**
  - mostra a resposta enquanto ela escreve, os passos, a ordem de serviço e as autorizações (Permitir, Sempre ou Negar);
  - para os arquivos alterados, oferece Revisar no editor, Ver diferenças e Desfazer;
  - traz o **comprovante** em cada número, com o cartão da célula de origem, e a **resposta viva**: se a planilha mudou depois, o número aparece riscado com o novo ao lado, e um botão refaz a resposta;
  - o contexto vai em chips que dá para desligar: arquivo, seleção, problemas e terminal;
  - tem o histórico da pasta, a escolha de quem responde nas conversas novas e os comandos `/`;
  - nos blocos de código, "Inserir no editor" passa pela mesma revisão.
- **Ctrl+I:**
  - as linhas antigas aparecem riscadas em vermelho, acima das novas em verde, com ✓ Aceitar e ✗ Recusar em cada trecho, mais Aceitar tudo (Ctrl+Enter) e Recusar tudo (Ctrl+Shift+Backspace);
  - nada é apagado se as linhas não forem mais exatamente as que a revisão pôs;
  - salvar o arquivo aceita o que faltar;
  - "Revisar no editor" usa a mesma revisão para os arquivos que uma resposta do chat mudou, comparados com a cópia de antes.
- **Autocompletar:**
  - é FIM (preencher o meio) no modelo que já está carregado: o llama-server do agente quando ele está de pé, senão o Ollama;
  - espera 350 ms de pausa e cancela na próxima tecla;
  - reaproveita a sugestão enquanto a pessoa digita o que ela diz;
  - nunca roda em `.env`, chaves e certificados.
- **API nova do Harness:** `POST /api/code/complete`, `POST /api/code/edit`, `GET /api/vscode` e `POST /api/vscode/install`.

## Medições (27/10, qwen3.5:4b, RTX local)

- **FIM** (`scripts/fim-bench.mjs`, 12 casos em JS, Python, TS, Java e C++):

  | Caminho | Certas | Mediana |
  |---|---|---|
  | Ollama raw | 11 de 12 | 477 ms |
  | llama-server `/completion` | 10 de 12 | 434 ms |
  | llama-server `/infill` | 10 de 12 | 393 ms |

  Empate técnico. O erro comum é o Python `total = ` virar `sum += valor`, um limite do modelo de 4B. Por isso fica o modelo que já está carregado, sem carregar um segundo.
- **Ponta a ponta** num VS Code de teste (`scripts/vscode-ext-e2e.mjs`): **15 de 15**.
  - Ctrl+I: a revisão aparece em cerca de 4 s; Aceitar tudo e Recusar tudo funcionam, e o resto do arquivo não muda.
  - Autocompletar: 3,6 s com o modelo frio, 0,3 s depois do chat.
  - Painel: a resposta e o texto parcial chegam, e o arquivo aberto vai junto.
  - Revisar no editor: aceitar um trecho e recusar outro, e o arquivo é salvo.
  - Terminal: o comando que falhou é guardado com a saída.
- **Capturas** (`scripts/smoke/vscode-shot.mjs`): painel com a resposta viva, cartão do número, revisão do Ctrl+I e sugestão em cinza.

## Ajustes que as capturas pediram

- A sugestão depois de `const total = ` vinha com um `}` a mais, porque o modelo fechava o bloco que já existe. Agora:
  - com código antes do cursor e a primeira linha completa, a sugestão fica numa linha só;
  - fechamentos que repetem o que vem depois saem.
- Com o cursor depois de `return 0;`, a sugestão era emendada na mesma linha. Agora a quebra de linha do modelo fica.
- O modelo às vezes acrescenta um `module.exports` no Ctrl+I. A instrução agora proíbe exports, imports e exemplos. Se acontecer mesmo assim, o trecho aparece separado e dá para recusar.

## Como testar

```
node --test test/vscode-aurora.test.js test/vscode-aurora-0.3.test.js
node scripts/vscode-ext-e2e.mjs        # VS Code de teste + Harness de teste + modelo local
node scripts/smoke/vscode-shot.mjs     # capturas
node scripts/fim-bench.mjs             # qualidade e tempo do autocompletar
node scripts/pack-vscode.mjs           # vscode/dist/aurora-harness.vsix (o npm run dist já faz)
```

Todos usam um perfil temporário do VS Code e um banco temporário do Harness. Nenhum mexe no VS Code, nos projetos ou no Harness da pessoa. A tela "Editor de código" só lista as extensões; instalar ou atualizar depende do clique.
