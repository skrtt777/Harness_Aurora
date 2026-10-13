# Aurora no VS Code

A Aurora do seu PC no chat do VS Code. Escreva `@aurora` no painel de chat (ao lado do Copilot) e peça como no Harness: ela usa o mesmo modelo local, as memórias, as ferramentas e o professor, com a **pasta aberta no VS Code como pasta do projeto**.

- O arquivo aberto, o trecho selecionado e os arquivos anexados com `#` vão junto com o pedido ("explica isso", "corrige essa função", "escreve os testes").
- Enquanto ela trabalha, o chat mostra cada passo (lendo, escrevendo, rodando um comando).
- Quando ela pede autorização (rodar um comando, gravar fora da pasta), aparecem os botões **Permitir** e **Negar**.
- Os arquivos que ela cita ou grava aparecem como referências clicáveis.
- `@aurora /nova` começa uma conversa nova; cada pasta tem a sua conversa, que também aparece no Harness desktop.

## Requisitos

- O Harness Aurora aberto neste computador (a extensão fala só com `http://127.0.0.1:8787`; nada sai do PC).
- VS Code 1.95 ou mais novo, com o painel de chat.

## Configurações

| Configuração | Padrão | O que faz |
| --- | --- | --- |
| `aurora.harnessUrl` | `http://127.0.0.1:8787` | Endereço do Harness (só endereços locais) |
| `aurora.provider` | `local` | Quem responde nas conversas novas: o modelo local, ou Codex/Claude |
| `aurora.useWorkspaceProject` | `true` | A pasta aberta vira a pasta do projeto no Harness |
| `aurora.harnessPath` | (vazio) | Caminho do `Harness Aurora.exe`, para o botão Abrir o Harness |
