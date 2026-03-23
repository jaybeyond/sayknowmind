"use client";

import { useState, useEffect, useCallback } from "react";
import { CategoryTree } from "./category-tree";
import { CategoryGraph } from "./category-graph";
import { FileText, ExternalLink, X, FolderOpen } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

interface CategoryData {
  id: string;
  name: string;
  parent_id: string | null;
  depth: number;
  path: string;
  description: string | null;
  color: string | null;
}

export interface CategoryNode {
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

interface CategoryDocument {
  id: string;
  title: string;
  url: string | null;
  source_type: string;
  created_at: string;
}

export function CategoryManager() {
  const { t } = useTranslation();
  const [categories, setCategories] = useState<CategoryData[]>([]);
  const [tree, setTree] = useState<CategoryNode | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string>("");
  const [viewMode, setViewMode] = useState<"tree" | "graph">("tree");
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<CategoryDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);

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

  const findNode = useCallback((node: CategoryNode | null, id: string): CategoryNode | null => {
    if (!node) return null;
    if (node.id === id) return node;
    for (const child of node.children) {
      const found = findNode(child, id);
      if (found) return found;
    }
    return null;
  }, []);

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

  // Fetch documents when a category is selected
  const fetchDocuments = useCallback(async (categoryId: string) => {
    setDocsLoading(true);
    try {
      const res = await fetch(`/api/categories/${categoryId}/documents`);
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.documents ?? []);
      } else {
        setDocuments([]);
      }
    } catch {
      setDocuments([]);
    } finally {
      setDocsLoading(false);
    }
  }, []);

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    const node = findNode(tree, id);
    setSelectedName(node?.name ?? "");
    fetchDocuments(id);
  }, [tree, findNode, fetchDocuments]);

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
        body: JSON.stringify({ parentId: newParentId || null }),
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
        if (selectedId === id) {
          setSelectedId(null);
          setDocuments([]);
        }
        await fetchCategories();
      }
    } catch (err) {
      console.error("Failed to delete category:", err);
    }
  };

  const handleRemoveDocument = async (documentId: string) => {
    if (!selectedId) return;
    try {
      const res = await fetch(`/api/categories/${selectedId}/documents`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId }),
      });
      if (res.ok) {
        setDocuments((prev) => prev.filter((d) => d.id !== documentId));
        await fetchCategories(); // Refresh counts
      }
    } catch (err) {
      console.error("Failed to remove document:", err);
    }
  };

  const handleCreateRequest = (parentId: string | null) => {
    setCreateParentId(parentId);
    setShowCreate(true);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h1 className="font-heading font-semibold text-lg">{t("categories.title")}</h1>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              onClick={() => setViewMode("tree")}
              className={`px-3 py-1 text-xs font-medium transition-colors ${
                viewMode === "tree" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("common.tree")}
            </button>
            <button
              onClick={() => setViewMode("graph")}
              className={`px-3 py-1 text-xs font-medium transition-colors ${
                viewMode === "graph" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("common.graph")}
            </button>
          </div>

          <button
            onClick={() => handleCreateRequest(null)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {t("common.new")}
          </button>
        </div>
      </div>

      {/* Create dialog */}
      {showCreate && (
        <div className="px-4 py-3 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder={t("categories.namePlaceholder")}
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
              {t("common.create")}
            </button>
            <button
              onClick={() => {
                setShowCreate(false);
                setNewName("");
              }}
              className="px-3 py-1.5 text-xs font-medium rounded-md text-muted-foreground hover:text-foreground"
            >
              {t("common.cancel")}
            </button>
          </div>
          {createParentId && (
            <p className="text-xs text-muted-foreground mt-1">
              {t("categories.creatingUnder").replace(
                "{{parent}}",
                categories.find((c) => c.id === createParentId)?.name ?? ""
              )}
            </p>
          )}
        </div>
      )}

      {/* Content: Tree/Graph + Document Panel */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Category tree/graph */}
        <div className={`${selectedId ? "w-1/2 border-r border-border" : "w-full"} overflow-hidden transition-all`}>
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-muted-foreground">{t("categories.loadingCategories")}</p>
            </div>
          ) : viewMode === "tree" ? (
            <div className="h-full overflow-y-auto">
              <CategoryTree
                tree={tree}
                selectedId={selectedId}
                onSelect={handleSelect}
                onMove={handleMove}
                onDelete={handleDelete}
                onCreate={handleCreateRequest}
              />
            </div>
          ) : (
            <CategoryGraph
              tree={tree}
              onNodeClick={handleSelect}
            />
          )}
        </div>

        {/* Right: Document list for selected category */}
        {selectedId && (
          <div className="w-1/2 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/20">
              <div className="flex items-center gap-2 min-w-0">
                <FolderOpen className="size-4 text-primary shrink-0" />
                <span className="text-sm font-medium truncate">{selectedName}</span>
                <span className="text-xs text-muted-foreground">({documents.length})</span>
              </div>
              <button
                onClick={() => {
                  setSelectedId(null);
                  setDocuments([]);
                }}
                className="p-1 rounded hover:bg-muted"
              >
                <X className="size-3.5 text-muted-foreground" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {docsLoading ? (
                <div className="flex items-center justify-center h-32">
                  <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
                </div>
              ) : documents.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-center px-4">
                  <FileText className="size-8 text-muted-foreground/30 mb-2" />
                  <p className="text-sm text-muted-foreground">{t("categories.noDocuments")}</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {documents.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 group"
                    >
                      <FileText className="size-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{doc.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(doc.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                        {doc.url && (
                          <a
                            href={doc.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1 rounded hover:bg-muted"
                            title={t("common.openUrl")}
                          >
                            <ExternalLink className="size-3.5 text-muted-foreground" />
                          </a>
                        )}
                        <button
                          onClick={() => handleRemoveDocument(doc.id)}
                          className="p-1 rounded hover:bg-destructive/10"
                          title={t("categories.removeDocument")}
                        >
                          <X className="size-3.5 text-muted-foreground hover:text-destructive" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
