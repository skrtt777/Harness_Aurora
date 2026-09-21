# Biblioteca inicial de jogos

`jogos-v1.json` contém 73 memórias de referência e 117 relações: um índice, nove organizadores e 63 procedimentos. São registros persistidos no banco do Harness como `imported`, em escopo global, disponíveis para recuperação em qualquer conversa. Não são dados sintéticos da tela Teste nem experiências de execução atribuídas ao modelo.

As áreas são planejamento/economia, arquitetura, movimento/física, mecânicas, mundo/IA, apresentação/áudio, dados/desempenho, qualidade/entrega e motores/3D/rede. Cada procedimento tem condição de uso ou ação concreta e uma verificação observável. Os títulos, conteúdo e tags permitem recuperação lexical e por embeddings locais.

## Uso e manutenção

O chat já chama `selectRelevantMemories` e passa ao modelo somente o conjunto selecionado, respeitando o orçamento do contexto. As ligações do Atlas representam relações explícitas de pertencimento e tema; elas não são pesos da rede neural e não fazem o modelo percorrer automaticamente toda a coleção.

Todos os registros são globais para serem acessíveis fora de um projeto específico. Por isso o Atlas os agrupa em “Contexto geral”; os nove assuntos podem ser explorados pelas ligações ou pela pesquisa. Os nós organizadores apontam ao índice e os procedimentos ao seu assunto. Ligações adicionais indicam dependências conceituais entre temas.

Para reproduzir a coleção autoral:

```powershell
python scripts/build-game-knowledge.py
node scripts/import-game-knowledge.mjs 8788 8787 --index
```

Informe apenas as portas locais que deseja atualizar. A importação cria uma cópia das memórias anteriores em `app/data/game-knowledge`, valida relações, preserva registros existentes e verifica deduplicação. `--index` salva novamente cada registro pela API existente para calcular embeddings no Ollama; não treina nem troca o modelo de chat.

`scripts/verify-game-knowledge.mjs` usa o banco indicado explicitamente em `HARNESS_DB_FILE` para verificar cinco buscas de jogos e a inclusão dos resultados no contexto compacto. Relatórios de importação e consulta ficam em `app/data/game-knowledge`.

## Fontes e limites

As notas combinam orientações autorais de implementação/teste com resumos curtos das fontes identificadas no campo `source`: documentação MDN, documentação oficial do Godot e Unity, Red Blob Games e Gaffer on Games. As referências foram consultadas em 20/09/2026; APIs de motores precisam ser conferidas para a versão do projeto. O script de construção mantém a lista exata de páginas por procedimento.

Esta é uma base inicial, não “todo o conhecimento sobre jogos”. Procedimentos precisam ser aplicados e testados no projeto concreto. A prévia atual do Harness executa HTML autocontido; ela não executa projetos Godot/Unity, servidores multiplayer ou scripts nativos. Novos aprendizados só devem ser descritos como correções comprovadas depois de testes com evidência.
