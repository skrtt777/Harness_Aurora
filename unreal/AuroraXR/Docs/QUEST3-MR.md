# Aurora MR — protótipo Quest 3

Mapa: `/Game/Aurora/Maps/L_AuroraMR`. O mapa VR anterior continua disponível.

## Experiência

O painel aparece com fade e deslocamento suave; a lista de opções entra em sequência.
Opções: Conversar, Memórias, Projetos e Ajustes. A seleção abre um estado de detalhe;
os três primeiros ainda não chamam o backend. Ajustes mostra as instruções dos gestos.

- Mão esquerda: mantenha a mão aberta, com os dedos estendidos e o polegar afastado, à frente do rosto por aproximadamente 1 segundo. O painel abre ou volta para sua frente, sem fechar.
- Para recolher: selecione o botão `−` no canto superior direito. Perder o tracking não fecha o menu.
- No headset, a experiência começa com uma indicação compacta do gesto. Uma barra se preenche durante o reconhecimento.
- Mão direita: aponte para a opção e faça pinça para selecionar.
- Rastreamento perdido: a seleção é liberada; é necessário abrir os dedos antes de uma nova pinça.
- O painel fica fixo no ambiente após ser posicionado, aproximadamente 95 cm à frente do usuário.
- Preview desktop: mouse para escolher, `M` para repetir a entrada e `Espaço` para abrir/recolher.

## Implementação

- `AuroraMRPanel`: interface Slate/UMG desenhada em tempo real, com animação e hit testing.
- `AuroraMRPawn`: câmera XR, widget espacial e ponteiro da mão direita. Usa joints OpenXR em espaço mundial, pinça direita com histerese de 2,2/3,5 cm e suavização do raio. A mão esquerda aberta é reconhecida por extensão dos dedos, afastamento do polegar e orientação do plano da mão, com confirmação temporal de 0,8 s.
- `AuroraPassthrough`: extensão nativa `XR_FB_passthrough`, camada de reconstrução underlay e composição por alpha. Não lê nem armazena imagens de câmera.
- `OpenXRHandTracking`: plugin da Unreal. Não há dependência do Meta XR SDK proprietário neste protótipo.
- O fundo da cena MR não contém céu, piso ou paredes virtuais. No desktop sem runtime XR, o fundo é preto e o rodapé informa que o passthrough não foi confirmado.

## Build e instalação

Execute `Scripts/Build-Quest.ps1`. O script usa Unreal 5.8, SDK Android 36,
NDK r27c e o JDK local, configurando somente o ambiente do processo. Os caminhos
podem ser substituídos pelos parâmetros do script.

Saída: `Saved/Builds/Quest3`. Pacote: `com.aurora.xr`. Build Development para sideload.

Com o Quest em modo desenvolvedor, conectado por USB e a depuração autorizada,
execute `Scripts/Install-Quest.ps1`. Ele exige um único dispositivo autorizado
ou o parâmetro `-Serial`. Não usa reset nem remove dados do dispositivo.

## Validação

O build e o teste no editor não comprovam passthrough ou qualidade dos gestos no hardware.
Antes de considerar a versão validada no Quest 3, verificar:

1. Instalação, abertura e visão do ambiente real atrás do painel.
2. Entrada animada e textos legíveis com os dois olhos.
3. Chamar com a esquerda aberta, selecionar cada opção com a direita e recolher pelo botão `−`.
4. Soltar a pinça, perder e recuperar o tracking sem clique involuntário.
5. Retornar do menu do sistema, retirar/recolocar o headset e fechar/reabrir o app.
6. Desempenho sustentado no headset; ainda não há medição de frame time.

## Referências

- [OpenXR — XR_FB_passthrough](https://registry.khronos.org/OpenXR/specs/1.1/html/xrspec.html#XR_FB_passthrough)
- [Meta — passthrough e composição underlay](https://developers.meta.com/horizon/documentation/unreal/unreal-passthrough-overview-gs/)
- [Epic — OpenXRHandTracking](https://dev.epicgames.com/documentation/unreal-engine/API/PluginIndex/OpenXRHandTracking)
