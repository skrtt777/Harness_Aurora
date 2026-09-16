# Roadmap Mestre — AI Harness / Memory Atlas

## Objetivo

Construir uma aplicação local instalável para trabalhar com agentes de IA individualmente ou em conjunto, tendo como experiência principal uma visualização 3D real das memórias em formato de rede neural orgânica, com modo técnico CAD.

O uso individual será sempre válido. O usuário poderá trabalhar somente com Codex, enquanto Claude, Gemini, Ollama e outros provedores serão integrações opcionais.

## Princípios do projeto

- Preservar dados existentes e não apagar trabalho sem autorização.
- Não presumir acesso a memórias do ChatGPT ou a repositórios antigos.
- Distinguir claramente dados reais importados de dados sintéticos de demonstração.
- Manter o aplicativo funcional mesmo com apenas um provedor configurado.
- Separar dados, domínio, renderização 3D e interface.
- Manter a chave e a autenticação fora do navegador.
- Calcular contagens e estados a partir dos dados reais carregados.
- Não apresentar estados como “online” ou “tempo real” sem integração que os justifique.
- Preferir recursos locais e reversíveis durante o desenvolvimento.

## Arquitetura final esperada

```text
AI Harness
├── frontend/                 # React, TypeScript, Vite
│   ├── data/                 # modelos, importação e validação
│   ├── memory/               # grafo, ranking e escopos
│   ├── neurons/              # geometria e variações determinísticas
│   ├── scene/                # Three.js/R3F, câmera e LOD
│   ├── panels/               # pesquisa, filtros e inspeção
│   └── accessibility/        # lista, teclado e fallback sem WebGL
├── backend/                  # API local e persistência
│   ├── providers/            # Codex, Claude, Gemini, Ollama e compatíveis
│   ├── orchestration/        # individual, comparação e colaboração
│   ├── memory/               # armazenamento e recuperação contextual
│   └── security/             # credenciais, permissões e escopos
├── app/                      # launcher/backend legado preservado quando aplicável
├── scripts/                  # desenvolvimento, validação e empacotamento
├── tests/                    # unitários, integração e smoke tests
└── docs/                     # contratos e manuais
```

## Fase 0 — Auditoria e fundação

### Entregas

- Verificar o conteúdo atual do workspace.
- Ler instruções existentes e identificar stack, scripts e pontos de entrada.
- Preservar o protótipo atual e seus arquivos de memória/documentação.
- Confirmar Node.js, npm e suporte a WebGL.
- Fixar versões compatíveis de React, Vite, Three.js, React Three Fiber e Drei.
- Criar convenções de commits, logs e testes.
- Criar uma configuração única de desenvolvimento.

### Critérios de conclusão

- O projeto inicia sem destruir o que já existe.
- O frontend e o backend possuem comandos documentados.
- O build e os testes mínimos são reproduzíveis.

## Fase 1 — Modelo de dados das memórias

### Modelo mínimo

Cada memória deve suportar:

- `id` estável.
- `title`.
- `content`.
- `kind`: `context` ou `demo`.
- `scope`: `general`, `project` ou `conversation`.
- `project`.
- `folder`.
- `conversation`.
- `source` verificável ou indicação de resumo/contexto.
- `date`, somente quando disponível.
- `tags`.
- `position` persistida na cena.
- `relations`.
- `relationTypes`: pertencimento, temática, derivação ou correção.

### Entregas

- Criar schema TypeScript e validação de entrada.
- Criar carga sintética de exatamente 1.000 registros.
- Marcar todos os registros sintéticos como demonstração.
- Criar importação de JSON.
- Preservar posições após filtros e recarregamentos.
- Preparar exportação do grafo.
- Calcular contagens por origem, escopo, projeto, categoria e tipo.

### Critérios de conclusão

- Nenhuma memória sintética é apresentada como real.
- A aplicação consegue carregar 1.000 registros sem duplicação de identidade.
- JSON inválido é rejeitado com mensagem clara.

## Fase 2 — Grafo e recuperação contextual

### Entregas

- Criar grafo separado de nós e relações.
- Diferenciar tipos de relação visualmente.
- Criar agrupamento espacial orgânico por contexto.
- Evitar anéis concêntricos rígidos.
- Criar ranking de relevância por texto, tags, escopo e relações.
- Aplicar limite configurável de contexto.
- Informar quais memórias foram usadas em cada execução da IA.
- Criar caminho de contexto geral → projeto/pasta → conversa → memória quando os dados permitirem.
- Preparar camada futura para embeddings e busca semântica.

### Critérios de conclusão

- Uma execução da IA consegue informar suas memórias acessadas.
- O limite de contexto é respeitado.
- Relações inexistentes não são inventadas.

