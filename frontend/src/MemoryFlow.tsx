import { useCallback, useMemo } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { groupColor, groupKey, type Memory } from "./data";
import { buildGraph, type MemoryEdge } from "./graph";

const NODE_WIDTH = 200;
const NODE_HEIGHT = 52;

const RELATION_LABEL: Record<string, string> = {
  belonging: "pertence a",
  thematic: "relacionado a",
  derivation: "decorre de",
  correction: "corrige",
};

const RELATION_COLOR: Record<string, string> = {
  belonging: "#75eaff",
  thematic: "#83a8ff",
  derivation: "#c5a0ff",
  correction: "#d49bff",
};

function layoutWithDagre(memories: Memory[], edges: MemoryEdge[]) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 96 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const memory of memories) g.setNode(memory.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const edge of edges) g.setEdge(edge.from.id, edge.to.id);
  dagre.layout(g);
  const positions = new Map<string, { x: number; y: number }>();
  for (const memory of memories) {
    const node = g.node(memory.id);
    positions.set(memory.id, node ? { x: node.x - NODE_WIDTH / 2, y: node.y - NODE_HEIGHT / 2 } : { x: 0, y: 0 });
  }
  return positions;
}

type NodeData = { memory: Memory; selected: boolean };

function MemoryNode({ data }: NodeProps) {
  const { memory, selected } = data as unknown as NodeData;
  return (
    <div className={`flow-node ${selected ? "selected" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <span className="flow-node-dot" style={{ background: groupColor(groupKey(memory)) }} />
      <div className="flow-node-body">
        <strong>{memory.title}</strong>
        <small>{memory.project || memory.conversation || "Contexto geral"}</small>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { memory: MemoryNode };

type Props = {
  memories: Memory[];
  allMemories: Memory[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

/**
 * A simplified 2D alternative to the 3D atlas: same underlying graph
 * (buildGraph from graph.ts), laid out hierarchically with dagre instead of
 * placed in 3D space. Mirrors MemoryScene's memories/allMemories contract so
 * edges to filtered-out nodes still resolve against the full graph.
 */
export default function MemoryFlow({ memories, allMemories, selectedId, onSelect }: Props) {
  const graph = useMemo(() => buildGraph(allMemories), [allMemories]);
  const visible = useMemo(() => new Set(memories.map((m) => m.id)), [memories]);
  const edges = useMemo(
    () => graph.edges.filter((e) => visible.has(e.from.id) && visible.has(e.to.id)),
    [graph, visible],
  );

  const { nodes, flowEdges } = useMemo(() => {
    const positions = layoutWithDagre(memories, edges);
    const nodes: Node[] = memories.map((memory) => ({
      id: memory.id,
      type: "memory",
      position: positions.get(memory.id) || { x: 0, y: 0 },
      data: { memory, selected: memory.id === selectedId } satisfies NodeData,
      draggable: false,
    }));
    const flowEdges: Edge[] = edges.map((edge) => ({
      id: edge.key,
      source: edge.from.id,
      target: edge.to.id,
      label: RELATION_LABEL[edge.type] || edge.type,
      style: { stroke: RELATION_COLOR[edge.type] || "#5a6b7a" },
      animated: edge.from.id === selectedId || edge.to.id === selectedId,
    }));
    return { nodes, flowEdges };
  }, [memories, edges, selectedId]);

  const handleNodeClick = useCallback((_: unknown, node: Node) => onSelect(node.id), [onSelect]);

  return (
    <div className="memory-flow">
      <ReactFlow
        nodes={nodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} color="#28334c" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable style={{ background: "#141a2a" }}
          nodeColor={(node) => groupColor(groupKey((node.data as NodeData).memory))}
          maskColor="#0c101cb8" maskStrokeColor="#c5a0ff" />
      </ReactFlow>
    </div>
  );
}
