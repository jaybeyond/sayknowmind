"use client";

import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Share2,
  Globe,
  Lock,
  Copy,
  Check,
  XCircle,
  Clock,
  ExternalLink,
  FileText,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMemoryStore } from "@/store/memory-store";
import { useTranslation } from "@/lib/i18n";
import { toast } from "sonner";

interface ShareItem {
  id: string;
  shareToken: string;
  documentId: string;
  title: string;
  summary: string | null;
  ogImage: string | null;
  tags: string[];
  readingTimeMinutes: number | null;
  accessType: "public" | "passphrase";
  isRevoked: boolean;
  expiresAt: string | null;
  createdAt: string;
}

function getStatus(item: ShareItem): "active" | "revoked" | "expired" {
  if (item.isRevoked) return "revoked";
  if (item.expiresAt && new Date(item.expiresAt) < new Date()) return "expired";
  return "active";
}

function ShareCard({
  item,
  copiedId,
  onCopy,
  onDelete,
}: {
  item: ShareItem;
  copiedId: string | null;
  onCopy: (token: string, id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  const status = getStatus(item);

  return (
    <div
      className={cn(
        "group relative flex flex-col rounded-xl border bg-card overflow-hidden transition-all hover:shadow-md",
        status !== "active" && "opacity-60"
      )}
    >
      {/* Status badge */}
      <div className="absolute top-3 left-3 z-10">
        <span
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium backdrop-blur-sm",
            status === "active" && "bg-emerald-500/90 text-white",
            status === "revoked" && "bg-destructive/90 text-destructive-foreground",
            status === "expired" && "bg-amber-500/90 text-white"
          )}
        >
          {item.accessType === "passphrase" ? (
            <Lock className="size-3" />
          ) : (
            <Globe className="size-3" />
          )}
          {status === "active" && t("published.active")}
          {status === "revoked" && t("published.revokedLabel")}
          {status === "expired" && t("published.expiredLabel")}
        </span>
      </div>

      {/* Delete button (top-right) */}
      <button
        onClick={() => onDelete(item.id)}
        className="absolute top-3 right-3 z-10 opacity-0 group-hover:opacity-100 transition-opacity size-7 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center text-destructive hover:bg-destructive hover:text-destructive-foreground"
      >
        <Trash2 className="size-3.5" />
      </button>

      {/* Thumbnail / Header area */}
      {item.ogImage ? (
        <div className="relative h-36 bg-muted overflow-hidden">
          <img
            src={item.ogImage}
            alt=""
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        <div className="h-24 bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
          <FileText className="size-8 text-muted-foreground/30" />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 p-4 space-y-2">
        <h3 className="font-medium text-sm line-clamp-2 leading-snug">
          {item.title}
        </h3>
        {item.summary && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {item.summary}
          </p>
        )}

        {/* Tags */}
        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {item.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground"
              >
                {tag}
              </span>
            ))}
            {item.tags.length > 3 && (
              <span className="px-1.5 py-0.5 rounded text-[10px] text-muted-foreground">
                +{item.tags.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Meta row */}
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground pt-1">
          <span>{new Date(item.createdAt).toLocaleDateString()}</span>
          {item.readingTimeMinutes && (
            <>
              <span>·</span>
              <span className="flex items-center gap-0.5">
                <Clock className="size-2.5" />
                {item.readingTimeMinutes}m
              </span>
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      {status === "active" && (
        <div className="flex items-center gap-1 px-3 pb-3">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1.5 h-7 text-xs"
            onClick={() => onCopy(item.shareToken, item.id)}
          >
            {copiedId === item.id ? (
              <Check className="size-3" />
            ) : (
              <Copy className="size-3" />
            )}
            {t("published.copyLink")}
          </Button>
          <Button variant="outline" size="sm" className="h-7 px-2" asChild>
            <a
              href={`/s/${item.shareToken}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="size-3" />
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}

function ShareListItem({
  item,
  copiedId,
  onCopy,
  onDelete,
}: {
  item: ShareItem;
  copiedId: string | null;
  onCopy: (token: string, id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  const status = getStatus(item);

  return (
    <div
      className={cn(
        "group flex items-center gap-4 p-4 rounded-lg border bg-card transition-all hover:shadow-sm",
        status !== "active" && "opacity-60"
      )}
    >
      {/* Icon */}
      <div
        className={cn(
          "size-10 rounded-lg flex items-center justify-center shrink-0",
          item.accessType === "passphrase"
            ? "bg-amber-500/10 text-amber-500"
            : "bg-emerald-500/10 text-emerald-500"
        )}
      >
        {item.accessType === "passphrase" ? (
          <Lock className="size-5" />
        ) : (
          <Globe className="size-5" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h3 className="font-medium truncate">{item.title}</h3>
        {item.summary && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {item.summary}
          </p>
        )}
        <div className="flex items-center gap-2 mt-1">
          <span
            className={cn(
              "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium",
              status === "active" && "bg-emerald-500/10 text-emerald-600",
              status === "revoked" && "bg-destructive/10 text-destructive",
              status === "expired" && "bg-amber-500/10 text-amber-600"
            )}
          >
            {status === "active" && t("published.active")}
            {status === "revoked" && t("published.revokedLabel")}
            {status === "expired" && t("published.expiredLabel")}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {new Date(item.createdAt).toLocaleDateString()}
          </span>
          {item.tags.length > 0 && (
            <>
              <span className="text-[10px] text-muted-foreground">·</span>
              {item.tags.slice(0, 2).map((tag) => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        {status === "active" && (
          <>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => onCopy(item.shareToken, item.id)}
            >
              {copiedId === item.id ? (
                <Check className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
              {t("published.copyLink")}
            </Button>
            <Button variant="outline" size="sm" className="px-2" asChild>
              <a
                href={`/s/${item.shareToken}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="size-3.5" />
              </a>
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => onDelete(item.id)}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

const PAGE_SIZE = 24;

export function PublishedContent() {
  const { t } = useTranslation();
  const { viewMode } = useMemoryStore();
  const [shares, setShares] = React.useState<ShareItem[]>([]);
  const [total, setTotal] = React.useState(0);
  const [hasMore, setHasMore] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const fetchShares = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/share?limit=${PAGE_SIZE}&offset=0`);
      if (!res.ok) return;
      const data = await res.json();
      setShares(data.shares ?? []);
      setTotal(data.total ?? 0);
      setHasMore(data.hasMore ?? false);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchShares();
  }, [fetchShares]);

  const loadMore = React.useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/share?limit=${PAGE_SIZE}&offset=${shares.length}`);
      if (res.ok) {
        const data = await res.json();
        setShares((prev) => [...prev, ...(data.shares ?? [])]);
        setHasMore(data.hasMore ?? false);
      }
    } finally {
      setLoadingMore(false);
    }
  }, [shares.length, hasMore, loadingMore]);

  const sentinelRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) loadMore();
        },
        { rootMargin: "200px" },
      );
      observer.observe(node);
      return () => observer.disconnect();
    },
    [loadMore],
  );

  const handleCopy = async (token: string, id: string) => {
    const url = `${window.location.origin}/s/${token}`;
    await navigator.clipboard.writeText(url);
    setCopiedId(id);
    toast.success(t("share.copied"));
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/share/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success(t("share.revoked"));
      setShares((prev) => prev.filter((s) => s.id !== id));
      setTotal((prev) => prev - 1);
    } catch {
      toast.error(t("share.revokeFailed"));
    }
  };

  if (loading) {
    return (
      <div className="flex-1 w-full overflow-auto">
        <div className="p-4 md:p-6 space-y-6">
          <Skeleton className="h-16 w-full rounded-xl" />
          <div
            className={cn(
              "grid gap-4",
              viewMode === "grid"
                ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                : "grid-cols-1"
            )}
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border bg-card overflow-hidden"
              >
                <Skeleton className="h-24 w-full" />
                <div className="p-4 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full overflow-auto">
      <div className="p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center">
            <Share2 className="size-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">{t("published.title")}</h2>
            <p className="text-sm text-muted-foreground">
              {total !== 1
                ? t("published.countMany").replace("{{count}}", String(total))
                : t("published.countOne").replace("{{count}}", String(total))}
            </p>
          </div>
        </div>

        {/* Empty state */}
        {shares.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Share2 className="size-12 text-muted-foreground/20 mb-4" />
            <h3 className="text-lg font-medium mb-1">
              {t("published.empty")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t("published.emptyCta")}
            </p>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {shares.map((item) => (
              <ShareCard
                key={item.id}
                item={item}
                copiedId={copiedId}
                onCopy={handleCopy}
                onDelete={handleDelete}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {shares.map((item) => (
              <ShareListItem
                key={item.id}
                item={item}
                copiedId={copiedId}
                onCopy={handleCopy}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}

        {/* Infinite scroll sentinel */}
        {!loading && hasMore && shares.length > 0 && (
          <div ref={sentinelRef} className="flex justify-center py-6">
            {loadingMore && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="size-4 animate-spin" />
              </div>
            )}
          </div>
        )}

        {!loading && !hasMore && shares.length > 0 && total > PAGE_SIZE && (
          <p className="text-center text-xs text-muted-foreground py-4">
            {t("published.countMany").replace("{{count}}", String(total))}
          </p>
        )}
      </div>
    </div>
  );
}
