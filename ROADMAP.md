# Roteiro da Aurora

O roteiro vivo do projeto. Os roteiros antigos (MVP, mestre, melhorias de setembro) e o diário do projeto estão em `docs/historico/`. As medições ficam nos documentos datados de `docs/` e nos relatórios de `reports/`.

**Objetivo:** primeiro, uso pessoal ("faça tudo que você faz"); depois, uso em empresa. A Aurora roda no computador da pessoa com um modelo local que aprende pelas memórias e com o professor pago (Claude/Codex).

## Como medimos

| Medição | Comando | Última |
|---|---|---|
| **Tudo de uma vez** | `npm run regressao -- --db <cópia> [--runs 2] [--rapido]` | compara com a rodada anterior e diz se pode publicar (`reports/regressao/`) |
| Testes automáticos | `npm test` | 568 passaram, 0 falhas (08/10); `deliveryGuards.test.js` falhou ao carregar 1 vez em 4 suítes, sem mensagem (não reproduz isolado) |
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

- **Benchmark 0.1.39 × 0.1.38 (08/10):** mesmo modelo e máquina: tempo por turno −45% na GPU (empresa) e −24% só na CPU, qualidade igual. Corrigidos no caminho: e-mail com prazo relativo em vez de "[data]", campos em branco depois de só buscar nos documentos, relatório com valores exatos, "criei o arquivo" sem gravar tratado como entrega (não como documento inventado), conta sobre uma conta anterior ("aquela multiplicação de antes") e "qnto" na calculadora. Regressão final: agentes 100%, empresa 98%, uso 100/100/100/93,8%. Uma queda isolada do llama-server (0xc0000005) numa rodada de agentes não se repetiu.

- **0.1.53 (21/10): o Mapa Vivo, a Zeladora e o WhatsApp funcionando** (`docs/MAPA_VIVO.md`).
  - **Mapa Vivo** (Memória → Mapa Vivo): a memória como um mar vivo — células (seções) com membrana que respira, organelas (memórias), sinapses com impulsos; o cursor é correnteza e um toque faz onda; uma pergunta é um impulso elétrico de memória em memória; chat ao lado do mapa com as etapas do turno (pergunta, busca, contexto, resposta).
  - **A Zeladora** (`app/memoryKeeper.js`): uma água-viva que percorre a memória seção por seção, classifica, liga as parecidas, compacta pensamentos repetidos (todas as frases distintas guardadas; reversível), marca conflitos de valor e memórias vagas; pode ser chamada para uma seção. Medida na base real: 10 ligações, nenhuma compactação indevida.
  - **WhatsApp corrigido**: o "close" atrasado de um socket antigo derrubava a conexão nova e abria uma segunda sessão — reconexão sem fim; agora cada conexão tem geração, a reconexão é única e com espera crescente, e o teste de envio mostra o motivo real de uma falha.
  - Revisão: teste de fumaça da interface inteira (`scripts/smoke/ui-smoke.mjs`), tipos verificados nos testes do frontend, gancho de pre-push instalado.

- **0.1.52 (20/10): Visão 2.0, fase 1 e o modo top secret** (`docs/VISAO_HARNESS_2.0.md`).
  - **Qualquer modelo por chave de API** (`app/apiEngines.js`): Anthropic (SDK oficial) e qualquer API compatível com OpenAI (OpenAI, OpenRouter, Gemini, endpoint próprio, Ollama), sempre às cegas pelo espelho; Configurações → Modelos.
  - **Gateway de canais** (`app/gateway.js`): uma conversa do celular para todos os canais, e a resposta volta pelo canal usado por último. **WhatsApp** (`app/whatsapp.js`, WhatsApp Web por QR, "Mensagem para você" ou número próprio por código).
  - **Top secret** ("Seus dados: Censurados"): documentos vão como texto censurado (nomes, identificadores, valores e números como marcas reversíveis), termos sigilosos viram [SIGILO n], a IA local é a segunda censora, e o que saiu fica registrado em Configurações → Privacidade.
  - Testes reais: Claude no top secret leu só marcas e o resumo voltou com os valores reais; qwen3.5:4b pelo Ollama como endpoint próprio; WhatsApp Web gerou o QR (o pareamento com o celular é o próximo teste). Bateria híbrida 7/7 sem vazamento; suíte 776/776.

