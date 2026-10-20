# Estudo: modelos pagos sem os dados saírem da empresa (19/10/2026)

**Pergunta:** como a Aurora pode usar Claude, Codex/GPT ou Gemini e os dados continuarem na máquina,
sem ir para um servidor fora da empresa?

**Resposta curta:** quando um modelo pago roda na nuvem, tudo o que vai no pedido sai da empresa. Não existe
configuração que impeça isso. Há só três jeitos de cumprir a regra:
1. **O modelo pago roda dentro da empresa.** Hoje só o Gemini é vendido assim. Claude e GPT não são.
2. **O modelo pago recebe a estrutura da tarefa e nunca os dados** ("código, não dados"). É o caminho que cabe
   na Aurora, e foi medido aqui (seção 3).
3. **Um modelo aberto grande roda num servidor da empresa.** Não é um modelo pago, mas chega perto em qualidade.

Os planos "empresariais" de nuvem (sem treino com os dados, sem retenção) **não cumprem a regra**: os dados
ainda vão para o servidor do provedor. Eles servem para empresas que aceitam um contrato no lugar da regra.

## 1. O que existe no mercado (out/2026)

| Opção | Dados saem da empresa? | Observação |
|---|---|---|
| Claude / GPT pela API pública | Sim | Hoje a Aurora usa a CLI do Claude e a do Codex, e elas leem os arquivos da pasta. |
| Claude na conta de nuvem da empresa (AWS Bedrock, Google Vertex, Microsoft Foundry) | Sim, mas ficam na conta de nuvem da empresa | Sem acesso de operadores da Anthropic no Bedrock. **Em São Paulo (sa-east-1), os Claude 5.x só têm roteamento global**: o pedido pode ser processado fora do Brasil. |
| Azure OpenAI com retenção zero | Sim | Por padrão, o Azure pode guardar os pedidos por até 30 dias para monitorar abuso. Tirar essa retenção depende de aprovação e de um contrato EA/MCA. |
| **Gemini no Google Distributed Cloud air-gapped** | **Não** | Disponível desde ago/2025 (Gemini 2.5 Flash e Pro). O hardware é do Google e fica na empresa, sem ligação com a internet. É contrato de grande porte, voltado a governo e setores regulados. |
| Modelo aberto grande num servidor da empresa (Mistral Medium 3.5 com 128B, gpt-oss-120b, Qwen grandes) | Não | Precisa de cerca de 4 GPUs para o Mistral Medium 3.5, que também existe como contêiner NVIDIA NIM. A licença precisa ser conferida no cartão do modelo (as fontes divergem). |
| Gateway da empresa na frente da API (proxy com chave única, filtro e registro) | Sim, mas controlado | Não segura os dados, mas centraliza o que sai, bloqueia o que é restrito e registra tudo para auditoria. |

**Conclusão:** para uma empresa comum (não governo), o caminho realista é a Aurora local fazendo o trabalho com
os dados, e o modelo pago entrando só com o que **não** é dado. Esse é o desenho das seções 2 e 3.

## 2. Desenho para a Aurora: o modelo pago vê a forma, não o conteúdo

Hoje (`app/engine.js`, motor unificado de 15/10), quando a Aurora local não consegue, o Claude ou o Codex fazem a
tarefa **na própria pasta do projeto**. Eles leem as planilhas reais e os nomes, e esse conteúdo vai para a nuvem.
A única barreira é `restrictedSources`: um documento marcado como "não liberado para IA paga" pede autorização
antes de sair (`app/chatTurn.js`, no trecho do motor).

A proposta tem quatro camadas, da mais forte para a mais fraca:

1. **Espelho sintético ("código, não dados").** A Aurora monta uma pasta-espelho em que cada planilha tem as
   mesmas colunas e os mesmos tipos, mas valores e nomes falsos (`Cliente A`, `000.000.000-01`, `Mês 1`…), e cada
   documento vira só a sua estrutura (títulos e tamanho). O modelo pago trabalha **no espelho** e entrega um
   script. A Aurora roda esse script **aqui**, nos arquivos reais, e confere o resultado. Na nuvem, ficam só os
   nomes das colunas e o pedido.
2. **Pseudônimos reversíveis** para o que não dá para espelhar, como um texto a revisar. Antes de enviar, CPF,
   CNPJ, e-mail, telefone, valores em R$ e nomes viram marcas (`[PESSOA_3]`, `[CPF_1]`). O mapa das marcas fica
   só na máquina e é desfeito na resposta. Os padrões fixos saem por regex; os nomes, pelo modelo local.
