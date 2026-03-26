"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";

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

  useEffect(() => {
    if (!memory) { setRelatedDocs([]); return; }
    let cancelled = false;
    fetch(`/api/documents/${memory.id}/related`)
      .then((r) => r.ok ? r.json() : { relations: [] })
      .then((data) => { if (!cancelled) setRelatedDocs(data.relations ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [memory?.id]);

  if (!memory) return null;

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
            {memory.title}
          </h2>
          {memory.url && (
            <a
              href={memory.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 mt-1"
            >
              <ExternalLink className="size-3 shrink-0" />
              <span className="truncate">
                {(() => {
                  try {
                    return new URL(memory.url).hostname;
                  } catch {
                    return memory.url;
                  }
                })()}
              </span>
            </a>
          )}
        </div>
        <button
          onClick={onClose}
          className="shrink-0 p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Content */}
      <div className="overflow-auto h-[calc(100%-80px)] p-5 space-y-5">
        {/* File preview (images/videos) */}
        {memory.docType === "file" && memory.fileType === "image" && memory.ogImage && (
          <div className="relative w-full rounded-lg overflow-hidden border border-border bg-muted">
            <Image
              src={memory.ogImage}
              alt={memory.title}
              width={400}
              height={300}
              className="w-full h-auto object-contain max-h-64"
              unoptimized
            />
          </div>
        )}
        {memory.docType === "file" && memory.fileType === "video" && (
          <div className="relative w-full rounded-lg overflow-hidden border border-border bg-black">
            <video
              src={`/api/files/${memory.id}`}
              controls
              className="w-full max-h-64"
              preload="metadata"
            />
          </div>
        )}

        {/* Download button for files */}
        {memory.docType === "file" && (
          <a
            href={`/api/files/${memory.id}?download=1`}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors"
          >
            <Download className="size-3.5" />
            {t("common.download")}
            {memory.fileName && (
              <span className="text-muted-foreground text-xs truncate max-w-48">
                ({memory.fileName})
              </span>
            )}
          </a>
        )}

        {/* Meta info */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            {new Date(memory.createdAt).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </span>
          {memory.readingTimeMinutes && (
            <span className="flex items-center gap-1">
              <FileText className="size-3" />
              {memory.readingTimeMinutes}{t("document.minRead")}
            </span>
          )}
          {memory.collectionId !== "all" && (
            <span className="flex items-center gap-1">
              <Folder className="size-3" />
              {memory.collectionId}
            </span>
          )}
        </div>

        {/* Summary */}
        {memory.summary && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t("document.summary")}
            </h3>
            <p className="text-sm leading-relaxed">{memory.summary}</p>
          </section>
        )}

        {/* What it solves */}
        {memory.whatItSolves && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Lightbulb className="size-3" />
              {t("document.whatItSolves")}
            </h3>
            <p className="text-sm leading-relaxed">{memory.whatItSolves}</p>
          </section>
        )}

        {/* Key Points */}
        {memory.keyPoints && memory.keyPoints.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <ListChecks className="size-3" />
              {t("document.keyPoints")}
            </h3>
            <ul className="space-y-1.5">
              {memory.keyPoints.map((point, i) => (
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
        {memory.userTags.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Tag className="size-3" />
              {t("sidebar.tags")}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {[...new Set(memory.userTags)].map((tag) => (
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
        {memory.aiTags.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Tag className="size-3" />
              AI {t("sidebar.tags")}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {[...new Set(memory.aiTags)].map((tag) => (
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
        {memory.description && memory.description !== memory.summary && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t("document.description")}
            </h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {memory.description}
            </p>
          </section>
        )}

        {/* Open original */}
        {memory.url && (
          <a
            href={memory.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors"
          >
            <ExternalLink className="size-3.5" />
            {t("document.openOriginal")}
          </a>
        )}
        {!memory.url && memory.docType === "file" && memory.ogImage && (
          <a
            href={memory.ogImage}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors"
          >
            {memory.fileType === "image" ? <ImageIcon className="size-3.5" /> : <Video className="size-3.5" />}
            {t("memory.openInNewTab")}
          </a>
        )}
      </div>
    </div>
  );
}
