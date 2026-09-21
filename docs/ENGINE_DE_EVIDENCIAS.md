# Engine de Evidências do Aurora

Componente próprio do Aurora para execução assistida por um modelo local. A combinação é específica do produto; busca restrita, análise de código, testes de regressão, recuperação de conhecimento e carregamento progressivo são técnicas conhecidas. Não há alegação de invenção científica inédita nem de equivalência a um modelo grande.

## Método

1. Receber objetivo, orçamento e, quando disponíveis, contratos de comportamento definidos antes da geração.
2. Selecionar apenas conhecimento ativado, compatível e dentro do escopo da conversa/projeto.
3. Produzir o artefato e executar os testes em navegador isolado, sem acesso à rede.
4. Diante de uma falha funcional, tentar no máximo seis hipóteses determinísticas estreitas. Cada hipótese é um candidato, nunca uma substituição aceita por suposição.
5. Se necessário, pedir reparo ao modelo dentro do orçamento cumulativo. O protocolo literal continua sendo o padrão. Se a cópia do alvo falhar, oferecer IDs associados a posições exatas do código e ao hash do artefato.
6. Rejeitar regressões, edições ambíguas, alvos desatualizados e repetição de uma proposta já reprovada.
7. Salvar como candidato o procedimento derivado de um reparo funcional comprovado. Ele permanece restrito à conversa/projeto e exige ativação. Sua evidência não comprova generalização.

## Ferramentas implementadas

### Reparos determinísticos

`proposeDeterministicRepairs()` inspeciona a árvore sintática, sem chamar a IA nem executar código no sistema. Primeiras famílias:

- Divisor diferente da variável que protege uma divisão por zero.
- Reinício que muda somente o texto, quando há uma variável mutável identificável que alimenta o mesmo elemento.
- Estado lido do localStorage e alterado por uma operação de array sem gravação correspondente.
- Filtro que usa condição literal `true`, com controle de categoria e valores identificáveis nos dados.

O resultado só é adotado se passar no contrato original e preservar as asserções anteriores. Uma regra pode não se aplicar, não encontrar a causa ou propor uma mudança rejeitada. Custos de teste/CPU/energia continuam existindo mesmo quando o consumo de tokens é zero.

### Edição por alvo

`repairTargets()` identifica expressões, atribuições e funções. `applyTargetEdits()` aplica até três alterações usando offsets e um hash do documento. Recusa alvos desconhecidos, sobrepostos ou desatualizados. A validação posterior continua obrigatória.

A primeira tentativa de usar esse protocolo em todos os reparos piorou os quatro casos de desenvolvimento (0/4). Por isso ele ficou como fallback, e a versão testada passou a priorizar hipóteses determinísticas. Os resultados dessa tentativa estão preservados, não descartados do histórico.

### Compatibilidade das skills

O parser preserva declarações de plataforma, ferramentas exigidas e variáveis de ambiente. Dependências declaradas indisponíveis bloqueiam ativação e seleção. Importações sem declarações suficientes aparecem como **Dependências a revisar**; não são certificadas automaticamente.

Capacidades declaradas pela engine: HTML, JSON, JavaScript, Markdown, CSV, validação no navegador e leitura de referências. Isso não concede terminal, instalação de programas ou contas externas ao modelo. Skills podem descrever dependências em texto sem declará-las: esse caso continua exigindo revisão.

### Referências sob demanda

O modelo recebe um índice curto das referências de skills selecionadas. Pode responder com `skill_request` em vez do artefato, solicitando um caminho desse índice. O executor permite até duas solicitações por etapa, somente para skills ativadas, compatíveis e no escopo. Cada chamada do modelo continua sendo contabilizada.

Uma referência é limitada a 5.000 caracteres na engine. Referências maiores exigem divisão; não são cortadas silenciosamente. Conteúdo GitHub fixado por revisão é armazenado em cache. Arquivos locais mutáveis não recebem o mesmo cache. Corpos de referências são tratados como dados de apoio, não como autorização para novas ações.

### Aprendizado com evidências

