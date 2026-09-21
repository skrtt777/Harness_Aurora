# Aurora 0.1.20 — Guia de boas-vindas

Na primeira abertura após instalar ou receber esta atualização, a Aurora apresenta um guia em quatro etapas:

- Como pedir tarefas, acompanhar arquivos, testar resultados e solicitar ajustes.
- Como funcionam os modos Local, Codex e Claude.
- Como instalar e autenticar Codex CLI e Claude Code, com links oficiais, comandos copiáveis e verificação de detecção.
- Como usar as memórias do chat, a coleção pessoal, a central compartilhada e o Atlas.

O guia pode ser pulado e reaberto em **Configurações → Primeiros passos → Abrir guia de boas-vindas**. A conclusão fica salva no banco local e permanece após reiniciar ou atualizar. Instalações existentes também veem o guia uma vez. Nenhuma conversa ou memória pessoal é alterada.

O conteúdo funciona sem chamadas ao modelo. A verificação informa se o programa foi encontrado; a autenticação é confirmada ao conversar. O guia não instala programas, inicia logins ou muda provedores automaticamente. Conta, acesso e limites dos serviços externos continuam sendo responsabilidade de cada usuário.

As instruções distinguem o Windows do WSL e explicam que é necessário usar **Sair** no ícone da Aurora perto do relógio para encerrar completamente o aplicativo após instalar um provedor.

## Fontes das instruções

- [Instalação do Codex CLI](https://developers.openai.com/codex/cli) e [autenticação](https://learn.chatgpt.com/docs/auth).
- [Instalação e autenticação do Claude Code](https://code.claude.com/docs/en/setup).

## Distribuição

Validação local: 248 testes de comportamento e integração, mais 6 testes de visualização, todos aprovados. O executável empacotado passou pelo teste de primeira abertura, fechamento do guia e persistência após reiniciar. Interface conferida em desktop e em largura de 390 px. Os testes não fazem login nem enviam mensagens reais aos provedores.

Atualize pelo aplicativo ou instale `Harness-Aurora-Setup-0.1.20.exe`. O instalador não possui assinatura digital de editor; os hashes dos arquivos acompanham a versão.

O GitHub Actions da conta permanece bloqueado por cobrança. A validação desta versão é executada localmente antes da publicação.
