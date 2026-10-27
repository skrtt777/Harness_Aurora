# O comprovante: a Aurora prova cada número que diz

Cada número de uma resposta (valor, percentual, data, contagem) é ligado ao lugar de onde veio:

- a **célula** da planilha lida, com arquivo, aba e endereço do Excel (`Vendas.xlsx › Outubro › D3 (Vendido)`);
- a **linha** de um documento;
- a **conta** que o produz (soma de uma coluna, total de números escritos ao lado, a − b, a ÷ b × 100);
- os **números da própria pessoa**.

O que não tem prova fica marcado como **sem fonte**.

Nenhum modelo participa. O código lê as mesmas saídas de ferramenta que o modelo leu e decide sozinho. Por isso o comprovante dá sempre o mesmo resultado e pode ser conferido à mão. Ele vale para qualquer motor: o modelo local, o Claude ou o Codex pelo espelho.

## Na tela

- **No texto:** cada número tem um sublinhado fino.
  - Verde: comprovado.
  - Verde pontilhado: calculado.
  - Amarelo ondulado: sem fonte.
- **Ao passar o mouse:** abre o cartão da fonte, com a linha da planilha e a célula acesa. No app instalado há o botão "Abrir a planilha (célula D3)".
- **Embaixo da resposta:** o selo diz "Comprovado · 6 de 6 números com prova" ou "1 número sem fonte". Aberto, ele vira o comprovante inteiro, número por número.

## A conferência

Uma resposta feita a partir de dados pode ter número que não está em nada lido e não sai de conta nenhuma. Nesse caso, ela volta **uma vez** ao modelo, com esses números nomeados. O modelo então relê com `filter`, faz a conta com `calculate`, ou tira o número.

- A conferência só vale para respostas que já provam algum número. Uma legenda com "100% natural" não volta.
- Desligada por padrão; para ligar: `AURORA_PROOF_GATE=on`. Medida em 27/10, ela disparou em 2 de 60 cenários da escada e não mudou nenhuma nota além do ruído do modelo: baterias 2/3/4 com 89,1/100/90,5% desligada e 87/100/89,7% ligada; escada 87,7% desligada e 84,4% ligada. Nos cenários que mudaram, ela não tinha disparado. O selo já mostra à pessoa o número sem fonte.

Casos reais que motivaram a conferência (bateria de uso, 27/10):

| Pedido | Resposta do modelo | O que o comprovante mostrou |
|---|---|---|
| "Quantos funcionários trabalham hoje?" | "128 funcionários" | Contou de olho, lendo a planilha aos pedaços; o quadro ativo tem 113 pessoas |
| "Faz uma planilha das minhas contas fixas: luz 230, água 90" | "R$ 320,45" e "energia R$ 230,45" | Os centavos foram inventados; "R$ 320,00" seria provado como 230 + 90 |

## Por que é diferente

- **Outros harness** (ChatGPT, NotebookLM, OpenClaw, Hermes) citam o arquivo, quando citam, e confiam no modelo para copiar o número certo.
- **SymGen** (MIT, 2024): o modelo escreve referências a células, que são resolvidas depois. Isso exige um modelo treinado ou instruído para isso.
- **A Aurora** prova depois, sem mudar o modelo, e aponta a célula. Ela também diz em voz alta o que não tem prova.
- A ideia segue "um modelo de 4B como gerador de candidatos sob uma camada externa de aceitação" ([arXiv 2609.30219](https://arxiv.org/abs/2609.30219)) e as "deterministic gates" de [arXiv 2607.07405](https://arxiv.org/abs/2607.07405).

## Código

- `app/proof.js`
  - `claimsOf`: os números de uma resposta, sem caminhos, numeração de lista, anos soltos, nomes de modelo (G84, 50MP), horas, faixas ou dias por extenso.
  - `factsOf`: cada número de uma saída de ferramenta, com célula ou linha.
  - `columnsOf`: somas, médias e contagens das tabelas lidas.
  - `proveAnswer`: junta tudo e dá o comprovante.
- `app/chatAgent.js`: guarda as saídas das ferramentas do turno (e das anteriores da conversa), calcula a prova no fim e roda a conferência `unproven_numbers`.
- `app/chatTurn.js`: grava a prova em `execution.proof`.
- `frontend/src/Proof.tsx`: o plugin `remarkProof` marca os números no texto; `ProofMark` é o cartão; `ProofSeal` é o selo.
- Testes:
  - `test/proof.test.js`;
  - `scripts/smoke/proof-shot.mjs`, que tira capturas de tela com um banco temporário;
  - `scripts/proof-report.mjs`, que mede o comprovante sobre os bancos de uma bateria.

## Precisão medida (escada, 60 cenários com a resposta conhecida, 27/10)

Medida com `scripts/proof-accuracy.mjs`, que junta o relatório de uso às provas gravadas.

| | Selo "Comprovado" | Selo com aviso |
|---|---|---|
| Respostas certas (35) | 35 | 0 (nenhum aviso à toa) |
| Respostas erradas (2) | 1 | 1 ("R$ 247,51" para roupas em setembro, que eram R$ 427) |

- **Antes das correções da noite**, a mesma medida dava 3 avisos à toa em 33 respostas certas. As causas eram:
  - divisão pelo número de pessoas ou parcelas do pedido ("2 pessoas", "2x");
  - total pedido num turno seguinte ("e quanto dá tudo junto?").
- **Agora:**
  - as contagens pequenas do pedido entram como divisores;
  - o que uma resposta anterior provou vale como fonte no turno seguinte (`priorProofSources`), mas nunca um número que tinha ficado sem fonte.
- **O que o selo não pega:** a resposta que diz só números verdadeiros e deixa de fora o que foi pedido. O comprovante prova o que foi dito, não se a resposta está completa.
