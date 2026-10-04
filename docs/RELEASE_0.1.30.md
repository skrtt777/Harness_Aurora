# Aurora 0.1.30: novo visual, planilhas que a IA entende, várias cópias do modelo e base dos agentes de tarefas

Esta versão inclui tudo o que estava preparado para a 0.1.29 (`docs/RELEASE_0.1.29.md`), que não chegou a ser publicada: OCR de PDFs escaneados, conversas longas sem fontes inventadas e revisão das fichas pela IA paga.

## Novo visual

- **Interface:** barra lateral e chat no estilo do Hermes Agent, com Configurações divididas em seções.
- **Atlas de memória:**
  - mapa por significado;
  - saúde das memórias e inspetor com ações;
  - modos galáxia, rede neural e mapa em blocos;
  - teste de lembrança.

## Documentos da empresa

- **Planilhas legíveis:** as datas do Excel aparecem como datas (antes vinham como `46299`), e os percentuais e as colunas vazias saem certos.
- **Perguntas de contar ou listar** ("quem entra de férias esse mês?", "qual contrato vence primeiro?"):
  - uma planilha pequena encontrada pela busca entra inteira no contexto;
  - a leitura ganhou o filtro `Coluna=texto`, que devolve o cabeçalho, só as linhas que batem e o total.
- **Data de hoje:** pedidos com "esse mês", "este ano", "agora", "vence" ou "atrasado" recebem a data atual. Antes, só "que dia é hoje" recebia.
- **Busca:**
  - o nome do arquivo passa a pesar ("férias" acha "Controle de Férias 2026.xlsx");
  - uma categoria inexistente não esvazia mais o resultado.
- **Travas de fidelidade:**
  - números e datas conferidos com os documentos;
  - calculadora exata;
  - a trava de documento inventado não desmente mais respostas certas, como "Ata **da** Reunião…" ou "Admissões **e** Desligamentos".

## Várias cópias do modelo local

- **O que fazem:** em perguntas sobre a empresa e em contas, a Aurora confere a resposta com mais cópias do modelo e fica com a que as outras confirmam.
- **Como sobe:** 2 cópias e, se elas discordarem, 4. Se mesmo assim não houver acordo, o professor pago revisa.
- **Medição** (49 perguntas sobre uma empresa fictícia de 15 setores):

  | Estratégia | Acerto |
  |---|---|
  | 1 resposta | 83% |
  | Escalada | 90%, com 2,7 cópias em média |
  | 5 cópias | 92% |

- **Segurança:** as cópias só leem. Nada é editado ou executado em dobro.
- **llama-server:** para as cópias rodarem juntas, a Aurora sobe o llama-server que já vem com o Ollama, na GPU e com 4 vagas, usando os mesmos arquivos de modelo. Assim, 4 respostas levam 1,6 vez o tempo de uma; no Ollama o qwen3.5 não roda em paralelo. O servidor desliga após 10 min parado, para liberar a GPU.
- **Capacidade do PC:** a Aurora mede uma vez quantas cópias o computador aguenta. Para fixar um número, use `LOCAL_COPIES`.

## Modelo local

- **Ollama iniciado pela Aurora:** passa a usar flash attention, cache KV q8 e 4 vagas por padrão. Com o qwen3.5:4b isso dá a mesma qualidade com 3,3 GB em vez de 8,4 GB. O que você configurou continua valendo.
- **Memória de vídeo:** os embeddings rodam na CPU para não tirar o modelo grande da GPU, e o contexto é único em todas as chamadas, para o Ollama não recarregar o modelo.
- **Modelos que pensam:** o raciocínio interno fica desligado em todos, não só no Qwen3.

## Agentes de tarefas (base)

- **O que são:** "funcionários" da Aurora, cada um com missão, setor, pasta de trabalho, ferramentas e gatilho (manual, horário ou pasta). Trabalham em modo Auto na própria pasta.
- **Agentes de setor:** criados a partir das pastas da empresa. RH, Financeiro e Controladoria já vêm com missão pronta.
- **Histórico:** cada execução guarda o pedido, os passos, os arquivos entregues e a revisão.
- **Por enquanto:** só pela API (`/api/agents`). A tela, as rotinas agendadas e o orquestrador vêm nas próximas versões (`docs/AGENTES_ROTEIRO.md`).

## Verificação

- `npm test`: 392 testes passaram, 0 falhas.
- **Avaliação por setor:** `docs/AVALIACAO_EMPRESA_2026-10-04.md`.
- **Comparação de modelos:** `docs/COMPARACAO_MODELOS_2026-10-04.md`.
- **Ainda falta medir:** a escalada rodando no llama-server, com acerto e tempo, numa rodada completa com a GPU livre.
