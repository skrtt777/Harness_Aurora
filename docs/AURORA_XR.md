# Aurora XR: a Aurora do PC em realidade mista, VR, AR e em qualquer tela

Pedido de 12/10/2026: "redesenhe todo o projeto Aurora VR para uma versão mais compatível com o nosso projeto; precisa ser AR/VR, com rastreamento de movimento, realidade mista (MR) e responsivo".

## A decisão

O app do Quest era um projeto **Unreal** (`unreal/AuroraXR`), separado do resto. Ele tinha um APK de 302 MB, 58 MB de `Content/` fora do git e builds que só esta máquina faz. Agora o app é o **Aurora XR**, um app **WebXR** na mesma linguagem e no mesmo repositório do Harness (`app/xr/`). Ele é servido pela própria ponte XR do PC. A mesma página roda em:

| Aparelho | Como fica |
|---|---|
| **Óculos (Quest 3/3S)** | **Realidade mista**: o quarto de verdade (passthrough), a maquete do Power BI numa mesa real e o painel da Aurora no ar, à distância do braço. Ou **VR**, numa sala calma com mesa. |
| **Celular** | **AR**: aponte para uma mesa e toque para pôr a maquete; a tela é o painel. Sem WebXR (iPhone), fica em 3D, e o botão **Movimento** gira a vista com o giroscópio. |
| **PC / tablet** | 3D ao lado do painel. Arraste para girar e clique num caminhão para ver os detalhes. |

Não é preciso instalar nada nem gerar APK: abra o endereço no navegador do aparelho. A mente é a mesma da Aurora do PC: conversa, memórias, projetos e o Power BI aberto.

## Rastreamento de movimento

- **Mãos** (Quest, `hand-tracking`): as juntas aparecem como pontos.
  - **Pinça** aponta e aperta.
  - **Tocar com o indicador** (poke) aperta um botão do painel.
  - **Palma aberta virada para você** por 0,8 s chama o painel para a sua frente.
  - **Duas mãos segurando a maquete** mudam o tamanho dela e a giram.
- **Controles**: o raio aponta, o gatilho aperta e o grip segura.
  - Segure a base da maquete e mova para levá-la a outro lugar.
  - Segure a barra sob o painel para levá-lo junto.
- **Cabeça e corpo**: o painel fica parado enquanto você olha em volta. Ele volta para a sua frente quando você vira mais de 40°, se afasta mais de 1,6 m ou começa a **andar** (velocidade da cabeça acima de 0,45 m/s por 0,6 s).
- **O quarto**:
  - *hit-test*: a mira na mesa para pôr a maquete.
  - *anchors*: a maquete fica presa à mesa. Onde o Quest permite, a âncora persistente traz a maquete de volta na próxima vez.
  - *plane detection*: as superfícies aparecem contadas em Ajustes.
- **Celular sem WebXR**: o giroscópio (`deviceorientation`) move a vista em 3D.

Os limiares (pinça de 2,2 cm/3,5 cm com histerese, palma por 0,8 s) são os mesmos do app Unreal. Ficam em `app/xr/lib/gestures.js` e têm testes.

## A maquete viva: pegar, olhar de perto, empurrar

Pedido de 12/10/2026: "poder segurar o caminhão… pegar com a mão e olhar de perto; quando largar ele volta pro lugar correto; os objetos devem ter interação dinâmica entre eles, o ambiente e eu".

- **Pegar**:
  - **Pinça (ou grip) encostada** numa coisa da maquete: ela vem para a mão.
  - **Pinça ou gatilho apontando de longe**: ela voa até a mão.
  - Na mão, ela **cresce até uns 14 cm** para você ver de perto, gira junto com o pulso e mostra o nome. Os detalhes (etapa, doca, espera) aparecem no painel.
  - **Ao soltar**, ela volta num arco para o lugar dela e encolhe. "O lugar" é onde os dados a põem, ou onde o comportamento dela está agora, se ela anda.
