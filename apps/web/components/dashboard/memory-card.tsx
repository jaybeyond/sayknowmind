"use client";

import * as React from "react";
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
  RotateCcw,
  XCircle,
  FileText,
  FileType,
  Globe,
  AlignLeft,
  Clock,
  Loader2,
  Download,
  ImageIcon,
  Video,
  File,
  Share2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMemoryStore, type Memory } from "@/store/memory-store";
import { useTranslation } from "@/lib/i18n";
import { getVideoEmbedUrl } from "@/lib/video-embed";
import { ShareDialog } from "./share-dialog";
import { MemoryEditModal } from "./memory-edit-modal";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";

interface MemoryCardProps {
  memory: Memory;
  variant?: "grid" | "list";
  context?: "default" | "archive" | "trash";
  onSelect?: (memory: Memory) => void;
}

const ProcessingBadge = ({ status }: { status?: Memory["jobStatus"] }) => {
  const { t } = useTranslation();
  if (!status || status === "completed") return null;
  if (status === "failed") {
    return (
      <span className="absolute top-3 left-3 z-10 inline-flex items-center gap-1 rounded-full bg-destructive/90 px-2 py-0.5 text-[10px] font-medium text-destructive-foreground backdrop-blur-sm">
        {t("status.failed")}
      </span>
    );
  }
  return (
    <span className="absolute top-3 left-3 z-10 inline-flex items-center gap-1 rounded-full bg-primary/90 px-2 py-0.5 text-[10px] font-medium text-primary-foreground backdrop-blur-sm">
      <Loader2 className="size-3 animate-spin" />
      {status === "processing" ? t("status.summarizing") : t("status.queued")}
    </span>
  );
};

const DocTypeIcon = ({ type, fileType }: { type?: "url" | "file" | "text"; fileType?: string }) => {
  if (type === "file") {
    switch (fileType) {
      case "image": return <ImageIcon className="size-3.5 text-muted-foreground" />;
      case "video": return <Video className="size-3.5 text-muted-foreground" />;
      default: return <FileText className="size-3.5 text-muted-foreground" />;
    }
  }
  if (type === "text") return <AlignLeft className="size-3.5 text-muted-foreground" />;
  return <Globe className="size-3.5 text-muted-foreground" />;
};

