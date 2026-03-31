"use client";

import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { Network, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

/** Detect dark mode from Tailwind's .dark class or system preference */
function useIsDark() {
  const [isDark, setIsDark] = useState(true);
  useEffect(() => {
    const check = () => {
      setIsDark(
        document.documentElement.classList.contains("dark") ||
        (!document.documentElement.classList.contains("light") &&
          window.matchMedia("(prefers-color-scheme: dark)").matches)
      );
    };
    check();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", check);
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => { mq.removeEventListener("change", check); observer.disconnect(); };
  }, []);
  return isDark;
}

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
  onBackgroundClick?: () => void;
  selectedNodeId?: string | null;
  focusNodeId?: string | null;
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
  onBackgroundClick,
  selectedNodeId,
  focusNodeId,
}: GraphCanvasProps) {
  const { t } = useTranslation();
  const isDark = useIsDark();
  const fgRef = useRef<ForceGraphMethods<FGNode, FGLink> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeMapRef = useRef<Map<string, FGNode>>(new Map());
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [sizeMultiplier, setSizeMultiplier] = useState(1);

  // Theme-aware colors
  const labelColor = isDark ? "#ffffffcc" : "#1a1a2ecc";
  const linkColorValue = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.15)";
  const particleColor = isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.25)";

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

  // Build graph data — useMemo keeps stable references so d3-force doesn't restart on re-render
  const data = useMemo(() => {
    const nodeIds = new Set<string>();
    const fgNodeMap = new Map<string, FGNode>();
    const fgNodes: FGNode[] = nodes.map((n) => {
      nodeIds.add(n.id);
      const fgNode: FGNode = {
        id: n.id,
        label: n.label,
        type: n.type,
        color: NODE_COLORS[n.type] ?? DEFAULT_COLOR,
        baseSize: BASE_SIZES[n.type] ?? 5,
        _original: n,
      };
      fgNodeMap.set(n.id, fgNode);
      return fgNode;
    });
    nodeMapRef.current = fgNodeMap;

    const edgeSet = new Set<string>();
    const fgLinks: FGLink[] = [];
    for (const edge of edges) {
      const key = `${edge.source}->${edge.target}`;
      if (
        edgeSet.has(key) ||
        !nodeIds.has(edge.source) ||
        !nodeIds.has(edge.target) ||
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

  // Center on focused node (drill-down from panel)
  useEffect(() => {
    if (!focusNodeId || !fgRef.current) return;
    const fg = fgRef.current;
    const target = nodeMapRef.current.get(focusNodeId);
    if (target && target.x != null && target.y != null) {
      fg.centerAt(target.x, target.y, 600);
      fg.zoom(2.5, 600);
    }
  }, [focusNodeId]);

  const handleZoomIn = () => fgRef.current?.zoom(1.5, 300);
  const handleZoomOut = () => fgRef.current?.zoom(0.67, 300);
  const handleFit = () => fgRef.current?.zoomToFit(400, 60);

  // Manual hit detection — bypasses ForceGraph2D's broken onNodeClick in React 19
  const findNodeAtScreen = useCallback(
    (clientX: number, clientY: number): FGNode | null => {
      const fg = fgRef.current;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!fg || !rect) return null;

      const canvasX = clientX - rect.left;
      const canvasY = clientY - rect.top;

      let closestNode: FGNode | null = null;
      let closestDist = Infinity;

      for (const node of nodeMapRef.current.values()) {
        if (node.x == null || node.y == null) continue;
        const sp = fg.graph2ScreenCoords(node.x, node.y);
        const dx = sp.x - canvasX;
        const dy = sp.y - canvasY;
        const dist = dx * dx + dy * dy;
        if (dist < closestDist) {
          closestDist = dist;
          closestNode = node;
        }
      }

      const HIT_RADIUS = 22; // px — generous for touch/click
      if (closestNode && closestDist < HIT_RADIUS * HIT_RADIUS) {
        return closestNode;
      }
      return null;
    },
    [],
  );

  const handleContainerPointerDown = useCallback((e: React.PointerEvent) => {
    pointerDownRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleContainerClick = useCallback(
    (e: React.MouseEvent) => {
      // Only handle clicks on canvas elements (not UI controls)
      const target = e.target as HTMLElement;
      if (target.tagName !== "CANVAS") return;

      // Distinguish click from drag
      const down = pointerDownRef.current;
      if (down) {
        const dx = e.clientX - down.x;
        const dy = e.clientY - down.y;
        if (dx * dx + dy * dy > 64) return; // >8px movement = drag
      }

      const hit = findNodeAtScreen(e.clientX, e.clientY);
      if (hit) {
        onNodeClick?.(hit._original);
      } else {
        onBackgroundClick?.();
      }
    },
    [findNodeAtScreen, onNodeClick, onBackgroundClick],
  );

  const handleContainerMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName !== "CANVAS") return;
      const hit = findNodeAtScreen(e.clientX, e.clientY);
      const el = containerRef.current;
      if (el) el.style.cursor = hit ? "pointer" : "default";
    },
    [findNodeAtScreen],
  );

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

  return (
    <div
      ref={containerRef}
      className="flex-1 relative min-h-0 overflow-hidden"
      onPointerDown={handleContainerPointerDown}
      onClick={handleContainerClick}
      onMouseMove={handleContainerMouseMove}
    >
      <ForceGraph2D
        ref={fgRef}
        width={dimensions.width}
        height={dimensions.height}
        graphData={data}
        backgroundColor="transparent"
        nodeLabel=""
        nodeCanvasObjectMode={() => "replace"}
        nodeCanvasObject={(node: FGNode, ctx, globalScale) => {
          // Sync live d3-force positions into nodeMapRef for manual hit detection
          nodeMapRef.current.set(node.id, node);
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
          ctx.fillStyle = labelColor;
          const label = node.label.length > 22 ? node.label.slice(0, 20) + "..." : node.label;
          ctx.fillText(label, x, y + size + 3);
        }}
        nodePointerAreaPaint={() => {
          // Intentionally empty — disables ForceGraph2D's default shadow canvas hit detection.
          // Without this, FG2D paints default circles on the shadow canvas and intercepts
          // clicks via its broken onNodeClick (React 19), preventing bubbling to our container handler.
        }}
        linkColor={() => linkColorValue}
        linkWidth={0.8}
        linkDirectionalParticles={1}
        linkDirectionalParticleWidth={1.5}
        linkDirectionalParticleSpeed={0.004}
        linkDirectionalParticleColor={() => particleColor}
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
