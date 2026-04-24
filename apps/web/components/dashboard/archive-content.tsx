"use client";

import * as React from "react";
import { useMemoryStore, type Memory } from "@/store/memory-store";
import { MemoryCard } from "./memory-card";
import { MemoryDetailPanel } from "./memory-detail-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Archive } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";

export function ArchiveContent() {
  const { getArchivedMemories, fetchArchivedMemories, isLoading, viewMode } = useMemoryStore();
  const { t } = useTranslation();
  const [selectedMemory, setSelectedMemory] = React.useState<Memory | null>(null);

  React.useEffect(() => {
    fetchArchivedMemories();
  }, [fetchArchivedMemories]);

  const archivedMemories = getArchivedMemories();

  if (isLoading) {
    return (
      <div className="flex-1 w-full overflow-auto">
        <div className="p-4 md:p-6 space-y-6">
          <Skeleton className="h-20 w-full rounded-xl" />
          <div className={cn(
            "grid gap-4",
            viewMode === "grid"
              ? "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
              : "grid-cols-1"
          )}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className={viewMode === "grid" ? "h-48 rounded-lg" : "h-16 rounded-lg"} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 w-full overflow-auto">
        <div className="p-4 md:p-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-lg bg-violet-500/10 text-violet-500 flex items-center justify-center">
              <Archive className="size-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">{t("archive.title")}</h2>
              <p className="text-sm text-muted-foreground">
                {archivedMemories.length !== 1
                  ? t("archive.countMany").replace("{{count}}", String(archivedMemories.length))
                  : t("archive.countOne").replace("{{count}}", String(archivedMemories.length))}
              </p>
            </div>
          </div>

          {archivedMemories.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Archive className="size-12 text-muted-foreground/20 mb-4" />
              <h3 className="text-lg font-medium mb-1">{t("emptyState.archive")}</h3>
              <p className="text-sm text-muted-foreground">
                {t("emptyState.archiveCta")}
              </p>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
              {archivedMemories.map((memory) => (
                <MemoryCard key={memory.id} memory={memory} context="archive" onSelect={setSelectedMemory} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {archivedMemories.map((memory) => (
                <MemoryCard key={memory.id} memory={memory} variant="list" context="archive" onSelect={setSelectedMemory} />
              ))}
            </div>
          )}
        </div>
      </div>
      <MemoryDetailPanel memory={selectedMemory} onClose={() => setSelectedMemory(null)} />
    </>
  );
}
