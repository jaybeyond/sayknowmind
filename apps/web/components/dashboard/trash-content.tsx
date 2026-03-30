"use client";

import * as React from "react";
import { useMemoryStore, type Memory } from "@/store/memory-store";
import { MemoryCard } from "./memory-card";
import { MemoryDetailPanel } from "./memory-detail-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";

export function TrashContent() {
  const { getTrashedMemories, fetchTrashedMemories, trashedMemories, isLoading, viewMode } =
    useMemoryStore();
  const { t } = useTranslation();
  const [selectedMemory, setSelectedMemory] = React.useState<Memory | null>(null);

  React.useEffect(() => {
    fetchTrashedMemories();
  }, [fetchTrashedMemories]);

  const filteredTrash = getTrashedMemories();

  if (isLoading) {
    return (
      <div className="flex-1 w-full overflow-auto">
        <div className="p-4 md:p-6 space-y-6">
          <Skeleton className="h-20 w-full rounded-xl" />
          <div className={cn(
            "grid gap-4",
            viewMode === "grid"
              ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
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
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-lg bg-destructive/10 text-destructive flex items-center justify-center">
                <Trash2 className="size-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">{t("trash.title")}</h2>
                <p className="text-sm text-muted-foreground">
                  {trashedMemories.length !== 1
                    ? t("trash.countMany").replace("{{count}}", String(trashedMemories.length))
                    : t("trash.countOne").replace("{{count}}", String(trashedMemories.length))}
                </p>
              </div>
            </div>
            {trashedMemories.length > 0 && (
              <p className="text-xs text-muted-foreground hidden sm:block">
                {t("trash.retention")}
              </p>
            )}
          </div>

          {trashedMemories.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Trash2 className="size-12 text-muted-foreground/20 mb-4" />
              <h3 className="text-lg font-medium mb-1">{t("emptyState.trash")}</h3>
              <p className="text-sm text-muted-foreground">
                {t("emptyState.trashCta")}
              </p>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredTrash.map((memory) => (
                <MemoryCard key={memory.id} memory={memory} context="trash" onSelect={setSelectedMemory} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {filteredTrash.map((memory) => (
                <MemoryCard key={memory.id} memory={memory} variant="list" context="trash" onSelect={setSelectedMemory} />
              ))}
            </div>
          )}
        </div>
      </div>
      <MemoryDetailPanel memory={selectedMemory} onClose={() => setSelectedMemory(null)} />
    </>
  );
}
