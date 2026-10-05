# Roteiro da Aurora

O roteiro vivo do projeto. Os roteiros antigos (MVP, mestre, melhorias de setembro) e o diário do projeto estão em `docs/historico/`. As medições ficam nos documentos datados de `docs/` e nos relatórios de `reports/`.

**Objetivo:** primeiro, uso pessoal ("faça tudo que você faz"); depois, uso em empresa. A Aurora roda no computador da pessoa com um modelo local que aprende pelas memórias e com o professor pago (Claude/Codex).

## Como medimos

| Medição | Comando | Última |
|---|---|---|
| Testes automáticos | `npm test` | 458 passaram, 0 falhas (05/10) |
| Conversas reais (5 cenários: documento, planilha, 10 turnos, navegador, honestidade) | `npm run battery -- --runs 3` | 100% com qwen3.5:4b e especulação ligada (05/10, `reports/battery/`) |
| Agentes de setor (arquivo entregue) | `npm run agents:eval -- --db <banco.db> --runs 3` | 7 setores + rotina de pasta: 96,9%, 22 de 24 perfeitas (05/10, `reports/agentes/`); variação de ±5 pontos com 3 rodadas |
| Orquestrador | `node scripts/orchestrator-eval.mjs --scenario fechamento|dependencia --runs 3` | fechamento 87,9%; dependência 90,5%; plano certo em 100% (05/10) |
| Agentes pessoais (organizar, código, pesquisa) | `node scripts/personal-tasks.mjs --runs 5 [--online]` | 92%; pesquisa 91,7% (05/10) |
| Empresa fictícia (49 perguntas) | `node scripts/empresa-eval.mjs --db <cópia>` | 96,9% (47 e 48 de 49 em 2 rodadas) com a escalada do app no llama-server, 2 s por pergunta (05/10); era 83% com 1 resposta |
| Velocidade do modelo local | `node scripts/spec-bench.mjs` | cópia de 40 linhas: 12,4 s → 3,4 s (GPU); 8,5 → 40 tokens/s (CPU) com `ngram-mod` (05/10) |
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

- **Velocidade e precisão (05/10, tarde):**
  - decodificação especulativa por n-gramas no llama-server (sem modelo auxiliar);
  - Desfazer movimentos de arquivos, no cartão do agente e no chat;
  - `read_file` filtra CSV, segue o "até/a partir de" do pedido, sugere o filtro de período ("esse mês") e acha caminhos relativos à pasta da empresa;
  - `write_document` avisa linhas que ficaram de fora; a resposta sempre diz onde está o arquivo;
  - navegador: Enter num campo de várias linhas envia o formulário de verdade;
  - `move_file` leva vários arquivos de uma vez.
- **Pesquisado e descartado (05/10):** amostragem recomendada do Qwen (temperatura 0,7, sem penalidade de repetição): conversas caíram de 100% para 86,7% (laços de busca). Template de chat "corrigido" da comunidade: o defeito do bloco `<think>` vazio não se aplica ao modo sem raciocínio que usamos.

## Agora

1. **Agentes de tarefa (`docs/AGENTES_ROTEIRO.md`):** as fases B a F foram concluídas em 05/10:
   - avaliação pelo arquivo entregue;
   - 7 setores;
   - agendador por horário e por pasta;
   - orquestrador;
   - agentes pessoais;
   - a tela "Agentes".

   Feito depois: dependências entre tarefas do orquestrador, barra lateral sem um projeto por agente, modelos prontos, andamento ao vivo, exportar histórico, Desfazer.
2. **Bateria de conversas maior:** conversas longas (10 ou mais turnos) e mudança de assunto no meio. Pesquisa, organização de pastas e correção de código já estão na avaliação dos agentes pessoais.
3. **Planilhas:** o filtro por comparação de números e datas já está no `read_file` (05/10). Falta fazer o modelo usá-lo sempre, em vez de comparar de cabeça quando a planilha cabe inteira.

## Depois

- **PCs sem placa de vídeo:** a especulação deu 5x na geração; falta medir o processamento do prompt inicial (cerca de 4.700 tokens fixos, já em cache entre conversas) num notebook de verdade.
- **Empresa:**
  - perfis e políticas por pessoa;
  - registro de auditoria;
  - instalador assinado com certificado de empresa (o SmartScreen e a TI bloqueiam sem isso);
  - atualização controlada pela TI.
- **Quest/XR:** a mesma "mente" do PC (mesmo contexto e memória). O backend é do Claude; o visual do Unreal é do Codex.

## Em espera

Estas frentes não avançam até o chat e os agentes estarem sólidos na bateria: memória central e comunidade no GitHub, atlas 3D, painel de treino de modelo e workflows. Elas continuam funcionando como estão.
