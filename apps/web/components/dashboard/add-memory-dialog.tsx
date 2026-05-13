"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMemoryStore } from "@/store/memory-store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Link, FileUp, FileText, BookmarkIcon } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

type Tab = "url" | "file" | "text" | "bookmarks";

const ACCEPTED_TYPES = ".pdf,.docx,.txt,.md,.html,.png,.jpg,.jpeg,.webp,.gif,.svg,.mp4,.webm,.mov";
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB (images/videos need more)

interface AddMemoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddMemoryDialog({ open, onOpenChange }: AddMemoryDialogProps) {
  const { t, locale } = useTranslation();
  const [tab, setTab] = React.useState<Tab>("url");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [url, setUrl] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [textContent, setTextContent] = React.useState("");
  const [textTitle, setTextTitle] = React.useState("");
  const [bookmarkFile, setBookmarkFile] = React.useState<File | null>(null);
  const [bookmarkPreview, setBookmarkPreview] = React.useState<{ total: number; folders: string[] } | null>(null);
  const [bookmarkResult, setBookmarkResult] = React.useState<{ imported: number; skipped: number; total: number } | null>(null);
  const bookmarkInputRef = React.useRef<HTMLInputElement>(null);

  const { fetchMemories, selectedCollection } = useMemoryStore();

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "url", label: t("ingest.tabUrl"), icon: <Link className="size-4" /> },
    { id: "file", label: t("ingest.tabFile"), icon: <FileUp className="size-4" /> },
    { id: "text", label: t("ingest.tabText"), icon: <FileText className="size-4" /> },
    { id: "bookmarks" as Tab, label: t("ingest.tabBookmarks") || "Bookmarks", icon: <BookmarkIcon className="size-4" /> },
  ];

  const reset = () => {
    setUrl("");
    setFile(null);
    setTextContent("");
    setTextTitle("");
    setBookmarkFile(null);
    setBookmarkPreview(null);
    setBookmarkResult(null);
    setError(null);
    setDragOver(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!loading) {
      reset();
      setTab("url");
      onOpenChange(next);
    }
  };

  const handleSuccess = async () => {
    toast.success(t("ingest.saved"));
    await fetchMemories();
    reset();
    onOpenChange(false);
  };

  const handleError = (res: Response, data: Record<string, unknown>) => {
    setError(
      typeof data.message === "string"
        ? data.message
        : `Failed to ingest (${res.status})`
    );
  };

  const isValidUrl = (s: string) => {
    try {
      const u = new URL(s);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  };

  const submitUrl = async (force = false) => {
    const trimmed = url.trim();
    if (!isValidUrl(trimmed)) {
      setError(t("ingest.invalidUrl"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ingest/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: trimmed,
          locale,
          force,
          categoryId: selectedCollection !== "all" ? selectedCollection : undefined,
        }),
      });
      if (res.status === 409) {
        const data = await res.json().catch(() => ({}));
        const existingTitle = data.existingTitle ?? "Unknown";
        if (window.confirm(t("ingest.duplicateConfirm").replace("{title}", existingTitle))) {
          await submitUrl(true);
        }
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        handleError(res, data);
        return;
      }
      await handleSuccess();
    } catch {
      setError(t("ingest.networkError"));
    } finally {
      setLoading(false);
    }
  };

  const validateFile = (f: File): string | null => {
    if (f.size > MAX_FILE_SIZE) return t("ingest.fileTooLarge");
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (!ext || !["pdf", "docx", "txt", "md", "html", "png", "jpg", "jpeg", "webp", "gif", "svg", "mp4", "webm", "mov"].includes(ext)) {
      return t("ingest.unsupportedType");
    }
    return null;
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (!dropped) return;
    const err = validateFile(dropped);
    if (err) { setError(err); return; }
    setError(null);
    setFile(dropped);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    const err = validateFile(selected);
    if (err) { setError(err); return; }
    setError(null);
    setFile(selected);
  };

  const submitFile = async (force = false) => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("locale", locale);
      if (force) formData.append("force", "true");
      if (selectedCollection !== "all") {
        formData.append("categoryId", selectedCollection);
      }
      const res = await fetch("/api/ingest/file", { method: "POST", body: formData });
      if (res.status === 409) {
        const data = await res.json().catch(() => ({}));
        const existingTitle = data.existingTitle ?? "Unknown";
        if (window.confirm(t("ingest.duplicateConfirm").replace("{title}", existingTitle))) {
          await submitFile(true);
        }
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        handleError(res, data);
        return;
      }
      await handleSuccess();
    } catch {
      setError(t("ingest.networkError"));
    } finally {
      setLoading(false);
    }
  };

  const submitText = async () => {
    const trimmed = textContent.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ingest/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: trimmed,
          title: textTitle.trim() || undefined,
          locale,
          categoryId: selectedCollection !== "all" ? selectedCollection : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        handleError(res, data);
        return;
      }
      await handleSuccess();
    } catch {
      setError(t("ingest.networkError"));
    } finally {
      setLoading(false);
    }
  };

  const handleBookmarkSelect = async (f: File) => {
    if (f.size > 20 * 1024 * 1024) {
      setError(t("ingest.fileTooLarge"));
      return;
    }
    setError(null);
    setBookmarkFile(f);
    setBookmarkResult(null);
    // Quick preview: count bookmarks client-side
    try {
      const text = await f.text();
      const head = text.slice(0, 512).toUpperCase();
      if (!head.includes("NETSCAPE-BOOKMARK") && !head.includes("<!DOCTYPE NETSCAPE")) {
        setError(t("ingest.unsupportedType"));
        setBookmarkFile(null);
        return;
      }
      // Count <A HREF= occurrences for preview
      const matches = text.match(/<A\s+HREF=/gi);
      const total = matches?.length ?? 0;
      // Extract folder names from <H3> tags
      const folderMatches = [...text.matchAll(/<H3[^>]*>([^<]+)<\/H3>/gi)];
      const folders = folderMatches.map((m) => m[1].trim()).filter(Boolean);
      setBookmarkPreview({ total, folders });
    } catch {
      setBookmarkPreview(null);
    }
  };

  const submitBookmarks = async () => {
    if (!bookmarkFile) return;
    setLoading(true);
    setError(null);
    setBookmarkResult(null);
    try {
      const formData = new FormData();
      formData.append("file", bookmarkFile);
      formData.append("locale", locale);
      formData.append("skipDuplicates", "true");
      if (selectedCollection !== "all") {
        formData.append("categoryId", selectedCollection);
      }
      const res = await fetch("/api/ingest/bookmarks", { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        handleError(res, data);
        return;
      }
      const data = await res.json();
      setBookmarkResult({ imported: data.imported, skipped: data.skipped, total: data.total });
      toast.success(`${data.imported} bookmarks imported`);
      await fetchMemories();
    } catch {
      setError(t("ingest.networkError"));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (tab === "url") submitUrl();
    else if (tab === "file") submitFile();
    else if (tab === "bookmarks") submitBookmarks();
    else submitText();
  };

  const isSubmitDisabled =
    loading ||
    (tab === "url" && !url.trim()) ||
    (tab === "file" && !file) ||
    (tab === "text" && !textContent.trim()) ||
    (tab === "bookmarks" && !bookmarkFile);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("ingest.addDocument")}</DialogTitle>
          <DialogDescription>{t("ingest.dialogDescription")}</DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={loading}
              onClick={() => { setTab(item.id); setError(null); }}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                tab === item.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {tab === "url" && (
            <Input
              type="url"
              placeholder={t("ingest.urlPlaceholder")}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={loading}
              autoFocus
            />
          )}

          {tab === "file" && (
            <div>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 cursor-pointer transition-colors",
                  dragOver
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/25 hover:border-muted-foreground/50"
                )}
              >
                <FileUp className="size-8 text-muted-foreground" />
                {file ? (
                  <p className="text-sm font-medium">{file.name}</p>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">{t("ingest.dragDrop")}</p>
                    <p className="text-xs text-muted-foreground/60">{t("ingest.supportedFormats")}</p>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES}
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
          )}

          {tab === "text" && (
            <div className="space-y-3">
              <Input
                placeholder={t("ingest.titlePlaceholder")}
                value={textTitle}
                onChange={(e) => setTextTitle(e.target.value)}
                disabled={loading}
              />
              <textarea
                placeholder={t("ingest.textPlaceholder")}
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                disabled={loading}
                rows={6}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
              />
            </div>
          )}

          {tab === "bookmarks" && (
            <div>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const dropped = e.dataTransfer.files[0];
                  if (dropped) handleBookmarkSelect(dropped);
                }}
                onClick={() => bookmarkInputRef.current?.click()}
                className={cn(
                  "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 cursor-pointer transition-colors",
                  dragOver
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/25 hover:border-muted-foreground/50"
                )}
              >
                <BookmarkIcon className="size-8 text-muted-foreground" />
                {bookmarkFile ? (
                  <p className="text-sm font-medium">{bookmarkFile.name}</p>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      {t("ingest.bookmarkDragDrop") || "Drop bookmark HTML file here"}
                    </p>
                    <p className="text-xs text-muted-foreground/60">
                      Chrome, Firefox, Safari, Edge
                    </p>
                  </>
                )}
              </div>
              <input
                ref={bookmarkInputRef}
                type="file"
                accept=".html,.htm"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleBookmarkSelect(f);
                }}
                className="hidden"
              />
              {bookmarkPreview && !bookmarkResult && (
                <div className="mt-3 rounded-md bg-muted p-3 text-sm space-y-1">
                  <p className="font-medium">{bookmarkPreview.total} bookmarks found</p>
                  {bookmarkPreview.folders.length > 0 && (
                    <p className="text-muted-foreground">
                      Folders: {bookmarkPreview.folders.slice(0, 5).join(", ")}
                      {bookmarkPreview.folders.length > 5 && ` +${bookmarkPreview.folders.length - 5} more`}
                    </p>
                  )}
                </div>
              )}
              {bookmarkResult && (
                <div className="mt-3 rounded-md bg-green-500/10 p-3 text-sm space-y-1">
                  <p className="font-medium text-green-700 dark:text-green-400">
                    {bookmarkResult.imported} imported, {bookmarkResult.skipped} skipped
                  </p>
                </div>
              )}
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={loading}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitDisabled}>
              {loading ? t("ingest.saving") : t("common.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
