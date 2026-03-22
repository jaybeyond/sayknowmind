"use client";

import { useBookmarksStore } from "@/store/bookmarks-store";
import { BookmarkCard } from "./bookmark-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Star } from "lucide-react";

export function FavoritesContent() {
  const { getFavoriteBookmarks, viewMode, isLoading } = useBookmarksStore();
  const favoriteBookmarks = getFavoriteBookmarks();

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
            <h2 className="text-lg font-semibold">Favorite Bookmarks</h2>
            <p className="text-sm text-muted-foreground">
              {favoriteBookmarks.length} bookmark
              {favoriteBookmarks.length !== 1 ? "s" : ""} marked as favorite
            </p>
          </div>
        </div>

        {favoriteBookmarks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Star className="size-12 text-muted-foreground/20 mb-4" />
            <h3 className="text-lg font-medium mb-1">No favorites yet</h3>
            <p className="text-sm text-muted-foreground">
              Star a document to add it here
            </p>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {favoriteBookmarks.map((bookmark) => (
              <BookmarkCard key={bookmark.id} bookmark={bookmark} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {favoriteBookmarks.map((bookmark) => (
              <BookmarkCard
                key={bookmark.id}
                bookmark={bookmark}
                variant="list"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