- **0.1.51 (20/10): IA local + paga sem os dados saírem do computador** (estudo e medições em `docs/ESTUDO_PAGOS_SEM_VAZAR_2026-10-19.md`).
  - **Motor unificado** (`app/engine.js`): Claude ou Codex fazem a tarefa de verdade, o primeiro com limite de uso. Um limite marca o motor até a hora que a CLI diz.
  - **Espelho** (`app/mirror.js`): cópia das planilhas com valores falsos e do código com marcas; o modelo forte escreve um script ou edita a cópia, e a Aurora roda e aplica o resultado aqui, com os valores reais.
  - **Ajuda ativa:** arquivos, gráficos, análises das planilhas e código vão primeiro ao modelo forte, às cegas; "agora em azul" continua a entrega. Limite de 40 chamadas por dia.
  - **Professor e correção cegos** (`app/blind.js`): marcas reversíveis para nomes e identificadores e resultados só pela forma.
  - **Bateria híbrida** (`scripts/hybrid-battery.mjs`): os modelos reais com uma escuta no lugar do CLI; nenhum dado sensível saiu nas rodadas de 20/10.
  - **Agentes com motor pago:** o agente de tarefa escolhe Aurora local, Claude ou Codex (às cegas, inclusive nas tarefas agendadas). No Escritório, o Claude e o Codex aparecem trabalhando ao lado de quem passou a tarefa.
  - Baterias (qwen3.5:4b): bateria nova só com a local 61/65; **híbrida (local + Claude) 65/65**; bateria híbrida de sigilo 7/7 sem vazamento; Codex no espelho testado; suíte 761/761.

- **0.1.50 (15/10, publicada): anexos de qualquer formato e correções de tela.**
  - **Anexos** (`app/docText.js`, `app/chatTurn.js`): .pbix/.pbit lidos (páginas e visuais; no .pbit, modelo com DAX), .xlsm, código e configuração; qualquer outro formato vira ficha em vez de sumir; botão de clipe no chat.
  - **Aurora do chat** (`AuroraCurtains.tsx`): o tempo era `now * (1 + energy * 1.5)` e girava minutos de movimento ao começar ou parar de digitar (14 rad por quadro); agora avança quadro a quadro.
  - **Escritório** (`OfficeView.tsx`): no máximo 30 quadros por segundo (era a taxa do monitor); navegador ocupado 13,5% → 3,5%. Travamento não reproduzido: 8 min parado e 4 min com 116 respostas em 3 conversas, sem tarefas longas nem memória crescendo.
  - Baterias (4b): nova 56/58 (as 2 falhas também na 0.1.49: ordem 1 em 3, apresentação 7/10 lá e 10/10 aqui); conversas 43/43; agentes 32/32; suíte 729/729.

- **0.1.49 (15/10, publicada): visual novo, bancada criativa e template automático.**
  - **Visual Aurora:** paleta fria por tokens (`tokens.css`), aurora binária no fundo do chat (`AuroraCurtains.tsx`), vista "Aurora" do Atlas (`MemoryParticles.tsx`).
  - **Bancada criativa na tela** (`BenchView.tsx`): o backend (`app/bench.js`) existia desde 11/10.
  - **Template de conversa automático** (`app/ggufMeta.js`, `app/templates`): ministral-3 e gpt-oss vinham sem template com ferramentas. ministral-3:3b 43,1% → 82,8%; 8b 84,5%; 14b 90,5%; gpt-oss:20b 87,1%.
  - **command_output com ring buffer** (`app/agentTools/textRing.js`): passados 60 000 caracteres, a saída nova sumia.
  - **Estudo de modelos de 14/10** (`docs/COMPARACAO_MODELOS_2026-10-14.md`): 11 candidatos; nenhum supera o qwen3.5:4b. Receitas de passos (Hermes) medidas sem efeito e não incluídas.
  - Baterias (4b): nova 57/58; conversas 43/43; agentes 32/32; suíte 726/726; frontend 15/15 e UI 22/22.

