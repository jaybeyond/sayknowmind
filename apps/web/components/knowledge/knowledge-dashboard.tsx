"use client";

import { useState, useEffect, useCallback } from "react";
import { GraphCanvas } from "./graph-canvas";
import { NodeDetailPanel } from "./node-detail-panel";
import { Skeleton } from "@/components/ui/skeleton";

interface GraphNode {
  id: string;
  label: string;
  type: string;
  properties?: Record<string, unknown>;
}

interface GraphEdge {
  source: string;
  target: string;
  type: string;
  label?: string;
}

interface NodeDetail {
  id: string;
  label: string;
  type: string;
  properties?: Record<string, unknown>;
  connectedDocuments?: Array<{ id: string; title: string; url?: string }>;
}

export function KnowledgeDashboard() {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<NodeDetail | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (filter !== "all") params.set("type", filter);

      const res = await fetch(`/api/knowledge/graph?${params}`);
      if (!res.ok) throw new Error("Failed to fetch graph");

      const data = await res.json();
      setNodes(data.nodes ?? []);
      setEdges(data.edges ?? []);
    } catch (err) {
      console.error("Failed to load graph:", err);
      setNodes([]);
      setEdges([]);
    } finally {
      setLoading(false);
    }
  }, [search, filter]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  const handleNodeClick = async (node: GraphNode) => {
    try {
      const res = await fetch(`/api/knowledge/node/${node.id}`);
      if (res.ok) {
        const detail = await res.json();
        setSelectedNode(detail);
      } else {
        setSelectedNode({
          id: node.id,
          label: node.label,
          type: node.type,
        });
      }
    } catch {
      setSelectedNode({
        id: node.id,
        label: node.label,
        type: node.type,
      });
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 p-3 border-b border-border">
        <div className="relative flex-1 max-w-sm">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            placeholder="Search knowledge graph..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md bg-muted/50 border border-border focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="text-sm rounded-md bg-muted/50 border border-border px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="all">All Types</option>
          <option value="document">Documents</option>
          <option value="entity">Entities</option>
          <option value="category">Categories</option>
        </select>

        <div className="text-xs text-muted-foreground">
          {nodes.length} nodes / {edges.length} edges
        </div>
      </div>

      {/* Graph Area */}
      <div className="flex-1 relative overflow-hidden bg-background">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-64 w-full max-w-lg rounded-xl" />
            <div className="flex gap-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        ) : (
          <GraphCanvas
            nodes={nodes}
            edges={edges}
            onNodeClick={handleNodeClick}
            selectedNodeId={selectedNode?.id}
          />
        )}

        {/* Node Detail Panel */}
        <NodeDetailPanel
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
        />
      </div>
    </div>
  );
}