export function MemoryCard({
  memory,
  variant = "grid",
  context = "default",
  onSelect,
}: MemoryCardProps) {
  const { toggleFavorite, archiveMemory, trashMemory, restoreFromArchive, restoreFromTrash, permanentlyDelete, addUserTag, fetchMemories } =
    useMemoryStore();
  const { t } = useTranslation();
  const [shareOpen, setShareOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [tagInputOpen, setTagInputOpen] = React.useState(false);
  const [tagValue, setTagValue] = React.useState("");
  const memoryTags = [...new Set(memory.tags)];
  const aiTagSet = new Set(memory.aiTags);

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(memory.url);
    toast.success(t("memory.urlCopied") ?? "URL copied");
  };

  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = tagValue.trim();
    if (trimmed) {
      addUserTag(memory.id, trimmed);
      toast.success(t("memory.tagAdded") ?? "Tag added");
    }
    setTagValue("");
    setTagInputOpen(false);
  };

  const [playing, setPlaying] = React.useState(false);

  const isFile = memory.docType === "file";
  const isImage = isFile && memory.fileType === "image";
  const isVideo = isFile && memory.fileType === "video";
  const fileUrl = isFile ? `/api/files/${memory.id}` : null;
  const downloadUrl = fileUrl ? `${fileUrl}?download=1` : null;
  const embedUrl = memory.url ? getVideoEmbedUrl(memory.url) : null;

  const handleClick = () => {
    if (onSelect) {
      onSelect(memory);
    } else if (fileUrl && (isImage || isVideo)) {
      window.open(fileUrl, "_blank");
    } else if (memory.url) {
      window.open(memory.url, "_blank");
    }
  };

  if (variant === "list") {
    return (
      <div className="group flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
        <button
          className="flex items-center gap-4 flex-1 min-w-0 text-left cursor-pointer"
          onClick={handleClick}
        >
        <div className="size-10 rounded-lg bg-muted flex items-center justify-center overflow-hidden shrink-0">
          {isImage && fileUrl ? (
            <Image src={fileUrl} alt={memory.title} width={40} height={40} className="size-10 object-cover" unoptimized />
          ) : memory.favicon ? (
            <Image src={memory.favicon} alt={memory.title} width={24} height={24} className={cn("size-6", memory.hasDarkIcon && "dark:invert")} />
          ) : (
            <File className="size-5 text-muted-foreground" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <DocTypeIcon type={memory.docType} fileType={memory.fileType} />
            <h3 className="font-medium truncate">{memory.title}</h3>
            {memory.jobStatus && memory.jobStatus !== "completed" && (
              <span className={cn(
                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium shrink-0",
                memory.jobStatus === "failed"
                  ? "bg-destructive/10 text-destructive"
                  : "bg-primary/10 text-primary"
              )}>
                {memory.jobStatus === "failed" ? t("status.failed") : (
                  <><Loader2 className="size-3 animate-spin" />{memory.jobStatus === "processing" ? t("status.summarizing") : t("status.queued")}</>
                )}
              </span>
            )}
            {memory.readingTimeMinutes && (
              <span className="hidden sm:inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                <Clock className="size-3" />
                {memory.readingTimeMinutes} {t("document.minRead")}
              </span>
            )}
            {memoryTags.length > 0 && (
              <div className="hidden sm:flex items-center gap-1">
                {memoryTags.slice(0, 2).map((tag) => (
                  <span
                    key={tag}
                    className={cn(
                      "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium",
                      aiTagSet.has(tag) && !memory.userTags.includes(tag)
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {tag}
                  </span>
                ))}
                {memoryTags.length > 2 && (
                  <span className="text-[10px] text-muted-foreground">
                    {t("memory.moreTags").replace("{{count}}", String(memoryTags.length - 2))}
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
        </button>

        <div className="flex items-center gap-1 shrink-0">
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
          {downloadUrl && (
            <Button variant="ghost" size="icon-xs" asChild>
              <a href={downloadUrl}><Download className="size-4" /></a>
            </Button>
          )}
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
                {t("memory.copyUrl")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setEditOpen(true)}>
                <Pencil className="size-4 mr-2" />
                {t("common.edit")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTagInputOpen(true)}>
                <Tag className="size-4 mr-2" />
                {t("memory.addTags")}
              </DropdownMenuItem>
              {context === "default" && (
                <DropdownMenuItem onClick={() => setShareOpen(true)}>
                  <Share2 className="size-4 mr-2" />
                  {t("memory.share")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {context === "trash" ? (
                <>
                  <DropdownMenuItem onClick={() => restoreFromTrash(memory.id)}>
                    <RotateCcw className="size-4 mr-2" />
                    {t("common.restore")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => {
                      toast(t("trash.confirmDelete"), {
                        action: { label: t("common.delete"), onClick: () => permanentlyDelete(memory.id) },
                        cancel: { label: t("common.cancel"), onClick: () => {} },
                        actionButtonStyle: { backgroundColor: "hsl(var(--destructive))", color: "hsl(var(--destructive-foreground))", marginLeft: "4px" },
                        duration: 8000,
                      });
                    }}
                  >
                    <XCircle className="size-4 mr-2" />
                    {t("trash.deleteForever")}
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  {context === "archive" ? (
                    <DropdownMenuItem onClick={() => restoreFromArchive(memory.id)}>
                      <RotateCcw className="size-4 mr-2" />
                      {t("common.restore")}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={() => archiveMemory(memory.id)}>
                      <Archive className="size-4 mr-2" />
                      {t("sidebar.archive")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => trashMemory(memory.id)}
                  >
                    <Trash2 className="size-4 mr-2" />
                    {t("common.delete")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {tagInputOpen && (
          <form onSubmit={handleAddTag} className="absolute top-1 right-14 z-20 flex items-center gap-1 bg-popover border rounded-lg p-1.5 shadow-lg">
            <Input
              value={tagValue}
              onChange={(e) => setTagValue(e.target.value)}
              placeholder={t("memory.tagPlaceholder") ?? "Tag name"}
              className="h-7 w-32 text-xs"
              autoFocus
              onBlur={() => { setTagInputOpen(false); setTagValue(""); }}
              onKeyDown={(e) => { if (e.key === "Escape") { setTagInputOpen(false); setTagValue(""); } }}
            />
          </form>
        )}
        <ShareDialog open={shareOpen} onOpenChange={setShareOpen} memory={memory} />
        <MemoryEditModal open={editOpen} onOpenChange={setEditOpen} memory={memory} onSaved={() => fetchMemories()} />
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
            {memory.url && (
              <DropdownMenuItem onClick={handleCopyUrl}>
                <Copy className="size-4 mr-2" />
                {t("memory.copyUrl")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={handleClick}>
              <ExternalLink className="size-4 mr-2" />
              {t("memory.openInNewTab")}
            </DropdownMenuItem>
            {downloadUrl && (
              <DropdownMenuItem asChild>
                <a href={downloadUrl}>
                  <Download className="size-4 mr-2" />
                  {t("common.download")}
                </a>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              <Pencil className="size-4 mr-2" />
              {t("common.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTagInputOpen(true)}>
              <Tag className="size-4 mr-2" />
              {t("memory.addTags")}
            </DropdownMenuItem>
            {context === "default" && (
              <DropdownMenuItem onClick={() => setShareOpen(true)}>
                <Share2 className="size-4 mr-2" />
                {t("memory.share")}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {context === "trash" ? (
              <>
                <DropdownMenuItem onClick={() => restoreFromTrash(memory.id)}>
                  <RotateCcw className="size-4 mr-2" />
                  {t("common.restore")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => {
                    toast(t("trash.confirmDelete"), {
                      action: { label: t("common.delete"), onClick: () => permanentlyDelete(memory.id) },
                      cancel: { label: t("common.cancel"), onClick: () => {} },
                      actionButtonStyle: { backgroundColor: "hsl(var(--destructive))", color: "hsl(var(--destructive-foreground))", marginLeft: "4px" },
                      duration: 8000,
                    });
                  }}
                >
                  <XCircle className="size-4 mr-2" />
                  {t("trash.deleteForever")}
                </DropdownMenuItem>
              </>
            ) : (
              <>
                {context === "archive" ? (
                  <DropdownMenuItem onClick={() => restoreFromArchive(memory.id)}>
                    <RotateCcw className="size-4 mr-2" />
                    {t("common.restore")}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => archiveMemory(memory.id)}>
                    <Archive className="size-4 mr-2" />
                    {t("sidebar.archive")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => trashMemory(memory.id)}
                >
                  <Trash2 className="size-4 mr-2" />
                  {t("common.delete")}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {tagInputOpen && (
        <form onSubmit={handleAddTag} className="absolute top-14 right-3 z-20 flex items-center gap-1 bg-popover border rounded-lg p-1.5 shadow-lg">
          <Input
            value={tagValue}
            onChange={(e) => setTagValue(e.target.value)}
            placeholder={t("memory.tagPlaceholder") ?? "Tag name"}
            className="h-7 w-32 text-xs"
            autoFocus
            onBlur={() => { setTagInputOpen(false); setTagValue(""); }}
            onKeyDown={(e) => { if (e.key === "Escape") { setTagInputOpen(false); setTagValue(""); } }}
          />
        </form>
      )}

      <ProcessingBadge status={memory.jobStatus} />

      <button
        className="w-full text-left cursor-pointer"
        onClick={handleClick}
      >
        {memory.ogImage ? (
          <div className="h-36 relative overflow-hidden bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={memory.ogImage}
              alt={memory.title}
              className="absolute inset-0 w-full h-full object-cover"
              loading="lazy"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            {embedUrl && (
              <button
                className="absolute inset-0 z-[1] cursor-pointer"
                onClick={(e) => { e.stopPropagation(); setPlaying(true); }}
              />
            )}
          </div>
        ) : isVideo && fileUrl ? (
          <div className="h-36 relative overflow-hidden bg-black flex items-center justify-center">
            <video src={fileUrl} className="h-full w-full object-cover" muted preload="metadata" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="size-10 rounded-full bg-black/60 flex items-center justify-center">
                <Video className="size-5 text-white" />
              </div>
            </div>
          </div>
        ) : (
          <div className="h-32 bg-linear-to-br from-muted/50 to-muted flex items-center justify-center">
            <div className="size-12 rounded-xl bg-background shadow-sm flex items-center justify-center">
              {isImage ? (
                <ImageIcon className="size-8 text-muted-foreground" />
              ) : isVideo ? (
                <Video className="size-8 text-muted-foreground" />
              ) : memory.docType === "file" ? (
                <FileText className="size-8 text-muted-foreground" />
              ) : memory.docType === "text" ? (
                <FileType className="size-8 text-muted-foreground" />
              ) : memory.favicon ? (
                <Image
                  src={memory.favicon}
                  alt={memory.title}
                  width={32}
                  height={32}
                  className={cn("size-8", memory.hasDarkIcon && "dark:invert")}
                />
              ) : (
                <Globe className="size-8 text-muted-foreground" />
              )}
            </div>
          </div>
        )}

        <div className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <DocTypeIcon type={memory.docType} fileType={memory.fileType} />
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
                  {memory.readingTimeMinutes} {t("document.minRead")}
                </span>
              )}
            </div>
          )}
          {memoryTags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {memoryTags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className={cn(
                    "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium",
                    aiTagSet.has(tag) && !memory.userTags.includes(tag)
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {tag}
                </span>
              ))}
              {memoryTags.length > 3 && (
                <span className="text-[10px] text-muted-foreground py-0.5">
                  {t("memory.moreTags").replace("{{count}}", String(memoryTags.length - 3))}
                </span>
              )}
            </div>
          )}
        </div>
      </button>
      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} memory={memory} />
      <MemoryEditModal open={editOpen} onOpenChange={setEditOpen} memory={memory} onSaved={() => fetchMemories()} />

      {/* Video embed modal */}
      {playing && embedUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setPlaying(false)}
        >
          <div
            className="relative w-full max-w-2xl mx-4 aspect-video rounded-xl overflow-hidden bg-black shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <iframe
              src={embedUrl}
              className="absolute inset-0 w-full h-full"
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
            />
            <button
              className="absolute -top-10 right-0 size-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/40 transition-colors"
              onClick={() => setPlaying(false)}
            >
              <XCircle className="size-5 text-white" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