- **0.1.48 (14/10, publicada): computador fraco e estudo de modelos.**
  - **Máquina fraca simulada** (`scripts/low-end-bench.mjs`: 8 GB, 4 threads, só CPU). qwen3.5:4b: 79 s por pedido (mediana) e 2,8 GB reais; qwen3.5:2b: 50 s e 1,3 GB.
  - **Estudo de modelos** (bateria nova, 58 checagens): qwen3.5:4b 98%; qwen3.5:2b 78–85%; granite4.1:3b 71%; gemma4:e4b 55–66%; gemma4:e2b 48–64%. O Gemma 4 escreve as chamadas de ferramenta no formato próprio (agora lido).
  - **Modelo pelo hardware:** o 2b sem placa de vídeo e com até ~10 GB (`hardwareDefaultModel`, `HARNESS_MODEL_TIER`).
  - **Cache por conjunto de ferramentas** (`app/llamaCache.js`):
    - um começo salvo por conjunto, restaurado na vaga única (38 ms);
    - aprendido entre turnos, com a vaga apagada antes e os pedidos esperando o salvar.
  - **Ferramentas:**
    - percentual de cada linha;
    - coluna certa na ordem pronta, mais a trava order_mismatch;
    - condição do pedido também na leitura com sort;
    - documento sobre planilha da pasta só depois de lê-la;
    - search_files aponta o projeto;
    - run_command com pasta inexistente diz a certa;
    - FORMAT_NAME com pptx (a conferência quebrava).
  - Avaliações não abrem o Power BI Desktop (`HARNESS_PBI_OPEN=off`).
  - Baterias (4b): nova 57/58 e apresentação 3/3; conversas 43/43; agentes 32/32; suíte 722/722.

- **0.1.47 (13/10, publicada): a bateria nova (inédita) e o que ela achou.**
  - Nasceu da conversa "monte um BI interativo sobre departamentos": o BI nunca saiu, seis respostas disseram "Pronto! Aplicado" com o modo Plano ligado, e o total saiu errado.
  - **Bateria "novos"** (`app/freshBattery.js`, `npm run battery -- --set novos`): 20 cenários, 58 checagens, empresa fictícia própria. 0.1.46: 66,7% no lote 1; agora 69/69 (lotes 1 a 3, 100%).
  - **Travas:** claimed_action (disse que fez sem ferramenta), count_mismatch (número ≠ lista), short_list (lista inteira pedida, parte mostrada), aviso do modo Plano.
  - **Leitura de planilhas:** "2.800.000" é número; soma, maior e menor; dias até hoje; ordem pedida; estoque abaixo do mínimo; "não entregues"; cruzamento de duas planilhas; formato do CSV para código; números de linha trocados pelos códigos.
  - **Power BI:** roteador com "bi/painel/indicadores"; goal curto; cores pedidas (askedStyle); tema por build novo; planilha do assunto incluída.
  - **write_document .pptx** (`app/pptxWriter.js`).
  - Baterias antigas: conversas 43/43, agentes de setor 32/32; suíte 716/716.

- **0.1.46 (13/10, publicada): a Aurora leve (notebook sem placa de vídeo).**
  - **Ferramentas por assunto** (`app/toolRouter.js`): de ~8.700 para 1.900-3.700 tokens; **AGENT.md** 10.670 → 3.900 caracteres com as regras de cada grupo em `runtime-policy/topics`.
  - **llama-server**: 1 vaga sem placa de vídeo (2 até 10 GB, 4 acima), `--cache-ram` pela RAM (padrão de 8 GB chegou a 10,6 GB), gerações simples no mesmo servidor (o Ollama carregava o modelo de novo).
  - Tempo limite de 15 min por chamada só no processador; pedido jurídico com as ferramentas da web.
  - **Notebook simulado** (`scripts/laptop-bench.mjs`, só CPU, 4 núcleos): antes 0 de 3 tarefas em 25 min e prompts de 12-14 mil tokens; agora 3 de 3 perfeitas em ~15 min, prompts de 5-7 mil tokens, servidor no pico de 6,1 GB.
  - Baterias (GPU): suíte 699/699, conversas 42/43, agentes de setor 62/64, código 4/4, VS Code 5/5.

