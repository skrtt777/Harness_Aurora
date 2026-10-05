# Roteiro da Aurora

O roteiro vivo do projeto. Os roteiros antigos (MVP, mestre, melhorias de setembro) e o diário do projeto estão em `docs/historico/`. As medições ficam nos documentos datados de `docs/` e nos relatórios de `reports/`.

**Objetivo:** primeiro, uso pessoal ("faça tudo que você faz"); depois, uso em empresa. A Aurora roda no computador da pessoa com um modelo local que aprende pelas memórias e com o professor pago (Claude/Codex).

## Como medimos

| Medição | Comando | Última |
|---|---|---|
| Testes automáticos | `npm test` | 488 passaram, 0 falhas (05/10) |
| Conversas reais (5 cenários: documento, planilha, 10 turnos, navegador, honestidade) | `npm run battery -- --runs 3` | 100% com qwen3.5:4b e especulação ligada (05/10, `reports/battery/`) |
| Agentes de setor (arquivo entregue) | `npm run agents:eval -- --db <banco.db> --runs 3` | 7 setores + rotina de pasta: 98,8%, 38 de 40 perfeitas em 5 rodadas (05/10, noite; `reports/agentes/`); variação de ±5 pontos com 3 rodadas |
| Orquestrador | `node scripts/orchestrator-eval.mjs --scenario fechamento|dependencia --runs 3` | fechamento 100%; dependência 95,2% (05/10, noite; eram 87,9% e 90,5%) |
| Agentes pessoais (organizar, código, pesquisa) | `node scripts/personal-tasks.mjs --runs 5 [--online]` | 100% (6 de 6, com `organize_folder`); pesquisa 91,7% (05/10) |
| Empresa fictícia (49 perguntas) | `node scripts/empresa-eval.mjs --db <cópia>` | 96% a 100% em 3 rodadas (05/10, noite), 2-3 s por pergunta; era 83% com 1 resposta |
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
  - `move_file` leva vários arquivos de uma vez; `organize_folder` organiza uma pasta por tipo numa chamada.
- **Extensões MCP (05/10):** a pessoa conecta servidores MCP (e-mail, agenda, Notion…) em Configurações → Agente. Só-leitura roda direto; o resto pede autorização; o resultado conta como conteúdo de fora. Com o modelo local, 6 de 6 (achou a ferramenta e pediu autorização para criar).
- **Empresa (05/10):** registro de ações exportável (tudo o que a Aurora fez, em qualquer conversa) e histórico dos agentes.
- **Equipe (05/10):** dependência só quando o pedido diz sequência; trava `missing_delivery`; dica de filtro numérico. Testado e revertido: mandar o pedido inteiro a cada agente (eles faziam a parte dos outros).
- **Modelo maior (05/10):** qwen3.5:9b × 4b, mesmo código, 3 rodadas: conversas 96,7% × 100%, agentes de setor 100% × 97,9%, agentes 45% mais lentos. O 4b continua o padrão. O 9b responde "qual é meu nome?" com a conta do Windows dos caminhos ("Lucas"), mesmo com "A pessoa se chama Rafaela" no contexto; se for oferecido para placas fortes (detecção já pronta), isso precisa de solução antes.
- **Pesquisado e descartado (05/10):** amostragem recomendada do Qwen (temperatura 0,7, sem penalidade de repetição): conversas caíram de 100% para 86,7% (laços de busca). Template de chat "corrigido" da comunidade: o defeito do bloco `<think>` vazio não se aplica ao modo sem raciocínio que usamos.

## Agora

1. **Publicar a 0.1.35** (instalador em `release/`, notas em `docs/RELEASE_0.1.35.md`): `gh release create v0.1.35 …` (a 0.1.34 nunca foi publicada; a 0.1.35 a substitui).
2. **Busca da empresa ainda erra o documento** em perguntas curtas: "próximo imposto a vencer" (vai à web em vez do calendário de obrigações), "quem é o gerente de logística" (não traz a lista de ramais), "área mais acima do orçamento" (lê o orçamento do ano anterior). Medir com `empresa-eval --only fiscal-1,administrativo-2,controladoria-2 --samples 5`.
3. **Perguntas de "maior/menor/mais acima"** numa planilha: o mesmo tipo de dica pronta que já existe para datas ("vence primeiro" → sort), escolhendo a coluna pelas palavras do pedido.
4. **Extensões MCP com servidores reais** (Google Agenda, Gmail): só foram testadas com um servidor de teste; falta um teste de ponta a ponta com um servidor público.
5. **qwen3.5:9b** para placas fortes: melhor nos agentes, pior nas conversas; antes de oferecer, resolver o nome da conta do Windows tomado como nome da pessoa.

Feito em 05/10 (detalhes acima, em Feito): agentes de tarefa completos (fases B a F), tela Agentes, Desfazer, MCP, registro de ações, especulação e preparo antecipado do modelo.

## Depois

- **PCs sem placa de vídeo:** medido em 05/10 com o build só-CPU (`LLAMA_FORCE_CPU=1`): o início fixo do prompt (5,8 mil tokens) leva ~48 s; a pré-carga enquanto a pessoa digita levou a primeira resposta de 55 s para 10 s. Falta medir num notebook de verdade (CPU mais fraca).
- **Empresa:**
  - perfis e políticas por pessoa;
  - registro de auditoria (feito: exportação das ações e do histórico dos agentes);
  - instalador assinado com certificado de empresa (o SmartScreen e a TI bloqueiam sem isso);
  - atualização controlada pela TI.
- **Quest/XR:** a mesma "mente" do PC (mesmo contexto e memória). O backend é do Claude; o visual do Unreal é do Codex.

## Em espera

Estas frentes não avançam até o chat e os agentes estarem sólidos na bateria: memória central e comunidade no GitHub, atlas 3D, painel de treino de modelo e workflows. Elas continuam funcionando como estão.
