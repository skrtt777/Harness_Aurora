# Aurora 0.1.21 — Catálogo Qwen3

- Opções sugeridas somente Qwen3 ou superior: Qwen3.5 0,8B, 2B, 4B, 9B e Qwen3-Coder 30B.
- Novo padrão Qwen3.5 4B, com download aproximado de 3,4 GB na primeira preparação. Estimativas de RAM no seletor não são requisitos de desempenho certificados.
- Escolhas antigas de Qwen1/2 e aliases conhecidos dos experimentos Aurora 1,5B usam o novo padrão. Os pesos antigos não são apagados; históricos e relatórios mantêm seus modelos originais.
- Geração Qwen3 com resposta direta (`think: false`) por padrão. Não é treinamento de pesos nem comprovação de ganho de precisão.

A meta é atender computadores de até 16 GB. O orçamento proposto de 30% da RAM, com pesos excedentes em SSD, está documentado como **experimento futuro**: esta versão não aplica um teto rígido de RAM nem incorpora um motor de leitura de especialistas pelo SSD. [Plano e limites](LOCAL_16GB.md).

## Verificação do modelo

O Qwen3.5 4B foi baixado e executado com e sem GPU no computador de desenvolvimento (i9-14900K, 32 GB de RAM, RTX 4090). Em uma pergunta de margem percentual, o teste com GPU retornou 35, como esperado; o teste em CPU retornou 0,35 e reprovou o critério de porcentagem. Ambos calcularam lucro de 350 corretamente. A falha foi preservada em `tmp/qwen35-4b-smoke.json` na máquina de desenvolvimento.

Esse ensaio verifica execução e formato; não é uma campanha de qualidade, não comprova ganho sobre Qwen2 e não representa um notebook de 16 GB. GPU e CPU podem produzir respostas diferentes. O catálogo muda por decisão de produto, sem afirmar aprovação nos critérios usados para promover modelos treinados.

## Distribuição

Verificações do aplicativo: 249 casos passaram na suíte inicial; um teste de interface aguardava o texto antigo do campo de modelo. O seletor foi atualizado para usar seu nome acessível e os 6 testes de interface passaram na reexecução, completando os 250 casos distintos. Os 6 testes de visualização e a verificação do executável empacotado também passaram. Esses testes de software são separados do ensaio do modelo acima.

Atualize pelo aplicativo ou baixe `Harness-Aurora-Setup-0.1.21.exe`. O instalador não possui assinatura digital de editor; os hashes acompanham a versão. O GitHub Actions da conta segue bloqueado por cobrança, portanto as verificações desta versão são executadas localmente.
