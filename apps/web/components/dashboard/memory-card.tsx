"use client";

import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Heart,
  MoreHorizontal,
  ExternalLink,
  Copy,
  Pencil,
  Trash2,
  Tag,
  Archive,
  FileText,
  FileType,
  Globe,
  AlignLeft,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMemoryStore, type Memory } from "@/store/memory-store";

interface MemoryCardProps {
  memory: Memory;
  variant?: "grid" | "list";
  onSelect?: (memory: Memory) => void;
}

const DocTypeIcon = ({ type }: { type?: "url" | "file" | "text" }) => {
  switch (type) {
    case "file":
      return <FileText className="size-3.5 text-muted-foreground" />;
    case "text":
      return <AlignLeft className="size-3.5 text-muted-foreground" />;
    default:
      return <Globe className="size-3.5 text-muted-foreground" />;
  }
};

export function MemoryCard({
  memory,
  variant = "grid",
  onSelect,
}: MemoryCardProps) {
  const { toggleFavorite, archiveMemory, trashMemory } =
    useMemoryStore();
  const memoryTags = memory.tags;

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(memory.url);
  };

  const handleClick = () => {
    if (onSelect) {
      onSelect(memory);
    } else {
      window.open(memory.url, "_blank");
    }
  };

  if (variant === "list") {
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
            <DocTypeIcon type={memory.docType} />
            <h3 className="font-medium truncate">{memory.title}</h3>
            {memory.readingTimeMinutes && (
              <span className="hidden sm:inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                <Clock className="size-3" />
                {memory.readingTimeMinutes} min
              </span>
            )}
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
                {memoryTags.length > 2 && (
                  <span className="text-[10px] text-muted-foreground">
                    +{memoryTags.length - 2}
                  </span>
                )}
              </div>
            )}
          </div>
          <p className="text-sm text-muted-foreground truncate">
            {memory.url}
          </p>
          {memory.whatItSolves && (
            <p className="text-xs text-muted-foreground/80 truncate mt-0.5">
              {memory.whatItSolves}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => toggleFavorite(memory.id)}
          >
            <Heart
              className={cn(
                "size-4",
                memory.isFavorite && "fill-red-500 text-red-500"
              )}
            />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={handleClick}>
            <ExternalLink className="size-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleCopyUrl}>
                <Copy className="size-4 mr-2" />
                Copy URL
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Pencil className="size-4 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Tag className="size-4 mr-2" />
                Add Tags
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => archiveMemory(memory.id)}>
                <Archive className="size-4 mr-2" />
                Archive
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => trashMemory(memory.id)}
              >
                <Trash2 className="size-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative flex flex-col rounded-xl border bg-card overflow-hidden hover:bg-accent/30 transition-colors">
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1">
        <Button
          variant="secondary"
          size="icon-xs"
          className="bg-background/80 backdrop-blur-sm"
          onClick={() => toggleFavorite(memory.id)}
        >
          <Heart
            className={cn(
              "size-4",
              memory.isFavorite && "fill-red-500 text-red-500"
            )}
          />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              size="icon-xs"
              className="bg-background/80 backdrop-blur-sm"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleCopyUrl}>
              <Copy className="size-4 mr-2" />
              Copy URL
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleClick}>
              <ExternalLink className="size-4 mr-2" />
              Open in new tab
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Pencil className="size-4 mr-2" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Tag className="size-4 mr-2" />
              Add Tags
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => archiveMemory(memory.id)}>
              <Archive className="size-4 mr-2" />
              Archive
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => trashMemory(memory.id)}
            >
              <Trash2 className="size-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <button
        className="w-full text-left cursor-pointer"
        onClick={handleClick}
      >
        <div className="h-32 bg-linear-to-br from-muted/50 to-muted flex items-center justify-center">
          <div className="size-12 rounded-xl bg-background shadow-sm flex items-center justify-center">
            {memory.docType === "file" ? (
              <FileText className="size-8 text-muted-foreground" />
            ) : memory.docType === "text" ? (
              <FileType className="size-8 text-muted-foreground" />
            ) : (
              <Image
                src={memory.favicon}
                alt={memory.title}
                width={32}
                height={32}
                className={cn("size-8", memory.hasDarkIcon && "dark:invert")}
              />
            )}
          </div>
        </div>

        <div className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <DocTypeIcon type={memory.docType} />
              <h3 className="font-medium line-clamp-1">{memory.title}</h3>
            </div>
          </div>
          <p className="text-sm text-muted-foreground line-clamp-2">
            {memory.description}
          </p>
          {(memory.summary || memory.keyPoints?.length) && (
            <div className="border-t pt-2 mt-1 space-y-1.5">
              {memory.summary && (
                <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                  {memory.summary}
                </p>
              )}
              {memory.keyPoints && memory.keyPoints.length > 0 && (
                <ul className="space-y-0.5">
                  {memory.keyPoints.slice(0, 2).map((point, i) => (
                    <li key={i} className="text-[11px] text-muted-foreground flex gap-1.5">
                      <span className="text-primary mt-0.5 shrink-0">•</span>
                      <span className="line-clamp-1">{point}</span>
                    </li>
                  ))}
                </ul>
              )}
              {memory.readingTimeMinutes && (
                <span className="text-[10px] text-muted-foreground/60">
                  {memory.readingTimeMinutes} min read
                </span>
              )}
            </div>
          )}
          {memoryTags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {memoryTags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
              {memoryTags.length > 3 && (
                <span className="text-[10px] text-muted-foreground py-0.5">
                  +{memoryTags.length - 3} more
                </span>
              )}
            </div>
          )}
        </div>
      </button>
    </div>
  );
}
