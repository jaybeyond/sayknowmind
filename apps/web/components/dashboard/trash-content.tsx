"use client";

import * as React from "react";
import { useMemoryStore, type Memory } from "@/store/memory-store";
import { MemoryCard } from "./memory-card";
import { MemoryDetailPanel } from "./memory-detail-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";

export function TrashContent() {
  const { getTrashedMemories, fetchTrashedMemories, emptyTrash, trashedMemories, isLoading, viewMode } =
    useMemoryStore();
  const { t } = useTranslation();
  const [selectedMemory, setSelectedMemory] = React.useState<Memory | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [emptying, setEmptying] = React.useState(false);

  async function handleEmptyTrash() {
    setEmptying(true);
    await emptyTrash();
    setEmptying(false);
    setConfirmOpen(false);
  }

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
              <div className="flex items-center gap-3">
                <p className="text-xs text-muted-foreground hidden md:block">
                  {t("trash.retention")}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmOpen(true)}
                  className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                  {t("trash.empty")}
                </Button>
              </div>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
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

      <Dialog open={confirmOpen} onOpenChange={(o) => !emptying && setConfirmOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="size-5" />
              {t("trash.emptyConfirmTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("trash.emptyConfirmDesc").replace("{{count}}", String(trashedMemories.length))}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={emptying}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleEmptyTrash} disabled={emptying}>
              {emptying ? t("common.loading") : t("trash.emptyConfirmAction")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
