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
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Globe, Lock, Copy, Check, Link2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { Memory } from "@/store/memory-store";

type AccessType = "public" | "passphrase";
type ExpiryOption = { hours: number; key: string };

const EXPIRY_OPTIONS: ExpiryOption[] = [
  { hours: 1, key: "share.expiry1h" },
  { hours: 24, key: "share.expiry24h" },
  { hours: 168, key: "share.expiry7d" },
  { hours: 720, key: "share.expiry30d" },
  { hours: 0, key: "share.expiryNone" },
];

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memory: Memory | null;
}

export function ShareDialog({ open, onOpenChange, memory }: ShareDialogProps) {
  const { t } = useTranslation();
  const [accessType, setAccessType] = React.useState<AccessType>("public");
  const [passphrase, setPassphrase] = React.useState("");
  const [expiryHours, setExpiryHours] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [shareUrl, setShareUrl] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const reset = () => {
    setAccessType("public");
    setPassphrase("");
    setExpiryHours(0);
    setShareUrl(null);
    setCopied(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!loading) {
      reset();
      onOpenChange(next);
    }
  };

  const handleCreate = async () => {
    if (!memory) return;
    if (accessType === "passphrase" && !passphrase.trim()) return;

    setLoading(true);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: memory.id,
          accessType,
          passphrase: accessType === "passphrase" ? passphrase : undefined,
          expiryHours: expiryHours || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || t("share.failed"));
      }

      const data = await res.json();
      const url = `${window.location.origin}/s/${data.shareToken}`;
      setShareUrl(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("share.failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    toast.success(t("share.copied"));
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("share.title")}</DialogTitle>
          <DialogDescription>{t("share.description")}</DialogDescription>
        </DialogHeader>

        {shareUrl ? (
          /* ---------- Success: show link ---------- */
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-3 overflow-hidden max-w-full">
              <Link2 className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-sm font-mono break-all min-w-0">{shareUrl}</span>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCopy} className="flex-1 gap-2">
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? t("share.copied") : t("share.copyLink")}
              </Button>
              <Button
                variant="outline"
                onClick={() => { reset(); }}
              >
                {t("share.shareAnother")}
              </Button>
            </div>
          </div>
        ) : (
          /* ---------- Form: configure share ---------- */
          <div className="space-y-4">
            {/* Access type toggle */}
            <div>
              <p className="text-sm font-medium mb-2">{t("share.accessType")}</p>
              <div className="flex gap-1 rounded-lg bg-muted p-1">
                <button
                  type="button"
                  onClick={() => setAccessType("public")}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    accessType === "public"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Globe className="size-4" />
                  {t("share.public")}
                </button>
                <button
                  type="button"
                  onClick={() => setAccessType("passphrase")}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    accessType === "passphrase"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Lock className="size-4" />
                  {t("share.passphrase")}
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                {accessType === "public" ? t("share.publicDesc") : t("share.passphraseDesc")}
              </p>
            </div>

            {/* Passphrase input */}
            {accessType === "passphrase" && (
              <Input
                type="text"
                placeholder={t("share.passphrasePlaceholder")}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                autoFocus
              />
            )}

            {/* Expiry options */}
            <div>
              <p className="text-sm font-medium mb-2">{t("share.expiry")}</p>
              <div className="flex flex-wrap gap-1.5">
                {EXPIRY_OPTIONS.map((opt) => (
                  <button
                    key={opt.hours}
                    type="button"
                    onClick={() => setExpiryHours(opt.hours)}
                    className={cn(
                      "rounded-md px-3 py-1 text-xs font-medium transition-colors border",
                      expiryHours === opt.hours
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:text-foreground"
                    )}
                  >
                    {t(opt.key)}
                  </button>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handleCreate}
                disabled={loading || (accessType === "passphrase" && !passphrase.trim())}
              >
                {loading ? t("share.creating") : t("share.createLink")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
