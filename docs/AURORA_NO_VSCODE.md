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

## Noite de 27→28/10: meta de 97% de acerto

**Como medimos.** `scripts/code-bench.mjs` executa o que a Aurora escreve e roda um teste de comportamento: a função editada faz o que foi pedido e continua fazendo o que fazia. São quatro conjuntos:

| Conjunto | Ctrl+I | Sugestões | Para que serve |
|---|---|---|---|
| ajuste (`code-bench-cases.mjs`) | 24 | 30 | usado para ajustar |
| 1ª validação (`code-bench-holdout.mjs`) | 20 | 24 | escrito depois do primeiro ajuste |
| 2ª validação (`code-bench-holdout2.mjs`) | 16 | 20 | escrito depois das dicas |
| 3ª validação (`code-bench-holdout3.mjs`) | 16 | 20 | escrito antes de medir as últimas correções; é a medida honesta |

Os cenários de uso no VS Code isolado ficam em `scripts/vscode-scenarios.mjs`: são 13, rodados a partir do `.vsix`.

**Resultado (duas rodadas por conjunto):**

| | Padrão (4B + coder 1,5B) | Forte (Qwen3-Coder 30B-A3B) |
|---|---|---|
| Ajuste | 98,1% | **100%** |
| 1ª validação | 94,3% | 92,0% |
| 2ª validação | 87,5% | **98,6%** |
| 3ª validação | 76,4% (Ctrl+I 47%) | **97,2%** (Ctrl+I 100%) |
| VS Code (13 cenários) | 13/13 | 13/13 |
| **Total** | — | **343/353 = 97,2%** |

O Ctrl+I do Padrão (o 4B do chat) não aguenta as tarefas difíceis da 3ª validação. O Forte acertou 100% do Ctrl+I nas duas últimas validações. As falhas que sobram no Forte são sugestões em casos ambíguos, como um `return null` quando o teste esperava texto, ou uma barra de progresso com colchetes.

**O que mudou para chegar lá:**
- **Ctrl+I:**
  - a seleção é ampliada até o bloco inteiro (`lib/blocks.js`);
  - a resposta tem as chaves equilibradas com a seleção e perde as linhas copiadas de depois dela;
  - a sintaxe é conferida (`node --check`, `ast.parse`), assim como nomes indefinidos novos (eslint-scope em JS, `ast` em Python), sempre sem executar o código; se algo falhar, há nova tentativa com o erro;
  - uma resposta igual à seleção é refeita;
  - o modelo escreve um plano curto antes do código, e o próprio modelo dá uma segunda olhada;
  - imports necessários podem ir dentro do trecho.
- **Sugestões:**
  - FIM no coder 1,5B (Padrão) ou no 30B (Forte);
  - as chaves são equilibradas por tipo, olhando o arquivo inteiro;
  - a linha cortada pelo limite sai, e a sugestão para quando volta a um recuo menor que o da linha do cursor;
  - um bloco de várias linhas vira uma linha só quando há texto depois do cursor;
  - até 3 candidatos, validados pela sintaxe.
- **Idiomas brasileiros** (`app/codeHints.js`): reais, acentos/slug, idade, CEP, CPF/CNPJ (como código), datas sem UTC, telefone, `\p{L}` no lugar de `\w`.
- **Segurança:** `/explicar` e `/revisar` não recebem as ferramentas que só escrevem, e o `git diff` vai sem os prefixos `a/` `b/`. Antes, o 4B gravava `b\calc.js`.

**O que foi medido e não ficou:**
- o modo de pensar no Ctrl+I: 46% de acerto e 26 s;
- um "exemplo de entrada → saída" no plano: a 1ª validação caiu para 80%.

**O perfil Forte na prática.** Com o modelo carregado, o Ctrl+I leva cerca de 2 s. A primeira carga vem do disco. Num HD mecânico, com 32 GB de RAM e o modelo do chat aberto, ela levou alguns minutos. Por isso o Ctrl+I nunca espera o modelo forte: enquanto ele carrega, quem responde é o modelo do chat. Num SSD, a carga leva cerca de 35 s.

**Regressão do Harness** (por causa da mudança no `chatTurn.js`): a Empresa caiu de 98% para 92% na pasta principal. Um A/B limpo, 8 rodadas em worktrees, deu 96,4% para o código anterior e 95,6% para o atual: é ruído do modelo. A regressão completa será refeita antes do lançamento.