## Fase 3 — Geometria neural 3D

### Visão geral

Usar Three.js com React Three Fiber e Drei para renderização WebGL real.

### Geometria

- Corpo celular orgânico, sem esfera perfeita.
- Núcleo interno.
- Dendritos curvos.
- Ramificações secundárias e terciárias.
- Espessura progressivamente menor.
- Axônio e terminações sinápticas.
- Variações determinísticas por `id`.
- Materiais por categoria e origem.
- Integração visual entre soma e prolongamentos.

### Níveis de detalhe

- **Visão geral:** soma simplificado e ramificações principais.
- **Distância intermediária:** soma e ramificações volumétricas.
- **Inspeção:** núcleo, ramificações detalhadas, terminações e wireframe.

### Desempenho

- Reutilizar geometrias e materiais.
- Usar instanciamento onde compatível.
- Não criar 1.000 componentes HTML sobrepostos.
- Não recalcular posições a cada frame.
- Limitar resolução de efeitos.
- Oferecer qualidade baixa, média e alta.
- Respeitar preferência por movimento reduzido.

### Critérios de conclusão

- A rede é WebGL real.
- Uma memória selecionada mostra volume, núcleo e ramificações.
- Diferentes memórias não repetem exatamente o mesmo neurônio.
- A visualização permanece utilizável com 1.000 registros.

## Fase 4 — Cena, câmera e CAD

### Controles

- Rotação livre em 360 graus.
- Zoom por scroll.
- Pan por mouse.
- Pan e atalhos por teclado.
- Seleção por clique.
- Destaque por hover.
- Foco por duplo clique.
- Visão geral.
- Perspectiva e ortográfica.
- Vistas frontal, superior, lateral e isométrica.
- Gizmo interativo de orientação.

### Modo CAD

- Grade espacial discreta.
- Eixos X, Y e Z.
- Wireframe sobre geometria real.
- Contornos e pontos de controle.
- Linhas-guia ancoradas.
- Caixa delimitadora real.
- Coordenadas da cena real.
- Dimensões identificadas como unidades da cena.
- Sem cotas biológicas inventadas.
- Modo “Inspecionar neurônio”.
- Vista explodida esquemática claramente identificada como representação visual.

### Critérios de conclusão

- O usuário consegue girar, aproximar e examinar uma memória.
- As coordenadas exibidas correspondem à geometria.
- O modo padrão permanece limpo e elegante.
- O modo CAD concentra os detalhes técnicos somente quando solicitado.

## Fase 5 — Interface completa

### Layout

- Barra lateral com coleções, projetos, categorias e contagens.
- Barra superior com pesquisa e controles.
- Área central dominante para a rede 3D.
- Painel direito para inspeção.
- Alternância mapa/lista.
- Modo foco recolhendo os painéis.
- Estado local/demonstração sempre explícito.

### Pesquisa e filtros

- Título.
- Conteúdo.
- Projeto.
- Pasta.
- Conversa.
- Tags.
- Categoria.
- Origem/contexto/demonstração.
- Escopo geral/projeto/conversa.
- Contagem atualizada após cada filtro.

### Painel de inspeção

- Título e conteúdo.
- Classificação real/demonstração.
- Escopo.
- Projeto/pasta.
- Conversa de origem.
- Fonte.
- Data quando disponível.
- Tags.
- Relações diretas.
- Tipo de cada relação.
- Navegação entre memórias relacionadas.

### Acessibilidade

- Lista navegável por teclado.
- Seleção textual da memória.
- Mensagem clara quando WebGL não estiver disponível.
- Não substituir o 3D silenciosamente por imagem.
- Manter navegação em lista sem WebGL.

## Fase 6 — Integração com provedores de IA

### Modo individual

- Codex como primeiro provedor.
- Reutilizar autenticação do Codex CLI quando disponível.
- Não acessar ou copiar tokens privados diretamente.
- Manter API direta como opção futura.

### Provedores opcionais

- Claude.
- Gemini.
- Ollama.
- APIs compatíveis com OpenAI.

### Orquestração

- Individual.
- Comparação independente.
- Executor → revisor → consolidador.
- Seleção explícita do provedor em cada etapa.
- Falha isolada por provedor.
- Registro de custo/uso quando fornecido.

## Fase 7 — Persistência, segurança e permissões

- Migrar memória de demonstração para armazenamento local versionado.
- Usar SQLite ou armazenamento equivalente quando o modelo estiver estável.
- Separar configurações e dados do código.
- Proteger credenciais no armazenamento do sistema.
- Não expor chaves no frontend.
- Aplicar escopos de memória corretamente.
- Não mostrar memórias de outros participantes sem autorização.
- Registrar importações, exportações e alterações relevantes.
- Criar backup antes de migrações.

