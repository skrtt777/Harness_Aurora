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

## Próximos passos

- **Servidor da empresa:** índice e memória por departamento num servidor com GPU e modelo maior; permissões por usuário via Active Directory/Entra ID, filtrando a busca pelas permissões de cada documento.
- **SharePoint direto pela API do Microsoft Graph**, com login corporativo.
- **OCR** de PDFs escaneados com o Tesseract, que já está no projeto.
- **IA paga como auxiliar da organização:** com autorização, propor a taxonomia de categorias e revisar fichas e fluxos extraídos pela local.
- **Escala:** busca por candidatos (FTS + vetores) em vez de pontuar todos os trechos, quando passar de dezenas de milhares.
