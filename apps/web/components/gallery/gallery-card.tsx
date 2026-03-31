"use client";

import Image from "next/image";
import Link from "next/link";
import {
  Globe,
  FileText,
  AlignLeft,
  Clock,
  Tag,
} from "lucide-react";

export interface GalleryItem {
  shareToken: string;
  title: string;
  summary: string | null;
  url: string | null;
  sourceType: string;
  ogImage: string | null;
  aiSummary: string | null;
  whatItSolves: string | null;
  keyPoints: string[] | null;
  readingTimeMinutes: number | null;
  tags: string[];
  sharedAt: string;
}

function SourceIcon({ type }: { type: string }) {
  if (type === "file") return <FileText className="size-8 text-muted-foreground" />;
  if (type === "text") return <AlignLeft className="size-8 text-muted-foreground" />;
  return <Globe className="size-8 text-muted-foreground" />;
}

export function GalleryCard({ item }: { item: GalleryItem }) {
  const displaySummary = item.aiSummary || item.summary;

  return (
    <Link
      href={`/s/${item.shareToken}`}
      className="group relative flex flex-col rounded-xl border bg-card overflow-hidden hover:bg-accent/30 transition-colors"
    >
      {/* Image or placeholder */}
      {item.ogImage ? (
        <div className="h-36 relative overflow-hidden bg-muted">
          <Image
            src={item.ogImage}
            alt={item.title}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-300"
            unoptimized
            loading="lazy"
          />
        </div>
      ) : (
        <div className="h-32 bg-linear-to-br from-muted/50 to-muted flex items-center justify-center">
          <div className="size-12 rounded-xl bg-background shadow-sm flex items-center justify-center">
            <SourceIcon type={item.sourceType} />
          </div>
        </div>
      )}

      {/* Content */}
      <div className="p-4 space-y-2 flex-1">
        <h3 className="font-medium line-clamp-2 leading-snug">{item.title}</h3>

        {displaySummary && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {displaySummary}
          </p>
        )}

        {/* Tags */}
        {item.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 pt-1">
            <Tag className="size-3 text-muted-foreground/60" />
            {item.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary"
              >
                {tag}
              </span>
            ))}
            {item.tags.length > 3 && (
              <span className="text-[10px] text-muted-foreground">
                +{item.tags.length - 3}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Footer meta */}
      <div className="px-4 pb-3 flex items-center gap-3 text-[11px] text-muted-foreground">
        {item.readingTimeMinutes && (
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3" />
            {item.readingTimeMinutes} min
          </span>
        )}
        <span>
          {new Date(item.sharedAt).toLocaleDateString()}
        </span>
      </div>
    </Link>
  );
}
