"use client";

import { ExternalLink, FileText } from "lucide-react";

export interface SourceCardData {
  id: string;
  title: string;
  url?: string;
  excerpt: string;
  score: number;
}

export function SourceCard({ source }: { source: SourceCardData }) {
  const scorePercent = Math.round(source.score * 100);

  return (
    <div className="flex-shrink-0 w-56 rounded-lg border border-border bg-card p-3 hover:border-primary/30 transition-colors">
      <div className="flex items-start gap-2 mb-1.5">
        <FileText className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
        <h4 className="text-xs font-medium line-clamp-2 leading-tight flex-1">
          {source.title}
        </h4>
      </div>

      {source.excerpt && (
        <p className="text-[11px] text-muted-foreground line-clamp-2 mb-2 leading-relaxed">
          {source.excerpt}
        </p>
      )}

      <div className="flex items-center justify-between">
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
          {scorePercent}%
        </span>
        {source.url && (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-primary transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </div>
  );
}

export function SourceCardRow({ sources }: { sources: SourceCardData[] }) {
  if (sources.length === 0) return null;

  return (
    <div className="py-2">
      <p className="text-xs text-muted-foreground mb-2 font-medium">
        Sources ({sources.length})
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
        {sources.map((source, i) => (
          <SourceCard key={source.id || i} source={source} />
        ))}
      </div>
    </div>
  );
}
