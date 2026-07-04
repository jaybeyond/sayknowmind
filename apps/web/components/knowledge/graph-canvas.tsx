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
  autoFitToken?: number;
}

const NODE_COLORS: Record<string, string> = {
  document: "#00E5FF",
  entity: "#FF2E63",
  category: "#A855F7",
  tag: "#22C55E",
};

const BASE_SIZES: Record<string, number> = {
  document: 5,
  entity: 3,
  category: 6,
  tag: 4,
};

const DEFAULT_COLOR = "#888888";

// Persisted manual node layout (per browser). Keyed by node id → graph coords.
// Dragging a node saves its spot here so the arrangement survives refreshes.
const POSITIONS_KEY = "knowledge-graph-positions";
type SavedPositions = Record<string, { x: number; y: number }>;

function loadSavedPositions(): SavedPositions {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(POSITIONS_KEY);
    return raw ? (JSON.parse(raw) as SavedPositions) : {};
  } catch {
    return {};
  }
}

function persistSavedPositions(map: SavedPositions) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(POSITIONS_KEY, JSON.stringify(map));
  } catch {
    /* storage full or unavailable — layout just won't persist */
  }
}

interface FGNode {
  id: string;
  label: string;
  type: string;
  color: string;
  baseSize: number;
  x?: number;
  y?: number;
  // d3-force fixed position — set while dragging to pin the node to the cursor,
  // left set after a drag so the manual placement sticks (undefined = free).
  fx?: number;
  fy?: number;
  _original: GraphNode;
}

interface FGLink {
  source: string | FGNode;
  target: string | FGNode;
  label: string;
}

// Largest zoom the AUTO-FIT is allowed to settle at. Manual zoom is unbounded
// (see ForceGraph2D minZoom/maxZoom below) — this only tames zoomToFit, which
// on a sparse graph (few/close nodes) over-zooms and renders giant blobs.
const FIT_MAX_ZOOM = 3.5;

// Node labels are only drawn once the user has zoomed in past this scale. At the
// zoomed-out overview the nodes are packed close together, so constant-screen-size
// labels overlap into an unreadable mess — hiding them keeps the overview clean
// and reveals labels only when you zoom in to inspect. (Tune to taste.)
const LABEL_ZOOM_THRESHOLD = 1.5;

// Hub nodes (tags / categories) are few and structurally meaningful, so their
// labels reveal earlier than the document mass.
const HUB_LABEL_ZOOM_THRESHOLD = 0.8;

// Fit the graph into view. zoomToFit() on a single node has a zero-area bounding
// box, so its computed scale blows up and the lone node fills the whole screen
// as a giant circle — guard that case with a fixed, sane zoom instead.
function fitGraph(
  fg: ForceGraphMethods<FGNode, FGLink> | undefined,
  nodeCount: number,
  ms: number,
  padding: number,
) {
  if (!fg) return;
  if (nodeCount <= 1) {
    fg.centerAt(0, 0, ms);
    fg.zoom(1.2, ms);
    return;
  }
  fg.zoomToFit(ms, padding);
  // Clamp ONLY the auto-fit result, after its animation, so sparse graphs don't
  // blow up. The user can still manually zoom in past this afterwards.
  setTimeout(() => {
    if (fg.zoom() > FIT_MAX_ZOOM) fg.zoom(FIT_MAX_ZOOM, 200);
  }, ms + 60);
}

