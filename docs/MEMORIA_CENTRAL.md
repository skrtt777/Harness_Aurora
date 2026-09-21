# Memória central e pessoal

A Aurora apresenta três níveis: **Central compartilhada → Memória individual de cada chat → Memória pessoal de todos os chats**. Os projetos continuam preservados como agrupamentos locais.

Essa ordem organiza a interface. Ao responder, a Aurora seleciona por relevância e orçamento, dando maior peso ao chat atual, depois ao projeto e ao conhecimento pessoal, e menor peso às referências genéricas da central. Referências públicas não são instruções nem permissões para executar ações. A coleção inteira nunca é enviada ao modelo.

## Usar

Em **Ferramentas → Memória → Memória central**, ative **Receber e consultar memórias da central**. O intervalo inicial é 6 horas, configurável. Use **Sincronizar agora** para antecipar uma atualização. O cache funciona offline depois do download. Desativar a opção impede a consulta nas respostas, mas permite visualizar o cache já baixado.

As memórias próprias permanecem privadas. A coleção pessoal já reúne as memórias de todos os chats na tela. A opção **Consultar também minhas memórias de outros chats e projetos** permite recuperá-las em outra conversa; começa desativada para preservar os limites anteriores. Essa opção não envia nada à central.

Como no chat normal, as referências selecionadas entram no contexto do provedor escolhido. Usar Codex/Claude envia esse contexto ao respectivo provedor; use Local para inferência no Ollama da própria máquina.

Para contribuir, ative o envio de cópias revisadas, configure GitHub CLI com a sua conta e use **Compartilhar cópia** em uma memória. Edite título, conteúdo e tags, confira a prévia e dê o aceite público. A aprovação fixa aquela cópia: alterações posteriores no chat não são enviadas. Nenhum histórico, ID de conversa, nome de projeto, caminho local ou credencial é anexado automaticamente.

O próximo ciclo envia a cópia como issue pública em `skrtt777/Harness_Aurora`. Ela só passa a ser baixada pelas outras instalações após revisão, criação do pacote e merge no repositório. Desligar o compartilhamento cancela as pendências, sem apagar conteúdo já publicado. Não há envio automático de novas memórias sem revisão individual.

## Implementação

- `app/centralMemory.js`: agendamento persistido, bloqueio contra execuções simultâneas, cache com FTS5, retirada de referências e fila de cópias aprovadas.
- `app/centralProtocol.js`: formatos, limites, hashes e bloqueio de alguns padrões de dados privados. Não garante anonimização.
- `app/centralGitHub.js`: GitHub CLI sem shell; conteúdo JSON por stdin. Autenticação administrada pelo CLI de cada usuário.
- `scripts/central-memory/review.mjs`: proposta de PR com dados; sem execução de conteúdo recebido e sem merge automático.
- `central-memories/`: manifesto e pacotes públicos revisados; atualização por hashes evita baixar novamente pacotes intactos.

Se o aplicativo estiver fechado ou offline, sincroniza quando voltar. Falhas preservam o cache; não multiplicam envios nem consomem chamadas de IA. A fila nunca considera um POST interrompido como sucesso nem tenta reenviá-lo às cegas.

Consulte [o processo de contribuição e moderação](../central-memories/README.md) para limites e retirada de conteúdo. As integrações seguem a [API de issues do GitHub](https://docs.github.com/en/rest/issues/issues) e o uso de [GitHub CLI com JSON por stdin](https://cli.github.com/manual/gh_api).
