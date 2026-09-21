# Catálogo de skills, indicador de resposta e relatório

Implementação e verificação em 20/09/2026.

## Uso

1. Abra **Ferramentas → Skills e regras**.
2. Clique em **Atualizar catálogo** na primeira utilização. O índice fica no banco local; consultas posteriores não precisam de rede ou de inferência.
3. Pesquise por nomes, descrições e tags, opcionalmente filtrando a fonte. A consulta retorna 30 itens por página. Termos em inglês podem encontrar mais resultados; as descrições são mantidas no idioma da fonte.
4. **Importar para revisão** baixa somente a skill escolhida e abre suas instruções. **Ativar esta skill** disponibiliza essa cópia à seleção por relevância e orçamento já existente no Aurora.
5. Em **Minha biblioteca**, use **Ler** para consultar uma cópia e **Desativar** para removê-la da seleção. Importar de novo o mesmo conteúdo não cria outra cópia.

O índice consultado em https://hermes-agent.nousresearch.com/docs/skills contém **98.326 entradas**. Foram aceitas **98.325** e rejeitada uma entrada sem os campos obrigatórios. São 76.180 entradas válidas de ClawHub, 20.000 de skills.sh, 1.021 de GitHub, 505 de LobeHub, 469 de browse.sh e 150 oficiais. Esses números descrevem entradas de catálogo, não skills únicas verificadas, compatíveis ou instaladas.

## Economia e procedência

- SQLite FTS5 pesquisa metadados localmente. Nenhum dos corpos das 98 mil entradas é enviado ao modelo para fazer essa busca.
- Apenas skills ativadas concorrem ao contexto; permanecem os limites de relevância, quantidade e tamanho do Aurora. Uma importação não amplia automaticamente esses limites.
- GitHub, oficial e skills.sh fixam o SHA do repositório. Referências textuais podem ser lidas sob demanda na mesma revisão. Caminhos ambíguos ou árvores incompletas não são resolvidos por adivinhação.
- ClawHub fixa a versão informada pela origem. Markdown sem cabeçalho recebe nome e descrição do índice, preservando o corpo; a origem é marcada `wrapped`.
- LobeHub converte `config.systemRole` em SKILL.md e identifica a conversão na origem. O hash registra o conteúdo recebido; essa fonte não oferece aqui uma revisão Git fixada.
- Importações são inativas. Ler ou importar não executa scripts, instala pacotes, conecta contas ou concede novas ferramentas ao modelo.
- O índice é substituído em uma transação. Falhas de download, JSON ou validação não apagam o catálogo anterior. Downloads e caminhos têm limites; redirecionamentos arbitrários são recusados.

## Verificação real e limites

Além dos testes isolados, a prévia sincronizou o índice real e importou cópias inativas de `frontend-design` (GitHub), `adversarial-ux-test` (oficial), `100m-leads` (skills.sh), `daily-game-news` (ClawHub) e `9-somboon` (LobeHub). A importação de `frontend-design` também foi exercitada pela interface, em tela larga e a 390 px, sem transbordamento horizontal.

O repositório `browserbase/browse.sh` indicado pela fonte retornou **404** no ensaio. As entradas continuam pesquisáveis, mas sua importação depende da disponibilidade da origem. Slugs ambíguos do ClawHub retornam erro e exigem identificação do arquivo correto. Catálogos externos podem conter descrições incorretas, dependências indisponíveis e formatos não suportados. A importação não comprova a qualidade da skill nem aumenta por si só a precisão do modelo.

## Animação

O GIF fornecido é servido localmente enquanto a conversa está aguardando uma resposta, acompanhado de três pontos. Ao concluir ou falhar a operação, o indicador sai; mensagens concluídas usam o símbolo estático. O modo de movimento reduzido do sistema usa a imagem estática também durante a espera. A animação não envolve inferência nem consumo de tokens.

## Relatório para investidores

`output/pdf/Aurora_Relatorio_Investidores.pdf` contém sete páginas: resumo, A/B inicial, seleção de contexto, reparos, custos, próximos marcos e método. Todas foram renderizadas e conferidas visualmente.

Os números vêm dos JSON preservados em `reports/`. O arquivo acompanhante `Aurora_metricas_fontes.json` registra hashes SHA-256 das fontes e hipóteses de cálculo. Para regenerar no Windows com ReportLab: `python scripts/build-investor-report.py`.

O documento distingue economia de tokens, aprovação funcional, reparo de defeitos conhecidos e evidência de generalização. Energia do PC usa a hipótese de **R$ 1,00/kWh** e **300 W**; não representa medição da tomada. Não há afirmação de precisão geral, retorno financeiro ou equivalência a modelos grandes.

## Testes

- `test/skill-catalog.test.js`: índice, paginação, filtros, contexto, revisão, deduplicação, conversões, caminhos, limites, falha de sincronização e autenticação.
- `test/ui.test.js`: GIF enquanto aguarda, retorno ao estático, movimento reduzido, busca, paginação, importação inativa, ativação e layout móvel.
- Build: `npm run frontend:build`. Regressão com navegadores em sequência: `node --test --test-concurrency=1 test/*.test.js`.
