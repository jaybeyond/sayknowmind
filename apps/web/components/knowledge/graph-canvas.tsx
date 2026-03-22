"use client";

import { useEffect } from "react";
import { SigmaContainer, useRegisterEvents, useSigma } from "@react-sigma/core";
import "@react-sigma/core/lib/style.css";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { Network } from "lucide-react";

interface GraphNode {
  id: string;
  type: string;
  label: string;
  properties?: Record<string, unknown>;
}

interface GraphEdge {
  source: string;
  target: string;
  type: string;
  label?: string;
}

interface GraphCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onNodeClick?: (node: GraphNode) => void;
  selectedNodeId?: string | null;
}

const NODE_COLORS: Record<string, string> = {
  document: "#00E5FF",
  entity: "#FF2E63",
  category: "#A855F7",
};

const DEFAULT_COLOR = "#888888";

// Inner component that has access to Sigma instance
function GraphEvents({
  nodes,
  onNodeClick,
}: {
  nodes: GraphNode[];
  onNodeClick?: (node: GraphNode) => void;
}) {
  const registerEvents = useRegisterEvents();
  const sigma = useSigma();

  useEffect(() => {
    registerEvents({
      clickNode: (event) => {
        const nodeId = event.node;
        const found = nodes.find((n) => n.id === nodeId);
        if (found) onNodeClick?.(found);
      },
      enterNode: () => {
        sigma.getContainer().style.cursor = "pointer";
      },
      leaveNode: () => {
        sigma.getContainer().style.cursor = "default";
      },
    });
  }, [registerEvents, sigma, nodes, onNodeClick]);

  return null;
}

function GraphLoader({
  nodes,
  edges,
  selectedNodeId,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNodeId?: string | null;
}) {
  const sigma = useSigma();

  useEffect(() => {
    const graph = sigma.getGraph();
    graph.clear();

    // Add nodes positioned in a circle initially
    nodes.forEach((node, i) => {
      const angle = (i / nodes.length) * 2 * Math.PI;
      const radius = 200;
      graph.addNode(node.id, {
        label: node.label.slice(0, 30),
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
        size: node.id === selectedNodeId ? 14 : 8,
        color:
          node.id === selectedNodeId
            ? "#ffffff"
            : (NODE_COLORS[node.type] ?? DEFAULT_COLOR),
        type: "circle",
      });
    });

    // Add edges (deduplicate, skip self-loops and missing endpoints)
    const edgeSet = new Set<string>();
    edges.forEach((edge) => {
      const key = `${edge.source}->${edge.target}`;
      if (
        edgeSet.has(key) ||
        !graph.hasNode(edge.source) ||
        !graph.hasNode(edge.target) ||
        edge.source === edge.target
      )
        return;
      edgeSet.add(key);
      try {
        graph.addEdge(edge.source, edge.target, {
          label: edge.label ?? edge.type,
          size: 1,
          color: "#ffffff20",
        });
      } catch {
        // Skip duplicate edge errors
      }
    });

    // Apply ForceAtlas2 layout
    if (nodes.length > 0) {
      forceAtlas2.assign(graph, {
        iterations: 100,
        settings: {
          gravity: 1,
          scalingRatio: 2,
          slowDown: 5,
        },
      });
    }

    sigma.refresh();
  }, [sigma, nodes, edges, selectedNodeId]);

  return null;
}

export function GraphCanvas({
  nodes,
  edges,
  onNodeClick,
  selectedNodeId,
}: GraphCanvasProps) {
  if (nodes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <Network className="size-12 text-muted-foreground/20 mx-auto" />
          <p className="text-muted-foreground text-sm font-medium">
            No knowledge graph yet
          </p>
          <p className="text-xs text-muted-foreground/50">
            Save documents to build your graph
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 relative">
      <SigmaContainer
        graph={Graph}
        style={{ height: "100%", width: "100%", background: "transparent" }}
        settings={{
          defaultNodeType: "circle",
          defaultEdgeType: "line",
          labelDensity: 0.07,
          labelGridCellSize: 60,
          labelRenderedSizeThreshold: 8,
          labelFont: "Inter, sans-serif",
          zIndex: true,
          renderLabels: true,
        }}
      >
        <GraphLoader
          nodes={nodes}
          edges={edges}
          selectedNodeId={selectedNodeId}
        />
        <GraphEvents nodes={nodes} onNodeClick={onNodeClick} />
      </SigmaContainer>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 flex gap-3 bg-background/60 backdrop-blur-sm rounded-lg px-3 py-2 border border-border/50">
        {Object.entries(NODE_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5">
            <div
              className="size-2.5 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="text-[11px] text-muted-foreground capitalize">
              {type}
            </span>
          </div>
        ))}
      </div>

      {/* Node count */}
      <div className="absolute top-4 right-4 text-xs text-muted-foreground/60 bg-background/60 backdrop-blur-sm rounded px-2 py-1 border border-border/50">
        {nodes.length} nodes · {edges.length} edges
      </div>
    </div>
  );
}
