# Ciclo 2 — testes funcionais no executor

Data: 20/09/2026. Implementação ativa na prévia `http://127.0.0.1:8788`. O aplicativo instalado na porta 8787 permanece na versão anterior.

## Entrega

O executor de etapas agora aceita contratos de testes antes da geração, executa interações reais no navegador, verifica persistência após recarregar, combina filtros e confere cálculos. As falhas informam ação, seletor, esperado e observado. Correções usam edições pequenas com alvo literal; versões anteriores e evidências são preservadas. Uma regressão ou falha funcional bloqueia o avanço.

Testes não consomem chamadas ao modelo. Reverificar uma etapa não aumenta os tokens. Planejamento, geração e reparo continuam no orçamento cumulativo. A chave de reutilização inclui contrato e versão do validador. A interface apresenta contagens resumidas e deixa os detalhes recolhidos nos ajustes da conversa. [Como usar e limites](TESTES_FUNCIONAIS.md).

## Verificação da implementação

- `npm test`: **215 testes passaram**, nenhum falhou ou foi ignorado, em 167,3 segundos. Log: `app/data/cycle2-tests.log`.
- As 12 verificações novas incluem quatro implementações corretas e quatro defeitos intencionais, persistência real, isolamento entre casos, cálculos, proteção contra regressão, dependências bloqueadas, cancelamento, ausência de requisições externas, contratos via API e orçamento de reparo.
- `npm run frontend:build`: TypeScript e build passaram. Permanece o aviso existente de bundles acima de 500 KB.
- Interface real: importação do contrato, plano direto com zero chamadas, execução, diagnóstico e bloqueio observados na prévia.

## Modelo local real: defeitos controlados

Modelo `qwen2.5-coder:1.5b`, semente 17, temperatura 0,2, até duas correções por defeito, saída limitada a 1024 tokens por chamada. Cada entrada inicial é um HTML com defeito sintético, fornecido ao executor com custo zero; **não é uma geração completa da IA**. Os reparos são chamadas reais ao Ollama. O banco do ensaio é separado e não contém o acervo de memórias do usuário.

| Caso | Resultado | Chamadas reais | Entrada | Saída | Total |
|---|---|---:|---:|---:|---:|
| Reiniciar e contar novamente | Corrigido e validado | 1 | 637 | 68 | 705 |
| Restaurar tarefas após recarregar | Corrigido e validado | 1 | 656 | 82 | 738 |
| Combinar categoria e pesquisa | Bloqueado: alvo de edição não coincide | 2 | 1617 | 337 | 1954 |
| Margem calculada sobre receita | Bloqueado: mudança sem progresso | 2 | 1978 | 110 | 2088 |
| **Total** | **2/4 recuperados** | **6** | **4888** | **597** | **5485** |

Na primeira configuração do reparo, esses mesmos casos consumiram 12853 tokens em oito chamadas e nenhum foi recuperado. Reduzir duplicações, retirar referências opcionais do reparo e terminar o prompt com a instrução de edição baixou o consumo para 5485 tokens: **57,3% menos nesse ensaio de desenvolvimento**, com recuperação de dois casos. Não é uma estimativa de economia para projetos gerais nem evidência em tarefas inéditas: o prompt foi ajustado depois de observar os primeiros resultados.

Os dois ensaios estão preservados:

- [Primeira configuração](../reports/cycle2-functional-workflows-2026-09-20/results.json).
- [Reparo compacto](../reports/cycle2-functional-workflows-compact-2026-09-20/results.json), com prompts, respostas, HTML anterior/posterior e evidências por tentativa.
- [Script reproduzível](../scripts/benchmark/probe-functional-workflows.mjs). Uma nova execução exige outro identificador para não sobrescrever medições anteriores.

O contador de chamadas do workflow inclui também a entrega inicial simulada; as colunas acima contam **somente chamadas reais**. A conclusão da etapa no ensaio para em `awaiting_acceptance`, sem inventar aceite humano.

## Geração natural pela interface

Um contador foi gerado e corrigido pela prévia com a configuração legada e o acervo existente. Consumiu **3397 tokens em duas chamadas reais**, sem professor. Ficou bloqueado porque o contrato exigia texto literal `2` e o modelo produziu `2.00`; a edição proposta não encontrou o trecho literal. Esse caso demonstra rejeição de um contrato de apresentação e falha do reparo, **não comprova defeito na aritmética do contador**. Evidência: [cycle2-product-smoke.json](../reports/cycle2-product-smoke.json).

Quando o requisito for igualdade numérica e não formatação exata, o contrato deve usar `assertNumber` e o locale correspondente. O teste acima foi preservado sem relaxar seu critério após ver o resultado.

## O que falta

O executor verifica os cenários configurados; ainda não traduz qualquer pedido em um conjunto completo e confiável de testes. Propostas da própria IA não autorizam aprovação automática da cobertura. A integração é para etapas HTML; o chat comum mantém a análise estática anterior.

Próximas prioridades: tornar alvos de edição confiáveis sem aceitar substituições ambíguas, melhorar correções de filtros e cálculos, distinguir requisitos numéricos de apresentação nos contratos e avaliar novas tarefas após congelar a configuração. Não houve campanha nova de memória nem medição de energia neste ciclo; a hipótese editável de R$ 1,00/kWh dos dashboards permanece inalterada.
