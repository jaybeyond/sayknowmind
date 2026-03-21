"use client";

import { useState, useEffect, useCallback } from "react";
import { CategoryTree } from "./category-tree";
import { CategoryGraph } from "./category-graph";

interface CategoryData {
  id: string;
  name: string;
  parent_id: string | null;
  depth: number;
  path: string;
  description: string | null;
  color: string | null;
}

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

export function CategoryManager() {
  const [categories, setCategories] = useState<CategoryData[]>([]);
  const [tree, setTree] = useState<CategoryNode | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"tree" | "graph">("tree");
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [createParentId, setCreateParentId] = useState<string | null>(null);

  // API returns { category: {...}, children: [...], documentCount } — flatten to CategoryNode
  const flattenApiTree = (node: any): CategoryNode | null => {
    if (!node?.category) return null;
    return {
      id: node.category.id,
      name: node.category.name,
      parentId: node.category.parentId ?? null,
      depth: node.category.depth,
      path: node.category.path,
      description: node.category.description,
      color: node.category.color,
      children: (node.children ?? []).map(flattenApiTree).filter(Boolean) as CategoryNode[],
      documentCount: node.documentCount ?? 0,
    };
  };

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch("/api/categories");
      if (!res.ok) return;
      const data = await res.json();
      setCategories(data.categories ?? []);
      setTree(data.tree ? flattenApiTree(data.tree) : null);
    } catch (err) {
      console.error("Failed to fetch categories:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          parentId: createParentId || undefined,
        }),
      });
      if (res.ok) {
        setNewName("");
        setShowCreate(false);
        setCreateParentId(null);
        await fetchCategories();
      }
    } catch (err) {
      console.error("Failed to create category:", err);
    }
  };

  const handleMove = async (id: string, newParentId: string | null) => {
    try {
      const res = await fetch(`/api/categories/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: newParentId || undefined }),
      });
      if (res.ok) await fetchCategories();
    } catch (err) {
      console.error("Failed to move category:", err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/categories/${id}`, { method: "DELETE" });
      if (res.ok) {
        if (selectedId === id) setSelectedId(null);
        await fetchCategories();
      }
    } catch (err) {
      console.error("Failed to delete category:", err);
    }
  };

  const handleCreateRequest = (parentId: string | null) => {
    setCreateParentId(parentId);
    setShowCreate(true);
  };

  // Convert flat categories to graph nodes
  const graphNodes = categories.map((c) => ({
    id: c.id,
    name: c.name,
    depth: c.depth,
    parentId: c.parent_id,
    color: c.color ?? undefined,
    documentCount: 0,
  }));

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h1 className="font-heading font-semibold text-lg">Categories</h1>
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              onClick={() => setViewMode("tree")}
              className={`px-3 py-1 text-xs font-medium transition-colors ${
                viewMode === "tree" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Tree
            </button>
            <button
              onClick={() => setViewMode("graph")}
              className={`px-3 py-1 text-xs font-medium transition-colors ${
                viewMode === "graph" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Graph
            </button>
          </div>

          <button
            onClick={() => handleCreateRequest(null)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New
          </button>
        </div>
      </div>

      {/* Create dialog */}
      {showCreate && (
        <div className="px-4 py-3 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Category name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              className="flex-1 px-3 py-1.5 text-sm rounded-md bg-background border border-border focus:outline-none focus:ring-1 focus:ring-primary"
              autoFocus
            />
            <button
              onClick={handleCreate}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Create
            </button>
            <button
              onClick={() => {
                setShowCreate(false);
                setNewName("");
              }}
              className="px-3 py-1.5 text-xs font-medium rounded-md text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
          {createParentId && (
            <p className="text-xs text-muted-foreground mt-1">
              Creating under: {categories.find((c) => c.id === createParentId)?.name}
            </p>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted-foreground">Loading categories...</p>
          </div>
        ) : viewMode === "tree" ? (
          <div className="h-full overflow-y-auto">
            <CategoryTree
              tree={tree}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onMove={handleMove}
              onDelete={handleDelete}
              onCreate={handleCreateRequest}
            />
          </div>
        ) : (
          <CategoryGraph
            nodes={graphNodes}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        )}
      </div>
    </div>
  );
}
