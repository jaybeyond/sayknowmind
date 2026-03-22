"use client";

import { useBookmarksStore } from "@/store/bookmarks-store";
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
import { type Bookmark } from "@/store/bookmarks-store";
import { cn } from "@/lib/utils";

function TrashedBookmarkCard({ bookmark }: { bookmark: Bookmark }) {
  const { restoreFromTrash, permanentlyDelete } = useBookmarksStore();

  const handlePermanentDelete = () => {
    if (!confirm("Permanently delete this?")) return;
    permanentlyDelete(bookmark.id);
  };

  return (
    <div className="group flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors opacity-75 hover:opacity-100">
      <div className="size-10 rounded-lg bg-muted flex items-center justify-center overflow-hidden shrink-0">
        <Image
          src={bookmark.favicon}
          alt={bookmark.title}
          width={24}
          height={24}
          className={cn(
            "size-6 grayscale",
            bookmark.hasDarkIcon && "dark:invert",
          )}
        />
      </div>

      <div className="flex-1 min-w-0">
        <h3 className="font-medium truncate">{bookmark.title}</h3>
        <p className="text-sm text-muted-foreground truncate">{bookmark.url}</p>
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => restoreFromTrash(bookmark.id)}
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
              onClick={() => window.open(bookmark.url, "_blank")}
            >
              <ExternalLink className="size-4 mr-2" />
              Open URL
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={handlePermanentDelete}
            >
              <XCircle className="size-4 mr-2" />
              Delete Forever
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function TrashContent() {
  const { getTrashedBookmarks, trashedBookmarks, isLoading } =
    useBookmarksStore();
  const filteredTrash = getTrashedBookmarks();

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
              <h2 className="text-lg font-semibold">Trash</h2>
              <p className="text-sm text-muted-foreground">
                {trashedBookmarks.length} bookmark
                {trashedBookmarks.length !== 1 ? "s" : ""} in trash
              </p>
            </div>
          </div>
          {trashedBookmarks.length > 0 && (
            <p className="text-xs text-muted-foreground hidden sm:block">
              Items in trash will be permanently deleted after 30 days
            </p>
          )}
        </div>

        {trashedBookmarks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Trash2 className="size-12 text-muted-foreground/20 mb-4" />
            <h3 className="text-lg font-medium mb-1">Trash is empty</h3>
            <p className="text-sm text-muted-foreground">
              Deleted documents will appear here
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredTrash.map((bookmark) => (
              <TrashedBookmarkCard key={bookmark.id} bookmark={bookmark} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
