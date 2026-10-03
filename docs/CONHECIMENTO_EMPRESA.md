# Conhecimento da empresa (piloto)

Objetivo: a Aurora conhecer o que cada departamento faz, a partir dos documentos que ele já mantém. Exemplo: alguém do RH pede "me traz um resumo da programação de final de ano", e a IA local acha o documento certo, mesmo sem saber o nome nem a pasta, e responde citando a fonte.

## Princípios combinados (30/09)

- **Fontes:** pastas da rede Windows (`\\servidor\RH`) e SharePoint.
- **IA local vê tudo:** nada sai do computador. É ela que lê, organiza por categoria, resume e extrai os fluxos.
- **IAs pagas ajudam:** recebem conteúdo só se a fonte estiver liberada para elas ou se a pessoa autorizar na hora.

## Como funciona

1. **Fontes:** em Configurações → "Conhecimento da empresa", cadastre uma pasta e o departamento.
   - **SharePoint:** use "Sincronizar" no OneDrive e cadastre a pasta local sincronizada. O conector direto pela API do Microsoft Graph exige registrar um app no Azure da empresa e fica para a fase de servidor.
   - **Opção "IA paga pode ver":** vem desligada por padrão.
2. **Leitura** (`app/docText.js`):
   - **Formatos:** Word, Excel, PowerPoint, PDF, texto, Markdown, CSV, HTML e RTF.
   - **Como:** os formatos do Office são lidos com um leitor de ZIP próprio; o PDF, com o `pdf.js` da Mozilla.
   - **Limitação:** PDFs escaneados (só imagem) ainda ficam sem texto.
3. **Índice incremental** (`app/knowledge.js`):
   - só relê arquivos novos ou alterados (data e tamanho) e remove os que sumiram;
   - divide o texto em trechos de ~900 caracteres, rotulados com o arquivo;
   - indexa por palavras (FTS) e por significado (embeddings `nomic-embed-text`).
4. **Mapeamento pela IA local:** cada documento ganha uma ficha com título, tipo, resumo, palavras-chave (com sinônimos), datas e fluxo (passo a passo) quando é procedimento.
   - **Categoria:** é a **pasta** que as pessoas já organizaram (`RH/Eventos`, `RH/Benefícios`…). O tema sugerido pelo modelo vale só para arquivos soltos na raiz. A classificação livre do modelo pequeno se mostrou instável: chegou a pôr "Confraternização" em "Férias".
   - **Mapa:** em Configurações há o mapa por categoria, com resumos e fluxos.
5. **Busca** (`searchKnowledge`):
   - **Pontuação:** combina a cobertura das palavras de conteúdo do pedido (sem "qual", "do", "hoje"…), a similaridade de significado e a ficha do documento.
   - **Separação:** pedidos sem relação ("oi", "cotação do dólar", "crie soma.js") ficam abaixo de 1,0; perguntas do departamento passam de 1,8.
6. **No chat:**
   - **Busca automática:** antes de responder, o Harness busca os documentos relacionados ao pedido (pontuação ≥ 1,5) e entrega os trechos ao modelo local.
   - **Ferramentas:** `knowledge_search` e `knowledge_map` servem para o resto.
   - **Trava de citação:** uma resposta que cita "Fonte:" sem nenhum documento consultado é mandada de volta para pesquisar.
7. **Privacidade:**
   - **Chats pagos:** numa conversa com Codex ou Claude, buscar em fontes não liberadas pede autorização.
   - **Professor automático:** só recebe uma conversa que usou documentos restritos se a pessoa aprovar no cartão.
   - **Permissões:** o indexador roda com o usuário do Windows, então cada pessoa só indexa o que já pode abrir, e o índice fica no perfil dela.

## Medições (30/09, qwen3.5:4b, acervo fictício de RH com 6 documentos em 6 formatos)

- **Indexação:** ~17 s (extração, embeddings e ficha pela IA local).
- **Busca:** 40–95 ms.
- **Avaliação:** 7 perguntas de RH na bateria fixa, entre elas o resumo de final de ano completo, a admissão, um contato e um "não encontrei" honesto. Resultado: **21/21 em 3 rodadas**, de 1 a 6 s cada.
- **Erros vistos numa conversa longa, antes das correções:**
  - uma fonte inventada, sem pesquisar (motivou a busca automática e a trava de citação);
  - uma resposta forçada sobre uma política que não existe.
- **O que a bateria ainda não cobre:** conversas longas.

## Escala e arquivos citados (01/10)

Um teste real indexou uma pasta Downloads inteira: 3.030 documentos, quase 50 mil trechos. Com esse volume:
- remover a fonte não terminava, porque o índice de palavras era apagado trecho por trecho com uma varredura completa;
- a busca comparava todos os vetores a cada mensagem.