- **Empurrar**: as pontas dos dedos, o pulso, o controle e a coisa que você segura empurram as outras. Elas se afastam, empurram as vizinhas e voltam sozinhas (mola). Nada cai da base. Na Operação, caminhões lado a lado na fila ficam onde os dados põem e só se mexem com um empurrão.
- **Comportamentos**: na Operação, só as pessoas se mexem um pouco no lugar, porque a maquete continua fiel aos dados. Nos cenários:

  | Comportamento | Quem |
  |---|---|
  | Passear | animais, pessoas |
  | Rodar (pela rodovia em anel) | carros, ônibus, trator, trem |
  | Voar | aviões, pássaros, helicóptero |
  | Nadar | peixes, barcos, dentro do lago |
  | Flutuar | nuvens, nave, balão |
  | Pular | galinhas, coelhos, bola |
  | Orbitar | planetas, em volta do sol |

  Partes se mexem sozinhas: pás do moinho, hélice, asas, chama, fumaça do vulcão, facho do farol.
- **No PC e no celular**: arraste uma coisa com o mouse ou o dedo. Ela empurra as outras e, ao soltar, volta. Um toque faz ela pular e mostra os detalhes.

## Cenários feitos pela Aurora

Na aba **Cenários**, ou só falando "Aurora, faz uma fazenda com vacas e um trator", a Aurora monta uma maquete de qualquer coisa:

1. **Na hora**, um rascunho sai das próprias palavras do pedido: o tema (fazenda, cidade, praia, sistema solar, dinossauros, floresta, zoológico, porto, aeroporto, inverno, acampamento, reino, parque, fundo do mar, vulcão, cidade do futuro) e as coisas contadas ("5 vacas", "dois tratores").
2. **A Aurora do PC**, na mesma conversa, responde com uma frase e um bloco ` ```cena ` (JSON: título, chão e itens com tipo, quantidade, posição, cor, comportamento e nome). A maquete dela entra no lugar do rascunho. Uma resposta sem bloco deixa o rascunho.

Há cerca de 60 tipos de modelos, feitos de formas simples (`app/xr/xr/models.js`): nada é baixado e tudo roda leve no óculos. Um tipo desconhecido vira uma caixa com o nome. Com o cenário na tela, "adiciona 3 cavalos", "coloca um foguete" e "tira os carros" mudam a maquete na hora, sem esperar a Aurora. Os cenários ficam salvos no aparelho (até 12): "outro cenário" troca, e a aba Operação volta para o Power BI.

## Como usar

1. **Ligar a ponte XR** no PC (o Harness desktop aberto): `npm run xr`, ou `scripts/start-xr.ps1` (que liga também a voz).
   - HTTPS na porta **8788**, na rede, para o óculos e o celular. O certificado é desta Aurora: o aviso no primeiro acesso é esperado.
   - HTTP na porta **8789**, só neste PC, e é seguro para WebXR por ser `localhost`.
2. **No PC**, abra `http://localhost:8789/xr/app/`. No próprio PC, o código de pareamento já vem preenchido.
3. **No óculos ou no celular**, abra `https://<ip do PC>:8788/xr/app/` e aceite o certificado. No PC, gere o código em **Ajustes › Parear aparelho** e digite-o no aparelho.
   - **Com o Quest no USB**, o aviso de certificado não aparece: rode `adb reverse tcp:8789 tcp:8789` e abra `http://localhost:8789/xr/app/` no navegador do óculos.
4. Toque em **Realidade mista** (óculos), **Entrar em VR** ou **Ver na mesa (AR)** (celular).

Por voz: "mostra a operação", "conversa", "memórias", "traz o painel", "coloca na mesa", "atualizar", "repita", "pare". Qualquer outra frase vai para a Aurora. A voz usa os mesmos serviços de transcrição e fala do PC que o app do Quest usava. Sem eles, a resposta aparece só no painel, e a fala do navegador é tentada.

**Só a operação do Power BI** (sem pareamento, só leitura): peça "ver em 3D" no chat (`powerbi action=vr`). O mesmo app abre no endereço aleatório do servidor do gêmeo, só com a página Operação.

## Segurança

