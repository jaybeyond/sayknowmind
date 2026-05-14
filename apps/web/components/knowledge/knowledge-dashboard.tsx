"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
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

const graphEvents = new Set([
  "document:created",
  "document:updated",
  "document:deleted",
  "ingest:completed",
]);

function getSseEventName(block: string): string | null {
  const eventLine = block
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("event:"));
  return eventLine ? eventLine.slice("event:".length).trim() : null;
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
  const [liveStatus, setLiveStatus] = useState<"connecting" | "connected" | "offline">("connecting");
  const [autoFitToken, setAutoFitToken] = useState(0);

  const fetchGraph = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setLoading(true);
    try {
      const params = new URLSearchParams();
      const trimmedSearch = search.trim();
      if (trimmedSearch) params.set("search", trimmedSearch);
      if (filter !== "all") params.set("type", filter);

      const query = params.toString();
      const res = await fetch(`/api/knowledge/graph${query ? `?${query}` : ""}`);
      if (!res.ok) throw new Error("Failed to fetch graph");

      const data = await res.json();
      setNodes(data.nodes ?? []);
      setEdges(data.edges ?? []);
      if (!options.silent) {
        setAutoFitToken((value) => value + 1);
      }
    } catch (err) {
      console.error("Failed to load graph:", err);
      if (!options.silent) {
        setNodes([]);
        setEdges([]);
      }
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, [search, filter]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  useEffect(() => {
    let stopped = false;
    let retryCount = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const scheduleRefresh = () => {
      setLiveStatus("connected");
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        void fetchGraph({ silent: true });
      }, 200);
    };

    const connect = async () => {
      if (stopped) return;
      controller = new AbortController();
      setLiveStatus((current) => current === "connected" ? current : "connecting");

      try {
        const res = await fetch("/api/events/stream", {
          signal: controller.signal,
          headers: { Accept: "text/event-stream" },
        });
        if (!res.ok || !res.body) throw new Error("SSE connect failed");

        setLiveStatus("connected");
        retryCount = 0;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!stopped) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";

          for (const block of blocks) {
            const eventName = getSseEventName(block);
            if (eventName && graphEvents.has(eventName)) scheduleRefresh();
          }
        }
      } catch {
        if (!stopped) setLiveStatus("offline");
      }

      if (!stopped) {
        const delay = Math.min(2000 * Math.pow(2, retryCount), 30_000);
        retryCount++;
        reconnectTimer = setTimeout(connect, delay);
      }
    };

    void connect();

    return () => {
      stopped = true;
      controller?.abort();
      if (refreshTimer) clearTimeout(refreshTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
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
    void fetchNodeDetail(nodeId);
  };

  const liveLabel = liveStatus === "connected"
    ? t("knowledge.liveConnected")
    : liveStatus === "connecting"
      ? t("knowledge.liveConnecting")
      : t("knowledge.liveDisconnected");

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
            type="search"
            placeholder={t("knowledge.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
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
          <option value="tag">{t("knowledge.filterTags")}</option>
        </select>

        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            className={`size-2 rounded-full ${liveStatus === "connected" ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground/40"}`}
          />
          <span>{liveLabel}</span>
        </div>

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
            autoFitToken={autoFitToken}
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
