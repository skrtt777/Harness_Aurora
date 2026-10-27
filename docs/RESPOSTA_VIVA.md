# A resposta viva

O comprovante ([COMPROVANTE.md](COMPROVANTE.md)) sabe de que célula veio cada número de uma resposta. A resposta viva usa isso depois da resposta: **quando a planilha muda, a Aurora avisa que aquele número não vale mais e diz o valor novo.**

> Só o Bruno Lima bateu a meta: vendeu ~~R$ 101.250,00~~ **R$ 104.800,00** …
>
> **Vendas Outubro.xlsx mudou depois desta resposta** · 4 números não valem mais
> - ~~R$ 101.250,00~~ → R$ 104.800,00 (Outubro › D4)
> - ~~R$ 286.650,00~~ → R$ 340.200,00
> - ~~R$ 73.350,00~~ → R$ 79.800,00
> - ~~R$ 360.000,00~~ → R$ 420.000,00
>
> [Refazer com os dados novos]

## Por que é nosso

A pesquisa de 27/10 procurou, e nenhum assistente faz isso: ChatGPT, Copilot no Excel, NotebookLM, OpenClaw e Hermes. O que existe:
- carimbo de data nos dados, para o agente responder com cautela;
- reindexar documentos que mudaram (RAG);
- ferramentas que comparam uma planilha com o sistema de origem.

Nenhum deles volta a uma resposta já dada para dizer que ela ficou errada. Para isso é preciso saber a célula de cada número, e só a Aurora guarda isso.

## Como funciona (`app/proofLive.js`, `app/proofWatch.js`)

- **Barato quando nada mudou:** compara a data de modificação do arquivo com a da resposta. Se o arquivo é mais antigo, é uma consulta ao disco e acabou.
- **Quando mudou:** relê o arquivo inteiro e também refaz as leituras da própria resposta, com os mesmos argumentos do `read_file` (filtro, ordem, offset). Assim, as somas e contagens que a ferramenta tinha escrito são recalculadas.
- **Célula:** a linha é achada pelo nome, como "Bruno Lima" (ela pode ter descido porque entrou outra acima), e entre linhas de mesmo nome, pela que tem mais células iguais. A coluna é achada pelo nome, ou pela posição quando a leitura tinha começado no meio da tabela.
- **Contas:** soma, média e contagem são refeitas com a leitura de onde vieram (o comprovante v2 guarda o filtro). Quantidade × preço é refeito na linha. A − b, % e desconto são refeitos com os números novos, até nada mais mudar.
- **Cada número termina como:**
  - **confere**;
  - **mudou**, com o valor novo;
  - **sumiu**: a linha, a coluna ou o arquivo não estão mais lá;
  - **mantido**: a fonte não é um arquivo (internet, memória, a pasta de boletos), e por isso não há o que reler.
- Nenhum modelo participa.

## Onde aparece

- **No chat:**
  - ao abrir a conversa, depois de cada resposta e quando a janela volta ao foco (a pessoa editou a planilha no Excel e voltou), o número antigo aparece riscado, com o novo ao lado;
  - o cartão do número mostra "Depois desta resposta, Outubro › D4 passou a dizer R$ 104.800,00" e, abaixo, a linha como era;
  - o aviso embaixo da resposta tem o botão "Refazer com os dados novos";
  - o selo passa a dizer "Comprovado na hora da resposta".
- **Na tela inicial:** "Respostas que mudaram", com as respostas recentes de qualquer conversa cuja planilha mudou. Um clique abre a conversa.
- **API:** `POST /api/conversations/:id/proof-recheck` e `GET /api/proof/stale`.

## Medição (`scripts/live-accuracy.mjs`)

Foram usadas 295 respostas reais com comprovante, das baterias de uso (12 bancos copiados), e os arquivos foram relidos à força.

| Medida | Resultado |
|---|---|
| Alarmes falsos (nada mudou e mesmo assim avisou) | **0 de 992** números reconferidos |
| Célula mudada em 10% (em memória; o arquivo não é escrito), pega com o valor novo certo | **271 de 301** |
| As 30 restantes | vêm da ferramenta de boletos, que lê uma pasta e ainda não é relida; ficam "mantido", sem aviso errado |

O primeiro resultado foi de 35% de alarmes falsos. Cinco correções levaram o número a zero:
1. As notas que o `read_file` escreve só aparecem refazendo a leitura.
2. Linhas com o mesmo nome são separadas pelas outras células.
3. Para um número dentro de um texto, como "Duplicata 2132", compara-se o texto da célula.
4. Um trecho que começa no meio da tabela é lido pela posição da coluna.
5. Uma conta de resposta antiga, sem a leitura guardada, não é dada como mudada.

`scripts/smoke/live-shot.mjs` cria uma planilha .xlsx de verdade e uma resposta comprovada, muda a planilha e confere a tela, o cartão e a tela inicial.

## Próximos passos

- [ ] Reler a pasta de boletos (bills) como reler um arquivo.
- [ ] Documentos entregues: avisar que o relatório gravado ficou desatualizado.
- [ ] WhatsApp: mandar "a planilha mudou, o número que te passei agora é…" para quem perguntou por lá. Isso manda mensagem para fora e precisa de aprovação.
