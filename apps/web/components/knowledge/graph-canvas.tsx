"use client";

import { useRef, useCallback, useEffect, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { Network, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

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

const BASE_SIZES: Record<string, number> = {
  document: 6,
  entity: 4,
  category: 8,
};

const DEFAULT_COLOR = "#888888";

interface FGNode {
  id: string;
  label: string;
  type: string;
  color: string;
  baseSize: number;
  x?: number;
  y?: number;
  _original: GraphNode;
}

interface FGLink {
  source: string | FGNode;
  target: string | FGNode;
  label: string;
}

export function GraphCanvas({
  nodes,
  edges,
  onNodeClick,
  selectedNodeId,
}: GraphCanvasProps) {
  const { t } = useTranslation();
  const fgRef = useRef<ForceGraphMethods<FGNode, FGLink> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [sizeMultiplier, setSizeMultiplier] = useState(1);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDimensions({ width, height });
        }
      }
    });

    observer.observe(el);
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setDimensions({ width: rect.width, height: rect.height });
    }

    return () => observer.disconnect();
  }, []);

  // Build graph data
  const graphData = useCallback(() => {
    const nodeMap = new Map<string, boolean>();
    const fgNodes: FGNode[] = nodes.map((n) => {
      nodeMap.set(n.id, true);
      return {
        id: n.id,
        label: n.label,
        type: n.type,
        color: NODE_COLORS[n.type] ?? DEFAULT_COLOR,
        baseSize: BASE_SIZES[n.type] ?? 5,
        _original: n,
      };
    });

    const edgeSet = new Set<string>();
    const fgLinks: FGLink[] = [];
    for (const edge of edges) {
      const key = `${edge.source}->${edge.target}`;
      if (
        edgeSet.has(key) ||
        !nodeMap.has(edge.source) ||
        !nodeMap.has(edge.target) ||
        edge.source === edge.target
      )
        continue;
      edgeSet.add(key);
      fgLinks.push({
        source: edge.source,
        target: edge.target,
        label: edge.label ?? edge.type,
      });
    }

    return { nodes: fgNodes, links: fgLinks };
  }, [nodes, edges]);

  // Zoom to fit after initial render
  useEffect(() => {
    const timer = setTimeout(() => {
      fgRef.current?.zoomToFit(400, 60);
    }, 800);
    return () => clearTimeout(timer);
  }, [nodes]);

  const handleZoomIn = () => fgRef.current?.zoom(1.5, 300);
  const handleZoomOut = () => fgRef.current?.zoom(0.67, 300);
  const handleFit = () => fgRef.current?.zoomToFit(400, 60);

  if (nodes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <Network className="size-12 text-muted-foreground/20 mx-auto" />
          <p className="text-muted-foreground text-sm font-medium">
            {t("knowledge.emptyTitle")}
          </p>
          <p className="text-xs text-muted-foreground/50">
            {t("knowledge.emptySubtitle")}
          </p>
        </div>
      </div>
    );
  }

  const data = graphData();

  return (
    <div ref={containerRef} className="flex-1 relative min-h-0 overflow-hidden">
      <ForceGraph2D
        ref={fgRef}
        width={dimensions.width}
        height={dimensions.height}
        graphData={data}
        backgroundColor="transparent"
        nodeLabel=""
        nodeCanvasObjectMode={() => "replace"}
        nodeCanvasObject={(node: FGNode, ctx, globalScale) => {
          const isSelected = node.id === selectedNodeId;
          const size = node.baseSize * sizeMultiplier * (isSelected ? 1.5 : 1);
          const color = isSelected ? "#ffffff" : node.color;
          const x = node.x ?? 0;
          const y = node.y ?? 0;

          // Glow
          ctx.beginPath();
          ctx.arc(x, y, size + 2, 0, 2 * Math.PI);
          ctx.fillStyle = color + "30";
          ctx.fill();

          // Node
          ctx.beginPath();
          ctx.arc(x, y, size, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();

          // Label
          const fontSize = Math.max(3.5, 11 / globalScale);
          ctx.font = `500 ${fontSize}px Inter, system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillStyle = "#ffffffcc";
          const label = node.label.length > 22 ? node.label.slice(0, 20) + "..." : node.label;
          ctx.fillText(label, x, y + size + 3);
        }}
        nodePointerAreaPaint={(node: FGNode, color, ctx) => {
          const size = node.baseSize * sizeMultiplier * 2;
          ctx.beginPath();
          ctx.arc(node.x ?? 0, node.y ?? 0, size, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
        }}
        onNodeClick={(node: FGNode) => {
          onNodeClick?.(node._original);
        }}
        onNodeHover={(node) => {
          const el = containerRef.current;
          if (el) el.style.cursor = node ? "pointer" : "default";
        }}
        linkColor={() => "rgba(255,255,255,0.12)"}
        linkWidth={0.8}
        linkDirectionalParticles={1}
        linkDirectionalParticleWidth={1.5}
        linkDirectionalParticleSpeed={0.004}
        linkDirectionalParticleColor={() => "rgba(255,255,255,0.3)"}
        cooldownTicks={120}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
        enableNodeDrag={true}
      />

      {/* Controls */}
      <div className="absolute top-4 left-4 flex flex-col gap-1.5">
        <button
          onClick={handleZoomIn}
          className="p-1.5 rounded-md bg-background/70 backdrop-blur-sm border border-border/50 hover:bg-muted transition-colors"
          title={t("knowledge.zoomIn")}
        >
          <ZoomIn className="size-3.5 text-muted-foreground" />
        </button>
        <button
          onClick={handleZoomOut}
          className="p-1.5 rounded-md bg-background/70 backdrop-blur-sm border border-border/50 hover:bg-muted transition-colors"
          title={t("knowledge.zoomOut")}
        >
          <ZoomOut className="size-3.5 text-muted-foreground" />
        </button>
        <button
          onClick={handleFit}
          className="p-1.5 rounded-md bg-background/70 backdrop-blur-sm border border-border/50 hover:bg-muted transition-colors"
          title={t("knowledge.fitToScreen")}
        >
          <Maximize2 className="size-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Node size slider */}
      <div className="absolute top-4 right-4 flex items-center gap-2 bg-background/70 backdrop-blur-sm rounded-lg px-3 py-1.5 border border-border/50">
        <span className="text-[10px] text-muted-foreground">{t("knowledge.nodeSize")}</span>
        <input
          type="range"
          min={0.5}
          max={3}
          step={0.1}
          value={sizeMultiplier}
          onChange={(e) => setSizeMultiplier(parseFloat(e.target.value))}
          className="w-20 h-1 accent-primary"
        />
        <span className="text-[10px] text-muted-foreground tabular-nums w-6">{sizeMultiplier.toFixed(1)}x</span>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 flex gap-3 bg-background/70 backdrop-blur-sm rounded-lg px-3 py-2 border border-border/50">
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

      {/* Stats */}
      <div className="absolute bottom-4 right-4 text-[10px] text-muted-foreground/50">
        {t("knowledge.stats")
          .replace("{{nodes}}", String(nodes.length))
          .replace("{{edges}}", String(edges.length))}
      </div>
    </div>
  );
}
