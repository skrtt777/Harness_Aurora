# Roteiro da Aurora

O roteiro vivo do projeto. Os roteiros antigos (MVP, mestre, melhorias de setembro) e o diário do projeto estão em `docs/historico/`. As medições ficam nos documentos datados de `docs/` e nos relatórios de `reports/`.

**Objetivo:** primeiro, uso pessoal ("faça tudo que você faz"); depois, uso em empresa. A Aurora roda no computador da pessoa com um modelo local que aprende pelas memórias e com o professor pago (Claude/Codex).

## Como medimos

| Medição | Comando | Última |
|---|---|---|
| Testes automáticos | `npm test` | 417 passaram, 0 falhas (05/10) |
| Conversas reais | `npm run battery -- --runs 5` | 100% (75/75) com qwen3.5:4b (05/10, `reports/battery/`) |
| Agentes de setor (arquivo entregue) | `npm run agents:eval -- --db <banco.db> --runs 5` | 96,7%, 13 de 15 tarefas perfeitas (05/10, `reports/agentes/`) |
| Empresa fictícia (49 perguntas) | `node scripts/empresa-eval.mjs --db <cópia>` | 83% com 1 resposta, 92% com 5 cópias (`docs/AVALIACAO_EMPRESA_2026-10-04.md`) |
| Tarefas do agente | Configurações → Avaliação | `docs/chat-agente.md` |

**Regra:** uma versão só sai se a bateria de conversas não cair mais de 5 pontos.

## Feito

- **Chat agente** (setembro): modos Manual/Auto/Plano, pasta do projeto, arquivos, terminal, navegador, memória, skills e plano (`docs/REVISAO_2026-09-27.md`).
- **Ciclo de ensino:** o professor revisa erros e entregas, as lições viram memória e o modelo local refaz. A lição nova é candidata (vale menos) até ajudar.
- **Conhecimento da empresa:** índice com OCR, busca por setor, travas contra documento inventado e várias cópias do modelo com consenso (`docs/CONHECIMENTO_EMPRESA.md`).
- **Entrega real (0.1.32):**
  - documentos Word, Excel e PDF com `write_document`;
  - travas de entrega falsa e de "quer que eu crie?";
  - cartão do arquivo no chat;
  - fim do terminal piscando;
  - o modelo `llama3.2:3b` antigo passou para o `qwen3.5:4b`.
- **Manutenção (04/10):**
  - o turno do chat foi separado do servidor (`app/chatTurn.js`);
  - o llama-server grava log e tem 16 mil tokens por vaga;
  - comandos pedem autorização depois de a Aurora ler a web.

## Agora

1. **Agentes de tarefa (`docs/AGENTES_ROTEIRO.md`):**
   - fase B concluída: tarefas conferíveis no `F:\EmpresaIA`, 96,7% (`npm run agents:eval`);
   - fases C a F: setores, rotinas agendadas, orquestrador e agentes pessoais.

   Cada agente novo ganha cenários na bateria de conversas.
2. **Bateria maior:** pesquisa na web com resumo, organizar uma pasta, corrigir um script e conversas longas (10 ou mais turnos). A bateria cobre o que as pessoas pedem de verdade.
3. **Planilhas:** o filtro por comparação de números e datas já está no `read_file` (05/10). Falta fazer o modelo usá-lo sempre, em vez de comparar de cabeça quando a planilha cabe inteira.

## Depois

- **Streaming no agente:** a resposta aparece só no fim. No Quest já existe streaming.
- **Cache de prompt:** `compactOldToolResults` reescreve resultados antigos a cada passo e invalida o cache do prompt. Na GPU isso é irrelevante, mas pesa em PCs sem placa. Medir num notebook antes de mudar.
- **Empresa:**
  - perfis e políticas por pessoa;
  - registro de auditoria;
  - instalador assinado com certificado de empresa (o SmartScreen e a TI bloqueiam sem isso);
  - atualização controlada pela TI.
- **Quest/XR:** a mesma "mente" do PC (mesmo contexto e memória). O backend é do Claude; o visual do Unreal é do Codex.

## Em espera

Estas frentes não avançam até o chat e os agentes estarem sólidos na bateria: memória central e comunidade no GitHub, atlas 3D, painel de treino de modelo e workflows. Elas continuam funcionando como estão.