- **0.1.45 (13/10, publicada): pedidos grandes encaixados, fontes oficiais e lições da Conferência.**
  - **Contexto** (`app/economy.js` fitBlocks): o último recurso encurta os blocos grandes (projeto, anexos, documentos da empresa) dizendo quanto faltou, em vez de recusar com "Requisitos ou dependências excedem o contexto" (notebook do trabalho).
  - **Fontes oficiais** (`app/legalSources.js`): a página do Planalto das leis do pedido na ordem de serviço e na cobrança da Conferência; Pessoas com a CLT.
  - **Lições da Conferência** (`app/conferenceLessons.js`), filtros normalizados, ordem de serviço no app e no VS Code (0.2.1), agentes sem "Quer ajustar?".
  - Baterias: suíte 697/697, agentes de setor 32/32, conversas 41/43 (o formulário no navegador oscilou).

- **0.1.44 (13/10, publicada): Conferência de citações e entregas mais firmes.**
  - **Conferência de citações** (`app/serviceOrder.js`): artigo, lei, súmula e decreto da resposta e dos documentos precisam estar no texto lido (por página, "art. X da Lei N" na página da lei N); volta uma vez, o resto sai com aviso. Texto em outro alfabeto volta.
  - **web_fetch**: `find` (o trecho de uma lei longa) e a codificação da página (windows-1252).
  - **Recepção** fora dos pedidos divididos entre subagentes (A/B: 2,75 → 3,5 de 5 na conversa do Power BI); Power BI cobrado na Expedição.
  - Script que falha mostra o código da linha do erro; filtro que não bate sugere `{{linhas}}`; corte de código pequeno pede reescrita enxuta.
  - Baterias: suíte 691/691, conversas 43/43, agentes de setor 61/64 (2 rodadas), VS Code 5/5.

- **0.1.43 (13/10, publicada): a Sede da Aurora.**
  - **Sede** (`app/headquarters.js`, `docs/ESCRITORIO.md`): 18 salas em três faixas; a estação de cada pessoa pelo que ela faz de verdade; a ficha de cada pedido.
  - **Recepção e Expedição** (`app/serviceOrder.js`): ordem de serviço no prompt e na ficha; a entrega conferida contra ela.
  - **Regras por departamento** (`runtime-policy/areas`), só em pedido da área; prompt enxuto quando não cabe.
  - **Entrega mais firme:** corte em fim de linha, nome de arquivo válido, gravar depois de ler demais.
  - Baterias: conversas 42/43 (a falha passou 3/3 ao repetir), agentes de setor 90,6% em 2 rodadas, código e VS Code verdes.

- **0.1.42 (13/10, publicada): Aurora em código e no VS Code, aprendizado, escritório único com RH.**
  - **VS Code** (`vscode/aurora` 0.2.0): `@aurora` com /explicar, /corrigir (painel Problemas), /testes, /revisar (git diff); diferenças e desfazer; barra de status; lâmpada "Corrigir com a Aurora".
  - **Código:** `create_site` e `create_api` (o modelo escreve o conteúdo, o Harness o resto); sintaxe checada ao gravar; `check_page` (computador e celular); `code_map`; travas de arquivo pedido e de "rodou sem rodar"; regras e ferramentas de código só em pedido de código.
  - **Aprender:** ferramenta `learn` (web, Stack Overflow, MDN, lição na memória); Bing quando o DuckDuckGo bloqueia; guias de código.
  - **Escritório:** uma sala para todos; RH (`app/hr.js`) com nota, estrela, plano de melhoria, desligamento com substituto e recontratar.
  - **BI:** regras de número por linha; subagentes por planilha.
  - Baterias: conversas 43/43, agentes de setor 32/32, código 4/4, VS Code 5/5.