export function GraphCanvas({
  nodes,
  edges,
  onNodeClick,
  onBackgroundClick,
  selectedNodeId,
  focusNodeId,
  autoFitToken = 0,
}: GraphCanvasProps) {
  const { t } = useTranslation();
  const isDark = useIsDark();
  const fgRef = useRef<ForceGraphMethods<FGNode, FGLink> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeMapRef = useRef<Map<string, FGNode>>(new Map());
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  // Node currently being dragged (manual drag — see pointer handlers below).
  // prevFx/prevFy remember the pin state before grabbing so a pure click restores it.
  const dragNodeRef = useRef<{ node: FGNode; moved: boolean; prevFx?: number; prevFy?: number } | null>(null);
  // Persisted manual layout, lazily loaded once on the client. Kept in state
  // (not a ref) so useMemo can seed node coords during render without tripping
  // the React 19 react-hooks/refs rule; drag handlers update via setState.
  const [savedPositions, setSavedPositions] = useState<SavedPositions>(() => loadSavedPositions());
  // Mirror of savedPositions for writes from stable callbacks (which close over
  // stale state), so drag-end can persist without reading a stale closure or
  // running a side effect inside the state updater.
  const savedPositionsRef = useRef<SavedPositions>(savedPositions);
  const [draggingNode, setDraggingNode] = useState(false);
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

  // Re-fit graph when dimensions change
  useEffect(() => {
    if (fgRef.current && dimensions.width > 0 && dimensions.height > 0) {
      setTimeout(() => fitGraph(fgRef.current, nodes.length, 300, 40), 100);
    }
  }, [dimensions.width, dimensions.height, nodes.length]);

  // Build graph data — useMemo keeps a stable reference so d3-force only
  // re-lays-out when nodes/edges actually change (the parent dedupes no-op
  // refreshes, so this rarely recomputes).
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
      // Restore a previously-dragged position: seed coords and pin it there so
      // the saved layout is honoured (unsaved nodes stay free for auto-layout).
      const saved = savedPositions[n.id];
      if (saved) {
        fgNode.x = saved.x;
        fgNode.y = saved.y;
        fgNode.fx = saved.x;
        fgNode.fy = saved.y;
      }
      fgNodeMap.set(n.id, fgNode);
      return fgNode;
    });

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

    return { nodes: fgNodes, links: fgLinks, nodeMap: fgNodeMap };
    // savedPositions is intentionally NOT a dependency: it changes on every
    // drag-end, and rebuilding here would hand force-graph a fresh node array,
    // discarding the live simulation coords of unpinned nodes and re-heating the
    // whole layout on every drag (CODE-REVIEW C16). The dragged node's position
    // is already applied to its live object; this memo re-seeds saved positions
    // only when nodes/edges actually change (reading the latest map then).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  // Above this node count the graph is dense enough that per-frame extras (link
  // particles) hurt more than they help; used to keep a full library smooth.
  const isLargeGraph = data.nodes.length > 300;

  // Sync nodeMapRef outside of render to satisfy React 19 rules-of-hooks
  useEffect(() => {
    nodeMapRef.current = data.nodeMap;
  }, [data.nodeMap]);

  // Zoom to fit only on explicit non-silent refreshes (initial load, search, filter).
  // Silent SSE refreshes preserve the user's current viewport.
  useEffect(() => {
    const timer = setTimeout(() => {
      fitGraph(fgRef.current, nodes.length, 400, 60);
    }, 800);
    return () => clearTimeout(timer);
  }, [autoFitToken, nodes.length]);

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

  const handleContainerPointerDown = useCallback(
    (e: React.PointerEvent) => {
      pointerDownRef.current = { x: e.clientX, y: e.clientY };
      const target = e.target as HTMLElement;
      if (target.tagName !== "CANVAS") return;
      const hit = findNodeAtScreen(e.clientX, e.clientY);
      if (!hit) return; // background → let ForceGraph pan/zoom as usual
      // Grab the node: pin it to its current spot and reheat the layout so
      // neighbours react. Pan is disabled (enablePanInteraction) while dragging.
      dragNodeRef.current = { node: hit, moved: false, prevFx: hit.fx, prevFy: hit.fy };
      hit.fx = hit.x;
      hit.fy = hit.y;
      setDraggingNode(true);
      fgRef.current?.d3ReheatSimulation();
    },
    [findNodeAtScreen],
  );

  const handleContainerPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragNodeRef.current;
      const fg = fgRef.current;
      const rect = containerRef.current?.getBoundingClientRect();
      if (drag && fg && rect) {
        const gc = fg.screen2GraphCoords(e.clientX - rect.left, e.clientY - rect.top);
        drag.node.fx = gc.x;
        drag.node.fy = gc.y;
        drag.node.x = gc.x;
        drag.node.y = gc.y;
        drag.moved = true;
        fg.d3ReheatSimulation();
        if (containerRef.current) containerRef.current.style.cursor = "grabbing";
        return;
      }
      // Hover affordance
      const target = e.target as HTMLElement;
      if (target.tagName !== "CANVAS") return;
      const hit = findNodeAtScreen(e.clientX, e.clientY);
      if (containerRef.current) containerRef.current.style.cursor = hit ? "grab" : "default";
    },
    [findNodeAtScreen],
  );

  const handleContainerPointerUp = useCallback(() => {
    const drag = dragNodeRef.current;
    if (!drag) return;
    if (drag.moved) {
      // Real drag → keep the node pinned where dropped and persist the spot.
      const { node } = drag;
      if (node.fx != null && node.fy != null) {
        const pos = { x: node.fx, y: node.fy };
        const next = { ...savedPositionsRef.current, [node.id]: pos };
        savedPositionsRef.current = next;
        persistSavedPositions(next);
        setSavedPositions(next);
      }
    } else {
      // Pure click → restore the pin state it had before grabbing (so clicking
      // a saved/pinned node doesn't unpin it).
      drag.node.fx = drag.prevFx;
      drag.node.fy = drag.prevFy;
    }
    dragNodeRef.current = null;
    setDraggingNode(false);
    fgRef.current?.d3ReheatSimulation();
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
      onPointerMove={handleContainerPointerMove}
      onPointerUp={handleContainerPointerUp}
      onPointerCancel={handleContainerPointerUp}
      onClick={handleContainerClick}
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
          // Sync live d3-force positions into nodeMapRef for manual hit detection.
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

          // Label — only past a zoom threshold, so a zoomed-out overview shows
          // clean nodes instead of a pile of overlapping text. Hub nodes (tags,
          // categories — a few hundred at most) reveal earlier than the doc mass
          // so the structure reads first. The selected node always keeps its label.
          const labelThreshold =
            node.type === "tag" || node.type === "category"
              ? HUB_LABEL_ZOOM_THRESHOLD
              : LABEL_ZOOM_THRESHOLD;
          if (globalScale >= labelThreshold || isSelected) {
            // Constant ON-SCREEN size: 11px regardless of zoom (no lower floor —
            // the old Math.max(3.5, ...) floor made labels GROW past ~3x zoom).
            const fontSize = 11 / globalScale;
            ctx.font = `500 ${fontSize}px Inter, system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillStyle = labelColor;
            const label = node.label.length > 22 ? node.label.slice(0, 20) + "..." : node.label;
            ctx.fillText(label, x, y + size + 3);
          }
        }}
        nodePointerAreaPaint={() => {
          // Intentionally empty — disables ForceGraph2D's default shadow canvas hit detection.
          // Without this, FG2D paints default circles on the shadow canvas and intercepts
          // clicks via its broken onNodeClick (React 19), preventing bubbling to our container handler.
        }}
        linkColor={() => linkColorValue}
        linkWidth={0.8}
        // Animated link particles are the main per-frame cost. On a large graph
        // (e.g. a full 1700-memory library) they tank the frame rate — turn them off.
        linkDirectionalParticles={isLargeGraph ? 0 : 1}
        linkDirectionalParticleWidth={1.5}
        linkDirectionalParticleSpeed={0.004}
        linkDirectionalParticleColor={() => particleColor}
        // A big graph needs MORE settling ticks, not fewer: at alphaDecay 0.02 the
        // sim needs ~230 ticks to converge, and freezing it early leaves the layout
        // stuck mid-explosion (stringy/bizarre instead of the organic cloud).
        cooldownTicks={isLargeGraph ? 300 : 120}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
        enableNodeDrag={false}
        enablePanInteraction={!draggingNode}
        minZoom={0.02}
        maxZoom={1e5}
      />

      {/* Controls — bottom-left, inside the chart (legend swapped to top-left) */}
      <div className="absolute bottom-4 left-4 flex flex-col gap-1.5">
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

      {/* Legend — moved to top-left so it doesn't overlap the controls */}
      <div className="absolute top-4 left-4 flex gap-3 bg-background/70 backdrop-blur-sm rounded-lg px-3 py-2 border border-border/50">
        {Object.entries(NODE_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5">
            <div
              className="size-2.5 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="text-[11px] text-muted-foreground capitalize">
              {t(`knowledge.nodeType.${type}`)}
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
