"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useMemoryStore, type Memory } from "@/store/memory-store";
import { useCategoriesStore } from "@/store/categories-store";
import { MemoryCard } from "./memory-card";
import { MemoryDetailPanel } from "./memory-detail-panel";
import { AddMemoryDialog } from "./add-memory-dialog";
import { StatsCards } from "./stats-cards";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { X, FileUp, BookOpen, Plus, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTranslation } from "@/lib/i18n";

export function MemoryContent() {
  const { t } = useTranslation();
  const {
    selectedCollection,
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
  const { categories } = useCategoriesStore();
  const [globalDragOver, setGlobalDragOver] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null);
  const [reprocessing, setReprocessing] = useState(false);

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
              <div>
                <h2 className="text-lg font-semibold">
                  {currentCollection?.name || t("sidebar.allMemories")}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {memoryCountLabel}
                  {hasActiveFilters && ` ${t("content.filtered")}`}
                </p>
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
