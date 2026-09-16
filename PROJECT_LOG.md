# Registro do Projeto — AI Harness

Este arquivo registra decisões, alterações e testes para manter o contexto de execução do projeto.

## Estado atual

- **Fase:** Fase 1 — Primeiro agente.
- **Versão interna:** 0.1.0.
- **Modo disponível:** Individual.
- **Provedor disponível:** Codex CLI com autenticação salva localmente.
- **Provedores adicionais:** ainda não implementados; continuam opcionais.

## Alterações realizadas

### 2026-09-15

- Criado `package.json` com scripts `start`, `test` e `check`.
- Criado backend local em `app/server.js`.
- Criada interface mínima em `app/public/index.html`.
- Criado `.env.example` para documentar a configuração local.
- Criados testes unitários iniciais em `test/server.test.js`.
- O backend mantém a chave da OpenAI fora do navegador.
- A integração utiliza `POST /v1/responses` com `store: false`.

## Decisões

- O uso individual é o caminho padrão.
- Codex é o primeiro provedor suportado.
- Novos provedores devem entrar por adaptadores, sem alterar a interface principal.
- O primeiro protótipo evita dependências externas obrigatórias e usa APIs nativas do Node.js.
- O app escuta apenas em `127.0.0.1` por padrão.
- O harness executa `codex exec --ephemeral --json` e não acessa diretamente os tokens do Codex.

## Testes planejados

- [x] Verificar sintaxe do backend com `npm run check`.
- [x] Verificar configuração padrão sem API key.
- [x] Verificar configuração com modelo customizado.
- [ ] Executar chamada real com a sessão autenticada do Codex CLI.
- [ ] Validar instalação limpa.
- [ ] Adicionar launcher Pinokio.
- [ ] Adicionar persistência SQLite.
- [ ] Adicionar segundo provedor opcional.

## Como continuar

1. Executar `npm test`.
2. Executar `npm run check`.
3. Confirmar que `codex` está instalado e autenticado.
4. Executar `npm start`.
5. Abrir `http://127.0.0.1:8787`.

## Pendências conhecidas

- Ainda não existe carregamento automático de arquivo `.env`.
- O histórico ainda não é persistido.
- A interface ainda não permite selecionar provedores.
- Não há streaming de resposta.
- Ainda não existe instalação/atualização via Pinokio.
- A autenticação via Codex CLI ainda não foi validada com uma tarefa real pelo harness.

## Resultados dos testes

### 2026-09-15

- `npm run check`: **passou**.
- `npm test`: a execução padrão encontrou `spawn EPERM` no ambiente Windows restrito.
- `node --test --test-isolation=none`: **passou — 4 testes**.
- O script `npm test` foi ajustado para usar `--test-isolation=none`, permitindo repetir o teste neste ambiente.
- O teste de fumaça do servidor passou; há **4 testes** cobrindo configuração, parser JSONL e endpoint local de saúde.
- O backend foi migrado para o Codex CLI; a chamada real com a conta autenticada permanece como validação manual.
- Como os repositórios antigos não estão disponíveis, o frontend novo foi adicionado ao projeto atual sem apagar o protótipo anterior.
- Criada aplicação React + TypeScript + Vite em `frontend/` usando Three.js, React Three Fiber e Drei.
- Criados módulos separados para dados sintéticos/importação, geração geométrica dos neurônios, cena 3D e interface.
- A carga inicial contém exatamente 1.000 registros sintéticos, marcados como `kind: demo` e identificados como demonstração.
- Incluída importação de JSON para dados reais, preservando `scope`, `source`, `project`, `folder`, `conversation`, `tags` e relações.
- Adicionados mapa/lista, busca, contagens calculadas, filtro preparado, painel de inspeção, câmera ortográfica/perspectiva, gizmo, grade/eixos CAD e wireframe.
- A interface foi redesenhada com sidebar, cabeçalho, cartões de status, área de conversa premium, composer responsivo e estados visuais de conexão/carregamento.
- Mantida a funcionalidade de chat, envio com Enter e nova linha com Shift + Enter.
- Adicionado popup de configurações com ícone animado, limite de contexto ajustável e visualização da rede de memória.
- Adicionada memória local em `app/data/memory.json`, com nós, relações e categorias básicas.
- O prompt enviado ao Codex agora inclui memórias locais e é limitado pelo tamanho configurado.
- A rede de memória foi promovida para o workspace principal com estética CAD/3D: grade em perspectiva, órbitas, conexões animadas e nós com profundidade visual.
- O retorno do backend agora informa `memoryAccess`, permitindo destacar em laranja as memórias consultadas durante a execução.

## Resultados de testes — interface

### 2026-09-15

- `npm run check`: **passou**.
- `npm test`: **passou — 4 testes**.
- A alteração visual não modificou o contrato do backend.
- `npm test`: **passou — 5 testes** após adicionar a validação do limite de contexto.
- Após a rede 3D e o rastreamento de acesso, `npm run check` e `npm test` continuam passando com **5 testes**.
- `frontend/npm install`: **passou**, 146 pacotes instalados, 0 vulnerabilidades; houve aviso de pacote transitivo depreciado (`three-mesh-bvh@0.7.8`).
- `frontend/npm run build`: **passou**, 616 módulos transformados e bundle de produção gerado.
- O build reportou aviso de chunk principal acima de 500 kB; otimização por code-splitting fica pendente.
- Validação visual no navegador confirmou WebGL real, 1.000 registros, seleção em lista com painel de inspeção e destaque do neurônio selecionado; o navegador ficou indisponível ao repetir a captura após o último ajuste de foco.
## 2026-09-15 — Histórico e distribuição para testers

