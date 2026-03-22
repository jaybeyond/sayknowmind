"use client";

import { useCallback, useEffect } from "react";
import {
  ReactFlow,
  addEdge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type OnConnect,
  BackgroundVariant,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { CategoryNode } from "./category-manager";

interface CategoryGraphProps {
  tree: CategoryNode | null;
  onNodeClick?: (nodeId: string) => void;
}

// Convert category tree to React Flow nodes/edges
function treeToFlow(
  node: CategoryNode,
  parentId: string | null = null,
  depth: number = 0,
  index: number = 0,
  _total: number = 1,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const x = depth * 220;
  const y = index * 80;

  nodes.push({
    id: node.id,
    position: { x, y },
    data: {
      label: (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-sm">{node.name}</span>
          {node.documentCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {node.documentCount} docs
            </span>
          )}
        </div>
      ),
    },
    style: {
      background: node.color ?? "#1a1a2e",
      border: "1px solid #00E5FF40",
      borderRadius: 8,
      padding: "8px 12px",
      minWidth: 140,
      color: "#ffffff",
    },
  });

  if (parentId) {
    edges.push({
      id: `${parentId}->${node.id}`,
      source: parentId,
      target: node.id,
      markerEnd: { type: MarkerType.ArrowClosed, color: "#00E5FF60" },
      style: { stroke: "#00E5FF40" },
    });
  }

  let childIndex = 0;
  const childCount = node.children?.length ?? 0;
  for (const child of node.children ?? []) {
    const sub = treeToFlow(
      child,
      node.id,
      depth + 1,
      index + childIndex,
      childCount,
    );
    nodes.push(...sub.nodes);
    edges.push(...sub.edges);
    childIndex += 1 + (child.children?.length ?? 0);
  }

  return { nodes, edges };
}

export function CategoryGraph({ tree, onNodeClick }: CategoryGraphProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const onConnect: OnConnect = useCallback(
    (connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges],
  );

  useEffect(() => {
    if (!tree) {
      setNodes([]);
      setEdges([]);
      return;
    }
    const { nodes: newNodes, edges: newEdges } = treeToFlow(tree);
    setNodes(newNodes);
    setEdges(newEdges);
  }, [tree, setNodes, setEdges]);

  if (!tree) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground text-sm">No categories yet</p>
      </div>
    );
  }

  return (
    <div className="flex-1 h-full" style={{ minHeight: 400 }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, node) => onNodeClick?.(node.id)}
        fitView
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} color="#ffffff10" />
        <Controls />
        <MiniMap
          nodeColor={(n) => (n.style?.background as string) ?? "#1a1a2e"}
          style={{ background: "#0a0a0a", border: "1px solid #ffffff15" }}
        />
      </ReactFlow>
    </div>
  );
}
