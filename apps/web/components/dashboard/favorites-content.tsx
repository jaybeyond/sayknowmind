"use client";

import { useMemoryStore } from "@/store/memory-store";
import { MemoryCard } from "./memory-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Star } from "lucide-react";

export function FavoritesContent() {
  const { getFavoriteMemories, viewMode, isLoading } = useMemoryStore();
  const favoriteMemories = getFavoriteMemories();

  if (isLoading) {
    return (
      <div className="flex-1 w-full overflow-auto">
        <div className="p-4 md:p-6 space-y-6">
          <Skeleton className="h-20 w-full rounded-xl" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-48 rounded-xl" />
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
          <div className="size-10 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center">
            <Star className="size-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Favorite Memories</h2>
            <p className="text-sm text-muted-foreground">
              {favoriteMemories.length} memor
              {favoriteMemories.length !== 1 ? "ies" : "y"} marked as favorite
            </p>
          </div>
        </div>

        {favoriteMemories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Star className="size-12 text-muted-foreground/20 mb-4" />
            <h3 className="text-lg font-medium mb-1">No favorites yet</h3>
            <p className="text-sm text-muted-foreground">
              Star a document to add it here
            </p>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {favoriteMemories.map((memory) => (
              <MemoryCard key={memory.id} memory={memory} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {favoriteMemories.map((memory) => (
              <MemoryCard
                key={memory.id}
                memory={memory}
                variant="list"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