- Adicionado histórico persistente de conversas em `frontend/src/history.ts`, com título automático, mensagens de usuário/assistente, provedor e memórias acessadas.
- A barra lateral agora lista conversas recentes; é possível criar uma nova conversa e reabrir qualquer conversa salva no navegador.
- Criada tela de conversa com composer, envio por Enter, estados de carregamento e preservação automática em `localStorage`.
- Configurado proxy Vite de `/api` para a API local em `frontend/vite.config.ts`.
- Adicionado `README.md` com execução, distribuição, atualização e checklist de validação.
- `update.cmd`/`scripts/update.ps1` agora atualizam checkout Git, reinstalam dependências e validam o build sem apagar dados locais; fora de Git, exibem orientação de distribuição do novo pacote.
- Validação: `npm test` passou com 5/5, `npm run check` passou e `frontend npm run build` passou com 618 módulos transformados.
- API local validada em `127.0.0.1:8787`: `/api/health` retornou 200 e `/api/memories` retornou 200.
- Interface validada em `127.0.0.1:5173`: 1.000 registros exibidos, tela de conversa acessível e console sem erros/avisos.
- Limitação conhecida: o bundle de produção do Three.js gera aviso de chunk acima de 500 kB; o histórico permanece local por navegador/dispositivo e ainda não sincroniza entre testers.
- Adicionado `start-test.cmd` para abrir API, frontend e navegador em um passo no Windows.

## 2026-09-15 — Instalador Windows e preparação do GitHub

- Criado instalador sem administrador em `installer/Install-AIHarness.ps1` e atalho `installer/install.cmd`.
- O instalador verifica Node.js, npm e Codex CLI, copia o projeto para `%LOCALAPPDATA%\AI-Harness`, instala dependências, executa o build e cria atalho na área de trabalho.
- Criado desinstalador em `installer/Uninstall-AIHarness.ps1`, sem remover histórico do navegador.
- O repositório Git local será inicializado nesta etapa; o push depende da URL do repositório GitHub e da autenticação do usuário.

## 2026-09-16 — Fluxo visual de pensamento

- A rede de relações passou a ficar visível em toda a cena, com curvas espaciais entre memórias relacionadas.
- Adicionados pulsos animados em uma amostra de conexões e em todas as relações diretas da memória selecionada.
- Neurônios acessados agora exibem emissividade quente, halo pulsante e alteração de escala; a seleção reduz a intensidade dos demais.
- No modo demonstrativo, uma sequência local percorre os registros para ilustrar atividade; eventos reais podem alimentar `memoryAccess` pela API.
- Build frontend validado novamente com 618 módulos transformados. A captura visual foi conferida no navegador local em 16/09/2026.

## 2026-09-16 — Refatoração completa da morfologia 3D

- Substituído o modelo radial por uma morfologia neural hierárquica: soma irregular, núcleo, dendritos primários/secundários/terciários e axônio com colaterais.
- Adicionadas espinhas sinápticas na inspeção, materiais CAD wireframe reutilizados e eixos técnicos locais no neurônio selecionado.
- Mantida a otimização por nível de detalhe: visão geral simplificada e geometria completa apenas no neurônio selecionado/inspecionado.
- Build Vite validado com 618 módulos e cena conferida no navegador local após recarregamento, sem erros/avisos novos no console.


## 2026-09-16 — Atlas neural CAD no Harness Aurora

- Cena reformulada com núcleo visual Aurora, grupos coloridos por projeto e 1.000 memórias demonstrativas. Nenhum dado pessoal da referência visual foi incluído no código.
- Geometria volumétrica determinística com soma, núcleo, dendritos em três níveis, axônio e terminações; seis variantes instanciadas na visão geral e geometrias detalhadas combinadas na inspeção.
- Conexões agrupadas e pulsos instanciados, explicitamente identificados como ilustrativos. Sem rotação automática da coleção.
- Foco da câmera por comando, com alvo do OrbitControls atualizado e interrupção por interação; enquadramento geral e vistas CAD; coordenadas e cotas reais da geometria em unidades da cena.
- Busca, filtros, projetos, assuntos, lista paginada, relações de entrada/saída, rede de origem e atalhos conectados à interface.
- Importador preserva relações/posições, valida IDs e referências, distribui registros sem posição e salva a coleção visual no navegador. Exportação completa em JSON.
- Movimento reduzido, pausa com renderização sob demanda, qualidade gráfica e fallback para lista em falha WebGL.
- Build 3D separado da interface; aviso de chunk 3D acima de 500 kB permanece.
- Validação: 5 testes de servidor, 6 testes de memória/grafo/geometria, sintaxe do servidor e build TypeScript/Vite passaram.
- Limitação desta execução: política do navegador remoto bloqueou localhost e arquivo de prévia; visual, interações WebGL e FPS ainda precisam de validação no computador de destino.
- A coleção importada no atlas é local ao navegador; a memória do backend usada pelo chat não foi alterada.
