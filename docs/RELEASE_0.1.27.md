# Aurora 0.1.27: conhecimento da empresa organizado pela IA local (piloto)

## O que muda

- **Conhecimento da empresa:** em Configurações → "Conhecimento da empresa", cadastre pastas da rede (`\\servidor\RH`) ou pastas do SharePoint sincronizadas pelo OneDrive, cada uma com seu departamento.
- **Leitura:** a IA local lê Word, Excel, PowerPoint, PDF, texto, CSV, HTML e RTF, e só relê o que mudou.
- **Organização:**
  - cada documento ganha uma ficha (resumo, datas, palavras-chave e o passo a passo dos procedimentos);
  - as pastas viram as categorias (`RH/Eventos`, `RH/Benefícios`…);
  - o mapa fica visível nas configurações.
- **Perguntas no chat:** "me traz um resumo da programação de final de ano" encontra o documento certo sem dizer onde ele está e responde citando a fonte. O Harness busca os documentos relacionados antes de o modelo responder. Uma resposta que cita uma fonte sem ter consultado nada volta para pesquisa.
- **`read_file`:** agora também abre Word, Excel, PowerPoint e PDF.

## Privacidade

- **IA local:** vê tudo, e nada sai do computador.
- **IAs pagas:** cada pasta tem a opção "IA paga pode ver", desligada por padrão. Sem ela, Codex e Claude (no chat ou como professor automático) só recebem trechos desses documentos com a sua autorização.
- **Permissões:** a indexação usa as permissões do seu usuário do Windows.

## Verificação

- `npm test`: 347 testes passaram, 0 falhas; `npm run test:memory`: 6 passaram.
- **Avaliação com `qwen3.5:4b`** num acervo fictício de RH (6 documentos em 6 formatos): 7 perguntas, 21 acertos em 21 em 3 rodadas, de 1 a 6 s cada. Indexação em ~17 s.
- **Ainda é piloto:**
  - PDFs escaneados ficam sem texto;
  - as fichas podem ter pequenos erros (a resposta usa o trecho original);
  - conversas longas ainda não estão na avaliação.

Detalhes: [CONHECIMENTO_EMPRESA.md](CONHECIMENTO_EMPRESA.md).
