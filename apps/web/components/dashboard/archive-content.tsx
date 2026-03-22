"use client";

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
  Archive,
  MoreHorizontal,
  RotateCcw,
  Trash2,
  ExternalLink,
} from "lucide-react";
import Image from "next/image";
import { type Memory } from "@/store/memory-store";
import { cn } from "@/lib/utils";

function ArchivedMemoryCard({ memory }: { memory: Memory }) {
  const { restoreFromArchive, trashMemory } = useMemoryStore();
  const memoryTags = memory.tags;

  return (
    <div className="group flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
      <div className="size-10 rounded-lg bg-muted flex items-center justify-center overflow-hidden shrink-0">
        <Image
          src={memory.favicon}
          alt={memory.title}
          width={24}
          height={24}
          className={cn("size-6", memory.hasDarkIcon && "dark:invert")}
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-medium truncate">{memory.title}</h3>
          {memoryTags.length > 0 && (
            <div className="hidden sm:flex items-center gap-1">
              {memoryTags.slice(0, 2).map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground truncate">{memory.url}</p>
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => restoreFromArchive(memory.id)}
        >
          <RotateCcw className="size-4 mr-1" />
          Restore
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
              Open URL
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => {
                restoreFromArchive(memory.id);
                setTimeout(() => trashMemory(memory.id), 0);
              }}
            >
              <Trash2 className="size-4 mr-2" />
              Move to Trash
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function ArchiveContent() {
  const { getArchivedMemories, isLoading } = useMemoryStore();
  const archivedMemories = getArchivedMemories();

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
        <div className="flex items-center gap-3 p-4 rounded-xl border bg-card">
          <div className="size-10 rounded-lg bg-violet-500/10 text-violet-500 flex items-center justify-center">
            <Archive className="size-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Archived Memories</h2>
            <p className="text-sm text-muted-foreground">
              {archivedMemories.length} memor
              {archivedMemories.length !== 1 ? "ies" : "y"} in archive
            </p>
          </div>
        </div>

        {archivedMemories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Archive className="size-12 text-muted-foreground/20 mb-4" />
            <h3 className="text-lg font-medium mb-1">Archive is empty</h3>
            <p className="text-sm text-muted-foreground">
              Archived documents will appear here
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {archivedMemories.map((memory) => (
              <ArchivedMemoryCard key={memory.id} memory={memory} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
