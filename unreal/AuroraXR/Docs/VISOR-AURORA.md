# Aurora Presence — visor de capacete, versão 0.3.0

Direção solicitada por Lucas em 26/09/2026: conversar com a Aurora no ambiente real, com perspectiva de dentro de um capacete e informações nas extremidades.

## Referência e adaptação

[Vídeo de Tom Melo: Como Construí um JARVIS PESSOAL Que Sabe Tudo Sobre Meu Negócio](https://www.youtube.com/watch?v=sl-ByvLRAP0). Foram inspecionados quadros da interface em 0:04 e 6:12 e o trecho em 0:48; não houve análise integral do áudio. A referência mostra núcleo luminoso, interface escura azul, conversa por voz e grupos de indicadores laterais.

Na Aurora, a sala real ocupa o centro. O núcleo visual do painel existente é preservado e um pequeno anel no canto indica o estado da voz. A interface de capacete fica em uma superfície binocular transparente a 1,2 m, com extensão de 1,6 m × 1 m (aproximadamente 67° × 45°). Textos de trabalho e ações ficam no painel espacial independente.

## Distribuição

| Região | Conteúdo real |
|---|---|
| Superior esquerda | Identidade Aurora e disponibilidade/autenticação da ponte Harness |
| Superior direita | Nome do projeto selecionado e quantidade de memórias referenciadas pela resposta |
| Inferior esquerda | Estado do passthrough, tracking separado das mãos, instrução e progresso do gesto de chamar |
| Inferior direita | Pronta, processando, ouvindo ou falando; microfone aberto/fechado; histórico curto do nível efetivamente capturado |
| Borda inferior | Mensagem curta da operação atual |
| Centro | Ambiente real; painel de trabalho aparece somente quando chamado |

Os contornos são interrompidos e têm animação inicial de 1,2 segundo. O movimento dos anéis é decorativo, não uma medição. Não são exibidos percentuais fictícios de confiança, temperatura, CPU, bateria, mapeamento, alvos ou reconhecimento de objetos.

## Interação

- Mostrar a palma esquerda por aproximadamente um segundo chama/recentraliza o painel.
- Pinça direita seleciona os controles do painel. O visor não recebe cliques e não bloqueia o raio de interação.
- O botão **VISOR: COMPLETO / REDUZIDO**, no rodapé do painel, alterna os modos. A preferência é salva no headset e restaurada ao abrir o aplicativo.
- Reduzido mantém conexão e estado do microfone, retirando contornos e indicadores secundários. No desktop, a tecla V também alterna o visor.
- Recolher o painel mantém o visor e encerra a escuta/reprodução conforme o comportamento já existente. A perda de tracking não esconde o visor nem o painel.
- A ponte é consultada periodicamente quando o cliente está ocioso. O indicador de conexão reflete requisições reais; uma perda de rede pode levar o intervalo de consulta e o timeout para aparecer.

## Conforto e limites de validação

A [orientação de design MR da Meta](https://developers.meta.com/horizon/design/mr-design-guideline/) recomenda minimizar conteúdo preso à cabeça e manter conteúdo de trabalho no espaço. Por isso este experimento limita o visor a estados curtos e oferece o modo reduzido; o painel longo continua espacial. A superfície do visor acompanha rigidamente a câmera para atender à perspectiva de capacete solicitada; isso ainda exige validação de conforto no aparelho vestido. A [orientação de display](https://developers.meta.com/horizon/design/display/) também diferencia os cuidados de profundidade de interfaces estereoscópicas.

Uma captura do aparelho confirma composição, não conforto, nitidez percebida por ambos os olhos, qualidade de voz nem precisão física das mãos. As pendências dos seis objetivos continuam registradas em TODO-PRESENCE.md.
