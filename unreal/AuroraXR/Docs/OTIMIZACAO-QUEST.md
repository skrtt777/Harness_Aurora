# Otimização do Harness no Quest — 0.7.1

> Registro histórico da versão densa 0.7.1. Em 27/09/2026, o usuário esclareceu
> que essa substituição não atende ao teste MoE/SSD. O caminho de conversa
> específico do Quest foi retirado do servidor. O trabalho atual está em
> [QUEST_MOE_PORT.md](../../../docs/QUEST_MOE_PORT.md); os resultados abaixo não
> validam o porte MoE nem a correção da repetição relatada pelo usuário.

## Contexto e geração

O gargalo identificado nos logs da 0.7 foi a leitura de contexto: uma conta simples recebeu 1589 tokens e gastou 58,7 segundos processando a entrada; a geração de seis tokens levou 0,55 segundo. Isso é uma medição pontual, não uma média.

O perfil `quest-chat-v1` restringe a recuperação a memórias relevantes, limita referências opcionais e mantém o histórico em ordem. O perfil vale apenas para conversas locais no Quest; a seleção padrão do desktop e os workflows permanecem no caminho anterior. Instruções, histórico e pedido chegam ao modelo em papéis separados. Requisitos obrigatórios não são cortados; pedidos grandes passam pelo tokenizer real antes da inferência. Cache de prefixo é solicitado ao llama.cpp e as métricas agora separam leitura e geração quando disponíveis.

Uma revisão pelo Claude, usando `correctLocalAnswer` do próprio Harness, ajudou a identificar a possibilidade de deixar uma resposta sem sua pergunta no histórico. Esse caso foi corrigido e testado. Relatório: `Saved/Standalone/OptimizationTeacherReview.json`.

## Comparação offline

`scripts/audit-quest-context.mjs` usa uma cópia do snapshot inicial com 90 memórias, sem chamar o modelo:

| Pedido | Caracteres antes | Caracteres depois | Memórias antes/depois |
|---|---:|---:|---:|
| Conta 3 + 5 | 5157 | 326 | 12 / 0 |
| Diferença entre IA local e professores | 7424 | 435 | 12 / 0 |
| Projeto Aurora Presence | 5293 | 414 | 12 / 1 |

Esses números medem o contexto enviado, não a velocidade nem a qualidade da resposta. Não se deve converter essa redução diretamente em ganho de tempo.

## Validação

- 277 testes passaram, 8 ignorados, nenhuma falha, incluindo integração do turno original, histórico, memória relevante, ausência de referências irrelevantes, orçamento de tokens e preservação do caminho anterior.
- APK 0.7.1, código 9, compilado com sucesso. Consulte `Saved/Standalone/BuildQuestOptimization.log`.
- A primeira tentativa foi interrompida quando o Quest ficou offline. Após recarga, a depuração Wi-Fi foi reativada por USB; bateria 16%, temperatura 41 °C. A versão 0.7.1 foi instalada via Wi-Fi e o runtime `standalone-071` iniciou no sandbox. As 95 memórias e as correções anteriores permaneceram intactas.
- Comparação da mesma pergunta “3 + 5”, primeiro turno após iniciar cada versão: antes 28,977 s, 1081 tokens de entrada e resposta errada “7”; depois 3,519 s, 102 tokens de entrada e resultado “3 + 5 = 8”. A conta ficou correta, mas o formato “somente o número” ainda não foi obedecido.
- Mais dois turnos na versão nova: confirmar a cor violeta levou 2,651 s; lembrar a cor levou 2,447 s. A explicação sobre IA local versus professores levou 10,055 s, recuperou três memórias relevantes e acertou a distinção principal, mas respondeu em uma frase quando foram pedidas duas.
- Medições pontuais pelo backend real no Quest, não uma garantia de latência. Não foi validada uma sessão prolongada com MR sendo renderizado e headset vestido. Não comparar diretamente o resultado de 10 s com o teste histórico de 71 s como se fossem condições idênticas.
- Relatório completo: `Saved/Standalone/OptimizationBenchmark.json`. Script: `scripts/benchmark-quest-chat.mjs before|after`. A voz funciona na ponte, mas a reprodução física pelo usuário ainda precisa ser ouvida; a UI estava suspensa durante a tentativa de teste visual/sonoro, e o comando de diagnóstico pendente foi removido.
- Tokenizer real do aparelho validado: entrada Unicode acima da janela foi recusada com HTTP 413 em 105 ms, antes de gerar ou cortar o conteúdo. `Saved/Standalone/QuestTokenBudget.json`.

## Voz escolhida pelo usuário

Kyutai Pocket TTS 3.3.0, modelo português e voz Alba do catálogo, já ativo no serviço local do PC na porta 8791. `scripts/start-xr.ps1` agora usa Pocket por padrão; `-TtsEngine qwen` permite iniciar o motor anterior quando a porta estiver livre. Instalador reproduzível: `scripts/setup-xr-pocket.ps1`. PyTorch 2.10 CPU, duas threads, sem GPU para síntese.

Comparação de uma frase, sem cache da frase e com os modelos já carregados: Qwen gerou 8,12 s de áudio em 13,953 s; Pocket gerou 9,36 s de áudio em 2,375 s. Pocket produziu o primeiro fragmento interno em 94 ms, mas o transporte atual entrega o WAV completo: isso não é latência de reprodução no headset. O teste de transcrição reconheceu o conteúdo, com “menu” transcrito como “Meno” no Pocket. Naturalidade e preferência de timbre ainda precisam de avaliação auditiva do usuário.

Contrato real de mídia validado com Pocket (WAV mono PCM16, 24 kHz). A chamada por nome via TLS reconheceu “Aurora, abra o menu” e rejeitou uma frase sem o nome. Relatórios: `Saved/Standalone/PocketVoiceComparison.json` e `Saved/WakeTLSValidation.json`; amostra: `Saved/Standalone/pocket-aurora.wav`.

Pocket ainda executa no PC. O porte Android do motor de voz não foi instalado nem validado; não considerar voz embarcada no Quest. A Kyutai disponibiliza código MIT e pesos/vozes com atribuição CC BY 4.0; usamos a versão pública sem clonagem de voz, com os estados de voz fornecidos pelo próprio projeto.

Voz: Alba MacKenna, amostra `alba-mackenna/casual.wav` do [catálogo Kyutai](https://huggingface.co/kyutai/tts-voices). Estado de voz e pesos portugueses do pacote público Kyutai, revisão `4e1e0a3e611c51c0b4ed8174fc10f32a54644303`.

Referências: [API do llama.cpp](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md), [Pocket TTS](https://github.com/kyutai-labs/pocket-tts), [português na Kyutai](https://kyutai.org/blog/2026-05-04-pocket-tts-multilingual/).
