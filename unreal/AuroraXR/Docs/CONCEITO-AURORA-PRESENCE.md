# Aurora Presence — conceito e plano de integração MR

Data: 26/09/2026. Status: conceito aprovado pelo usuário; implementação autorizada. O conceito descreve o destino do produto; o estado real de entrega e validação está em TODO-PRESENCE.md.

## 1. Produto

Levar a mesma Aurora do Harness para o ambiente físico do usuário: uma presença com quem conversar, capaz de retomar projetos, consultar memórias e apresentar resultados em objetos digitais posicionados no cômodo.

A referência a Pokémon GO orienta a sensação de encontrar e interagir com uma entidade virtual no mundo real. A primeira experiência acontece no cômodo do usuário, sem depender de geolocalização, deslocamento pela cidade ou personagens de terceiros.

Nome de trabalho: Aurora Presence. Identidade proposta: um pequeno núcleo luminoso, com silhueta reconhecível, centro expressivo e anéis incompletos em ciano/violeta. Orientação, movimento e áudio espacial comunicam atenção. Materialização breve, sem efeitos constantes cobrindo a visão. O núcleo fica perto da área escolhida; não acompanha cada movimento da cabeça.

O painel futurista continua no produto como interface contextual: abre a partir da Aurora com uma animação e oferece Conversar, Projetos, Memórias e Ambiente. Evitar grandes paredes de texto: resumo falado, cartão curto e detalhes sob demanda. Cores sempre acompanhadas de texto/forma para identificar estados.

## 2. O que existe no Harness

Inspeção do código local, pacote 0.1.23:

| Base existente | Aproveitamento em MR | Trabalho novo |
|---|---|---|
| Conversas e mensagens persistentes | Continuar no Quest a conversa do PC | Cliente Unreal e sincronização |
| Projetos com instruções | Abrir projeto e apresentar suas conversas | Seletor espacial e resumo fundamentado |
| Memórias globais, de projeto e conversa | Consultar e salvar conhecimento | Comandos por voz e cartões com origem |
| Relações entre memórias e Atlas | Explorar conexões reais em 3D | Renderizador XR com poucos nós por vez |
| Provedores Local/Ollama, Codex e Claude | Usar o provedor configurado na conversa | Transporte remoto, estado e recuperação |
| Correção explícita pelo professor | Pedir revisão e conservar o aprendizado | Acionamento contextual e apresentação |
| Artefatos de mensagens | Consultar entregas da Aurora | Visualizador XR de texto/código inicialmente |
| Skills, workflows e agente de navegador | Acompanhar tarefas executadas no PC | Adaptadores explícitos para ações suportadas |

Evidências: `app/server.js`, `app/httpSecurity.js`, `app/local.js`, `app/browserAgent.js`, `frontend/src/api.ts`, `docs/CHAT_E_ARQUIVOS.md` e README.

Limites observados: API de chat devolve resultado completo e oferece polling de etapa/cancelamento; não há streaming de tokens no caminho atual. O caminho local usa `stream: false`. Não foi encontrado pipeline de conversa por voz. O agente de navegador recebe texto extraído por OCR; isso não constitui visão do ambiente. O Atlas tem conhecimento e relações reais, mas seu layout não é memória espacial persistente do cômodo. Renderização HTML do desktop não deve ser presumida disponível ou segura no cliente Unreal.

O APK 0.1.2 é uma base técnica de passthrough, mãos, gesto e menu. Ainda não conversa com o Harness. Logs confirmam inicialização no Quest 3S; estabilidade visual prolongada do gesto e desempenho ainda precisam de medição física.

## 3. Experiência principal

