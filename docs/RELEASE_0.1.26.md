# Aurora 0.1.26: agente local que age, aprende com o professor e mede a própria evolução

Inclui também o que foi feito na 0.1.24 (memória com evidência, relógio real, Quest ligado ao PC), que não teve instalador próprio.

## O chat age

- **O chat virou agente:** pedidos como "controle o navegador e acesse o youtube", "pesquise lofi no youtube e abra o primeiro vídeo" ou "rode os testes" são executados, não descritos. O modelo decide sozinho quando agir.
- **26 ferramentas:**
  - **navegador:** por DOM e refs, com abas, e o Chrome ou o Edge instalados como reserva;
  - **web:** pesquisa e leitura de páginas;
  - **programas:** abrir apps, arquivos e links;
  - **arquivos:** busca por nome e por conteúdo, leitura por linhas, criação e edição;
  - **terminal:** saída ao vivo e processos em segundo plano;
  - **conhecimento:** memória, skills (procurar, usar, criar) e plano de etapas.
- **Modos:**
  - **Auto** age livremente na pasta do projeto e pergunta antes de apagar, instalar, usar a rede, mexer no sistema ou sair da pasta;
  - **Manual** pergunta toda alteração;
  - **Plano** só olha e propõe.
  - O cartão de autorização tem "Sempre permitir" e expira em 2 min; o Quest também pode responder a ele.
- **Pasta do projeto:** cada projeto pode ter uma pasta de trabalho. Um `AURORA.md` dentro dela vira instruções permanentes. Configure pelo ícone de pasta ao lado do projeto.

## A IA local aprende

- **Professor automático:** Codex ou Claude revisam quando há erro e em toda entrega que alterou algo, conferindo os arquivos na pasta do projeto. As lições viram memória e a local refaz. O limite diário é configurável (padrão 30 chamadas).
- **Memórias com ciclo de vida:** não duplicam; as que ajudam sobem no ranking; as automáticas que só falham são arquivadas.
- **Avaliação contínua:** em Configurações → "A IA local está aprendendo?" rodam 12 tarefas numa cópia dos seus dados, com e sem memórias, com histórico.

## Correções

- **Segurança:** o agente não alcança a API ou a interface da própria Aurora, o Ollama nem a ponte XR. Arquivos que podem executar código (`.lnk`, `.hta`, `.url`, `.reg`…) pedem autorização.
- **Prompts longos:** chamadas ao Codex e ao Claude com mais de ~32 mil caracteres falhavam no Windows (`ENAMETOOLONG`). Agora o prompt vai pelo stdin.
- **Carga do modelo local:** ele não recarrega mais entre chamadas (~4 s por troca) e fica carregado por 30 min.
- **Comandos travados:** comandos que liam a entrada ficavam presos até o timeout.

Detalhes, medições e roadmap: [chat-agente.md](chat-agente.md) e [REVISAO_2026-09-27.md](REVISAO_2026-09-27.md).

## Verificação

- `npm test`: 339 testes passaram, 0 falhas.
- `npm run test:memory`: 6 passaram.
- Testes reais com `qwen3.5:4b` e o Codex CLI.
- Interface: compilada e testada, mas ainda não conferida no app instalado. O visual novo é básico.
