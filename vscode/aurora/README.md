# Aurora no VS Code

A Aurora do seu PC no chat do VS Code. Escreva `@aurora` no painel de chat (ao lado do Copilot) e peça como no Harness: ela usa o mesmo modelo local, as memórias, as ferramentas e o professor, com a **pasta aberta no VS Code como pasta do projeto**. Nada sai do computador.

## Comandos no chat

| Comando | O que faz |
| --- | --- |
| `@aurora /explicar` | Explica o trecho selecionado (ou o arquivo aberto), sem mudar nada |
| `@aurora /corrigir` | Corrige os erros do painel **Problemas** (ou o trecho selecionado, ou o que você disser) |
| `@aurora /testes` | Escreve testes para o arquivo aberto, grava ao lado e roda |
| `@aurora /revisar` | Revisa as mudanças ainda não commitadas (`git diff`): bugs, riscos e o que falta |
| `@aurora /nova` | Começa uma conversa nova |

Ou só peça: `@aurora crie uma API de tarefas na pasta api`, `@aurora faça um site sobre receitas`.

## O que vai junto com o pedido
- o arquivo aberto e a seleção (com as linhas);
- os erros e avisos do painel Problemas do arquivo (de todo o projeto no `/corrigir`);
- os arquivos anexados com `#`;
- o `git diff` no `/revisar`.

## Enquanto ela trabalha
- cada passo aparece no chat (lendo, editando, rodando um comando), e o texto dela aparece enquanto escreve;
- quando ela pede autorização (rodar um comando, gravar fora da pasta), aparecem **Permitir** e **Negar**.

## Quando ela termina
- a lista dos arquivos **criados** e **editados**, clicáveis;
- **Ver diferenças**: o antes e depois de cada arquivo editado, no diff do VS Code (o primeiro abre sozinho);
- **Desfazer estas mudanças**: os editados voltam como estavam e os criados são apagados (o que você mudou depois fica). O mesmo Desfazer aparece na conversa no Harness.

## Atalhos
- **Ctrl+Alt+A** abre o chat com `@aurora`;
- botão direito no editor: *Explicar este código*, *Corrigir os problemas*, *Escrever testes*;
- a lâmpada de um erro: **Corrigir com a Aurora**;
- na aba de controle de versão: *Revisar minhas mudanças*;
- na barra de status: ✦ Aurora ligada, girando quando ela trabalha, ⊘ quando o Harness está fechado (clique para conversar).

## Requisitos
- O Harness Aurora aberto neste computador (a extensão fala só com `http://127.0.0.1:8787`).
- VS Code 1.95 ou mais novo, com o painel de chat.

## Configurações

| Configuração | Padrão | O que faz |
| --- | --- | --- |
| `aurora.harnessUrl` | `http://127.0.0.1:8787` | Endereço do Harness (só endereços locais) |
| `aurora.provider` | `local` | Quem responde nas conversas novas: o modelo local, ou Codex/Claude |
| `aurora.useWorkspaceProject` | `true` | A pasta aberta vira a pasta do projeto no Harness |
| `aurora.openChangedFiles` | `true` | Abre o primeiro arquivo que ela mudou (com as diferenças) |
| `aurora.harnessPath` | (vazio) | Caminho do `Harness Aurora.exe`, para o botão Abrir o Harness |
