# Porte do Harness para Quest: executor MoE

## Objetivo e estado

Usar o próprio Harness como mente da experiência MR: contexto, projetos,
memórias, persistência e correções dos professores permanecem no servidor
original. Android troca o adaptador de inferência, não a política de conversa.

Em 27/09/2026, o perfil alternativo `quest-chat-v1` foi removido do caminho de
conversa de `server.js`. O teste de integração verifica que o transporte Quest
produz o mesmo contexto do transporte desktop. Isso não torna modelos diferentes
equivalentes nem comprova qualidade de inferência.

A versão 0.7.1 instalada usa Qwen 0,8B denso e **não testa a proposta MoE/SSD**.
O aplicativo desktop encontrado neste PC está configurado com Llama 3.2 3B.
O experimento MoE do repositório usa Qwen3-Coder 30B, conforme
[QWEN3_MOE_RESULTS.md](QWEN3_MOE_RESULTS.md). São três situações distintas.

## Executor reproduzido

- llama.cpp: `f5e85d43a048f3d5adefb4c5e29867d8077fba62`.
- Swap-MoE: `50459bb422a01c0ba2e1da08b4d932f652f3e413`.
- Modelo: `qwen3-coder:30b`, 18.556.688.736 bytes.
- SHA-256: `1194192cf2a187eb02722edcc3f77b11d21f537048ce04b67ccf8ba78863006a`.
- Android ARM64, API 29, NDK 27.2; CPU, sem descarte ou fixação de especialistas.
- Build confirmado como ELF AArch64; dependências dinâmicas: libc, libm e libdl.

`python scripts/prepare-quest-moe.py` recupera os commits, aplica o patch original
e compila. `--download` baixa e verifica os pesos exatos; não executar dois
downloads simultâneos sobre o mesmo `.part`.

Adaptações restritas ao porte: gerador de recursos compilado com MSVC para o
host Windows; libstdc++ estática no executável Android; `madvise(MADV_DONTNEED)`
para páginas de especialistas em mapeamentos de arquivo somente leitura.
O prefetch alinha o endereço inicial à página do Android; alinhamento de tensor
GGUF sozinho não atende ao requisito de `posix_madvise`.
A implementação Android de `posix_madvise(POSIX_MADV_DONTNEED)` não libera páginas:
[fonte Bionic](https://android.googlesource.com/platform/bionic/+/8880cab65/libc/bionic/posix_madvise.cpp).
Essa alteração afeta a liberação explícita quando acionada, não constitui um teto
de RAM. Os testes Windows usaram uma API de working set inexistente no Android.

## Pacote e pesos

`python scripts/bundle-quest-runtime.py` agora prepara o executor MoE por padrão.
`--legacy-dense` é apenas diagnóstico explícito. O pacote recebe `engine-config.json`
com o modelo e parâmetros compartilhados pelo supervisor Java e pelo servidor Node.
O binário estático MoE não carrega o antigo plugin GGML do Termux.

Os pesos grandes ficam fora do APK, em:

```
/sdcard/Android/data/com.aurora.xr/files/models/qwen3-coder-30b.gguf
```

O supervisor verifica tamanho e SHA-256 antes de iniciar. Ausência ou corrupção
interrompe o início; não há substituição automática pelo 0,8B. O banco continua
em `files/aurora-data/harness.db`, fora da pasta de versão do runtime.
O hash inicial lê o arquivo todo e aquece caches; benchmarks frios devem registrar
isso e não apresentar esse estado como armazenamento frio.

## Validação pendente no dispositivo

- Conexão ADB: o Quest ficou offline durante este porte.
- Conferir a transcrição real do caso “que horas são” e sua resposta/memórias.
  Sem esse registro, não atribuir o erro ao STT, histórico ou modelo como fato.
- Verificar armazenamento livre antes de transferir; último registro: cerca de
  20 GiB livres, insuficiente para manter duas cópias destes pesos mais folga.
  Nunca apagar aplicativos ou dados do usuário para caber o modelo.
- Executar primeiro uma prova isolada, acompanhando RSS, memória disponível,
  temperatura, leitura do armazenamento, tempo até resposta e qualidade.
  Interromper sob pressão de memória; não chamar monitor amostrado de limite rígido.
- Só depois instalar/iniciar a experiência completa, medir também com MR ativo.
- Comparar perguntas idênticas no desktop e no Quest: horário real com origem
  verificável, cálculo, contexto de projeto, recuperação de memória e mudança de assunto.
- Verificar dez turnos sem eco/repetição e transcrição versus texto enviado ao Harness.
- Pocket TTS continua no PC. Esta etapa não comprova voz integralmente offline.

Não há ainda resultado de inferência MoE no Quest, nem confirmação de que seu
armazenamento UFS e RAM sustentam este modelo com latência adequada em MR.