Correções:
- **Índice de palavras ligado ao trecho:** remover a fonte leva 1,3 s. A tabela antiga é migrada sozinha em ~1 s.
- **Busca por candidatos acima de 5 mil trechos:** os 300 melhores por palavra e os 300 por significado, num cache de vetores em memória. Fica em ~90 ms por busca; a primeira, que monta o cache, leva ~1 s.
- **Embeddings em lote:** 16 trechos por chamada.
- **Pontuação por raridade (IDF):** palavras raras no acervo pesam mais.
- **Busca automática só para pedidos de informação:** "qual", "quanto", "me traz", "resuma", "?". Saudações e ordens de ação ("oi", "crie", "abra") nunca puxam documentos. Num acervo grande e misturado nenhum sinal de pontuação sozinho separava "oi, tudo bem" de uma pergunta real.

Arquivos citados na conversa ("resuma o MARU_MEDIA_KIT_PDF_FINAL", um caminho colado):
- são localizados pelo nome no projeto, Área de Trabalho, Documentos, Downloads e OneDrive;
- são lidos antes da resposta e continuam anexados nos turnos seguintes;
- caminhos com `$env:`, barras duplicadas ou acentos corrompidos são corrigidos ou encontrados pelo nome;
- o histórico só repete as ações que deram certo, então um link inventado não volta a ser tentado.

## OCR de documentos escaneados (03/10)

- **Páginas sem texto:** uma página de PDF com menos de 20 caracteres de texto é desenhada pelo pdf.js num canvas (`@napi-rs/canvas`, ~200 dpi) e lida pelo Tesseract local (`por+eng`).
  - Só essas páginas passam pelo OCR, então um PDF misto mantém o texto real.
  - No máximo 40 páginas por documento.
  - O texto lido sai com o cabeçalho `## Página N (OCR)`, e o mapa mostra "lido por OCR".
- **Imagens:** `.png`, `.jpg`, `.bmp` e `.webp` com texto legível também entram (a partir de 20 KB, o que descarta ícones). Uma foto sem texto não vira documento.
- **`read_file` e arquivos citados no chat** também leem PDFs escaneados e imagens.
- **Se o OCR falhar** (por exemplo, sem o arquivo do idioma), a mensagem diz isso, em vez de "documento sem texto".
- **Medições** (RTX 4090, página A4):
  - desenhar a página: ~0,3 s;
  - OCR: ~0,8–1,1 s;
  - o comunicado escaneado da amostra é lido sem erros ("Marcos Lima, ramal 2210", "26/12/2026").

## Conversas longas na bateria (03/10)

A bateria do agente (`app/agentEval.js`) agora aceita tarefas de vários turnos na mesma conversa. Há três conversas de RH, com 20 turnos no total:
- seguimentos sem repetir o assunto ("e o auxílio home office?", "quem eu procuro?");
- "valeu" e "oi, tudo bem?" no meio, que não podem puxar documentos;
- políticas que não existem (bônus anual, curso de inglês);
- a pergunta respondida pelo comunicado escaneado;
- o usuário contradizendo o documento ("me disseram que é dia 20").

Toda "Fonte:" precisa ser um arquivo real do acervo. O resumo mostra os turnos certos além das tarefas.

Erros reais encontrados com `qwen3.5:4b`:
- **Documento inventado para sustentar um "sim":** "a empresa paga curso de inglês, veja Programa de Educação Corporativa". Motivou a trava de documento inventado (abaixo).
- **Nome copiado errado do documento escaneado:** "Marcoa Lima"; numa rodada, um nome e um ramal inventados. A busca acha o documento certo (pontuação 2,9), então o erro é da cópia pelo modelo pequeno, não da busca nem do OCR.
- **Leitura de documento da empresa esperava autorização:** o `read_file` de um documento da pasta de conhecimento caía em "ler fora da pasta do projeto" e ficava 120 s esperando autorização. Agora, a pasta cadastrada como conhecimento é lida como a do projeto. Escrever nela continua pedindo autorização, e a IA paga continua pedindo para ver.

**Trava de documento inventado:** numa conversa local, a resposta que cita ("Fonte: …" ou um nome de arquivo) um documento que não existe no índice volta uma vez para o modelo, com a ordem de responder só com o que os documentos dizem.
- **O que conta como existente:** os nomes de arquivo, os títulos das fichas e os arquivos lidos no turno.
- **Exceção:** turnos que usaram a web ou o navegador não são conferidos.