## Fase 8 — Instalação e atualização

### Primeira distribuição

- Launcher local com instalação, início, reset e atualização.
- Configuração automática do ambiente.
- Verificação de dependências.
- Mensagens de erro acionáveis.
- README completo.

### Empacotamento desktop

- Avaliar Tauri depois que o app web estiver estável.
- Criar instalador para Windows.
- Criar ícone e atalho.
- Separar diretório de dados do diretório da aplicação.
- Implementar atualização segura.
- Preservar memórias durante atualizações.

## Fase 9 — Testes e validação

### Testes automatizados

- Schema e validação de JSON.
- Geração determinística de neurônios.
- Relações e contagens.
- Ranking e limite de contexto.
- Importação/exportação.
- API local.
- Fallback sem WebGL.
- Build TypeScript.

### Testes manuais

- Carregar 1.000 memórias.
- Rotacionar, aproximar e deslocar a câmera.
- Selecionar e inspecionar um neurônio.
- Navegar por relações.
- Usar pesquisa e filtros.
- Alternar mapa/lista.
- Alternar CAD, wireframe e ortográfica.
- Testar diferentes tamanhos de janela.
- Testar qualidade baixa, média e alta.
- Testar movimento reduzido.
- Testar memória importada real e demonstração.

### Medições

Registrar:

- Ambiente de teste.
- Navegador e versão.
- GPU disponível.
- Número de memórias.
- Tempo de carregamento.
- Tempo de primeira renderização.
- FPS observado na visão geral.
- FPS observado na inspeção.
- Uso aproximado de memória.
- Erros e avisos do console.

Não declarar fluidez ou FPS sem medir.

## Fase 10 — Documentação e entrega

- README de instalação.
- Guia de importação JSON.
- Especificação do modelo de memória.
- Guia de provedores.
- Guia do modo CAD.
- Política de dados locais.
- Registro de alterações.
- Evidências reais da interface funcionando.
- Limitações conhecidas.
- Instruções de atualização e recuperação.

## Ordem de implementação em uma execução contínua

1. Auditar e preservar o workspace.
2. Consolidar a estrutura React/Vite.
3. Instalar e fixar dependências compatíveis.
4. Criar o modelo de dados e 1.000 memórias demo.
5. Implementar importação JSON.
6. Implementar grafo e relações.
7. Implementar neurônio 3D detalhado.
8. Implementar LOD e otimizações.
9. Implementar câmera e controles.
10. Implementar modo CAD.
11. Implementar seleção, inspeção e navegação.
12. Implementar pesquisa e filtros ativos.
13. Implementar lista acessível e fallback sem WebGL.
14. Integrar rastreamento de memória no contexto do Codex.
15. Implementar provedores opcionais por adaptadores.
16. Adicionar persistência e proteção de dados.
17. Criar launcher e atualização.
18. Executar testes automatizados.
19. Executar validação visual e de desempenho.
20. Corrigir problemas encontrados.
21. Atualizar documentação e registro do projeto.

## Critério principal de aceitação

O projeto estará pronto quando for possível:

1. Abrir a aplicação local.
2. Visualizar 1.000 memórias demonstrativas em uma rede neural 3D real.
3. Girar, aproximar e deslocar a câmera.
4. Selecionar uma memória.
5. Examinar um neurônio com corpo volumétrico, núcleo e ramificações orgânicas.
6. Ativar o modo CAD e ver a geometria técnica correspondente.
7. Pesquisar, filtrar e navegar pelas relações.
8. Importar dados reais em JSON sem misturá-los com demonstrações.
9. Usar somente Codex ou adicionar outros provedores opcionalmente.
10. Instalar e atualizar o aplicativo sem perder os dados locais.

## Decisões necessárias ao final

Só solicitar confirmação se essas escolhas alterarem materialmente a implementação:

1. **Nome oficial do produto:** manter “AI Harness”, usar “Memory Atlas” ou outro nome.
2. **Distribuição inicial:** launcher local primeiro ou instalador desktop já na primeira entrega.
3. **Persistência:** JSON local inicialmente ou SQLite desde o começo.
4. **Provedor Codex:** somente Codex CLI autenticado ou também API key como fallback visível.
5. **Qualidade padrão:** baixa, média ou alta para a cena 3D.
6. **Tema:** manter o tema escuro azul/ciano ou adotar outra paleta.
7. **Dados reais:** formato JSON final caso exista uma fonte de memórias para importar.

Se nenhuma decisão for fornecida, serão usados estes padrões: nome AI Harness, launcher local primeiro, SQLite quando a camada de dados estiver estável, Codex CLI como padrão, qualidade média, tema escuro azul/ciano e schema JSON documentado neste projeto.
