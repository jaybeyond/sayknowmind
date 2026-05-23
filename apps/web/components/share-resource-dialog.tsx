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
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Loader2, Mail, Trash2, Eye, Pencil } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

export type ResourceType = "document" | "category";
export type Permission = "view" | "edit";

interface ShareEntry {
  id: string;
  permission: Permission;
  grantee: {
    id: string;
    name: string | null;
    email: string;
  };
}

interface ShareResourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resourceType: ResourceType;
  resourceId: string;
  resourceName?: string;
}

export function ShareResourceDialog({
  open,
  onOpenChange,
  resourceType,
  resourceId,
  resourceName,
}: ShareResourceDialogProps) {
  const { t } = useTranslation();
  const [shares, setShares] = React.useState<ShareEntry[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [permission, setPermission] = React.useState<Permission>("view");
  const [granting, setGranting] = React.useState(false);
  const [revoking, setRevoking] = React.useState<string | null>(null);

  const loadShares = React.useCallback(async () => {
    if (!resourceId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/shares?resourceType=${resourceType}&resourceId=${encodeURIComponent(resourceId)}`
      );
      if (!res.ok) {
        if (res.status !== 404) {
          toast.error(t("team.share.loadFailed"));
        }
        setShares([]);
        return;
      }
      const data = await res.json();
      setShares(data.shares ?? []);
    } catch {
      toast.error(t("team.share.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [resourceId, resourceType]);

  React.useEffect(() => {
    if (open) {
      void loadShares();
    } else {
      setEmail("");
      setPermission("view");
    }
  }, [open, loadShares]);

  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    const granteeEmail = email.trim();
    if (!granteeEmail) return;
    setGranting(true);
    try {
      const res = await fetch("/api/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceType, resourceId, granteeEmail, permission }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.message ?? t("team.share.shareFailed"));
        return;
      }
      toast.success(t("team.share.shareSuccess").replace("{email}", granteeEmail));
      setEmail("");
      void loadShares();
    } catch {
      toast.error(t("team.share.shareFailed"));
    } finally {
      setGranting(false);
    }
  };

  const handleRevoke = async (shareId: string) => {
    setRevoking(shareId);
    try {
      const res = await fetch(`/api/shares?id=${encodeURIComponent(shareId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        toast.error(t("team.share.revokeFailed"));
        return;
      }
      toast.success(t("team.share.revokeSuccess"));
      void loadShares();
    } catch {
      toast.error(t("team.share.revokeFailed"));
    } finally {
      setRevoking(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("team.share.dialogTitle")}</DialogTitle>
          <DialogDescription>
            {resourceName ? `"${resourceName}"` : `This ${resourceType}`} {t("team.share.dialogDesc")}
          </DialogDescription>
        </DialogHeader>

        {/* Grant form */}
        <form onSubmit={handleGrant} className="flex gap-2">
          <div className="relative flex-1">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              type="email"
              placeholder={t("team.share.emailPlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-9"
            />
          </div>
          <select
            className="text-sm border border-border rounded-md px-2 bg-background text-foreground h-9 shrink-0"
            value={permission}
            onChange={(e) => setPermission(e.target.value as Permission)}
          >
            <option value="view">{t("team.share.permissionView")}</option>
            <option value="edit">{t("team.share.permissionEdit")}</option>
          </select>
          <Button type="submit" disabled={!email.trim() || granting} size="sm" className="h-9">
            {granting && <Loader2 className="size-4 animate-spin" />}
            {t("team.share.shareButton")}
          </Button>
        </form>

        {/* Current shares */}
        <div className="space-y-2">
          {loading ? (
            <>
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="size-7 rounded-full" />
                  <div className="space-y-1 flex-1">
                    <Skeleton className="h-3.5 w-28" />
                    <Skeleton className="h-3 w-40" />
                  </div>
                  <Skeleton className="h-6 w-12" />
                </div>
              ))}
            </>
          ) : shares.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {t("team.share.noAccess")}
            </p>
          ) : (
            shares.map((share) => (
              <div
                key={share.id}
                className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
              >
                <div className="size-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
                  {(share.grantee.name ?? share.grantee.email).slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {share.grantee.name ?? share.grantee.email}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{share.grantee.email}</p>
                </div>
                <span className="flex items-center gap-1 text-xs text-muted-foreground px-2 py-0.5 rounded-md border border-border bg-muted/30 shrink-0">
                  {share.permission === "view" ? (
                    <Eye className="size-3" />
                  ) : (
                    <Pencil className="size-3" />
                  )}
                  {share.permission === "view" ? t("team.share.permissionView") : t("team.share.permissionEdit")}
                </span>
                <button
                  onClick={() => handleRevoke(share.id)}
                  disabled={revoking === share.id}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                  title={t("team.share.revokeTitle")}
                >
                  {revoking === share.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                </button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