- **0.1.41 (11–12/10, publicada): escritório dos agentes, BI com a operação desenhada e Aurora XR.**
  - **Escritório** (`docs/ESCRITORIO.md`):
    - cada sessão, agente, cópia, professor e o chefe aparece como uma pessoa em pixel art, no estado real;
    - o lugar muda conforme a ferramenta: estante, servidor ou computador;
    - quem entrega leva o papel ao chefe e vai ao café; o chefe faz ronda e cobra;
    - as sessões ganham nomes;
    - a sala cresce com a equipe e acompanha a hora do dia.
  - **Power BI com cena:** a operação desenhada pelos dados, gêmeo digital, notas do que mudou, mapa por estado e simulação "e se".
  - **Aurora XR:** VR refeito em WebXR, com maquete viva e cenários da Aurora com resposta presa ao formato (só no XR).
  - **Regressão:**
    - testes automáticos 100%, conversas reais 100%, agentes 90,6% (−4,7), empresa 98%;
    - testes de uso por bateria: 1 = 92,3% na rodada da regressão e 95,1% no reteste (variação do modelo; "pede pro agente financeiro…" às vezes devolve tabela ou .docx em vez de .xlsx, como já acontecia na 0.1.40), 2 = 100%, 3 = 100%, 4 = 91,3%.
- **0.1.40 (09–11/10, publicada): trabalho junto nos programas.**
  - Excel, Word e PowerPoint são abertos e preenchidos na tela, com tabelas, fórmulas e gráficos.
  - Qualquer programa pode ser operado por janela, com a diferença da tela conferida depois de cada ação.
  - Power BI:
    - completo a partir de uma planilha: perfil dos dados, modelo estrela, calendário, medidas DAX e relatório PBIR com tema, salvo em TMDL;
    - perguntas ao modelo semântico aberto, por ADOMD.
  - O navegador passou a ter ritmo, limite de ações e parada diante de captcha.
  - A Vizinhança do Atlas voltou a ser um fluxograma.
  - Na tela inicial, os cartões passaram a mostrar o que a Aurora sabe fazer.
  - Uma tabela cortada pelo limite de saída é completada com a última leitura.
  - Regressão: agentes 95,3%, empresa 96%. Testes de uso por bateria: 1 = 100%, 2 = 97,8%, 3 = 95,7%, 4 = 93,8%. A planilha "nome e cargo dos 39 da produção" continua instável e já falhava antes.

## Agora

1. **BI com cena visual (próxima versão), primeira etapa feita em 11/10:**
   - Quando os dados têm um fluxo com etapas (status de pedido, entrega ou chamado), o BI abre numa página de operação, com o tema escuro.
   - **Cena isométrica do CD:** uma medida DAX devolve um SVG, mostrado no visual de Imagem. Desenha as docas com o caminhão de cada uma, colorido pela etapa ou em vermelho se atrasado, as docas livres em verde, a fila e a estrada.
   - **Trilha de etapas**, barras de progresso na tabela e o **painel do item selecionado**.
   - **Clique na tabela:** acende o caminhão na cena, apaga os outros e mostra o detalhe dele e a trilha.
   - **Medidas de operação:** em andamento, no pátio, no prazo %, atrasados agora, estoque.
   - **Outras páginas:** a de entregas mostra prazo por transportadora e atrasos por destino. As páginas seguem o pedido ("só a operação", "sem a tendência").
   - **Laboratórios:**
     - `scene-lab.mjs`: 21/21;
     - `scene-cowork.mjs` com o modelo local: 16/16 em 2 rodadas;
     - o painel de vendas sem fluxo continua igual: 10/10.
   - **Próximas etapas:**
     - cenas para outros domínios: loja ou vendas por região, fábrica e linhas, chamados por equipe;
     - escolha da cena pelo pedido;
     - mais de 10 docas;
     - mapa do Brasil com as rotas em trânsito.
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