`captureVerifiedRepair()` exige falha funcional anterior, contrato fornecido pelo solicitante e resultado posterior aprovado no validador real. Aprovação genérica humana e testes gerados pelo próprio modelo não bastam para esse registro automático.

A biblioteca registra escopo, trechos antes/depois, hashes de artefatos e testes, versão do validador e execução de origem. Conteúdo idêntico no mesmo escopo acrescenta evidências ao registro existente. Não há fusão semântica automática de soluções apenas parecidas, atualização de pesos do modelo ou publicação externa.

## Interface

Em **Ferramentas → Skills e regras → Engine de Evidências**, estão os contadores de execuções, contratos aprovados, tokens por aprovação, referências, reutilizações e candidatos a conhecimento. As falhas entram no numerador do custo por aprovação. Aceite humano e aprovação dos testes aparecem separados.

O painel mostra também a última avaliação concluída em uma base isolada. A tarifa inicia em R$ 1,00/kWh e a potência em 300 W; ambos podem ser editados. Trata-se de simulação durante os ciclos, não medição da tomada nem custo total do negócio.

### Padrão adotado após a avaliação

Nas execuções por etapas, **Contexto mínimo** passou a ser o padrão. É possível escolher explicitamente **Incluir memórias relevantes** ou **Incluir memórias e skills ativadas** antes de preparar o plano. Reparos determinísticos, contratos, orçamento e reutilização da própria execução continuam disponíveis nos três modos. O chat comum mantém seu fluxo separado; esta política é aplicada à engine de etapas.

Essa escolha foi feita depois da campanha congelada: 7/36 aprovações e 60.602 tokens sem conhecimento, 8/36 e 84.497 tokens com memórias, 5/36 e 108.280 tokens com memórias e skills. Os intervalos de 95% das diferenças de aprovação incluem zero. Não foi promovida uma alegação de ganho geral; escolheu-se um padrão de menor contexto. O snapshot da avaliação preserva o código anterior à mudança do valor padrão; os três braços já passavam o modo explicitamente.

Nos casos novos, nenhuma das hipóteses determinísticas se aplicou e nenhum reparo do modelo recuperou uma falha inicial. A ferramenta resolve as quatro famílias estreitas de desenvolvimento, mas ainda não cobre os defeitos naturais observados. Isso é uma limitação medida, não omitida.

## Desenvolvimento e avaliação

- `reports/engine-development-v1`: edição por IDs como primeira opção; 0/4 recuperados, oito chamadas reais, 8.602 tokens.
- `reports/engine-development-v2`: hipóteses determinísticas; 4/4 recuperados, sem chamada ao modelo para reparar. Artefatos iniciais são defeitos sintéticos, não gerações da IA.
- `scripts/benchmark/run-engine-evaluation.mjs`: avaliação em 12 tarefas novas de jogo, página, app e BI, com três sementes e três condições. Engine, modelo e orçamento são iguais entre as condições. São 108 execuções.
- O treino consiste nos quatro defeitos anteriores, em projeto e banco separados dos dados do usuário. Conhecimento obtido nas tarefas de avaliação não é ativado durante a campanha.
- Há referências manuais para conferir os contratos antes de pedir saídas ao modelo; os artefatos de referência não entram nos prompts.
- Os grupos alternam de ordem. O modelo é aquecido uma vez. Tokens vêm do Ollama; duração inclui geração, teste e reparo. Intervalos de incerteza são agrupados por tarefa.
- Prompt, resposta, histórico, artefato, manifesto, hashes e snapshot dos fontes são preservados. Uma campanha interrompida não é publicada como resultado completo.

## Limites

A engine executa atualmente contratos funcionais de HTML. Outros formatos mantêm validação estrutural e revisão quando o significado não pode ser testado. Não converte automaticamente qualquer pedido em cobertura completa de testes, não instala dependências de todas as skills e não comprova qualidade de projetos grandes.

O produto deve ampliar famílias de reparo e modalidades de teste a partir de falhas observadas. Uma queda de tokens ou um sucesso em defeito conhecido não autoriza afirmar melhora de precisão geral. A seleção automática de conhecimento precisa de evidências em tarefas novas e do orçamento disponível.