**Régua corrigida:** a primeira versão reprovava respostas honestas. Nos registros das rodadas, as mudanças são estas:
- o "não encontrei" passa a aceitar as variações ("não foi encontrada informação", "não contém");
- só um valor atribuído à política inexistente (bônus, viagem) conta como resposta forçada, e citar o vale-refeição real ao lado não conta;
- a fonte é comparada sem o parêntese do nome ("Plantão do recesso.pdf" é o arquivo real);
- em "dividir em quantas partes", basta o "3".

### Medições (03/10, `qwen3.5:4b`, bateria inteira de 23 tarefas, cópia do banco real)

| Rodadas | Versão | Tarefas | Turnos das conversas | Conversas inteiras | RH (7 perguntas) |
|---|---|---|---|---|---|
| 1–3 | régua antiga, sem a trava | 59/69 | 51/60 | 2/9 | 20/21 |
| 4–6 | régua corrigida + trava (com 2 bugs de recorte do nome) | 60/69 | 59/60 | 8/9 | 20/21 |
| 7–9 | régua corrigida + trava corrigida | 61/69 | 58/60 | 7/9 | 20/21 |

Cada rodada leva cerca de 1 minuto. As rodadas 1–3 não podem ser recontadas com a régua nova, porque as respostas ficaram guardadas cortadas.

O que ainda falha:
- **"Sim" sem citar documento:** "a empresa paga curso de inglês?" virou um "sim" genérico em 2 de 3 rodadas, sem citar nenhum documento, e por isso a trava não pega.
- **Falhas fora do conhecimento:** a conta "17 vezes 3" e tarefas de código oscilam rodada a rodada. O código anterior a esta versão também errou a conta em 2 de 4 tentativas, então não é regressão.

### Travas de fidelidade aos documentos (03/10, depois da 0.1.29)

Estão em `app/grounding.js` e não fazem nenhuma chamada paga. Cada trava devolve a resposta ao modelo no máximo uma vez. O resultado do turno registra qual trava atuou (`execution.checks`), e a bateria mostra isso por turno.

1. **Pergunta sobre a empresa sem consulta:**
   - **Quando atua:** a pergunta fala da empresa (RH, política, benefício, férias…), nenhum documento foi encontrado automaticamente e o modelo respondeu sem pesquisar.
   - **O que acontece:** ele é mandado usar `knowledge_search`.
   - **Exceção:** um "não encontrei" honesto passa direto.
2. **Nome ou número copiado errado:**
   - **Números:** um número de 4 ou mais dígitos que não está nos documentos nem na conversa (ramal 2200 quando o documento diz 2210).
   - **Nomes:** um nome quase igual a um real ("Marcoa Lima" no lugar de "Marcos Lima").
   - **O que não conta:** "R$ 80,00" vale "R$ 80"; acrescentar o ano a uma data não conta; contas feitas pelo modelo não são conferidas; títulos e expressões comuns ("Data do Evento", "Recursos Humanos") não são nomes.
3. **"Sim" sem base:**
   - **Quando atua:** uma pergunta de sim/não sobre a empresa ("A empresa paga curso de inglês?") respondida com "sim", sobre um assunto que nenhum documento consultado menciona.
   - **O que acontece:** a resposta volta pedindo "não encontrei".

**Medições** (`qwen3.5:4b`, só as tarefas de conhecimento, as conversas e `achar-funcao`; 3 rodadas por linha):

| Versão | Tarefas | Turnos | Observação |
|---|---|---|---|
| Travas 1 e 2 na primeira versão | 30/33 | 55/60 | A trava 2 checava todo nome em maiúsculas e sinalizou "Data do Evento" e "R$ 80,00". Esses retornos pioraram respostas certas. |
| Travas 1 e 2 estreitadas | 32/33 | 59/60 | A falha restante foi o "sim, a empresa paga curso de inglês", que motivou a trava 3. |

**A primeira versão da trava 3 piorou o resultado.** Ela considerava qualquer palavra da pergunta ausente dos documentos ("cuida", "fica", "levar"). Nas duas rodadas completas que terminaram, ela fez o modelo trocar três respostas certas por "não encontrei":
- rodada 13: 19/23 tarefas, 18/20 turnos;
- rodada 14: 21/23 tarefas, 20/20 turnos.

A trava foi restringida a perguntas de sim/não respondidas com "sim". Com isso, as três travas entraram na bateria completa (rodadas 16–18):

| Rodadas | Tarefas | Turnos | Conversas inteiras | RH |
|---|---|---|---|---|
| 7–9 (0.1.29, sem estas travas) | 61/69 | 58/60 | 7/9 | 20/21 |
| 16–18 (com as 3 travas) | 65/69 | 59/60 | 8/9 | 20/21 |

