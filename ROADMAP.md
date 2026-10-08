# Roteiro da Aurora

O roteiro vivo do projeto. Os roteiros antigos (MVP, mestre, melhorias de setembro) e o diário do projeto estão em `docs/historico/`. As medições ficam nos documentos datados de `docs/` e nos relatórios de `reports/`.

**Objetivo:** primeiro, uso pessoal ("faça tudo que você faz"); depois, uso em empresa. A Aurora roda no computador da pessoa com um modelo local que aprende pelas memórias e com o professor pago (Claude/Codex).

## Como medimos

| Medição | Comando | Última |
|---|---|---|
| **Tudo de uma vez** | `npm run regressao -- --db <cópia> [--runs 2] [--rapido]` | compara com a rodada anterior e diz se pode publicar (`reports/regressao/`) |
| Testes automáticos | `npm test` | 560 passaram, 0 falhas (07/10) |
| Conversas reais (8 cenários: documento, planilha, 10 turnos, navegador, honestidade, mapa, continuidade, arquivos) | `npm run battery -- --runs 3` | 97,7% a 100% com qwen3.5:4b (07/10, `reports/battery/`) |
| Testes de uso (81 cenários em 4 baterias, linguagem de usuário leigo: digitação, pedido pobre, conversa longa, injeção) | `npm run uso -- --db <cópia> [--bateria N]` | bateria 1 96,2%, 2 94,7%, 3 100%, 4 97,5% (07/10, `reports/uso/`) |
| Agentes de setor (arquivo entregue) | `npm run agents:eval -- --db <banco.db> --runs 3` | 99–100% (24 de 24 perfeitas em duas rodadas seguidas, 06/10; `reports/agentes/`); variação de ±5 pontos com 3 rodadas |
| Orquestrador | `node scripts/orchestrator-eval.mjs --scenario fechamento|dependencia --runs 3` | fechamento 97–100%; dependência 100% (06/10) |
| Vigia ("avisar só quando houver novidade") | `node scripts/heartbeat-eval.mjs --runs 3` | 8/9 a 11/12 (06/10) |
| Celular (Telegram falso, boleto + planilha) | `node scripts/phone-eval.mjs --runs 2` | 4/4 (06/10) |
| Agentes pessoais (organizar, código, pesquisa) | `node scripts/personal-tasks.mjs --runs 5 [--online]` | 100% (6 de 6, com `organize_folder`); pesquisa 91,7% (05/10) |
| Empresa fictícia (49 perguntas) | `node scripts/empresa-eval.mjs --db <cópia>` | 94% a 100% (07/10), 2-3 s por pergunta; as 3 perguntas difíceis (imposto, gerente, orçamento) 3/3 |
| Velocidade do modelo local | `node scripts/spec-bench.mjs` | cópia de 40 linhas: 12,4 s → 3,4 s (GPU); 8,5 → 40 tokens/s (CPU) com `ngram-mod` (05/10) |
| Tarefas do agente | Configurações → Avaliação | `docs/chat-agente.md` |

**Regra:** uma versão só sai se a bateria de conversas não cair mais de 5 pontos. Toda avaliação importa `scripts/evalSandbox.mjs` (Desktop, Documentos e Downloads falsos).

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

- **Noite de 06/10 (0.1.37, `docs/NOITE_2026-10-06.md`):**
  - Aurora no celular (Telegram): conversa, arquivos nos dois sentidos, autorização por botão, avisos dos agentes;
  - mapa do computador, "Sobre você", diário, vigia que não repete aviso;
  - conversa e celular passam trabalho a um agente ou à equipe;
  - filtros prontos pela intenção do pedido e entrega conferida antes de gravar;
  - guia de boas-vindas para leigos, novidades após atualizar, tela inicial com saudação e o dia.

- **Testes de uso e briefings (06–07/10, 0.1.38):**
  - 4 baterias de testes de uso (81 cenários) com linguagem de usuário leigo, do simples à gerente; dezenas de defeitos achados e corrigidos (abreviações, renomear/mover, "apaguei" sem apagar, sofrimento → CVV, salário de colega restrito, cliente que mais deve por total, contagem por categoria);
  - **briefings** (`app/briefs/*.md`, 12 tipos): pedido pobre vira entrega completa, com opções de ajuste no fim (botões no app); bateria de pedidos pobres 52% → 97,5%; tela Configurações → Briefings para ligar, editar e criar;
  - pedido em dois passos ("faz uma planilha com eles") reusa a planilha lida antes; documento longo por partes (`append`); TOTAL na planilha de controle;
  - busca da empresa: imposto a vencer, gerente de um setor e "mais acima do orçamento" (valor e %);
  - `npm run regressao`: todas as medições, comparadas com a rodada anterior.

- **Acelerador do modelo local (07/10, `docs/ACELERADOR_2026-10-07.md`):** estudo do Strata aplicado ao qwen3.5:4b. Partida instantânea: o começo fixo do prompt (ferramentas + regras) salvo em disco e restaurado quando o servidor sobe: primeira resposta após reiniciar 68–74 s → 1,3 s na CPU; turno do agente na CPU 285 s → 109 s. Medido e descartado: MTP do próprio modelo (mais lento na GPU e na CPU), threads e tamanho do bloco (o padrão já é o melhor). Escrever menos: resposta de 2 frases depois de gravar, correção direto no arquivo, pedido de texto sem arquivo nem site: −27% de tokens escritos e −18% de chamadas, com a mesma nota.

## Agora

1. **Publicar a 0.1.38** (instalador em `release/`): `gh release create v0.1.38 …` com o .exe, o .blockmap e o latest.yml.
1. **Áudio pelo celular:** hoje a mensagem de voz recebe "mande por texto"; falta uma transcrição local leve (a do Quest depende de um serviço à parte).
2. **Briefings por setor** além de proposta e orçamento (RH, compras, jurídico), e medir quanto cada novo briefing ajuda com a bateria 4 antes de manter.
3. **Respostas longas e o limite de saída do modelo:** o relatório completo ainda passa do limite às vezes; ver se o `append` é usado sozinho ou se precisa de trava.
4. **Extensões MCP com servidores reais** (Google Agenda, Gmail): só foram testadas com um servidor de teste; falta um teste de ponta a ponta com um servidor público.
5. **"fetch failed" esporádico na avaliação da empresa** (2 perguntas numa rodada de 05/10, noite; uma rodada inteira não gerou relatório): o log do llama-server não mostra queda. Suspeita: um reinício do servidor com requisições em andamento (as cópias do consenso rodam em paralelo). No turno do app há nova tentativa automática; falta achar a causa.
6. **qwen3.5:9b** para placas fortes: melhor nos agentes, pior nas conversas; antes de oferecer, resolver o nome da conta do Windows tomado como nome da pessoa.

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
