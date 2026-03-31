"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { NodeDetailPanel } from "./node-detail-panel";
import { useTranslation } from "@/lib/i18n";

function GraphCanvasLoading() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
      {t("knowledge.loadingGraph")}
    </div>
  );
}

const GraphCanvas = dynamic(() => import("./graph-canvas").then((m) => m.GraphCanvas), {
  ssr: false,
  loading: () => <GraphCanvasLoading />,
});
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
  connectedEntities?: Array<{ id: string; name: string; type: string; confidence?: number }>;
}

export function KnowledgeDashboard() {
  const { t } = useTranslation();
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<NodeDetail | null>(null);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
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

  const fetchNodeDetail = async (nodeId: string) => {
    try {
      const res = await fetch(`/api/knowledge/node/${nodeId}`);
      if (res.ok) {
        const detail = await res.json();
        setSelectedNode(detail);
      }
    } catch {
      // ignore
    }
  };

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

  const handleDrillDown = (nodeId: string) => {
    setFocusNodeId(nodeId);
    fetchNodeDetail(nodeId);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full overflow-hidden">
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
            placeholder={t("knowledge.searchPlaceholder")}
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
          <option value="all">{t("knowledge.filterAll")}</option>
          <option value="document">{t("knowledge.filterDocuments")}</option>
          <option value="entity">{t("knowledge.filterEntities")}</option>
          <option value="category">{t("knowledge.filterCategories")}</option>
        </select>

        <div className="text-xs text-muted-foreground">
          {t("knowledge.statsSlash")
            .replace("{{nodes}}", String(nodes.length))
            .replace("{{edges}}", String(edges.length))}
        </div>
      </div>

      {/* Graph Area */}
      <div className="flex-1 relative overflow-hidden bg-background min-h-0 flex flex-col">
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
            onBackgroundClick={() => setSelectedNode(null)}
            selectedNodeId={selectedNode?.id}
            focusNodeId={focusNodeId}
          />
        )}

        {/* Node Detail Panel */}
        <NodeDetailPanel
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
          onDrillDown={handleDrillDown}
        />
      </div>
    </div>
  );
}
