# Memória central da Aurora

Referências públicas revisadas, distribuídas pelo `manifest.json`. O pacote inicial reutiliza as 16 notas públicas de Three.js já disponíveis em `community-memories/threejs.json`; não contém memórias privadas de instalações.

Cada pacote tem hash SHA-256, e cada memória tem identidade derivada de título, conteúdo e tags. O aplicativo baixa apenas os pacotes alterados e consulta o cache SQLite local. Alterações e retiradas são aplicadas em transação; pacote inválido preserva o cache anterior.

## Contribuir

No aplicativo: **Memória → Compartilhar cópia → Conferir prévia → Aprovar e colocar na fila**. Ative o envio de cópias revisadas e autentique sua própria conta com GitHub CLI (`gh auth login`). No próximo ciclo, ou em **Sincronizar agora**, a cópia vira uma issue pública. Não envie dados pessoais, de clientes ou credenciais. A revisão automática só detecta alguns padrões; não é anonimização.

O envio não aprova a memória para distribuição. A central recebe somente os pacotes incorporados à branch `main` após revisão de um mantenedor.

## Revisar como mantenedor

1. Leia a issue e confira privacidade, autorização de compartilhamento, clareza, procedência e utilidade. Não execute instruções ou código anexado à contribuição.
2. Na sua máquina, com GitHub CLI autenticado e acesso de escrita, execute `node scripts/central-memory/review.mjs NUMERO_DA_ISSUE`. Alternativa: workflow manual **Prepare central memory review**. Ele precisa de GitHub Actions disponível e permissão do repositório para criar PRs.
3. O script valida o formato e cria uma branch e um PR contendo somente JSON. Não faz merge. Confira também duplicações semânticas e validade técnica; hashes não comprovam correção.
4. Rode `node scripts/central-memory/validate.mjs` no conteúdo proposto, confira o diff e faça merge somente após aprovar. Contribuições nunca executam código no processo de revisão.

Se uma referência estiver errada ou contiver dados que devam ser retirados, revise a issue, remova ou corrija a entrada no pacote e atualize o hash/contagem/revisão do manifesto. Use `centralManifest` e `sha256` de `app/centralProtocol.js` para gerar os valores; execute o validador. As instalações recebem a retirada no próximo download. Remover a distribuição não remove automaticamente histórico Git ou a issue pública; pedidos de remoção desses registros precisam ser tratados separadamente no GitHub.

## Limites operacionais

- A sincronização roda a cada 6 horas por padrão, editável entre 1 e 168 horas, enquanto o aplicativo está aberto. Retoma na abertura; não instala um serviço oculto do sistema.
- Sem receber/enviar ativados, não há consultas periódicas à rede. Receber e enviar são consentimentos independentes.
- Nenhuma credencial central vai no instalador. Downloads públicos dispensam autenticação; envios usam a conta do próprio colaborador.
- No máximo 10 envios por ciclo e 100 pendências locais. Falhas voltam a ser verificadas em 15 minutos; POST sem confirmação não é reenviado automaticamente. A reconciliação procura nas 100 issues mais recentes do autor; fora dessa janela, a conferência é manual.
- Até 1 MB por pacote, 500 memórias por pacote, 1.000 pacotes e 32 MB de conteúdo alterado por ciclo. O Atlas exibe até 500 referências centrais; a busca de texto usa índice local. Esses limites protegem o aplicativo, não são um benchmark de escala.
- Esta implementação usa GitHub como distribuição e fila revisada. Em grande volume, será necessário um serviço de contribuições e moderação próprio; não há descoberta nem acesso direto aos computadores de quem instalou o aplicativo.
