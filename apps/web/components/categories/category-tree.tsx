"use client";

import { useState, useCallback } from "react";

interface CategoryNode {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  path: string;
  description?: string;
  color?: string;
  children: CategoryNode[];
  documentCount: number;
}

interface CategoryTreeProps {
  tree: CategoryNode | null;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onMove?: (id: string, newParentId: string | null) => void;
  onRename?: (id: string, newName: string) => void;
  onDelete?: (id: string) => void;
  onCreate?: (parentId: string | null) => void;
}

function TreeNode({
  node,
  level,
  selectedId,
  onSelect,
  onMove,
  onDelete,
  draggedId,
  onDragStart,
  onDragEnd,
}: {
  node: CategoryNode;
  level: number;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onMove?: (id: string, newParentId: string | null) => void;
  onDelete?: (id: string) => void;
  draggedId: string | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}) {
  const [expanded, setExpanded] = useState(level < 2);
  const [dragOver, setDragOver] = useState(false);
  const isSelected = node.id === selectedId;
  const hasChildren = node.children.length > 0;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (draggedId && draggedId !== node.id) {
      setDragOver(true);
    }
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (draggedId && draggedId !== node.id && onMove) {
      onMove(draggedId, node.id);
    }
  };

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-2 py-1 rounded text-sm cursor-pointer select-none transition-colors
          ${isSelected ? "bg-primary/20 text-primary" : "hover:bg-muted/50"}
          ${dragOver ? "bg-primary/10 ring-1 ring-primary/50" : ""}
        `}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={() => onSelect?.(node.id)}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          onDragStart(node.id);
        }}
        onDragEnd={onDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Expand/collapse toggle */}
        <button
          className={`w-4 h-4 flex items-center justify-center text-muted-foreground ${!hasChildren ? "invisible" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="currentColor"
            className={`transition-transform ${expanded ? "rotate-90" : ""}`}
          >
            <path d="M3 1l4 4-4 4V1z" />
          </svg>
        </button>

        {/* Color dot */}
        {node.color && (
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: node.color }}
          />
        )}

        {/* Name */}
        <span className="truncate flex-1">{node.name}</span>

        {/* Document count */}
        {node.documentCount > 0 && (
          <span className="text-xs text-muted-foreground">{node.documentCount}</span>
        )}

        {/* Delete button */}
        {onDelete && (
          <button
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-0.5"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(node.id);
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              onMove={onMove}
              onDelete={onDelete}
              draggedId={draggedId}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function CategoryTree({
  tree,
  selectedId,
  onSelect,
  onMove,
  onDelete,
  onCreate,
}: CategoryTreeProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const handleDragStart = useCallback((id: string) => setDraggedId(id), []);
  const handleDragEnd = useCallback(() => setDraggedId(null), []);

  // Root drop zone for moving to top level
  const handleRootDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (draggedId && onMove) {
      onMove(draggedId, "");
    }
    setDraggedId(null);
  };

  if (!tree) {
    return (
      <div className="p-4 text-center text-muted-foreground text-sm">
        <p>No categories yet.</p>
        {onCreate && (
          <button
            onClick={() => onCreate(null)}
            className="mt-2 text-primary hover:underline text-sm"
          >
            Create your first category
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className="py-1"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleRootDrop}
    >
      {tree.children.map((child) => (
        <TreeNode
          key={child.id}
          node={child}
          level={0}
          selectedId={selectedId}
          onSelect={onSelect}
          onMove={onMove}
          onDelete={onDelete}
          draggedId={draggedId}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        />
      ))}

      {onCreate && (
        <button
          onClick={() => onCreate(null)}
          className="flex items-center gap-1 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground mt-1"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Category
        </button>
      )}
    </div>
  );
}
