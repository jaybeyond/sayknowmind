"use client";

/**
 * Per-account file browser dialog.
 *
 * The user navigates folders, ticks files, and presses "Import selected".
 * All API calls go through /api/integrations/connectors/<provider>/...
 * which only operates on the current user's tokens.
 */

import { useState, useEffect, useCallback } from "react";
import {
  X,
  ChevronRight,
  Folder,
  FileText,
  ImageIcon,
  FilmIcon,
  Loader2,
  Download,
  CheckSquare,
  Square,
  Check,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";

interface ConnectorItem {
  externalId: string;
  name: string;
  kind: "file" | "folder";
  mimeType?: string;
  size?: number;
  modifiedAt?: string;
  externalUrl?: string;
  downloadable: boolean;
  alreadyImported?: boolean;
  importedDocumentId?: string;
}

interface ListPage {
  items: ConnectorItem[];
  nextCursor?: string;
}

interface Props {
  providerId: string;
  account: { accountId: string; email?: string; label?: string };
  displayName: string;
  onClose: () => void;
  onImported?: () => void;
}

interface Crumb {
  id: string | null;
  name: string;
}

/**
 * MIME-type filter tabs offered for Google Drive. Other providers fall back
 * to a single "All" tab. `labelKey` resolves through i18n at render time.
 */
const DRIVE_MIME_FILTERS: ReadonlyArray<{ id: string; labelKey: string; mimes: string[] | null }> = [
  { id: "all", labelKey: "integrations.ccFilterAll", mimes: null },
  { id: "docs", labelKey: "integrations.ccFilterDocs", mimes: ["application/vnd.google-apps.document"] },
  { id: "sheets", labelKey: "integrations.ccFilterSheets", mimes: ["application/vnd.google-apps.spreadsheet"] },
  { id: "slides", labelKey: "integrations.ccFilterSlides", mimes: ["application/vnd.google-apps.presentation"] },
  { id: "pdf", labelKey: "integrations.ccFilterPdf", mimes: ["application/pdf"] },
];

function fileIcon(mimeType?: string) {
  if (!mimeType) return <FileText className="size-4 shrink-0" />;
  if (mimeType.startsWith("image/")) return <ImageIcon className="size-4 shrink-0" />;
  if (mimeType.startsWith("video/")) return <FilmIcon className="size-4 shrink-0" />;
  return <FileText className="size-4 shrink-0" />;
}

function formatBytes(n?: number): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function ConnectorBrowserDialog({ providerId, account, displayName, onClose, onImported }: Props) {
  const { t } = useTranslation();
  const [items, setItems] = useState<ConnectorItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: null, name: t("integrations.ccRoot") }]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [resultBanner, setResultBanner] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>("all");

  const currentParent = crumbs[crumbs.length - 1].id;

  // Only Google Drive currently exposes mime filters. Other providers see no tab row.
  const filterTabs = providerId === "google-drive" ? DRIVE_MIME_FILTERS : null;

  const fetchPage = useCallback(
    async (parentId: string | null, append: boolean, cursorParam?: string) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ accountId: account.accountId });
        if (parentId) params.set("parentId", parentId);
        if (cursorParam) params.set("cursor", cursorParam);

        // Apply active mime filter (Drive only)
        if (filterTabs) {
          const tab = filterTabs.find((t) => t.id === activeFilter);
          if (tab?.mimes) {
            for (const m of tab.mimes) {
              params.append("filter[mimeTypes]", m);
            }
          }
        }

        const res = await fetch(
          `/api/integrations/connectors/${providerId}/list?${params.toString()}`,
        );
        if (!res.ok) {
          setResultBanner(`${t("integrations.ccListFailedPrefix")} ${await res.text()}`);
          return;
        }
        const data = (await res.json()) as ListPage;
        setItems((prev) => (append ? [...prev, ...data.items] : data.items));
        setCursor(data.nextCursor);
        setHasMore(Boolean(data.nextCursor));
      } finally {
        setLoading(false);
      }
    },
    [providerId, account.accountId, filterTabs, activeFilter],
  );

  useEffect(() => {
    setItems([]);
    setSelected(new Set());
    setCursor(undefined);
    void fetchPage(currentParent, false, undefined);
  }, [currentParent, fetchPage]);

  const enterFolder = (item: ConnectorItem) => {
    setCrumbs((prev) => [...prev, { id: item.externalId, name: item.name }]);
  };

  const goToCrumb = (idx: number) => {
    setCrumbs((prev) => prev.slice(0, idx + 1));
  };

  const toggle = (externalId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(externalId)) next.delete(externalId);
      else next.add(externalId);
      return next;
    });
  };

  const importSelected = async () => {
    if (selected.size === 0 || importing) return;
    setImporting(true);
    setResultBanner(null);
    try {
      const res = await fetch(`/api/integrations/connectors/${providerId}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: account.accountId,
          externalIds: Array.from(selected),
        }),
      });
      if (!res.ok) {
        setResultBanner(`${t("integrations.ccImportFailedPrefix")} ${await res.text()}`);
        return;
      }
      const data = await res.json();
      setResultBanner(
        `${t("integrations.ccImportedCount")} ${data.imported}, ${t("integrations.ccSkippedCount")} ${data.skipped}, ${t("integrations.ccFailedCount")} ${data.failed}.`,
      );
      setSelected(new Set());
      onImported?.();
      // Re-fetch the current folder so newly-imported rows show the badge.
      void fetchPage(currentParent, false, undefined);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl max-h-[85vh] flex flex-col bg-card border border-border rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="min-w-0">
            <div className="text-sm font-semibold">{displayName}</div>
            <div className="text-xs text-muted-foreground truncate">
              {account.email ?? account.label ?? account.accountId}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 hover:bg-accent"
            aria-label={t("integrations.ccClose")}
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Breadcrumbs */}
        <div className="px-4 py-2 border-b border-border flex items-center gap-1 text-xs overflow-x-auto">
          {crumbs.map((c, i) => (
            <span key={`${c.id ?? "root"}-${i}`} className="inline-flex items-center gap-1 shrink-0">
              {i > 0 && <ChevronRight className="size-3 text-muted-foreground" />}
              <button
                onClick={() => goToCrumb(i)}
                className="hover:text-foreground text-muted-foreground"
              >
                {c.name}
              </button>
            </span>
          ))}
        </div>

        {/* Mime filter tabs (Drive only) */}
        {filterTabs && (
          <div className="px-4 py-1.5 border-b border-border flex items-center gap-1 text-xs overflow-x-auto">
            {filterTabs.map((tab) => {
              const active = tab.id === activeFilter;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveFilter(tab.id);
                    setSelected(new Set());
                  }}
                  className={`px-2.5 py-1 rounded-md transition-colors shrink-0 ${
                    active
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t(tab.labelKey)}
                </button>
              );
            })}
          </div>
        )}

        {/* Item list */}
        <div className="flex-1 overflow-y-auto p-2">
          {loading && items.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground inline-flex items-center justify-center gap-2 w-full">
              <Loader2 className="size-4 animate-spin" />
              {t("integrations.ccDialogLoading")}
            </div>
          ) : items.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">{t("integrations.ccEmpty")}</div>
          ) : (
            <ul className="space-y-0.5">
              {items.map((item) => {
                const isFolder = item.kind === "folder";
                const checked = selected.has(item.externalId);
                const isImported = !isFolder && item.alreadyImported === true;
                return (
                  <li
                    key={item.externalId}
                    className={`flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50 text-sm ${
                      isImported ? "opacity-60" : ""
                    }`}
                  >
                    {!isFolder && item.downloadable && !isImported ? (
                      <button
                        onClick={() => toggle(item.externalId)}
                        className="shrink-0"
                        aria-label={checked ? t("integrations.ccDeselect") : t("integrations.ccSelect")}
                      >
                        {checked ? (
                          <CheckSquare className="size-4 text-primary" />
                        ) : (
                          <Square className="size-4 text-muted-foreground" />
                        )}
                      </button>
                    ) : (
                      <span className="size-4 shrink-0" />
                    )}
                    {isFolder ? (
                      <Folder className="size-4 shrink-0 text-amber-400" />
                    ) : (
                      fileIcon(item.mimeType)
                    )}
                    <button
                      onClick={() => (isFolder ? enterFolder(item) : toggle(item.externalId))}
                      className="flex-1 min-w-0 text-left truncate"
                      disabled={!isFolder && (!item.downloadable || isImported)}
                    >
                      <span className="truncate">{item.name}</span>
                    </button>
                    {isImported && (
                      <span
                        className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 text-[10px] shrink-0"
                        title={t("integrations.ccAlreadyImported")}
                      >
                        <Check className="size-3" />
                        {t("integrations.ccImportedBadge")}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {!isFolder && formatBytes(item.size)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {hasMore && (
            <button
              onClick={() => void fetchPage(currentParent, true, cursor)}
              disabled={loading}
              className="mt-2 w-full text-xs text-muted-foreground hover:text-foreground py-2"
            >
              {loading ? t("integrations.ccDialogLoading") : t("integrations.ccLoadMore")}
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border p-3 flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {selected.size > 0
              ? `${selected.size} ${t("integrations.ccSelected")}`
              : t("integrations.ccSelectPrompt")}
          </div>
          <div className="flex items-center gap-2">
            {resultBanner && (
              <span className="text-[11px] text-muted-foreground truncate max-w-[280px]">
                {resultBanner}
              </span>
            )}
            <button
              onClick={importSelected}
              disabled={selected.size === 0 || importing}
              className="text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 inline-flex items-center gap-1.5"
            >
              {importing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
              {t("integrations.ccImportButton")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