Correções que as travas fizeram e que acertaram na volta:
- **Nome copiado errado:** "Marco Lima" virou "Marcos Lima".
- **"Sim" sem base:** "Sim! A empresa oferece cursos de inglês" virou "não encontrei".

Um falso positivo restante foi corrigido depois das rodadas:
- **O que aconteceu:** dois números colados por um separador ("20" e "2026", lidos como "202026") foram sinalizados como erro, e o resumo de fim de ano, que estava certo, saiu errado.
- **Correção:** um número assim agora é conferido parte por parte.

As outras falhas das rodadas são:
- a conta "17 vezes 3", que já oscilava antes;
- uma resposta genérica ("procure o RH") para "quem eu procuro?".

### Calculadora, seguimentos e pedidos de contato (03/10)

- **Calculadora:** contas em português ("17 vezes 3", "15% de 200") são calculadas de forma exata (`app/runtimeFacts.js`) e entregues ao modelo como fato, como a hora.
- **Seguimentos:** uma pergunta de seguimento com pronome ("sobre isso", "e o…") busca documentos junto com a pergunta anterior.
- **Contatos:** um pedido de contato ("quem eu procuro?") aceita listas com ramal ou e-mail a partir da pontuação 1,0.
- **Busca:** o radical passa a casar só no início da palavra ("partes" não casa dentro de "coparticipação").

| Rodadas | Tarefas | Turnos | "17 × 3" | "Quem eu procuro sobre isso?" |
|---|---|---|---|---|
| 16–18 (antes) | 65/69 | 59/60 | 1/3 | 2/3 |
| 19–21 (depois) | 64/69 | 58/60 | 3/3 | 3/3 |

Os dois casos visados passaram a acertar em todas as rodadas. O total ficou dentro da variação entre rodadas.

As falhas novas não se repetiram entre rodadas:
- um "não encontrei" para o prazo de aprovação das férias;
- `contar-arquivos` e `pasta-leiame`, que já oscilavam antes.

As rodadas 19–21 levaram de 113 a 231 s, contra cerca de 65 s antes, com o computador sob outra carga.

## IA paga revisa a organização (03/10)

Em Configurações → Conhecimento, o botão **"Revisar com IA paga"** manda ao professor (Codex ou Claude, o mesmo do ensino automático) as **fichas** de até 60 documentos da fonte:
- **O que vai:** título, tipo, categoria, resumo, palavras-chave, fluxo e o caminho do arquivo. Nunca o texto dos documentos.
- **Fonte restrita:** se a pasta não está liberada para IA paga, a UI pede confirmação antes do envio.
- **Custo:** conta no mesmo limite diário do professor.
- **Resposta:** o professor devolve uma nota sobre a taxonomia e correções campo a campo. Correções inválidas são descartadas: documento inexistente, tipo fora da lista, categoria com mais de 4 palavras, valor igual ao atual.
- **Decisão:** nada muda até a pessoa **aceitar**. A correção aceita fica guardada na ficha (`card.overrides`):
  - a categoria vale mesmo depois de o arquivo mudar;
  - os outros campos valem enquanto o texto do arquivo for o mesmo.
- **A local aprende:** as três correções aceitas mais recentes do departamento entram como exemplos no prompt que a IA local usa para fichar os próximos documentos.

Teste real (Codex, amostra de RH, fichas escritas pelo `qwen3.5:4b`): 7 fichas revisadas em 27 s, com 10 sugestões. Exemplos:
- **Título errado:** "Solicitação de licenças" → "Como solicitar férias".
- **Categoria:** o plantão do recesso sai de "Eventos" para "Contatos".
- **Palavras-chave:** "férias" e "pedido de férias" entram nas palavras-chave da ficha de férias, que não tinha "férias".

A correção aceita sobreviveu à reindexação e apareceu como exemplo no prompt.

## Próximos passos

- **Servidor da empresa:** índice e memória por departamento num servidor com GPU e modelo maior; permissões por usuário via Active Directory/Entra ID, filtrando a busca pelas permissões de cada documento.
- **SharePoint direto pela API do Microsoft Graph**, com login corporativo.
- **"Sim" sem base:** quando a pergunta é sobre a empresa, nenhum documento responde e o modelo afirma algo, a resposta deveria voltar pedindo "não encontrei". É a falha que sobrou nas conversas longas.
- **Cópia fiel de nomes e números:** o modelo pequeno ainda erra a cópia de nomes ("Marcoa"). Uma conferência dos nomes próprios e números da resposta contra os trechos usados pode mandar a resposta de volta, como a trava de documento inventado.
- **Escala:** busca por candidatos (FTS + vetores) em vez de pontuar todos os trechos, quando passar de dezenas de milhares.
