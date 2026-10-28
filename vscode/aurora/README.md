# Aurora no VS Code

A Aurora do seu PC dentro do VS Code (e do Cursor ou do Windsurf). Ela usa o mesmo modelo local, as memórias, as ferramentas e o professor do Harness Aurora, com a **pasta aberta como pasta do projeto**. Nada sai do computador.

## Painel da Aurora (✦ na barra lateral)

O chat próprio da Aurora. Não precisa do Copilot.

- **O texto aparece enquanto ela escreve**, com os passos (lendo, editando, rodando) e a ordem de serviço.
- **Autorizações** com Permitir, Sempre ou Negar, no próprio painel.
- **Arquivos que ela mudou** aparecem clicáveis, com três botões:
  - **Revisar no editor**: cada trecho com Aceitar ou Recusar;
  - **Ver diferenças**;
  - **Desfazer**.
- **O comprovante:**
  - cada número da resposta fica marcado; ao passar o mouse, aparecem a planilha, a célula e a linha de onde ele veio;
  - **se a planilha mudar depois**, o número antigo aparece riscado, com o novo ao lado, e um botão refaz a resposta.
- **Contexto em chips:** o arquivo aberto, a seleção, os problemas e o último comando que falhou no terminal. Clique num chip para tirar ou pôr.
- **Histórico** das conversas da pasta (clique no título).
- **Quem responde nas conversas novas:** Local, Codex ou Claude.
- Os blocos de código têm **Copiar** e **Inserir no editor**, que mostra o diff para aceitar.

Comandos com `/`:

| Comando | O que faz |
| --- | --- |
| `/explicar` | Explica o trecho selecionado (ou o arquivo aberto), sem mudar nada |
| `/corrigir` | Corrige os erros do painel **Problemas**, do **terminal** ou o que você disser |
| `/testes` | Escreve testes para o arquivo aberto, grava ao lado e roda |
| `/revisar` | Revisa as mudanças ainda não commitadas (`git diff`) |
| `/nova` | Começa uma conversa nova |

## Ctrl+I: editar no código

1. Selecione um trecho, aperte **Ctrl+I** e diga o que mudar: "trate lista vazia", "adicione tipos", "renomeie para camelCase".
   - Sem seleção, ela escreve no lugar do cursor.
2. A mudança aparece no próprio arquivo: as linhas antigas riscadas em vermelho e as novas em verde.
3. Decida:
   - **✓ Aceitar** ou **✗ Recusar** em cada trecho;
   - **Ctrl+Enter** aceita tudo;
   - **Ctrl+Shift+Backspace** recusa tudo;
   - salvar o arquivo aceita o que faltar.

Também aparece no botão direito ("Aurora: Editar aqui") e na lâmpada de um trecho selecionado.

## Autocompletar

Quando você para de digitar, aparece uma sugestão em cinza, feita pelo modelo local; **Tab** aceita.
- Ela nunca roda em `.env`, chaves ou certificados.
- Liga e desliga no painel, na barra de status ou em `aurora.autocomplete`.

## Erro no terminal

- Quando um comando falha no terminal integrado, a barra de status mostra **Corrigir com a Aurora**.
- O comando e o fim da saída vão junto com o pedido.
- Para isso, o terminal precisa da integração de shell do VS Code, que já vem ligada.

## Outros caminhos
- `@aurora` no chat do VS Code (para quem usa o Copilot Chat): os mesmos comandos.
- **Ctrl+Alt+A** abre o painel.
- No botão direito do editor: *Explicar*, *Corrigir*, *Escrever testes*.
- Na lâmpada de um erro: **Corrigir com a Aurora**.
- Na aba de controle de versão: *Revisar minhas mudanças*.

## Instalação

No Harness Aurora, vá em **Configurações → Editor de código → Instalar**. O Harness instala a extensão no VS Code, no Cursor ou no Windsurf que encontrar, e mostra quando há uma versão nova.

Requisitos:
- o Harness Aurora instalado neste computador. Se ele estiver fechado, a extensão o abre sozinha;
- VS Code 1.95 ou mais novo.

## Configurações

| Configuração | Padrão | O que faz |
| --- | --- | --- |
| `aurora.provider` | `local` | Quem responde nas conversas novas |
| `aurora.chatLocation` | `panel` | Onde os comandos abrem a conversa: o painel da Aurora ou o chat do VS Code (`@aurora`) |
| `aurora.autocomplete` | `true` | Sugestões em cinza do modelo local |
| `aurora.autocompleteDelayMs` | `350` | Pausa antes de sugerir |
| `aurora.ctrlI` | `true` | Ctrl+I abre a edição da Aurora |
| `aurora.autoStartHarness` | `true` | Abrir o Harness sozinho quando ele estiver fechado |
| `aurora.startHarnessWithVsCode` | `false` | Abrir o Harness junto com o VS Code |
| `aurora.useWorkspaceProject` | `true` | A pasta aberta vira a pasta do projeto no Harness |
| `aurora.openChangedFiles` | `true` | Abre o primeiro arquivo que ela mudou, com as diferenças |
| `aurora.harnessUrl` | `http://127.0.0.1:8787` | Endereço do Harness (só endereços locais) |
| `aurora.harnessPath` | (vazio) | Caminho do `Harness Aurora.exe`, quando não está no lugar de sempre |
