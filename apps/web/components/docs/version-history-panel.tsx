"use client";

import * as React from "react";
import { X, History, RotateCcw, Loader2 } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";
import { toast } from "sonner";

interface VersionAuthor {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

interface DocVersion {
  id: string;
  createdAt: string;
  title: string | null;
  content: string | null;
  author: VersionAuthor;
}

/**
 * What changed between an older and a newer snapshot. Content is the flat
 * plaintext projection of the doc (notes blocks / sheet cells / mindmap topics),
 * so a line-set diff surfaces added/removed text without a full LCS.
 */
function lineDiff(newer: string, older: string): { added: string[]; removed: string[] } {
  const split = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
  const newLines = split(newer);
  const oldLines = split(older);
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  return {
    added: newLines.filter((l) => !oldSet.has(l)),
    removed: oldLines.filter((l) => !newSet.has(l)),
  };
}

interface VersionHistoryPanelProps {
  docId: string;
  open: boolean;
  onClose: () => void;
}

const LOCALE_TAGS: Record<string, string> = { en: "en-US", ko: "ko-KR", zh: "zh-CN", ja: "ja-JP" };

export function VersionHistoryPanel({ docId, open, onClose }: VersionHistoryPanelProps) {
  const { t, locale } = useTranslation();
  const localeTag = LOCALE_TAGS[locale] ?? "en-US";
  const [versions, setVersions] = React.useState<DocVersion[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [restoringId, setRestoringId] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    setLoading(true);
    fetch(`/api/documents/${docId}/versions`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setVersions(data?.versions ?? []))
      .catch(() => setVersions([]))
      .finally(() => setLoading(false));
  }, [docId]);

  React.useEffect(() => {
    if (open) load();
  }, [open, load]);

  const relativeTime = React.useCallback(
    (iso: string): string => {
      const then = new Date(iso).getTime();
      const diffSec = Math.round((Date.now() - then) / 1000);
      const rtf = new Intl.RelativeTimeFormat(localeTag, { numeric: "auto" });
      if (diffSec < 60) return rtf.format(-diffSec, "second");
      if (diffSec < 3600) return rtf.format(-Math.round(diffSec / 60), "minute");
      if (diffSec < 86400) return rtf.format(-Math.round(diffSec / 3600), "hour");
      if (diffSec < 604800) return rtf.format(-Math.round(diffSec / 86400), "day");
      return new Date(iso).toLocaleDateString(localeTag, { dateStyle: "medium" } as Intl.DateTimeFormatOptions);
    },
    [localeTag],
  );

  const handleRestore = React.useCallback(
    async (versionId: string) => {
      if (!window.confirm(t("docs.history.restoreConfirm"))) return;
      setRestoringId(versionId);
      try {
        const res = await fetch(`/api/documents/${docId}/versions/${versionId}/restore`, { method: "POST" });
        if (!res.ok) throw new Error("restore failed");
        toast.success(t("docs.history.restored"));
        // Reload so the editors re-seed from the restored content (collab CRDT
        // was reset server-side).
        setTimeout(() => window.location.reload(), 400);
      } catch {
        toast.error(t("docs.history.restoreFailed"));
        setRestoringId(null);
      }
    },
    [docId, t],
  );

  if (!open) return null;

  return (
    <div
      className="absolute right-0 top-0 bottom-0 w-80 bg-background/95 backdrop-blur-sm border-l border-border overflow-y-auto z-20 animate-in slide-in-from-right-4 duration-200"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="sticky top-0 bg-background/95 backdrop-blur-sm border-b border-border p-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-semibold text-sm">
          <History className="size-4" />
          {t("docs.history.title")}
        </h3>
        <Button variant="ghost" size="icon-xs" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>

      <div className="p-3 space-y-1">
        {loading && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        )}

        {!loading && versions && versions.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">{t("docs.history.empty")}</p>
        )}

        {!loading &&
          versions?.map((v, i) => {
            const name = v.author.name || v.author.email || t("docs.history.someone");
            const initial = (name.trim().charAt(0) || "?").toUpperCase();
            const older = versions[i + 1];
            const diff = older ? lineDiff(v.content ?? "", older.content ?? "") : null;
            const titleChanged = !!older && (v.title ?? "") !== (older.title ?? "");
            const MAX = 4;
            const extra =
              diff ? Math.max(0, diff.added.length - MAX) + Math.max(0, diff.removed.length - MAX) : 0;
            const unchanged = !!older && !titleChanged && diff !== null && diff.added.length === 0 && diff.removed.length === 0;
            return (
              <div key={v.id} className="group rounded-md p-2 hover:bg-muted/60 transition-colors">
                <div className="flex items-center gap-2.5">
                  <Avatar className="size-7 shrink-0">
                    {v.author.image ? <AvatarImage src={v.author.image} alt={name} /> : null}
                    <AvatarFallback className="text-[11px]">{initial}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate">
                      {name}
                      {i === 0 && (
                        <span className="ml-1.5 text-[10px] font-normal text-emerald-500">
                          {t("docs.history.current")}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{relativeTime(v.createdAt)}</div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    disabled={restoringId !== null}
                    onClick={() => handleRestore(v.id)}
                    title={t("docs.history.restore")}
                  >
                    {restoringId === v.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <>
                        <RotateCcw className="size-3.5" />
                        <span className="hidden sm:inline ml-1">{t("docs.history.restore")}</span>
                      </>
                    )}
                  </Button>
                </div>

                {/* What changed in this version */}
                <div className="mt-1 ml-9 space-y-0.5 text-[11px] leading-snug">
                  {!older && <div className="text-muted-foreground/70 italic">{t("docs.history.initial")}</div>}
                  {titleChanged && (
                    <div className="text-amber-500 truncate">
                      {t("docs.history.titleChanged")}: {v.title || "—"}
                    </div>
                  )}
                  {diff?.added.slice(0, MAX).map((l, k) => (
                    <div key={`a${k}`} className="text-emerald-500 truncate" title={l}>+ {l}</div>
                  ))}
                  {diff?.removed.slice(0, MAX).map((l, k) => (
                    <div key={`r${k}`} className="text-rose-400/80 truncate line-through" title={l}>− {l}</div>
                  ))}
                  {extra > 0 && (
                    <div className="text-muted-foreground/60">{t("docs.history.moreChanges").replace("{count}", String(extra))}</div>
                  )}
                  {unchanged && <div className="text-muted-foreground/50 italic">{t("docs.history.noChange")}</div>}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
