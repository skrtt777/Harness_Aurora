# Teste prático das memórias — 20/09/2026

**Resultado: recuperação confirmada; geração funcional reprovada neste cenário.**

Foi usado o chat local real da prévia Aurora 0.1.16, com `qwen2.5-coder:1.5b`, sem professor. A conversa “Teste real — jogo e memórias” contém as três respostas e os arquivos de cada versão. O código entregue pelo modelo não foi corrigido manualmente.

## O que foi pedido e observado

1. Criar um HTML com Iniciar, Alvo, placar, Vitória após três pontos e Reiniciar. A resposta consultou 12 memórias, incluindo reinício, pontuação e testes funcionais. Na execução, pontuou antes de iniciar, moveu o alvo sem parar e não zerou corretamente no reinício.
2. Enviar à própria IA os erros observados e pedir correção. O alvo passou a se mover uma vez por início, mas continuou pontuando fora de partida e os reinícios sucessivos falharam. Foram aprovadas 8 de 17 verificações comportamentais. A exigência adicional de três elementos `button` também falhou: foram usados `div`.
3. Pedir dois pontos por clique e vitória aos seis, reiterando os defeitos. A mudança numérica funcionou, mas persistiram falhas de estado. Resultado final: **8 de 18 verificações aprovadas**.

| Verificação final | Esperado | Observado |
|---|---|---|
| Clicar antes de iniciar | 0 | 2 |
| Iniciar | 0 | 0 |
| Três acertos | 2, 4, 6 | 2, 4, 6 |
| Vitória aos seis | Exibir Vitória | Exibiu |
| Acerto após vitória | Continuar em 6 | Continuou em 6, alvo oculto |
| Cinco reinícios | 0, 0, 0, 0, 0 | 0, 2, 4, 6, 6 |
| Um acerto após cada reinício | 2, 2, 2, 2, 2 | 2, 4, 6, 6, 6 |
| Botões semânticos | 3 | 0 |

Cada valor em uma sequência corresponde a uma verificação separada. A maioria das falhas de reinício decorre da mesma causa; 8/18 descreve este roteiro e não é uma taxa geral de capacidade do modelo.

Os testes das duas últimas versões usaram cliques nativos do navegador. Na primeira versão, além dos cliques nativos, um evento de clique foi disparado programaticamente para isolar a lógica de reinício quando o alvo não parava de se mover; esse caso não foi tratado como êxito de interação real.

## O que isso comprova

Os IDs e títulos das memórias constam no `memoryAccess` da resposta, portanto o Harness recuperou e incluiu referências. A alteração de pontuação foi aplicada, mas a presença das memórias não garantiu aplicação correta das regras de estado. O modelo repetiu código problemático mesmo depois de feedback específico.

Não foi executado controle sem memórias neste ensaio. Portanto, não se pode concluir que as memórias melhoraram ou pioraram o desempenho. Tampouco uma resposta que cita conhecimento comprova capacidade de implementar um jogo completo.

## Protocolo para medir ganho de memória

- Fixar modelo, versão, parâmetros de geração, limites de tokens e ferramentas disponíveis.
- Usar várias tarefas inéditas e previamente definir testes externos ao modelo: jogos, alterações e casos de erro.
- Comparar os mesmos pedidos com e sem recuperação de memória, em múltiplas execuções com sementes pareadas quando suportadas.
- Medir aprovação funcional, regressões, tentativas de correção, latência e tokens reais. Contabilizar memória no orçamento total de contexto.
- Separar recuperação correta, aplicação correta e melhoria em relação ao controle. Uma única comparação não basta para uma conclusão geral.
- Não aprovar a entrega só por ausência de erros de sintaxe. O Harness precisa de testes funcionais e retorno automático da evidência para o ciclo de correção.

## Evidências locais

- `scripts/probe-game-memory.mjs`: pedidos enviados pelo fluxo real do chat.
- `app/data/game-memory-probe/create.json`, `repair.json`, `change.json`: prompts, respostas, uso de memória e uso de tokens reportado por resposta.
- Arquivos HTML e relatórios `*-validation.json` na mesma pasta.
- Conversa: `f87abacb-d4d4-4cb6-9cbf-3db40f701bad` na prévia da porta 8788.

Os campos de uso de tokens registrados são os retornados pelo chat; não representam necessariamente todas as inferências de eventuais reparos internos. Nenhuma dessas entregas foi marcada como workflow aprovado nem transformada em memória de correção bem-sucedida.
