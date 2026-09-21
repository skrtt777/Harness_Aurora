# Execução econômica e skills — 0.1.14

## O que está implementado

- Regras legíveis em app/runtime-policy: SOUL, RULES, ECONOMY e KERNEL. Somente o núcleo curto é enviado a cada chamada; o backend aplica os limites.
- Contexto limitado por blocos completos: requisitos e dependências têm prioridade. Uma etapa que não cabe é interrompida com explicação; código não é truncado silenciosamente.
- Biblioteca de quatro skills iniciais, descoberta da pasta ~/.hermes/skills, importação manual de SKILL.md e catálogo oficial NousResearch/hermes-agent. Importações são snapshots identificados por hash e revisão, inativas até ativação.
- YAML frontmatter; corpos carregados por relevância. Skills longas usam seções completas relevantes dentro do orçamento, com indicação de carregamento parcial. Referências de texto podem ser lidas individualmente na biblioteca. Scripts são texto: não são executados ao importar ou ler.
- Execuções persistidas em SQLite: objetivo, plano, dependências, artefatos, tentativas, evidências, orçamento e aceite.
- Planejamento local com esquema JSON; pedidos explícitos de uma etapa HTML/JSON têm plano determinístico sem chamada ao modelo.
- Cada etapa só libera suas dependentes após verificação disponível ou revisão humana. Artefatos e aceites são vinculados por SHA-256.
- JSON e JavaScript passam por análise estrutural. HTML autocontido passa por sintaxe e inicialização em navegador isolado sem rede; usa Chromium do Playwright ou Edge/Brave já instalado, com perfil temporário.
- Dados, regras de negócio e comportamento funcional exigem verificação apropriada. O teste de inicialização NÃO certifica todos os requisitos. A entrega integrada exige aceite final.
- Limites persistentes de chamadas, tempo, tokens contabilizados e tentativas. Uma chamada interrompida reserva conservadoramente o orçamento. Tokens medidos pelo Ollama são separados de estimativas.
- Revisão completa redundante do chat local desativada por padrão; correções respondem a erros encontrados. Revisão deliberada continua disponível na função.
- Reutilização exata de entregas aprovadas na conversa e entre conversas do mesmo projeto. Verifica objetivo, regras, skills relevantes e memórias. O chat normal também pode retornar uma entrega aprovada compatível sem inferência.
- Ampliação explícita de uma entrega: cria outra execução com a versão aprovada como base, preservando a anterior.
- Ajuda opcional do professor: no máximo uma consulta explícita por execução, contexto limitado. Pode propor skill candidata, que permanece inativa. Nenhuma consulta ao professor ocorre durante execução normal.

## Como usar

1. Abra uma conversa Local e expanda **Execução por etapas**.
2. Descreva objetivo, entradas disponíveis e critérios. Ajuste o máximo de chamadas.
3. **Preparar ou recuperar plano** reutiliza uma execução compatível ou prepara a lista.
4. Confira as etapas e clique em **Executar / continuar etapas**.
5. Revise artefatos quando solicitado; erros levam a correção dentro do orçamento.
6. **Refazer verificações sem usar IA** reavalia o mesmo artefato.
7. Confira a entrega integrada e conclua. O artefato final é salvo no chat.
8. Para mudanças futuras, use **Ampliar esta entrega**.
9. Em **Skills e regras**, consulte o catálogo Hermes, importe, leia e ative somente procedimentos pertinentes.

## Limites explícitos

Esta versão executa tarefas que produzem artefatos HTML, JSON, JavaScript, Markdown ou CSV. Não é um executor irrestrito de shell, instalador de ferramentas de terceiros nem implementação de todas as ferramentas do Hermes. Skills que dependem dessas ferramentas não ganham a capacidade apenas por serem importadas.

Uma execução contém até oito etapas, com orçamento padrão de 16 chamadas locais, 60 mil tokens contabilizados, duas tentativas por etapa e dez minutos de execução ativa. A ajuda do professor pode liberar uma tentativa adicional, mantendo o limite total. Após mudanças nas regras/skills pertinentes ou instruções do projeto, prepare um novo plano compatível.

O contexto usa estimativa de caracteres para seleção; a medição de consumo vem de prompt_eval_count/eval_count do Ollama. Estimativas não são cobrança nem porcentagem garantida de economia. Valores de negócio e arquivos externos que mudam não são inferidos por cache: forneça os dados atuais no objetivo ou no contexto do projeto.

Procedimentos importados não são considerados conhecimento comprovado automaticamente. A seleção de seções por palavras-chave não substitui avaliação de pertinência ou compatibilidade. A biblioteca é extensível, mas um modelo pequeno continua sujeito a erros de raciocínio, planejamento e código.

## Referências

Formato e carregamento progressivo inspirados no [sistema de skills do Hermes](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/). O catálogo consulta o repositório oficial e fixa a revisão no momento da importação. Não há envio automático de memórias ao catálogo.

## Validação

Testes automatizados em test/workflows.test.js cobrem estados, orçamento, cancelamento, retomada, evidências, escopo de reutilização, ajuda explícita e importação. A suíte anterior permanece ativa. O teste de navegador usa banco separado; nenhum teste automatizado altera o histórico do aplicativo instalado.

Evidências da validação real, consumo e instalador: [EVIDENCIAS_0.1.14.json](EVIDENCIAS_0.1.14.json).
