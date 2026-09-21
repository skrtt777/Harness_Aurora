# Chat e arquivos — 0.1.15

A conversa é a tela principal: mensagem, resposta formatada e cartões de arquivo. A coluna direita abre ao clicar em um cartão ou quando chega uma nova resposta com arquivos. Fechar o painel preserva a conversa. O botão Arquivos permite voltar a qualquer entrega anterior.

- Visualizar: executa HTML autocontido em iframe isolado; documentos Markdown são formatados.
- Código: mostra o conteúdo literal de HTML, CSS, JavaScript, JSON, CSV, Python, SQL e outros blocos de texto reconhecidos.
- Copiar / Baixar: exportam o conteúdo da versão selecionada, sem chamar o modelo.
- Caminho no rodapé: copia a localização real do arquivo salvo.
- Abertura: salva uma cópia em `artifacts/<conversa>/<mensagem>/<nome>`, junto ao banco de dados. Não precisa configurar uma pasta antes de usar. Arquivos editados externamente não são sobrescritos.
- Histórico: cada mensagem tem arquivos independentes. Correções no chat geram uma nova versão e mantêm a anterior acessível.

Memórias, skills, regras, Atlas e métricas ficam em Ferramentas. Modelo da próxima conversa fica no seletor recolhido da lateral. Os ajustes da conversa e o executor avançado por etapas ficam no botão de três pontos. O executor conserva suas verificações e aprovações; o chat continua usando o fluxo de geração e correção local existente. Esta alteração não transforma revisões semânticas em aprovações automáticas.

Para ajustes comuns, escreva o pedido no mesmo chat. “Revisar com Codex/Claude” continua sendo uma ação explícita que chama o professor selecionado.

## Limites da visualização

A prévia suporta HTML autocontido, com CSS e JavaScript embutidos. Não instala dependências, não executa Python/shell no computador e não serve projetos com backend ou vários módulos interdependentes. Esses arquivos podem ser lidos e baixados. Recursos de rede ficam bloqueados na prévia. Mostrar uma prévia não significa que os requisitos funcionais foram validados.

As respostas usam [react-markdown](https://github.com/remarkjs/react-markdown) e [remark-gfm](https://github.com/remarkjs/remark-gfm), sem habilitar HTML arbitrário na conversa. A visualização HTML usa sandbox sem acesso à origem do aplicativo. As APIs de arquivo exigem sessão local; nomes fornecidos pelo modelo não podem escolher caminhos do sistema.
