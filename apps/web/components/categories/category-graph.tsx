"use client";

import { useEffect, useRef, useState } from "react";

interface CategoryGraphNode {
  id: string;
  name: string;
  depth: number;
  parentId: string | null;
  color?: string;
  documentCount: number;
}

interface CategoryGraphProps {
  nodes: CategoryGraphNode[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}

export function CategoryGraph({ nodes, selectedId, onSelect }: CategoryGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const dragRef = useRef({ dragging: false, lastX: 0, lastY: 0 });

  // Position nodes in a radial layout
  const positioned = (() => {
    if (nodes.length === 0) return [];

    const roots = nodes.filter((n) => !n.parentId);
    const childMap = new Map<string | null, CategoryGraphNode[]>();
    for (const node of nodes) {
      const key = node.parentId;
      if (!childMap.has(key)) childMap.set(key, []);
      childMap.get(key)!.push(node);
    }

    const result: Array<CategoryGraphNode & { x: number; y: number; radius: number }> = [];

    function layout(
      parent: CategoryGraphNode | null,
      cx: number,
      cy: number,
      angleStart: number,
      angleEnd: number,
      radiusStep: number,
    ) {
      const children = childMap.get(parent?.id ?? null) ?? [];
      if (children.length === 0) return;

      const angleStep = (angleEnd - angleStart) / children.length;
      children.forEach((child, i) => {
        const angle = angleStart + angleStep * (i + 0.5);
        const r = radiusStep * (child.depth + 1);
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        result.push({ ...child, x, y, radius: 20 + child.documentCount * 3 });
        layout(child, cx, cy, angleStart + angleStep * i, angleStart + angleStep * (i + 1), radiusStep);
      });
    }

    // Place roots, then layout children
    if (roots.length === 1) {
      const root = roots[0];
      result.push({ ...root, x: 0, y: 0, radius: 30 });
      layout(root, 0, 0, 0, Math.PI * 2, 120);
    } else {
      roots.forEach((root, i) => {
        const angle = (i / roots.length) * Math.PI * 2;
        const x = Math.cos(angle) * 100;
        const y = Math.sin(angle) * 100;
        result.push({ ...root, x, y, radius: 25 });
        const aStart = angle - Math.PI / roots.length;
        const aEnd = angle + Math.PI / roots.length;
        layout(root, 0, 0, aStart, aEnd, 120);
      });
    }

    return result;
  })();

  // Build edges
  const edges = nodes
    .filter((n) => n.parentId)
    .map((n) => ({ source: n.parentId!, target: n.id }));

  useEffect(() => {
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
    ctx.translate(rect.width / 2 + transform.x, rect.height / 2 + transform.y);
    ctx.scale(transform.scale, transform.scale);

    const nodeMap = new Map(positioned.map((n) => [n.id, n]));

    // Draw edges
    for (const edge of edges) {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) continue;

      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Draw nodes
    for (const node of positioned) {
      const isSelected = node.id === selectedId;
      const isHovered = node.id === hoveredNode;
      const r = isSelected ? node.radius * 1.2 : isHovered ? node.radius * 1.1 : node.radius;

      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = node.color || "#7C3AED";
      ctx.globalAlpha = isSelected ? 0.9 : 0.6;
      ctx.fill();
      ctx.globalAlpha = 1;

      if (isSelected) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Label
      ctx.fillStyle = "#fff";
      ctx.font = `${Math.max(11, r * 0.5)}px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(node.name, node.x, node.y);
    }

    ctx.restore();
  }, [positioned, edges, transform, selectedId, hoveredNode]);

  const handleMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { dragging: true, lastX: e.clientX, lastY: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (dragRef.current.dragging) {
      setTransform((t) => ({
        ...t,
        x: t.x + e.clientX - dragRef.current.lastX,
        y: t.y + e.clientY - dragRef.current.lastY,
      }));
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left - rect.width / 2 - transform.x) / transform.scale;
    const my = (e.clientY - rect.top - rect.height / 2 - transform.y) / transform.scale;

    let found: string | null = null;
    for (const node of positioned) {
      const dx = mx - node.x;
      const dy = my - node.y;
      if (dx * dx + dy * dy < node.radius * node.radius) {
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
    if (!onSelect) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left - rect.width / 2 - transform.x) / transform.scale;
    const my = (e.clientY - rect.top - rect.height / 2 - transform.y) / transform.scale;

    for (const node of positioned) {
      const dx = mx - node.x;
      const dy = my - node.y;
      if (dx * dx + dy * dy < node.radius * node.radius) {
        onSelect(node.id);
        return;
      }
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform((t) => ({ ...t, scale: Math.max(0.2, Math.min(4, t.scale * delta)) }));
  };

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No categories to display
      </div>
    );
  }

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
