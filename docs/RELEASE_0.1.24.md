# Aurora 0.1.24: memória com evidência, relógio real e Quest ligado ao PC

## Mente (PC e Quest)

- **Memórias só com evidência de relevância** (`app/store.js`): antes, toda memória recebia um piso de pontuação, e o prompt sempre levava 12, até em "que horas são?". Agora uma memória só entra se tiver uma palavra distintiva do título ou das tags em comum com o pedido, ou similaridade ≥ 0,70. Medido na base real:
  - as 9 memórias esperadas continuam sendo recuperadas;
  - as perguntas sem relação agora ficam sem memória (0/5 → 5/5);
  - o prompt ficou cerca de 2,6 vezes menor.
- **Relógio real** (`app/runtimeFacts.js`): perguntas de hora ou data recebem a hora do dispositivo. O texto é afirmativo, porque a versão com "não invente acesso a sensores" levava o modelo pequeno a recusar.

## Quest (Aurora Presence)

- O app do Quest usa **o Harness do PC primeiro**. O Harness embarcado só sobe quando o PC não responde e volta a desligar quando o PC reaparece.
- A ponte XR (`app/xrBridge.js`) renova a sessão sozinha depois que o app do PC reinicia. Antes, toda mensagem falhava com "Sessão local inválida" até reiniciar a ponte.
- O Harness embarcado ficou com a mesma mente do PC: mesmos pesos (`llama3.2:3b`), template, amostragem e embeddings. A resposta aparece enquanto é gerada.

Detalhes e medições: [QUEST_PARIDADE.md](QUEST_PARIDADE.md).

## Verificação

- `npm test`: 294 testes passaram, 0 falhas.
- Pergunta pelo Quest, com o app 0.1.24 instalado no PC: "que horas são?" → "04:49:32 BRT", em 7 s.
