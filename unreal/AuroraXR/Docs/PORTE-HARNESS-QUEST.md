# Harness Aurora no Quest — versão 0.7

## Base preservada

O aplicativo empacota o backend do repositório original: `app/server.js`, SQLite (`app/db.js` / `app/store.js`), seleção de contexto, memórias, extração, revisão local, correção pelos professores e workflows. Não é uma segunda implementação de conversa em C++.

`app/localLlama.js` adapta apenas a fronteira do executor: o Harness continua montando o contexto e persistindo resultados; no Android, llama.cpp executa Qwen3.5 0.8B Q4_0. O caminho Ollama do desktop permanece disponível. O modelo menor é uma adaptação ao orçamento de memória do Quest, não equivalência de capacidade ao modelo do PC.

Node 24.18 ARM64/Bionic e suas dependências são obtidos dos pacotes oficiais do Termux, verificados por SHA256 do índice. Nenhum Termux precisa ser instalado pelo usuário. Os executáveis ficam em nativeLibraryDir do APK; bibliotecas, scripts e modelo ficam nos arquivos privados. A inicialização Android usa processos filhos, tentativas limitadas de recuperação e encerramento no onDestroy. O banco persistente fica separado dos arquivos versionados do runtime.

## Professores existentes

Claude e Codex foram chamados por `correctLocalAnswer` para revisar o plano de porte. Os relatórios estão em `Saved/Standalone/review-claude.json` e `review-codex.json`. São revisões textuais da arquitetura fornecida, não inspeções independentes de todo o repositório.

No Quest, `runClaude` e `runCodex` usam um relay TLS autenticado para as mesmas CLIs configuradas no PC. A criação da correção, a persistência da resposta e as memórias ensinadas continuam no Harness do Quest. Eles não são modelos offline. O menu Projetos/Ajustes oferece seleção do professor e pedido de revisão da resposta local.

## Dados e limites

- Snapshot inicial via SQLite VACUUM INTO, com verificação de integridade: 1 projeto, 8 conversas, 35 mensagens e 90 memórias. O banco do PC não é modificado. O snapshot é transferido separadamente, sem dados pessoais dentro do APK.
- O banco local passa a evoluir no Quest. Não há sincronização bidirecional automática de edições.
- Voz, detecção do nome e OCR ainda usam serviços do PC pelo relay. A geração de texto, histórico e memórias funcionam no aparelho. “Retomar contexto” permite acionar uma resposta local pelo menu.
- Playwright/Chromium e CLIs desktop não são executados no Android. A validação estática de artefatos permanece; testes funcionais de navegador indicam necessidade do desktop.
- Serviços internos escutam somente em loopback. Inferência usa chave efêmera; API Harness e ponte XR mantêm autenticação. Certificado público acompanha o app; tokens do PC não são incluídos no pacote.

## Referências da interface

Quatro capturas fornecidas em `C:/Users/lucas/OneDrive/Imagens/Screenshots`: Screenshot_5, Screenshot_4, Screenshot_2 e Screenshot_1. Layout com ficha à esquerda, círculos ao centro e opções destacáveis à direita; seleção dourada, superfícies transparentes, sem HUD fixa. Ajustes de tamanho e posição do menu preservados.

## Evidências

- APK final 0.7.0, código 8, instalado por ADB Wi-Fi: Node e llama.cpp iniciaram no UID do próprio aplicativo. Logs `Saved/Standalone/InstallFinal.log`, `BuildQuestFinal.log` e `QuestFinal.log`.
- Verificação da instalação final: banco com 1 projeto, 8 conversas e 90 memórias antes do teste. Uma conversa real gerou 203 tokens com 1296 tokens de entrada em 70,967 s. A resposta estava incorreta e repetitiva: confirma execução local, não qualidade suficiente para uso final. Claude corrigiu em 11,432 s e criou três memórias. Relatório `Saved/Standalone/DeviceValidation.json`.
- Codex também corrigiu uma segunda conversa local pelo Quest: 10,597 s para revisão, duas memórias criadas e consultadas novamente pela API para conferir persistência. O Harness impediu corretamente uma segunda correção da mesma mensagem; o teste usa conversas distintas para cada professor.
- Após recompilar o ajuste de seleção de professor e reinstalar, a conversa, a correção e as 95 memórias permaneceram disponíveis. O modelo reiniciou no sandbox do app. Logs finais: `BuildQuestTeacher.log`, `InstallTeacher.log`; verificação reproduzível: `scripts/check-quest-persistence.mjs`.
- Captura estereoscópica do menu transparente no aparelho: `Saved/Standalone/QuestFinal.png`. Conforto e seleção com a mão ainda exigem avaliação física.
- Execução de Node e DatabaseSync no Quest; importação do backend original após adaptação dos imports desktop.
- Primeira conversa completa pelo backend no aparelho: 15,967 segundos, persistida no banco. `Saved/Standalone/FirstChat.json`.
- Modelo: PSS 770920 KB (~753 MiB); backend: 64468 KB (~63 MiB), com o MR aberto. Medição pontual, sem teste térmico prolongado.
- Regressão: 265 testes passaram, 8 ignorados. Mais 11 testes específicos passaram, incluindo adapter local, escolha de professor e relay autenticado.
- PIE: navegação das quatro categorias, tamanho e eixo X nos novos pontos de seleção.

Referências técnicas: [llama.cpp Android](https://github.com/ggml-org/llama.cpp/blob/master/docs/android.md), [pacote Node Android do Termux](https://github.com/termux/termux-packages/blob/master/packages/nodejs/build.sh), [modelo GGUF do ggml-org](https://huggingface.co/ggml-org/Qwen3.5-0.8B-GGUF).

## Reprodução

`scripts/prepare-quest-runtime.py` obtém o runtime; `scripts/bundle-quest-runtime.py` empacota runtime, dependências npm, modelo e código original. O diretório Saved/Standalone/harness precisa das dependências de produção instaladas com npm dentro dele (não usar um prefixo que crie links para o checkout). Modelo GGUF em Saved/Standalone/model.gguf. O manifesto de pacotes está em Saved/Standalone/runtime-manifest.json. Binaries e modelos não são versionados no Git.