1. Usuário abre o aplicativo e vê seu ambiente real. A primeira configuração vincula o Quest ao Harness do PC e oferece posicionar a Aurora.
2. Mão esquerda aberta sustentada chama a Aurora. Ela se materializa na área de interação, com confirmação visual e sonora. Perder o rastreamento das mãos não a faz desaparecer.
3. Um comando deliberado inicia a escuta. Durante a sessão de conversa, o sistema detecta o fim da fala e alterna turnos, com indicação visível de microfone e botão/gesto de parar. A primeira versão não exige reconhecimento contínuo da palavra “Aurora” em segundo plano.
4. Usuário diz: “Abra meu projeto Aurora e me diga onde paramos.” Havendo nomes ambíguos, surgem poucas opções reais para escolher.
5. A fala vira texto; o Harness recebe a mensagem na conversa escolhida, usa suas instruções/memórias e devolve a resposta. A Aurora mostra a etapa real e depois responde por voz, com resumo visual e acesso ao conteúdo completo.
6. “Mostre as memórias usadas.” Cartões exibem os registros referenciados pela resposta. Nenhuma origem é inventada; se não houver memória utilizada, a interface informa isso.
7. “Guarde esta decisão neste projeto.” Uma ação estruturada cria memória no mesmo Harness. Sucesso só aparece após persistência confirmada. O registro fica consultável no PC.
8. Usuário aponta uma superfície e coloca um cartão ali. Esse posicionamento pertence à camada espacial e referencia o ID do conteúdo, sem duplicar a base de conhecimento.
9. Usuário encerra a conversa ou recolhe o painel. Aurora e cartões só fecham por ação deliberada; falhas de tracking ou rede têm estados próprios.

Exemplo de evolução ambiental: “Coloque a lista nesta mesa”; depois, com visão implementada, “Leia esta anotação e relacione ao projeto”. A primeira ação requer geometria/seleção espacial; a segunda requer imagem, interpretação e contexto multimodal.

## 4. Arquitetura proposta

```text
Quest — aplicativo Unreal nativo
  Passthrough, mãos, Aurora, cartões, áudio e contexto espacial
                     ↕ conexão autenticada e criptografada na LAN
PC — ponte XR do Harness
  Pareamento, sessão, eventos, voz, ações permitidas e reconexão
                     ↕ serviços existentes
Harness Aurora
  Conversas, projetos, memória, artefatos, skills e provedores
                     ↕
Ollama local / Codex CLI / Claude CLI
```

O aplicativo roda no Quest; a IA e seus dados continuam no PC nesta versão. Uso normal por Wi-Fi na mesma rede; cabo usado para instalação/diagnóstico. PC ligado e Harness disponível são requisitos. Execução totalmente sem internet depende também dos provedores de voz/modelo escolhidos e dos recursos já instalados. Não prometer modelo completo executando no headset.

A API atual é deliberadamente local: valida Host/origem e entrega token de sessão local. Não basta abrir a porta na rede. Criar ponte XR com pareamento por código temporário, identidade por dispositivo, revogação e transporte TLS com validação/pinning estabelecido no pareamento. Não copiar credenciais de CLI para o Quest. Reutilizar serviços do Harness; evitar duas bases SQLite ou dois servidores concorrendo pela mesma porta.

Contrato XR versionado: capacidades disponíveis, projetos/conversas, início de turno, estados reais, resultado, cancelamento, ações de memória e artefatos. Cada pedido tem identificador único; reconexão consulta o resultado antes de repetir gravações. A primeira entrega pode transmitir resposta completa com eventos de progresso; streaming de tokens depende de evolução dos adaptadores e não será simulado.

Voz: captura no Quest, transcrição e síntese preferencialmente no PC. Selecionar motores após teste de português, tempo de resposta, memória e execução simultânea com Ollama. Echo cancellation/controle de reprodução e interrupção precisam evitar que a Aurora transcreva a própria fala. Microfone, processamento e reprodução têm estados independentes.

Ações espaciais usam comandos tipados e validados pelo aplicativo. Texto produzido pelo modelo não executa código Unreal nem chama qualquer ferramenta arbitrariamente. Manter os limites e confirmações que os workflows existentes já exigem.

## 5. Ambiente real e visão

Três capacidades distintas:

- Presença: passthrough, escala, posição, animação e som espacial.
- Espaço: superfícies, limites e ancoragem para colocar conteúdo e recuperá-lo entre sessões.
- Visão: acesso autorizado a quadros da câmera e modelo capaz de interpretar o conteúdo observado.