- A ponte continua só com as rotas da lista (`/xr/v1/...`), com token por aparelho, revogável.
- O app é servido em `/xr/app/` com CSP `default-src 'self'`. O three.js fica dentro do projeto (`app/xr/vendor`, MIT), então nada vem de fora, e o app funciona numa rede sem internet.
- Pedido com `Origin` só é aceito quando é a própria ponte (o app). Outro site não usa o token de um navegador pareado.
- Abrir um código de pareamento (`POST /xr/v1/pairing`) só funciona **no próprio PC** (loopback). Pelo `adb reverse`, o Quest no USB conta como loopback; o USB já é autorizado no aparelho.

## Arquivos

| Arquivo | O que é |
|---|---|
| `app/xr/index.html`, `app.css`, `main.js` | O app: interface responsiva (lado a lado no PC; uma coluna com abas embaixo no celular), conversa, voz, operação, memórias, projetos, ajustes e pareamento. |
| `app/xr/xr/stage.js` | A cena three.js para todos os modos: 3D com órbita e giroscópio; sessões MR/VR/AR; mãos, controles, poke, pegar/girar/escalar; hit-test, âncoras, superfícies; o painel que acompanha quem anda. |
| `app/xr/xr/panel3d.js` | O painel no espaço: as mesmas páginas, desenhadas num canvas. |
| `app/xr/xr/twin3d.js` | A maquete: caminhão, pessoa e volume; o lugar de cada área; anéis de destaque; selo "N de N". |
| `app/xr/lib/*.js` | Partes puras, testadas em Node: `twinLayout` (o contrato do gêmeo → onde cada coisa fica), `gestures`, `voice`, `device` (que aparelho é e quais modos ele tem), `api` (cliente da ponte), `scene` (pedido e resposta da Aurora → cenário arrumado na base) e `dynamics` (comportamentos, empurrões, mola, a volta para casa). |
| `app/xr/xr/models.js`, `scene3d.js` | Os modelos dos cenários e a maquete de um cenário (base no chão pedido, rodovia em anel quando algo roda). |
| `app/xrStatic.js` | Serve os arquivos do app (ponte e servidor do gêmeo). |
| `test/xr-app.test.js` | 15 testes, inclusive cenários (bloco da Aurora, rascunho, arrumação, edições) e dinâmica (comportamentos, empurrão e volta, fila parada): maquete, gestos, voz, perfil do aparelho, arquivos do app, origem, pareamento e conversa contra a ponte real. |
| `scripts/xr-lab/xr-lab.mjs` | Laboratório: ponte de teste isolada (PC falso), Chromium como PC, celular e **Quest 3 emulado (IWER)** em MR e VR. `--serve 8799` sobe só a ponte de teste para um óculos no USB. Com `?lab=1` na URL, o aparelho manda para o PC o que suporta, os erros e o rastreamento. |

## Conferido

- `npm test`: todos passando, inclusive os 13 novos.
- Laboratório (`node scripts/xr-lab/xr-lab.mjs <pasta> --iwer <iwer.min.js>`):
  - **PC**: pareia, conversa, mostra a operação e escolhe o caminhão clicado.
  - **Celular**: uma coluna e sem rolagem lateral.
  - **Quest MR emulado**: entra em MR, painel visível, o gatilho apontado para o painel troca de página e as duas mãos são rastreadas.
  - **Quest VR emulado**: segurar a maquete com o controle e mover 20 cm leva a maquete 20 cm, na mesma altura.
  - **Quest MR emulado, maquete viva**:
    - o grip encostado num caminhão o pega, ele cresce 2,8×, acompanha a mão e, ao soltar, volta exatamente para a doca, no tamanho certo;
    - o controle encostado em outro caminhão o empurra 3,7 cm, e ele volta para o lugar.
  - **PC, cenário**: pedir uma fazenda mostra o rascunho e depois a da Aurora (12 coisas, 12 corpos); a vaca arrastada com o mouse volta para o lugar.
- O emulador desenha a profundidade invertida no VR: o chão cobre a maquete na captura. É defeito do emulador. Fica para conferir no óculos de verdade.

## O que fica do Unreal

`unreal/AuroraXR` continua no repositório, sem mudanças, como referência; o runtime embarcado do Quest (Harness no próprio óculos) só existe lá. O Aurora XR web usa sempre a Aurora do PC.
