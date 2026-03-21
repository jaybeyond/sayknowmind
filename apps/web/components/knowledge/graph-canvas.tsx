"use client";

import { useEffect, useRef, useState, useCallback } from "react";

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

interface GraphCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onNodeClick?: (nodeId: string) => void;
  selectedNodeId?: string | null;
  searchHighlight?: string[];
}

const TYPE_COLORS: Record<string, string> = {
  document: "#00E5FF",
  entity: "#FF2E63",
  category: "#7C3AED",
  concept: "#10B981",
};

function forceSimulation(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
): GraphNode[] {
  const positioned = nodes.map((n, i) => ({
    ...n,
    x: n.x || width / 2 + Math.cos((i / nodes.length) * Math.PI * 2) * Math.min(width, height) * 0.35,
    y: n.y || height / 2 + Math.sin((i / nodes.length) * Math.PI * 2) * Math.min(width, height) * 0.35,
  }));

  // Simple force layout: repulsion between nodes + attraction along edges
  const nodeMap = new Map(positioned.map((n) => [n.id, n]));

  for (let iter = 0; iter < 50; iter++) {
    // Repulsion
    for (let i = 0; i < positioned.length; i++) {
      for (let j = i + 1; j < positioned.length; j++) {
        const a = positioned[i];
        const b = positioned[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = 800 / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.x -= fx;
        a.y -= fy;
        b.x += fx;
        b.y += fy;
      }
    }

    // Attraction along edges
    for (const edge of edges) {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const force = (dist - 100) * 0.01;
      const fx = (dx / Math.max(dist, 1)) * force;
      const fy = (dy / Math.max(dist, 1)) * force;
      source.x += fx;
      source.y += fy;
      target.x -= fx;
      target.y -= fy;
    }

    // Center gravity
    for (const node of positioned) {
      node.x += (width / 2 - node.x) * 0.01;
      node.y += (height / 2 - node.y) * 0.01;
      // Boundary clamping
      node.x = Math.max(30, Math.min(width - 30, node.x));
      node.y = Math.max(30, Math.min(height - 30, node.y));
    }
  }

  return positioned;
}

export function GraphCanvas({
  nodes,
  edges,
  onNodeClick,
  selectedNodeId,
  searchHighlight,
}: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [positioned, setPositioned] = useState<GraphNode[]>([]);
  const dragRef = useRef<{ dragging: boolean; lastX: number; lastY: number }>({
    dragging: false,
    lastX: 0,
    lastY: 0,
  });

  // Position nodes on mount or data change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    setPositioned(forceSimulation(nodes, edges, rect.width, rect.height));
  }, [nodes, edges]);

  // Render
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * devicePixelRatio;
    canvas.height = rect.height * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);

    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.scale, transform.scale);

    const nodeMap = new Map(positioned.map((n) => [n.id, n]));
    const highlightSet = new Set(searchHighlight ?? []);

    // Draw edges
    for (const edge of edges) {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) continue;

      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Draw nodes
    for (const node of positioned) {
      const isSelected = node.id === selectedNodeId;
      const isHovered = node.id === hoveredNode;
      const isHighlighted = highlightSet.has(node.id);
      const baseSize = node.size || 6;
      const size = isSelected ? baseSize * 1.5 : isHovered ? baseSize * 1.3 : baseSize;

      ctx.beginPath();
      ctx.arc(node.x, node.y, size, 0, Math.PI * 2);

      if (isHighlighted) {
        ctx.fillStyle = "#FFD700";
      } else {
        ctx.fillStyle = node.color || TYPE_COLORS[node.type] || "#888";
      }

      if (isSelected || isHovered) {
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 12;
      }
      ctx.fill();
      ctx.shadowBlur = 0;

      if (isSelected || isHovered) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Label
      if (isSelected || isHovered || size > 8) {
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.font = `${Math.max(10, size)}px Inter, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(node.label, node.x, node.y + size + 14);
      }
    }

    ctx.restore();
  }, [positioned, edges, transform, selectedNodeId, hoveredNode, searchHighlight]);

  useEffect(() => {
    render();
  }, [render]);

  // Mouse handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { dragging: true, lastX: e.clientX, lastY: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (dragRef.current.dragging) {
      const dx = e.clientX - dragRef.current.lastX;
      const dy = e.clientY - dragRef.current.lastY;
      setTransform((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
      return;
    }

    // Hit test for hover
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left - transform.x) / transform.scale;
    const my = (e.clientY - rect.top - transform.y) / transform.scale;

    let found: string | null = null;
    for (const node of positioned) {
      const dx = mx - node.x;
      const dy = my - node.y;
      if (dx * dx + dy * dy < (node.size + 4) * (node.size + 4)) {
        found = node.id;
        break;
      }
    }
    setHoveredNode(found);
    canvas.style.cursor = found ? "pointer" : "grab";
  };

  const handleMouseUp = () => {
    dragRef.current.dragging = false;
  };

  const handleClick = (e: React.MouseEvent) => {
    if (!onNodeClick) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left - transform.x) / transform.scale;
    const my = (e.clientY - rect.top - transform.y) / transform.scale;

    for (const node of positioned) {
      const dx = mx - node.x;
      const dy = my - node.y;
      if (dx * dx + dy * dy < (node.size + 4) * (node.size + 4)) {
        onNodeClick(node.id);
        return;
      }
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform((t) => ({
      ...t,
      scale: Math.max(0.1, Math.min(5, t.scale * delta)),
    }));
  };

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={handleClick}
      onWheel={handleWheel}
    />
  );
}
