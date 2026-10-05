# Aurora 0.1.33: arquivo entregue à vista, lições com prova e mais segurança

## O arquivo aparece na conversa

- Quando a Aurora cria ou edita um arquivo, a resposta mostra um cartão com o nome e a pasta, e os botões **Abrir** e **Mostrar na pasta**.
- Abrir só funciona com documentos e imagens. Um programa nunca é executado por esse botão.

## Sem afirmação falsa de entrega

- Se a gravação foi negada ou falhou e mesmo assim a resposta diz "já criei o arquivo", a Aurora acrescenta um aviso: nenhum arquivo foi gravado, e por quê.
- "Vou criar o documento…" sem criar, ou "posso prosseguir?", voltam para o modelo fazer de fato.
- Um caminho que repete o nome da pasta do projeto ("planilha/contratos.xlsx" dentro da pasta "planilha") não cria mais uma subpasta duplicada.

## Lições do professor com prova

- Uma lição nova do Claude/Codex entra como **candidata**: vale menos na escolha do contexto até ajudar pelo menos uma vez. Ela é arquivada depois de 2 falhas sem ajudar.
- O mapa de memórias mostra quais lições ainda são candidatas.

## Segurança

- Depois que a Aurora lê páginas da internet numa conversa, todo comando pede sua autorização, mesmo dentro da pasta do projeto. Uma página pode trazer instruções escondidas. As regras de "permitir sempre" continuam valendo.
- O conteúdo da internet chega ao modelo marcado como informação, nunca como instrução.

## Por baixo

- **Mais contexto:** o modelo local tem 16 mil tokens por resposta em paralelo, eram 12 mil, para caber um PDF anexado mais a revisão do professor. Custa 0,4 GB a mais de memória de vídeo.
- **Log:** o servidor do modelo grava `llama-server.log` na pasta de dados. Antes ele não deixava rastro nenhum.

## Verificação

- `npm test`: 412 testes passaram, 0 falhas.
- **Bateria de conversas reais** (`npm run battery`, nova): resumir um PDF, criar a versão atualizada e achar o arquivo; filtrar uma planilha e entregar outra; dizer que não encontrou. Com `qwen3.5:4b`, deu **95,6% em 3 rodadas**.
- **Smoke do app empacotado:** abre, reinicia e mantém os dados.
