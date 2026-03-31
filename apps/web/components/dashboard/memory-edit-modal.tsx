"use client";

import { useState, useCallback, useRef } from "react";
import { type Memory, useMemoryStore } from "@/store/memory-store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  X,
  Plus,
  Save,
  Loader2,
  ImageIcon,
  Paperclip,
  Trash2,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { toast } from "sonner";

interface MemoryEditModalProps {
  memory: Memory;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (updated: Partial<Memory>) => void;
}

interface Attachment {
  file: File;
  preview?: string;
  type: "image" | "file";
}

export function MemoryEditModal({
  memory,
  open,
  onOpenChange,
  onSaved,
}: MemoryEditModalProps) {
  const { t } = useTranslation();
  const { fetchMemories } = useMemoryStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState(memory.title);
  const [summary, setSummary] = useState(memory.summary ?? "");
  const [whatItSolves, setWhatItSolves] = useState(memory.whatItSolves ?? "");
  const [keyPoints, setKeyPoints] = useState<string[]>(
    memory.keyPoints?.length ? [...memory.keyPoints] : [""]
  );
  const [userTags, setUserTags] = useState<string[]>([...memory.userTags]);
  const [tagInput, setTagInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [saving, setSaving] = useState(false);

  const addTag = useCallback(() => {
    const tag = tagInput.trim();
    if (tag && !userTags.includes(tag)) {
      setUserTags((prev) => [...prev, tag]);
    }
    setTagInput("");
  }, [tagInput, userTags]);

  const removeTag = useCallback((tag: string) => {
    setUserTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  const addKeyPoint = useCallback(() => {
    setKeyPoints((prev) => [...prev, ""]);
  }, []);

  const updateKeyPoint = useCallback((index: number, value: string) => {
    setKeyPoints((prev) => prev.map((p, i) => (i === index ? value : p)));
  }, []);

  const removeKeyPoint = useCallback((index: number) => {
    setKeyPoints((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>, type: "image" | "file") => {
      const files = e.target.files;
      if (!files) return;
      const newAttachments: Attachment[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const att: Attachment = { file, type };
        if (type === "image" && file.type.startsWith("image/")) {
          att.preview = URL.createObjectURL(file);
        }
        newAttachments.push(att);
      }
      setAttachments((prev) => [...prev, ...newAttachments]);
      e.target.value = "";
    },
    []
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => {
      const removed = prev[index];
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const uploadAttachments = async () => {
    for (const att of attachments) {
      const formData = new FormData();
      formData.append("file", att.file);
      try {
        await fetch("/api/ingest/file", { method: "POST", body: formData });
      } catch {
        // silently continue
      }
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error(t("edit.titleRequired"));
      return;
    }

    setSaving(true);
    try {
      const cleanedKeyPoints = keyPoints.filter((p) => p.trim());
      const body: Record<string, unknown> = {
        title: title.trim(),
        summary: summary.trim() || undefined,
        metadata: {
          what_it_solves: whatItSolves.trim() || undefined,
          key_points:
            cleanedKeyPoints.length > 0 ? cleanedKeyPoints : undefined,
          userTags,
        },
      };

      const res = await fetch(`/api/documents/${memory.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to save");
      }

      // Upload any new attachments
      if (attachments.length > 0) {
        await uploadAttachments();
      }

      toast.success(t("edit.saved"));
      onSaved?.({
        title: title.trim(),
        summary: summary.trim() || undefined,
        whatItSolves: whatItSolves.trim() || undefined,
        keyPoints: cleanedKeyPoints.length > 0 ? cleanedKeyPoints : undefined,
        userTags,
        tags: [...new Set([...userTags, ...memory.aiTags])],
      });
      fetchMemories();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("edit.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl !max-h-[85vh] !h-auto overflow-hidden flex flex-col p-0">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-0 shrink-0">
          <DialogTitle>{t("edit.title")}</DialogTitle>
        </DialogHeader>

        {/* Scrollable body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          <div className="space-y-5">
            {/* Title */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t("edit.fieldTitle")}
              </label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("edit.fieldTitle")}
                className="text-base font-semibold"
              />
            </div>

            {/* Summary */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t("document.summary")}
              </label>
              <textarea
                value={summary}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setSummary(e.target.value)
                }
                placeholder={t("edit.summaryPlaceholder")}
                rows={4}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-vertical min-h-[80px]"
              />
            </div>

            {/* What it solves */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t("document.whatItSolves")}
              </label>
              <textarea
                value={whatItSolves}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setWhatItSolves(e.target.value)
                }
                placeholder={t("edit.whatItSolvesPlaceholder")}
                rows={2}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-vertical min-h-[56px]"
              />
            </div>

            {/* Key Points */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {t("document.keyPoints")}
                </label>
                <button
                  type="button"
                  onClick={addKeyPoint}
                  className="text-xs text-primary hover:text-primary/80 flex items-center gap-0.5"
                >
                  <Plus className="size-3" />
                  {t("edit.addPoint")}
                </button>
              </div>
              <div className="space-y-2">
                {keyPoints.map((point, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground shrink-0 w-5 text-right">
                      {i + 1}.
                    </span>
                    <Input
                      value={point}
                      onChange={(e) => updateKeyPoint(i, e.target.value)}
                      placeholder={t("edit.keyPointPlaceholder")}
                      className="flex-1 min-w-0"
                    />
                    {keyPoints.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeKeyPoint(i)}
                        className="p-1.5 text-muted-foreground hover:text-destructive shrink-0"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Tags */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t("sidebar.tags")}
              </label>
              {userTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {userTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="hover:text-destructive"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  placeholder={t("edit.tagPlaceholder")}
                  className="flex-1 min-w-0"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addTag}
                  disabled={!tagInput.trim()}
                >
                  <Plus className="size-3.5" />
                </Button>
              </div>
              {memory.aiTags.length > 0 && (
                <div className="pt-1">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    AI {t("sidebar.tags")}
                  </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {memory.aiTags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 rounded-full text-[10px] bg-primary/10 text-primary"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Attachments */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t("edit.attachments")}
              </label>

              {/* Existing OG image */}
              {memory.ogImage && (
                <div className="relative w-full rounded-lg overflow-hidden border border-border bg-muted">
                  <img
                    src={memory.ogImage}
                    alt=""
                    className="w-full h-32 object-cover"
                  />
                  <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] bg-background/80 text-muted-foreground backdrop-blur-sm">
                    {t("edit.currentImage")}
                  </span>
                </div>
              )}

              {/* New attachments */}
              {attachments.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {attachments.map((att, i) => (
                    <div
                      key={i}
                      className="relative group rounded-lg border border-border overflow-hidden bg-muted"
                    >
                      {att.preview ? (
                        <img
                          src={att.preview}
                          alt=""
                          className="w-full h-24 object-cover"
                        />
                      ) : (
                        <div className="h-24 flex items-center justify-center">
                          <Paperclip className="size-6 text-muted-foreground/40" />
                        </div>
                      )}
                      <div className="px-2 py-1 text-[10px] text-muted-foreground truncate">
                        {att.file.name}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeAttachment(i)}
                        className="absolute top-1 right-1 size-5 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add buttons */}
              <div className="flex gap-2">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFileSelect(e, "image")}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.txt,.md,.html"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFileSelect(e, "file")}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => imageInputRef.current?.click()}
                >
                  <ImageIcon className="size-3.5" />
                  {t("edit.addImage")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip className="size-3.5" />
                  {t("edit.addFile")}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer — pinned */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t shrink-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="size-4 mr-1.5 animate-spin" />
            ) : (
              <Save className="size-4 mr-1.5" />
            )}
            {t("edit.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