3. **Modelo pago só como professor de método.** O modelo pago revisa o **plano** e os passos que falharam (o nome
   da ferramenta e o erro), sem o conteúdo, e a lição fica na memória local. Esse mecanismo já existe
   (`app/teacher.js`); falta tirar o conteúdo do pedido que vai para ele.
4. **Política por documento e por empresa.** O que já existe (`paid_allowed` em cada fonte) e mais um
   interruptor de empresa: "nada sai, nem com autorização". Nesse modo, a escalação só usa o espelho, ou
   não acontece.

O que continua saindo mesmo no melhor caso: o texto do pedido, os nomes das colunas e o tamanho dos arquivos.
Se até os nomes das colunas forem sigilosos, o espelho também troca esses nomes, e o script recebe o mapa só na
hora de rodar aqui.

## 3. Medição (19/10, Claude Opus pela CLI, pasta de teste no temp)

**A. Motor atual, sem proteção.** Pedido: apresentação com gráfico de barras de `vendas.csv`. O Claude entregou
em **36 s** um `.pptx` com gráfico nativo e números certos e conferiu o arquivo. A planilha inteira foi para a
nuvem.

**B. Espelho sintético.** Planilha real: `cliente, cpf, mes, vendas`, com nomes e CPFs. O Claude recebeu só a
cópia falsa e escreveu `gerar.py`; o script rodou na pasta real.
- Tempo: **33 s**, o mesmo do caso A.
- Apresentação real gerada aqui: categorias Janeiro…Abril e valores **120, 95, 143, 160**, iguais aos da planilha real.
- Nenhum nome, CPF ou valor real no pedido nem na pasta-espelho (verificado por busca).
- Nenhum valor sintético fixo no script: tudo vem do arquivo.
- Ele também deixou CPF e nomes de fora da apresentação, como pedido.

Roteiro do experimento: `mirror-e2e.mjs` (rascunho da sessão, a ser movido para `scripts/` na implementação).

**Limite observado:** o espelho funciona bem para tarefas que viram programa (gráficos, relatórios, conversões,
fórmulas, Power BI). Para tarefas em que o modelo precisa *ler* o conteúdo (resumir um contrato, responder sobre
um e-mail), sobram os pseudônimos (camada 2) ou o modelo local.

## 4. Plano de implementação proposto

1. `app/mirror.js`: monta o espelho de uma pasta. CSV/XLSX com colunas e tipos preservados e valores falsos
   coerentes (datas, moeda, inteiros, categorias com a mesma quantidade de valores distintos). DOCX/PDF viram o
   esqueleto de títulos. Imagens e binários ficam de fora.
2. `engine.js`: modo `mirror` no `escalate`. O executor trabalha no espelho e devolve scripts; a Aurora roda os
   scripts na pasta real com as mesmas permissões do modo Auto, e a conferência da entrega compara o resultado
   com os dados reais.
3. `app/pseudonym.js`: marca e desfaz pseudônimos, para o professor e para os pedidos de texto.
4. Configurações → "Privacidade dos modelos pagos": **Espelho** (padrão em perfil empresa) / Pseudônimos /
   Livre / Nada sai.
5. Bateria nova "sigilo": casos com CPF, nomes e valores, em que o pedido gravado não pode ter nenhum deles e a
   entrega tem de bater com os dados reais.

## Fontes
- Gemini no GDC air-gapped: [SiliconANGLE, 27/08/2025](https://siliconangle.com/2025/08/27/gemini-ai-lands-google-distributed-cloud-secure-premises-adoption/), [Techzine](https://techzine.eu/news/infrastructure/130405/google-brings-gemini-to-on-premises-data-centers-with-distributed-cloud)
- Claude nas nuvens da empresa: [Claude Desktop em AWS, Google Cloud e Foundry](https://claude.com/blog/the-full-claude-desktop-experience-on-aws-google-cloud-and-microsoft-foundry), [Claude no Bedrock](https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock), [regiões do Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/models-region-compatibility.html), [Opus 5.5 no Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-5-5.html)
- Azure: [retenção zero (Microsoft Q&A)](https://learn.microsoft.com/en-us/answers/questions/5738671/how-can-i-get-a-zero-data-retention-agreement-so-i-can-use-azure-openai-service-within-my-platform), [residência de dados](https://azure.microsoft.com/en-us/explore/global-infrastructure/data-residency)
- Mistral Medium 3.5: [Let's Data Science](https://letsdatascience.com/blog/mistral-medium-3-5-128b-open-weight-merged-model)
- Claude Code isolado da internet: [Claude Code SRE Handbook](https://har-ki.github.io/claude-code-sre-handbook/handbook/06-air-gapped/)
