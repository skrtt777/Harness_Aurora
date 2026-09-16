# Memória neural 3D / Aurora

O atlas representa registros como neurônios WebGL: soma orgânico, núcleo, dendritos com ramificações, axônio e terminações. O núcleo Aurora e os neurônios grandes de projeto organizam visualmente a coleção; não são memórias adicionais nem relações semânticas inventadas.

## Usar a cena

- Arraste para girar; use a roda para aproximar e Shift + arrastar ou botão direito para mover.
- Clique em uma memória para abrir seus dados e destacar suas relações.
- Duplo clique ou **Inspecionar em 3D** aproxima o neurônio detalhado. Depois da transição, a câmera fica livre; arrastar interrompe a aproximação.
- **CAD** mostra grade, eixos e caixa delimitadora. Na inspeção, as dimensões são calculadas da geometria e identificadas como **u.c.** (unidades da cena), sem significado biológico.
- **ISO / FRENTE / TOPO / LADO**, **Ortográfica** e **Wireframe** permitem examinar a cena. Frente, topo e lado enquadram a seleção quando houver uma.
- **Visão geral** remove a seleção e reenquadra a coleção.
- **Pausar** desliga os pulsos e usa renderização sob demanda. A preferência de movimento reduzido do sistema é respeitada.
- **Leve** reduz a resolução de renderização. **Alta** usa até 1,5× de densidade de pixels.
- **Ctrl/Cmd + K** foca a pesquisa; **Escape** fecha a inspeção e sai do modo foco. A lista usa botões acessíveis pelo teclado e paginação de 100 registros.

As relações destacadas vêm exclusivamente dos dados. A rede de origem percorre relações direcionadas `belonging` e `derivation`, com proteção contra ciclos. Relações `thematic` e `correction` continuam disponíveis nas conexões diretas. Os pulsos são **ilustrativos**, não telemetria de uso pela IA.

## Coleções e importação

A primeira abertura usa 1.000 registros sintéticos identificados como demonstração. Uma coleção importada substitui a coleção visual e fica salva em `localStorage` neste navegador. Exportar gera o JSON completo, mesmo com filtros ativos.

```json
[
  {
    "id": "contexto-1",
    "title": "Diretriz do projeto",
    "content": "Conteúdo fornecido pelo usuário.",
    "kind": "context",
    "scope": "project",
    "project": "Meu projeto",
    "source": "Documento do projeto",
    "tags": ["arquitetura"],
    "position": [0, 0, 0],
    "relations": []
  },
  {
    "id": "decisao-1",
    "title": "Decisão vinculada",
    "content": "Detalhes da decisão.",
    "kind": "context",
    "scope": "conversation",
    "project": "Meu projeto",
    "conversation": "Conversa de planejamento",
    "tags": ["interface"],
    "relations": ["contexto-1"],
    "relationTypes": { "contexto-1": "derivation" }
  }
]
```

`id` deve ser único. `scope` aceita `general`, `project` e `conversation`; `kind` aceita `context` e `demo`. Posições fornecidas são preservadas; posições ausentes recebem coordenadas determinísticas por projeto. O importador rejeita coordenadas inválidas, IDs duplicados, escopos/tipos inválidos e relações com IDs inexistentes, sem substituir a coleção atual. Limites: 10 MB e 10.000 registros por importação. A carga de referência/teste é de 1.000 registros; 10.000 não é uma garantia de desempenho.

**A coleção visual importada não é enviada ao provedor nem sincronizada com `app/data/memory.json`.** A memória usada pelo chat continua sendo a do backend existente. A alteração implementa a exploração visual e preserva o contrato do chat.

## Implementação

- `data.ts`: importação, layout e dados sintéticos.
- `graph.ts`: índices de relações e percurso de origem.
- `morphology.ts`: geometria determinística e tubos com espessura decrescente.
- `Neuron.tsx`: inspeção detalhada e cotas.
- `MemoryScene.tsx`: geometrias instanciadas, conexões agrupadas, pulsos, câmera e tratamento de falhas WebGL.

A visão geral utiliza seis variantes de geometria compartilhadas em `InstancedMesh`. Grupos e seleção usam geometrias detalhadas combinadas. Conexões são desenhadas em um único `LineSegments`, em vez de um componente de linha por relação. A cena 3D é carregada separadamente da interface por importação dinâmica.

## Validação desta implementação

```powershell
npm test
npm run check
npm run test:memory
npm run frontend:build
```

- Cinco testes existentes do servidor e seis testes novos de dados/grafo/geometria passaram.
- TypeScript e build de produção passaram. O chunk 3D ainda gera aviso de tamanho do Vite.
- O navegador remoto bloqueou tanto o endereço local quanto a prévia em arquivo por política de acesso. Não houve validação visual, medição de FPS real ou teste de GPU nesta execução.
- Verificação manual pendente no computador de destino: rotação, pan, duplo clique, interrupção da câmera, troca de projeção, importação/exportação pela interface, layout em tela estreita e fallback sem WebGL.
