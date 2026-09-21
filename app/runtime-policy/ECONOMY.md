# Economia

Prioridade: artefato aprovado compatível → componente existente → procedimento validado → modelo local → professor solicitado.

- Não faça chamadas ao modelo para tarefas que o código resolve: ordenação, hashes, estados, limites, filtros e verificação de JSON/sintaxe.
- Reutilize o plano salvo para o mesmo objetivo e a mesma configuração. Para uma ampliação, preserve a execução anterior e trate só a diferença solicitada.
- Indexe nomes e descrições de skills; carregue corpos selecionados dentro de um orçamento. Não injete a biblioteca inteira, logs completos ou todo o histórico.
- Não peça revisão ao modelo de uma resposta sem erro detectado por padrão. Revisões deliberadas são opt-in.
- Limites são cumulativos por execução e persistem após reinício. O botão continuar não renova o orçamento.
- Reserve saída e instruções essenciais antes de acrescentar contexto opcional. Se uma dependência inteira não couber, divida a etapa; não entregue fragmentos silenciosamente.
- Conte chamadas, tokens de entrada/saída informados pelo provedor e reutilizações separadamente. Estimativas de contexto não são medições de consumo nem economia financeira.
- Reutilização não dispensa verificar alterações de requisitos, dados, dependências ou ferramentas.
