"use client";

import { useState, useEffect, useCallback } from "react";
import { GraphCanvas } from "./graph-canvas";
import { NodeDetailPanel } from "./node-detail-panel";

interface GraphNode {
  id: string;
  label: string;
  type: "document" | "entity" | "category" | "concept";
  x: number;
  y: number;
  size: number;
  color: string;
}

interface GraphEdge {
  source: string;
  target: string;
  label?: string;
  weight?: number;
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
  const [searchHighlight, setSearchHighlight] = useState<string[]>([]);
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

      // Highlight search matches
      if (search) {
        const matching = (data.nodes ?? [])
          .filter((n: GraphNode) =>
            n.label.toLowerCase().includes(search.toLowerCase()),
          )
          .map((n: GraphNode) => n.id);
        setSearchHighlight(matching);
      } else {
        setSearchHighlight([]);
      }
    } catch (err) {
      console.error("Failed to load graph:", err);
      // Show empty state
      setNodes([]);
      setEdges([]);
    } finally {
      setLoading(false);
    }
  }, [search, filter]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  const handleNodeClick = async (nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;

    try {
      const res = await fetch(`/api/knowledge/node/${nodeId}`);
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
          <option value="concept">Concepts</option>
        </select>

        <div className="text-xs text-muted-foreground">
          {nodes.length} nodes / {edges.length} edges
        </div>
      </div>

      {/* Graph Area */}
      <div className="flex-1 relative overflow-hidden bg-background">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-muted-foreground text-sm">Loading knowledge graph...</div>
          </div>
        ) : nodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="text-muted-foreground/50">
              <circle cx="12" cy="12" r="3" />
              <circle cx="4" cy="6" r="2" />
              <circle cx="20" cy="6" r="2" />
              <circle cx="4" cy="18" r="2" />
              <circle cx="20" cy="18" r="2" />
              <path d="M6 7l4 4M14 11l4-4M6 17l4-4M14 13l4 4" />
            </svg>
            <p className="text-muted-foreground text-sm">No data yet. Ingest some documents to see the knowledge graph.</p>
          </div>
        ) : (
          <GraphCanvas
            nodes={nodes}
            edges={edges}
            onNodeClick={handleNodeClick}
            selectedNodeId={selectedNode?.id}
            searchHighlight={searchHighlight}
          />
        )}

        {/* Node Detail Panel */}
        <NodeDetailPanel
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
        />

        {/* Legend */}
        <div className="absolute bottom-3 left-3 flex gap-3 bg-background/80 backdrop-blur-sm rounded-md p-2 border border-border text-xs">
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-[#00E5FF]" /> Document
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-[#FF2E63]" /> Entity
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-[#7C3AED]" /> Category
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-[#10B981]" /> Concept
          </div>
        </div>
      </div>
    </div>
  );
}
