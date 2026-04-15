"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useMemoryStore, type Memory } from "@/store/memory-store";
import { useCategoriesStore } from "@/store/categories-store";
import { MemoryCard } from "./memory-card";
import { MemoryDetailPanel } from "./memory-detail-panel";
import { AddMemoryDialog } from "./add-memory-dialog";
import { StatsCards } from "./stats-cards";
import { GalleryCard, type GalleryItem } from "@/components/gallery/gallery-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { X, FileUp, BookOpen, Plus, RefreshCw, Globe } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTranslation } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Gallery View (shared public content, inline in content area)
// ---------------------------------------------------------------------------

function GalleryView() {
  const { t } = useTranslation();
  const { selectedTags, toggleTag, viewMode } = useMemoryStore();
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch("/api/share/gallery?limit=24&offset=0")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setItems(data.items);
          setTotal(data.total);
          setHasMore(data.hasMore);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/share/gallery?limit=24&offset=${items.length}`);
      if (res.ok) {
        const data = await res.json();
        setItems((prev) => [...prev, ...data.items]);
        setHasMore(data.hasMore);
      }
    } finally {
      setLoadingMore(false);
    }
  }, [items.length, hasMore, loadingMore]);

  const sentinelRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      const observer = new IntersectionObserver(
        (entries) => { if (entries[0].isIntersecting) loadMore(); },
        { rootMargin: "200px" },
      );
      observer.observe(node);
      return () => observer.disconnect();
    },
    [loadMore],
  );

  // Derive tags from gallery items for filtering
  const allTags = items.flatMap((i) => i.tags);
  const tagCounts = new Map<string, number>();
  for (const tag of allTags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  const derivedTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ id: name, name, count }));

  // Filter by selected tags
  const filtered =
    selectedTags.length === 0
      ? items
      : items.filter((item) => selectedTags.some((t) => item.tags.includes(t)));

  const activeTagsData = derivedTags.filter((tg) => selectedTags.includes(tg.id));

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">{t("gallery.hero")}</h2>
            <p className="text-sm text-muted-foreground">
              {total > 0
                ? t("gallery.sharedCount").replace("{{count}}", String(total))
                : t("gallery.noShares")}
            </p>
          </div>
          {activeTagsData.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {activeTagsData.map((tag) => (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-primary text-primary-foreground"
                >
                  {tag.name}
                  <button onClick={() => toggleTag(tag.id)} className="hover:bg-primary-foreground/20 rounded-full p-0.5">
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Tag pills for filtering */}
        {derivedTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {derivedTags.slice(0, 20).map((tag) => (
              <button
                key={tag.id}
                onClick={() => toggleTag(tag.id)}
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors",
                  selectedTags.includes(tag.id)
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {tag.name}
                <span className="opacity-60">{tag.count}</span>
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className={cn(
            "grid gap-4",
            viewMode === "grid"
              ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
              : "grid-cols-1"
          )}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl border bg-card overflow-hidden animate-pulse">
                <div className="h-32 bg-muted" />
                <div className="p-4 space-y-2">
                  <div className="h-4 w-3/4 rounded bg-muted" />
                  <div className="h-3 w-full rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Globe className="size-16 text-muted-foreground/20 mb-4" />
            <h3 className="text-lg font-semibold mb-2">{t("gallery.noShares")}</h3>
          </div>
        ) : (
          <>
            <div className={cn(
              "grid gap-4",
              viewMode === "grid"
                ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                : "grid-cols-1"
            )}>
              {filtered.map((item) => (
                <GalleryCard key={item.shareToken} item={item} />
              ))}
            </div>
            {loadingMore && (
              <div className="flex justify-center py-6">
                <RefreshCw className="size-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {hasMore && <div ref={sentinelRef} className="h-1" />}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Memory Content
// ---------------------------------------------------------------------------

export function MemoryContent() {
  const { t } = useTranslation();
  const {
    selectedCollection,
    selectedTab,
    setSelectedTab,
    getFilteredMemories,
    viewMode,
    selectedTags,
    toggleTag,
    filterType,
    setFilterType,
    sortBy,
    getDerivedTags,
    isLoading,
    isLoadingMore,
    hasMore,
    totalCount,
    searchQuery,
    fetchMemories,
    loadMoreMemories,
  } = useMemoryStore();
  const { categories, getChildren, hasChildren, addCategory, deleteCategory } = useCategoriesStore();
  const [globalDragOver, setGlobalDragOver] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null);
  const [reprocessing, setReprocessing] = useState(false);
  const [addingTab, setAddingTab] = useState(false);
  const [newTabName, setNewTabName] = useState("");

  // Infinite scroll: trigger loadMore when sentinel enters viewport
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
            loadMoreMemories();
          }
        },
        { rootMargin: "200px" },
      );
      observer.observe(node);
      return () => observer.disconnect();
    },
    [hasMore, isLoadingMore, loadMoreMemories],
  );

  const filteredMemories = getFilteredMemories();
  const derivedTags = getDerivedTags();
  const memoriesWithoutSummary = getFilteredMemories().filter(
    (m) => !m.summary && m.jobStatus !== "processing" && m.jobStatus !== "pending"
  );

  const handleReprocess = async () => {
    setReprocessing(true);
    try {
      const res = await fetch("/api/documents/reprocess", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        toast.success(t("content.reprocessQueued").replace("{{count}}", String(data.reprocessed)));
        setTimeout(() => fetchMemories(), 2000);
      } else {
        toast.error(t("content.reprocessFailed"));
      }
    } catch {
      toast.error(t("content.networkError"));
    } finally {
      setReprocessing(false);
    }
  };

  const currentCollection =
    selectedCollection === "all"
      ? { name: t("sidebar.allMemories") }
      : categories.find((c) => c.id === selectedCollection);

  const activeTagsData = derivedTags.filter((tg) => selectedTags.includes(tg.id));
  const hasActiveFilters =
    selectedTags.length > 0 || filterType !== "all" || sortBy !== "date-newest";

  const displayCount = totalCount > filteredMemories.length ? totalCount : filteredMemories.length;
  const memoryCountLabel =
    displayCount === 1
      ? t("content.memoryCountOne").replace("{{count}}", String(displayCount))
      : t("content.memoryCountMany").replace("{{count}}", String(displayCount));

  // Show gallery view when "gallery" collection is selected
  if (selectedCollection === "gallery") {
    return (
      <div className="flex-1 w-full overflow-auto">
        <GalleryView />
      </div>
    );
  }

  return (
    <>
      <AddMemoryDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <div
        className="flex-1 w-full overflow-auto relative"
        onDragOver={(e) => { e.preventDefault(); setGlobalDragOver(true); }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node)) {
            setGlobalDragOver(false);
          }
        }}
        onDrop={async (e) => {
          e.preventDefault();
          setGlobalDragOver(false);
          const file = e.dataTransfer.files[0];
          if (!file) return;

          const ext = file.name.split(".").pop()?.toLowerCase();
          if (!ext || !["pdf", "docx", "txt", "md", "html"].includes(ext)) {
            toast.error(t("content.unsupportedType"));
            return;
          }
          if (file.size > 10 * 1024 * 1024) {
            toast.error(t("content.fileTooLarge"));
            return;
          }

          const formData = new FormData();
          formData.append("file", file);
          toast.loading(t("content.savingFile"), { id: "file-drop" });
          try {
            const res = await fetch("/api/ingest/file", { method: "POST", body: formData });
            if (res.ok) {
              toast.success(t("content.fileSaved"), { id: "file-drop" });
              fetchMemories();
            } else {
              toast.error(t("content.saveFailed"), { id: "file-drop" });
            }
          } catch {
            toast.error(t("content.networkError"), { id: "file-drop" });
          }
        }}
      >
        {globalDragOver && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm border-2 border-dashed border-primary rounded-lg">
            <div className="text-center space-y-2">
              <FileUp className="size-12 text-primary mx-auto" />
              <p className="text-lg font-semibold text-primary">{t("content.dropToSave")}</p>
              <p className="text-sm text-muted-foreground">{t("content.dropFormats")}</p>
            </div>
          </div>
        )}

        <div className="p-4 md:p-6 space-y-6">
          <StatsCards />

          {memoriesWithoutSummary.length > 0 && (
            <div className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
              <p className="text-sm text-amber-700 dark:text-amber-400">
                {t("content.needsProcessing").replace("{{count}}", String(memoriesWithoutSummary.length))}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={handleReprocess}
                disabled={reprocessing}
                className="shrink-0"
              >
                <RefreshCw className={cn("size-3.5 mr-1.5", reprocessing && "animate-spin")} />
                {reprocessing ? t("content.reprocessing") : t("content.reprocess")}
              </Button>
            </div>
          )}

          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-6 min-w-0">
                <div className="shrink-0">
                  <h2 className="text-lg font-semibold">
                    {currentCollection?.name || t("sidebar.allMemories")}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {memoryCountLabel}
                    {hasActiveFilters && ` ${t("content.filtered")}`}
                  </p>
                </div>
                {selectedCollection !== "all" && (
                  <div className="flex items-center gap-1.5 overflow-x-auto">
                    <button
                      onClick={() => setSelectedTab(null)}
                      className={cn(
                        "shrink-0 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                        !selectedTab
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {t("tabs.all")}
                    </button>
                    {getChildren(selectedCollection).map((child) => (
                      <span
                        key={child.id}
                        className={cn(
                          "group/tab shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer",
                          selectedTab === child.id
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:text-foreground"
                        )}
                        onClick={() => setSelectedTab(child.id)}
                      >
                        {child.name}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toast(`"${child.name}" ${t("tabs.deleteConfirm")}`, {
                              action: {
                                label: t("common.delete"),
                                onClick: async () => {
                                  const ok = await deleteCategory(child.id);
                                  if (ok && selectedTab === child.id) setSelectedTab(null);
                                },
                              },
                              cancel: {
                                label: t("common.cancel"),
                                onClick: () => {},
                              },
                              actionButtonStyle: {
                                backgroundColor: "hsl(var(--destructive))",
                                color: "hsl(var(--destructive-foreground))",
                                marginLeft: "4px",
                              },
                              cancelButtonStyle: {
                                marginLeft: "auto",
                              },
                              duration: 8000,
                            });
                          }}
                          className={cn(
                            "opacity-0 group-hover/tab:opacity-100 rounded-full p-0.5 transition-opacity",
                            selectedTab === child.id
                              ? "hover:bg-primary-foreground/20"
                              : "hover:bg-foreground/10"
                          )}
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                    {addingTab ? (
                      <form
                        className="shrink-0"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const trimmed = newTabName.trim();
                          if (trimmed) {
                            const newId = await addCategory(trimmed, selectedCollection);
                            if (newId) setSelectedTab(newId);
                            else toast.error(t("sidebar.createFailed"));
                          }
                          setNewTabName("");
                          setAddingTab(false);
                        }}
                      >
                        <Input
                          value={newTabName}
                          onChange={(e) => setNewTabName(e.target.value)}
                          placeholder={t("tabs.addTab")}
                          className="h-6 w-24 text-xs"
                          autoFocus
                          onBlur={() => { setAddingTab(false); setNewTabName(""); }}
                          onKeyDown={(e) => { if (e.key === "Escape") { setAddingTab(false); setNewTabName(""); } }}
                        />
                      </form>
                    ) : (
                      <button
                        onClick={() => setAddingTab(true)}
                        className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        title={t("tabs.addTab")}
                      >
                        <Plus className="size-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {(activeTagsData.length > 0 || filterType !== "all") && (
                <div className="flex flex-wrap items-center gap-2">
                  {filterType !== "all" && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-primary/10 text-primary">
                      {filterType === "favorites" && t("content.favoritesOnly")}
                      {filterType === "with-tags" && t("content.withTags")}
                      {filterType === "without-tags" && t("content.withoutTags")}
                      <button
                        onClick={() => setFilterType("all")}
                        className="hover:bg-primary/20 rounded-full p-0.5"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  )}
                  {activeTagsData.map((tag) => (
                    <span
                      key={tag.id}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-primary text-primary-foreground"
                    >
                      {tag.name}
                      <button
                        onClick={() => toggleTag(tag.id)}
                        className="hover:bg-primary-foreground/20 rounded-full p-0.5"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {isLoading ? (
              <div className={cn(
                "grid gap-4",
                viewMode === "grid"
                  ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                  : "grid-cols-1"
              )}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="rounded-lg border bg-card p-4 space-y-3">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                    <div className="flex gap-2 pt-2">
                      <Skeleton className="h-5 w-16 rounded-full" />
                      <Skeleton className="h-5 w-12 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : viewMode === "grid" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredMemories.map((memory) => (
                  <MemoryCard key={memory.id} memory={memory} onSelect={setSelectedMemory} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {filteredMemories.map((memory) => (
                  <MemoryCard
                    key={memory.id}
                    memory={memory}
                    variant="list"
                    onSelect={setSelectedMemory}
                  />
                ))}
              </div>
            )}

            {/* Infinite scroll sentinel + load more indicator */}
            {!isLoading && hasMore && filteredMemories.length > 0 && (
              <div ref={loadMoreRef} className="flex justify-center py-6">
                {isLoadingMore ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <RefreshCw className="size-4 animate-spin" />
                    {t("content.loadingMore") ?? "Loading more..."}
                  </div>
                ) : (
                  <Button variant="outline" size="sm" onClick={loadMoreMemories}>
                    {t("content.loadMore") ?? "Load more"}
                  </Button>
                )}
              </div>
            )}

            {!isLoading && !hasMore && filteredMemories.length > 0 && totalCount > 20 && (
              <p className="text-center text-xs text-muted-foreground py-4">
                {t("content.allLoaded")?.replace("{{count}}", String(totalCount)) ?? `All ${totalCount} memories loaded`}
              </p>
            )}

            {!isLoading && filteredMemories.length === 0 && (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="size-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                  <BookOpen className="size-8 text-muted-foreground/50" />
                </div>
                <h3 className="text-lg font-semibold mb-2">
                  {searchQuery ? t("emptyState.search") : t("emptyState.allDocuments")}
                </h3>
                <p className="text-sm text-muted-foreground mb-6 max-w-sm">
                  {searchQuery ? t("emptyState.searchCta") : t("emptyState.allDocumentsCta")}
                </p>
                {hasActiveFilters && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setFilterType("all")}
                    className="mb-3"
                  >
                    {t("content.clearFilters")}
                  </Button>
                )}
                {!searchQuery && (
                  <Button onClick={() => setDialogOpen(true)} size="sm">
                    <Plus className="size-4 mr-2" />
                    {t("content.addFirst")}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <MemoryDetailPanel memory={selectedMemory} onClose={() => setSelectedMemory(null)} />
    </>
  );
}