Avaliar Meta XR/MRUK e Spatial Anchors em uma cópia técnica antes de incorporá-los ao projeto Unreal 5.8.3. Compatibilidade de versões é um marco obrigatório, não uma suposição. Se exigir outra versão suportada de Unreal, preservar a base atual e registrar a decisão de migração antes da integração completa.

Usar dados de Scene API/MRUK quando disponíveis. Sem mapa do ambiente, oferecer posicionamento manual explicitamente identificado. Ancoragem persistente deve ter estado de localização: não encontrado, procurando, localizado. Se não conseguir restaurar, pedir reposicionamento; não fingir que reconheceu a sala.

Guardar âncora, transformação, versão e referências de conteúdo separadamente das memórias textuais do Harness. Nome de objeto dado pelo usuário não equivale a identificação visual automática. Capturas visuais, quando implementadas, ocorrem por ação explícita; envio a provedor externo é identificado.

## 6. Plano de execução após fechar o conceito

| Etapa | Entrega concreta | Critério de conclusão |
|---|---|---|
| 1. Contrato e compatibilidade | Decisões de SDK, voz e contrato XR documentadas; ponte pareada | Quest consulta projeto real; dispositivo não pareado é recusado |
| 2. Conversa completa | Mensagem, progresso, resposta, cancelamento e reconexão | Conversa do headset aparece no Harness sem duplicações |
| 3. Voz e presença | Aurora animada, entrada/saída de áudio e interrupção | Conversa em português sem precisar digitar; estado de escuta inequívoco |
| 4. Interação espacial | Painel contextual, pinça, arrastar, posicionar e restaurar | Conteúdo permanece estável; perda de mãos não altera visibilidade |
| 5. Memória e projetos | Seleção real, memória consultada/salva e artefatos de texto | IDs e dados coincidem no PC e no headset |
| 6. Contexto visual e validação integrada | Pedido explícito de observar/ler uma anotação, APK integrado e relatório | Captura real chega a caminho visual validado; percurso ponta a ponta testado no aparelho, com falhas e limites visíveis |

As etapas organizam o desenvolvimento interno. A entrega para avaliação é uma experiência integrada, com recursos reais. Funções indisponíveis não ficam expostas como opções vazias. A etapa de visão tem validação independente; se a compatibilidade ou o modelo impedirem sua conclusão, o bloqueio será registrado sem apresentar respostas textuais como percepção visual.

## 7. Escopo e critérios de qualidade

Primeira entrega integrada: uma Aurora, um usuário, um PC pareado, conversa por voz, projetos, memória, cartões manipuláveis, colocação no ambiente e uma interação visual delimitada. Atlas completo, avatar humano detalhado, vários usuários, exploração por GPS e IA inteiramente no headset ficam para evoluções posteriores.

Alvo de desempenho inicial: 72 FPS sustentados, orçamento aproximado de 13,9 ms por quadro, medidos no Quest 3S conectado. Reduzir transparência sobreposta, partículas e quantidade de cartões. Não é resultado já alcançado. Medir separadamente reconhecimento da fala, resposta do modelo e início do áudio antes de fixar metas de latência.

Teste integrado: iniciar conversa existente; abrir projeto; obter resposta fundamentada; inspecionar memória usada; salvar decisão e conferir no desktop; posicionar cartão; reiniciar e restaurar âncora; interromper fala; retirar mãos do campo; desconectar/reconectar rede sem duplicar operações. Fazer sessão física de pelo menos 15 minutos e registrar frame times, falhas, conforto e legibilidade. Aparência em captura do editor não substitui esse teste.

## 8. Referências técnicas

- [MRUK: recursos, consultas de superfícies e world locking](https://developers.meta.com/horizon/documentation/unreal/unreal-mr-utility-kit-features/).
- [Spatial Anchors em Unreal](https://developers.meta.com/horizon/documentation/unreal/unreal-spatial-anchors/).
- [Passthrough e distinção do acesso aos quadros de câmera](https://developers.meta.com/horizon/essentials/horizon-os-passthrough/).

Essas APIs fornecem capacidades de plataforma; não demonstram que já estão integradas ao AuroraXR ou que a combinação atual de versões foi validada.
