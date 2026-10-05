# Aurora 0.1.35: mais rápida e mais certeira

## Mais rápida

- **Respostas longas até 5 vezes mais rápidas.** O modelo local passa a usar *decodificação especulativa por n-gramas*: quando a resposta repete trechos que já estão na conversa (linhas de uma planilha que viram uma tabela no documento, por exemplo), vários tokens saem de uma vez. O texto é o mesmo.
  - Com placa de vídeo: copiar 40 linhas de planilha caiu de 12,4 s para 3,4 s.
  - Sem placa de vídeo: de 8,5 para 40 tokens por segundo.
  - Os agentes de setor terminaram a bateria 19% mais rápido.
- **O modelo carrega enquanto você digita:** numa conversa local, o modelo começa a carregar no primeiro caractere, e a resposta não espera o carregamento depois que você envia.

## Organizar arquivos

- **Organizar uma pasta numa vez só:** "organize meus Downloads" separa todos os arquivos soltos por tipo (Documentos, Planilhas, Imagens, Vídeos, Instaladores…) numa única ação. Subpastas e downloads em andamento ficam como estão, nada é apagado nem sobrescrito.
- **Desfazer:** a resposta que moveu arquivos, no chat ou num agente, mostra **Desfazer**. Os arquivos voltam ao lugar, e um arquivo novo que ocupou o lugar antigo nunca é sobrescrito.
- **Mover vários de uma vez:** a Aurora move uma lista de arquivos para a mesma pasta numa ação só.

## Agentes

- **A notificação leva à tela Agentes:** clicar em "<agente> terminou" abre a tela dos agentes.
- **A resposta sempre diz onde está o arquivo:** se o agente entregou um documento e não disse onde, a Aurora acrescenta o caminho.

## Navegador

- **Formulários de contato enviados de verdade:** apertar Enter na caixa de mensagem só pulava uma linha, mas a Aurora dizia que tinha enviado. Agora o formulário é enviado como se você clicasse em Enviar.

## Planilhas

- **CSV também:** filtrar e ordenar agora funciona em arquivos .csv e .tsv (com ";" ou ",", e aspas), não só em Excel.
- **Datas como você falou:** "até 15/10", "a partir de", "antes de" e "depois de" decidem a comparação, mesmo que o modelo escreva o filtro de outro jeito. "Esse mês", "mês que vem" e "em outubro" viram o período certo.
- **Linhas que faltaram:** ao gravar um documento, a Aurora confere se todas as linhas filtradas entraram e avisa quais ficaram de fora.
- **Pastas da empresa:** um caminho como "Jurídico\Contratos Vigentes.xlsx", do jeito que o mapa da empresa mostra, é encontrado na pasta da empresa.

## Medição

| O quê | Resultado |
|---|---|
| Testes automáticos | (preencher) |
| Conversas reais, 5 cenários, 3 rodadas | 100% |
| Agentes de setor, conferindo o arquivo entregue (3 rodadas) | 22 de 24 tarefas perfeitas (eram 18 a 20) |
