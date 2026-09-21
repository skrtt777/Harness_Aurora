# Harness Aurora 0.1.19 — Memória central

Esta versão conecta as instalações a uma base pública revisada, preservando a coleção pessoal de cada usuário.

- Três níveis visíveis: central compartilhada, memória individual do chat e memória pessoal de todos os chats. Projetos continuam preservados.
- Sincronização a cada 6 horas por padrão, editável entre 1 e 168 horas, enquanto o aplicativo está aberto. Retoma na abertura e mantém cache offline.
- Downloads incrementais por hash, pesquisa local em SQLite/FTS5, aplicação atômica de atualizações e remoções, limites de conteúdo e recuperação de falhas.
- Compartilhamento desativado por padrão. Cada cópia pública passa por edição, prévia e consentimento antes de entrar na fila. Somente título, conteúdo e tags são enviados.
- Contribuições são issues públicas criadas com a conta GitHub do próprio usuário; requer GitHub CLI autenticado. Não há credencial de mantenedor no instalador.
- Revisão por PR de dados antes da distribuição. O script não executa conteúdo recebido nem faz merge automático. Envios incertos não são repetidos às cegas.
- Central separada no Atlas (até 500 referências), com o tema Aurora. A busca em texto consulta o índice completo do cache.
- Consulta entre chats/projetos locais é uma opção separada e não compartilha nada com a comunidade.

## Começar

Atualize pelo aplicativo ou baixe `Harness-Aurora-Setup-0.1.19.exe`. Abra **Ferramentas → Memória → Memória central** e ative o recebimento. A central começa com 16 referências de Three.js que já eram públicas no projeto.

Para contribuir, configure GitHub CLI com `gh auth login`, ative o envio de cópias revisadas e use **Compartilhar cópia** em uma memória. Os demais usuários também precisam atualizar e optar por participar. A Aurora não descobre nem acessa remotamente seus computadores.

## Validação

247 testes de integração e comportamento e 6 testes de visualização passaram localmente. O executável empacotado também passou pelo teste de abertura, funcionamento e persistência após reiniciar. Os testes de envio usam respostas controladas do GitHub, sem publicar memórias pessoais ou contribuições de teste.

## Limites

O instalador não tem assinatura digital de editor. Consulte os hashes publicados junto aos arquivos de instalação e atualização.

Detecção automática de dados privados é parcial e não substitui revisão humana. Publicações no GitHub são públicas; cancelar a fila ou apagar o cache local não apaga uma issue ou o histórico Git. Referências centrais são dados de consulta, não instruções ou permissões de execução, e não comprovam ganho de precisão.

O workflow de revisão pode ser usado quando o GitHub Actions estiver disponível. Enquanto a conta estiver bloqueada por cobrança, o mantenedor pode executar `node scripts/central-memory/review.mjs NUMERO_DA_ISSUE` na sua máquina e revisar o PR normalmente. A publicação continua dependendo de revisão e merge.

Guia completo: [Memória central](MEMORIA_CENTRAL.md) e [processo de contribuição/moderação](../central-memories/README.md).
