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
import { Link, FileUp, FileText } from "lucide-react";

type Tab = "url" | "file" | "text";

const ACCEPTED_TYPES = ".pdf,.docx,.txt,.md,.html";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

interface AddMemoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddMemoryDialog({ open, onOpenChange }: AddMemoryDialogProps) {
  const [tab, setTab] = React.useState<Tab>("url");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // URL tab state
  const [url, setUrl] = React.useState("");

  // File tab state
  const [file, setFile] = React.useState<File | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Text tab state
  const [textContent, setTextContent] = React.useState("");
  const [textTitle, setTextTitle] = React.useState("");

  const { fetchMemories } = useMemoryStore();

  const reset = () => {
    setUrl("");
    setFile(null);
    setTextContent("");
    setTextTitle("");
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
    toast.success("Saved!");
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

  // --- URL ---
  const isValidUrl = (s: string) => {
    try {
      const u = new URL(s);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  };

  const submitUrl = async () => {
    const trimmed = url.trim();
    if (!isValidUrl(trimmed)) {
      setError("Please enter a valid URL (https://...)");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const locale = navigator.language?.split("-")[0] ?? "en";
      const res = await fetch("/api/ingest/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed, locale }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        handleError(res, data);
        return;
      }
      await handleSuccess();
    } catch {
      setError("Network error -- please try again");
    } finally {
      setLoading(false);
    }
  };

  // --- File ---
  const validateFile = (f: File): string | null => {
    if (f.size > MAX_FILE_SIZE) return "File exceeds 10 MB limit";
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (!ext || !["pdf", "docx", "txt", "md", "html"].includes(ext)) {
      return "Unsupported file type. Accepted: .pdf .docx .txt .md .html";
    }
    return null;
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (!dropped) return;
    const err = validateFile(dropped);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setFile(dropped);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    const err = validateFile(selected);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setFile(selected);
  };

  const submitFile = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/ingest/file", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        handleError(res, data);
        return;
      }
      await handleSuccess();
    } catch {
      setError("Network error -- please try again");
    } finally {
      setLoading(false);
    }
  };

  // --- Text ---
  const submitText = async () => {
    const trimmed = textContent.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ingest/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed, title: textTitle.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        handleError(res, data);
        return;
      }
      await handleSuccess();
    } catch {
      setError("Network error -- please try again");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (tab === "url") submitUrl();
    else if (tab === "file") submitFile();
    else submitText();
  };

  const isSubmitDisabled =
    loading ||
    (tab === "url" && !url.trim()) ||
    (tab === "file" && !file) ||
    (tab === "text" && !textContent.trim());

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "url", label: "URL", icon: <Link className="size-4" /> },
    { id: "file", label: "File", icon: <FileUp className="size-4" /> },
    { id: "text", label: "Text", icon: <FileText className="size-4" /> },
  ];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Document</DialogTitle>
          <DialogDescription>
            Save a URL, upload a file, or paste text to your knowledge base.
          </DialogDescription>
        </DialogHeader>

        {/* Tab switcher */}
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={loading}
              onClick={() => {
                setTab(t.id);
                setError(null);
              }}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                tab === t.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* URL tab */}
          {tab === "url" && (
            <Input
              type="url"
              placeholder="https://example.com/article"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={loading}
              autoFocus
            />
          )}

          {/* File tab */}
          {tab === "file" && (
            <div>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
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
                    <p className="text-sm text-muted-foreground">
                      Drop a file here or click to browse
                    </p>
                    <p className="text-xs text-muted-foreground/60">
                      .pdf .docx .txt .md .html -- max 10 MB
                    </p>
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

          {/* Text tab */}
          {tab === "text" && (
            <div className="space-y-3">
              <Input
                placeholder="Title (optional)"
                value={textTitle}
                onChange={(e) => setTextTitle(e.target.value)}
                disabled={loading}
              />
              <textarea
                placeholder="Paste or type your content here..."
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                disabled={loading}
                rows={6}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
              />
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitDisabled}>
              {loading ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
