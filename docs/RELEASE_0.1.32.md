# Aurora 0.1.32: documentos de verdade e sem terminal piscando

## A Aurora cria documentos de verdade

- **Nova ferramenta de documentos:** "crie um novo documento com valores atualizados" agora gera um arquivo Word (.docx), Excel (.xlsx), PDF, .md ou .csv, com títulos, listas e tabelas. A resposta traz o caminho do arquivo.
  - **Seus arquivos ficam intactos:** se já existe um arquivo seu com o mesmo nome, ela salva como "nome (2)". Ela só atualiza os documentos que ela mesma criou.
- **Sem entrega inventada:** se a resposta diz "criei o documento" e nada foi gravado, ela volta e cria de fato, ou diz claramente que não criou.
- **Sem pergunta desnecessária:** se você pediu um arquivo, ela não responde "quer que eu crie?"; faz, marcando como estimativa o que não puder confirmar.
- **Pesquisa com limite:** depois de 4 buscas na web no mesmo pedido, ela entrega com o que já tem, em vez de gastar todas as ações pesquisando.

## Conversas mais longas funcionam

- **A partir da segunda mensagem a Aurora não perde as ferramentas nem o arquivo:** antes, com alguns modelos, "crie…" ou "onde está?" viravam um chat simples, sem o PDF da conversa.
- **Modelo padrão:** instalações antigas que ainda usavam o `llama3.2:3b` passam para o `qwen3.5:4b`, o modelo avaliado. Um modelo que você escolheu continua valendo.
- **"Onde está?"** depois de uma entrega real é só uma pergunta. Não aciona revisão paga.

## Revisão pelo professor (Claude/Codex)

- **O refazer entrega o que você pediu:** antes, a resposta começava com "Corrigi a situação: agora, após a leitura…" em vez do resumo.
- **O refazer não falha mais por falta de espaço** na memória do modelo local.
- **"Revisar com Claude"** recebe a conversa e o arquivo citado, então não pergunta mais "qual documento?".

## Fim do terminal piscando

- No Windows, a Aurora iniciava o Ollama sem janela de console. Cada vez que um modelo carregava, abriam e fechavam terminais: 24 numa única medição. Agora são 0, e o Ollama continua rodando depois que você fecha a Aurora.
- Na primeira abertura, a 0.1.32 reinicia uma vez o Ollama iniciado pela versão anterior, que ainda piscava.

## Verificação

- `npm test`: 405 testes passaram, 0 falhas. Os novos repetem o caso real: entrega inventada, histórico com várias chamadas, refazer sem narração, Word/Excel/PDF gerados e relidos.
- **Repetição da conversa real do media kit** numa cópia do banco, com `qwen3.5:4b`: resumo completo numa leitura só, documento criado de verdade com o caminho e "onde está?" respondido. Com o `llama3.2:3b` o agente não cai mais para o chat simples, mas esse modelo continua fraco demais para a tarefa.
- **Terminal:** janelas de console contadas durante uma carga de modelo. Eram 24 do jeito antigo e são 0 do jeito novo.
