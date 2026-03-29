"use client";

import * as React from "react";
import { useMemoryStore } from "@/store/memory-store";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Trash2,
  MoreHorizontal,
  RotateCcw,
  XCircle,
  ExternalLink,
} from "lucide-react";
import Image from "next/image";
import { type Memory } from "@/store/memory-store";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";

function TrashedMemoryCard({ memory }: { memory: Memory }) {
  const { restoreFromTrash, permanentlyDelete } = useMemoryStore();
  const { t } = useTranslation();

  const handlePermanentDelete = () => {
    if (!confirm(t("trash.confirmDelete"))) return;
    permanentlyDelete(memory.id);
  };

  return (
    <div className="group flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors opacity-75 hover:opacity-100">
      <div className="size-10 rounded-lg bg-muted flex items-center justify-center overflow-hidden shrink-0">
        <Image
          src={memory.favicon}
          alt={memory.title}
          width={24}
          height={24}
          className={cn(
            "size-6 grayscale",
            memory.hasDarkIcon && "dark:invert",
          )}
        />
      </div>

      <div className="flex-1 min-w-0">
        <h3 className="font-medium truncate">{memory.title}</h3>
        <p className="text-sm text-muted-foreground truncate">{memory.url}</p>
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => restoreFromTrash(memory.id)}
        >
          <RotateCcw className="size-4 mr-1" />
          {t("common.restore")}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => window.open(memory.url, "_blank")}
            >
              <ExternalLink className="size-4 mr-2" />
              {t("common.openUrl")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={handlePermanentDelete}
            >
              <XCircle className="size-4 mr-2" />
              {t("trash.deleteForever")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function TrashContent() {
  const { getTrashedMemories, fetchTrashedMemories, trashedMemories, isLoading } =
    useMemoryStore();
  const { t } = useTranslation();

  React.useEffect(() => {
    fetchTrashedMemories();
  }, [fetchTrashedMemories]);

  const filteredTrash = getTrashedMemories();

  if (isLoading) {
    return (
      <div className="flex-1 w-full overflow-auto">
        <div className="p-4 md:p-6 space-y-6">
          <Skeleton className="h-20 w-full rounded-xl" />
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full overflow-auto">
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between gap-4 p-4 rounded-xl border bg-card">
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
        ) : (
          <div className="flex flex-col gap-2">
            {filteredTrash.map((memory) => (
              <TrashedMemoryCard key={memory.id} memory={memory} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
