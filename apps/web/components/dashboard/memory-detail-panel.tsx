"use client";

import { useState, useEffect } from "react";
import { type Memory } from "@/store/memory-store";
import {
  X,
  ExternalLink,
  Clock,
  Tag,
  Folder,
  Lightbulb,
  ListChecks,
  FileText,
  Download,
  ImageIcon,
  Video,
  Link2,
  Share2,
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import { ShareDialog } from "./share-dialog";
import { MemoryEditModal } from "./memory-edit-modal";

interface MemoryDetailPanelProps {
  memory: Memory | null;
  onClose: () => void;
}

interface RelatedDoc {
  id: string;
  title: string;
  score: number;
}

export function MemoryDetailPanel({ memory, onClose }: MemoryDetailPanelProps) {
  const { t } = useTranslation();
  const [relatedDocs, setRelatedDocs] = useState<RelatedDoc[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [currentMemory, setCurrentMemory] = useState<Memory | null>(memory);

  // Sync currentMemory when prop changes
  useEffect(() => {
    setCurrentMemory(memory);
  }, [memory]);

  const displayed = currentMemory ?? memory;
  const memoryId = displayed?.id;

  useEffect(() => {
    if (!memoryId) return;
    let cancelled = false;
    fetch(`/api/documents/${memoryId}/related`)
      .then((r) => r.ok ? r.json() : { relations: [] })
      .then((data) => { if (!cancelled) setRelatedDocs(data.relations ?? []); })
      .catch(() => { if (!cancelled) setRelatedDocs([]); });
    return () => { cancelled = true; setRelatedDocs([]); };
  }, [memoryId]);

  if (!memory) return null;

  // Use displayed (which may have local edits) for rendering
  const m = displayed ?? memory;

  return (
    <div
      className={cn(
        "fixed inset-y-0 right-0 z-40 w-full max-w-md bg-background border-l border-border shadow-xl",
        "transform transition-transform duration-200 ease-out",
        memory ? "translate-x-0" : "translate-x-full"
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 p-5 border-b border-border">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold leading-tight line-clamp-2">
            {m.title}
          </h2>
          {m.url && (
            <a
              href={m.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 mt-1"
            >
              <ExternalLink className="size-3 shrink-0" />
              <span className="truncate">
                {(() => {
                  try {
                    return new URL(m.url).hostname;
                  } catch {
                    return m.url;
                  }
                })()}
              </span>
            </a>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setEditOpen(true)}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
            title={t("edit.title")}
          >
            <Pencil className="size-4" />
          </button>
          <button
            onClick={() => setShareOpen(true)}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
            title={t("memory.share")}
          >
            <Share2 className="size-4" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <ShareDialog open={shareOpen} onOpenChange={setShareOpen} memory={m} />
      </div>

      {/* Content */}
      <div className="overflow-auto h-[calc(100%-80px)] p-5 space-y-5">
        {/* File preview (images/videos) */}
        {m.docType === "file" && m.fileType === "image" && m.ogImage && (
          <div className="relative w-full rounded-lg overflow-hidden border border-border bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={m.ogImage}
              alt={m.title}
              className="w-full h-auto object-contain max-h-64"
              onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = "none"; }}
            />
          </div>
        )}
        {m.docType === "file" && m.fileType === "video" && (
          <div className="relative w-full rounded-lg overflow-hidden border border-border bg-black">
            <video
              src={`/api/files/${m.id}`}
              controls
              className="w-full max-h-64"
              preload="metadata"
            />
          </div>
        )}

        {/* Download button for files */}
        {m.docType === "file" && (
          <a
            href={`/api/files/${m.id}?download=1`}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors"
          >
            <Download className="size-3.5" />
            {t("common.download")}
            {m.fileName && (
              <span className="text-muted-foreground text-xs truncate max-w-48">
                ({m.fileName})
              </span>
            )}
          </a>
        )}

        {/* Meta info */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            {new Date(m.createdAt).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </span>
          {m.readingTimeMinutes && (
            <span className="flex items-center gap-1">
              <FileText className="size-3" />
              {m.readingTimeMinutes}{t("document.minRead")}
            </span>
          )}
          {m.collectionId !== "all" && (
            <span className="flex items-center gap-1">
              <Folder className="size-3" />
              {m.collectionId}
            </span>
          )}
        </div>

        {/* Summary */}
        {m.summary && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t("document.summary")}
            </h3>
            <p className="text-sm leading-relaxed">{m.summary}</p>
          </section>
        )}

        {/* What it solves */}
        {m.whatItSolves && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Lightbulb className="size-3" />
              {t("document.whatItSolves")}
            </h3>
            <p className="text-sm leading-relaxed">{m.whatItSolves}</p>
          </section>
        )}

        {/* Key Points */}
        {m.keyPoints && m.keyPoints.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <ListChecks className="size-3" />
              {t("document.keyPoints")}
            </h3>
            <ul className="space-y-1.5">
              {m.keyPoints.map((point, i) => (
                <li
                  key={i}
                  className="text-sm leading-relaxed flex gap-2"
                >
                  <span className="text-primary font-medium shrink-0">
                    {i + 1}.
                  </span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* User Tags */}
        {m.userTags.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Tag className="size-3" />
              {t("sidebar.tags")}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {[...new Set(m.userTags)].map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* AI Tags */}
        {m.aiTags.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Tag className="size-3" />
              AI {t("sidebar.tags")}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {[...new Set(m.aiTags)].map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary"
                >
                  {tag}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Related Documents */}
        {relatedDocs.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Link2 className="size-3" />
              {t("document.relatedDocs")}
            </h3>
            <div className="space-y-1.5">
              {relatedDocs.map((doc) => (
                <button
                  key={doc.id}
                  className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                  onClick={() => window.open(`/api/documents/${doc.id}`, "_blank")}
                >
                  <FileText className="size-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm truncate flex-1">{doc.title}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {Math.round(doc.score * 100)}%
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Description (original) */}
        {m.description && m.description !== m.summary && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t("document.description")}
            </h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {m.description}
            </p>
          </section>
        )}

        {/* Open original */}
        {m.url && (
          <a
            href={m.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors"
          >
            <ExternalLink className="size-3.5" />
            {t("document.openOriginal")}
          </a>
        )}
        {!m.url && m.docType === "file" && m.ogImage && (
          <a
            href={m.ogImage}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors"
          >
            {m.fileType === "image" ? <ImageIcon className="size-3.5" /> : <Video className="size-3.5" />}
            {t("memory.openInNewTab")}
          </a>
        )}
      </div>

      {/* Edit Modal */}
      <MemoryEditModal
        memory={m}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={(updated) => {
          setCurrentMemory((prev) => prev ? { ...prev, ...updated } : prev);
        }}
      />
    </div>
  );
}
