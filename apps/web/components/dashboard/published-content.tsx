"use client";

import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Share2, Globe, Lock, Copy, Check, XCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import { toast } from "sonner";

interface ShareItem {
  id: string;
  shareToken: string;
  documentId: string;
  title: string;
  summary: string | null;
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

export function PublishedContent() {
  const { t } = useTranslation();
  const [shares, setShares] = React.useState<ShareItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const fetchShares = React.useCallback(async () => {
    try {
      const res = await fetch("/api/share");
      if (!res.ok) return;
      const data = await res.json();
      setShares(data.shares ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchShares();
  }, [fetchShares]);

  const handleCopy = async (token: string, id: string) => {
    const url = `${window.location.origin}/s/${token}`;
    await navigator.clipboard.writeText(url);
    setCopiedId(id);
    toast.success(t("share.copied"));
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleRevoke = async (id: string) => {
    try {
      const res = await fetch(`/api/share/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success(t("share.revoked"));
      setShares((prev) =>
        prev.map((s) => (s.id === id ? { ...s, isRevoked: true } : s))
      );
    } catch {
      toast.error(t("share.revokeFailed"));
    }
  };

  if (loading) {
    return (
      <div className="flex-1 w-full overflow-auto">
        <div className="p-4 md:p-6 space-y-6">
          <Skeleton className="h-20 w-full rounded-xl" />
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-lg" />
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
              {shares.length !== 1
                ? t("published.countMany").replace("{{count}}", String(shares.length))
                : t("published.countOne").replace("{{count}}", String(shares.length))}
            </p>
          </div>
        </div>

        {/* Empty state */}
        {shares.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Share2 className="size-12 text-muted-foreground/20 mb-4" />
            <h3 className="text-lg font-medium mb-1">{t("published.empty")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("published.emptyCta")}
            </p>
          </div>
        ) : (
          /* Share list */
          <div className="space-y-3">
            {shares.map((item) => {
              const status = getStatus(item);
              return (
                <div
                  key={item.id}
                  className={cn(
                    "flex items-center gap-4 p-4 rounded-lg border bg-card",
                    status !== "active" && "opacity-60"
                  )}
                >
                  {/* Icon */}
                  <div className={cn(
                    "size-10 rounded-lg flex items-center justify-center shrink-0",
                    item.accessType === "passphrase"
                      ? "bg-amber-500/10 text-amber-500"
                      : "bg-emerald-500/10 text-emerald-500"
                  )}>
                    {item.accessType === "passphrase" ? (
                      <Lock className="size-5" />
                    ) : (
                      <Globe className="size-5" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium truncate">{item.title}</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={cn(
                        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium",
                        status === "active" && "bg-emerald-500/10 text-emerald-600",
                        status === "revoked" && "bg-destructive/10 text-destructive",
                        status === "expired" && "bg-amber-500/10 text-amber-600"
                      )}>
                        {status === "active" && t("published.active")}
                        {status === "revoked" && t("published.revokedLabel")}
                        {status === "expired" && t("published.expiredLabel")}
                      </span>
                      {item.expiresAt && status === "active" && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="size-3" />
                          {t("published.expiresAt").replace(
                            "{{date}}",
                            new Date(item.expiresAt).toLocaleDateString()
                          )}
                        </span>
                      )}
                      {!item.expiresAt && status === "active" && (
                        <span className="text-xs text-muted-foreground">
                          {t("published.noExpiry")}
                        </span>
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
                          onClick={() => handleCopy(item.shareToken, item.id)}
                        >
                          {copiedId === item.id ? (
                            <Check className="size-3.5" />
                          ) : (
                            <Copy className="size-3.5" />
                          )}
                          {t("published.copyLink")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive gap-1.5"
                          onClick={() => handleRevoke(item.id)}
                        >
                          <XCircle className="size-3.5" />
                          {t("published.revokeShare")}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
