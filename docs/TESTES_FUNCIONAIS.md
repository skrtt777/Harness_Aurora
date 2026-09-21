# Testes funcionais no executor

O executor de etapas agora testa comportamentos em HTML com um contrato declarativo fixado antes de gerar o artefato. Os testes não chamam a IA. Cada cenário usa um navegador isolado, sem acesso à rede; ações do mesmo cenário compartilham localStorage, inclusive após `reload`. Outro cenário começa vazio.

## Uso na interface

Em uma conversa Local, abra **Ajustes da conversa → Execução por etapas → Testes de aceitação** e importe um JSON. Descreva o objetivo e prepare o plano. Os resultados ficam nos detalhes de cada etapa. **Refazer verificações sem usar IA** executa o mesmo contrato sem gerar novamente.

Exemplos prontos para uma etapa HTML estão em [knowledge/test-contracts](../knowledge/test-contracts/): `restart.json`, `persistence.json`, `filters.json` e `calculations.json`. Eles são exemplos de desenvolvimento com seletores e dados específicos; adapte-os aos requisitos do seu projeto. Os objetivos correspondentes estão em [functional-fixtures.mjs](../scripts/benchmark/functional-fixtures.mjs).

O planejamento local pode propor testes na mesma chamada que cria as etapas. Esses testes são identificados como propostas: se falharem, iniciam correção; se passarem, a cobertura ainda precisa de revisão humana. Pedidos diretos de uma etapa continuam dispensando a chamada de planejamento; sem contrato fornecido, recebem somente a verificação de inicialização e revisão. Não há inferência gratuita de requisitos arbitrários.

## Contrato e API

`POST /api/conversations/:id/workflows`, com a sessão existente:

```json
{
  "goal": "Entregue em uma etapa HTML um contador: #hit soma 1, #reset zera e #points exibe o valor.",
  "functionalContracts": [{
    "step": 0,
    "contract": {
      "version": 1,
      "cases": [{
        "id": "restart",
        "name": "Reiniciar o estado e contar novamente",
        "actions": [
          {"op": "click", "selector": "#hit"},
          {"op": "assertText", "selector": "#points", "expected": "1"},
          {"op": "click", "selector": "#reset"},
          {"op": "assertText", "selector": "#points", "expected": "0"},
          {"op": "click", "selector": "#hit"},
          {"op": "assertText", "selector": "#points", "expected": "1"}
        ]
      }]
    }
  }]
}
```

Para importar na interface, o arquivo contém apenas a lista `functionalContracts`. Os índices de etapa começam em zero. Cada contrato é persistido com hash, participa da chave de reutilização e é aplicado novamente na retomada e na reverificação. Contratos fornecidos têm precedência sobre sugestões do planejador. Uma mudança no contrato cria outra execução; uma mudança na versão do validador invalida o reaproveitamento anterior.

| Operação | Campos além de `op` | Verificação |
|---|---|---|
| `click` | `selector` | Clicar em um elemento |
| `fill`, `select` | `selector`, `value` texto | Preencher ou escolher valor de opção |
| `check` | `selector`, `value` booleano | Marcar ou desmarcar |
| `press` | `selector`, `value` | Enter, Escape, Space, Tab ou setas |
| `reload` | nenhum | Recarregar o mesmo artefato preservando armazenamento |
| `assertText`, `assertValue` | `selector`, `expected` texto | Texto visível normalizado ou valor exato |
| `assertCount` | `selector`, `expected` inteiro | Quantidade de elementos |
| `assertNumber` | `selector`, `expected` número | Número completo, moeda ou percentual; `locale` pt-BR (padrão) ou en-US, `tolerance` de 0 a 1 (padrão 0,001) |
| `assertChecked`, `assertVisible` | `selector`, `expected` booleano | Estado do controle ou visibilidade |

Limites: até 8 contratos por execução, 8 casos por contrato, 20 ações por caso e 80 ações no conjunto. Cada caso termina em uma asserção. O contrato aceita dados, não JavaScript ou comandos. Asserções têm prazo limitado, e a suíte tem orçamento de 15 segundos, além da inicialização do navegador. Indisponibilidade ou teste inconclusivo não gera aprovação automática.

## Correção e avanço

- A falha registra cenário, ação, seletor, esperado e observado. Os casos independentes restantes também são executados.
- O reparo recebe o objetivo, as instruções do projeto, o código sem CSS e a sequência que falhou. Skills e memórias opcionais não são reenviadas nesse reparo; o artefato e os requisitos já estão disponíveis.
- A IA responde com edições `before`/`after`. O alvo deve ser único e literal. Edições inválidas, sem mudança ou que removam IDs são rejeitadas.
- O contrato inteiro é executado novamente. A versão candidata só substitui a anterior se preservar as asserções que passavam e houver progresso nas verificações. Versões e evidências ficam no histórico.
- Falha impede dependências de avançarem e não pode ser anulada por uma aprovação genérica. Chamadas de reparo usam o mesmo orçamento cumulativo e a mesma contabilidade.
- Passar um contrato fornecido libera a próxima etapa. A entrega integrada mantém o aceite final existente. O resultado significa aprovação **nos cenários configurados**, não correção universal do projeto.

## Limites atuais

Esta integração atende o executor de etapas HTML. O chat comum continua usando análise estática e o reparo do ciclo anterior. Não cobre automaticamente servidores, banco de dados remoto, dependências externas, todos os requisitos de um pedido em linguagem natural ou qualidade visual. Ensinar testes melhores ao planejador e medir transferência para tarefas inéditas são trabalhos seguintes.
