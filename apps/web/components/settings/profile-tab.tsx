"use client";

import { useState, useEffect } from "react";
import { useSession, authClient } from "@/lib/auth-client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

export function ProfileTab() {
  const { data: session, isPending, refetch } = useSession();
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (session?.user?.name) setName(session.user.name);
    if (session?.user?.email) setEmail(session.user.email);
  }, [session?.user?.name, session?.user?.email]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: Record<string, string> = {};
      if (name !== (user?.name ?? "")) updates.name = name;
      if (email !== (user?.email ?? "")) updates.email = email;

      const { error } = await authClient.updateUser(updates);
      if (error) {
        toast.error(error.message ?? t("profile.saveFailed"));
      } else {
        toast.success(t("profile.updated"));
        refetch?.();
      }
    } catch {
      toast.error(t("profile.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (isPending) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="size-16 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  const user = session?.user;
  const initials = (user?.name ?? user?.email ?? "??").slice(0, 2).toUpperCase();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="size-16 rounded-full bg-primary/10 text-primary flex items-center justify-center text-lg font-semibold shrink-0">
          {initials}
        </div>
        <div>
          <p className="font-medium">{user?.name || t("profile.noName")}</p>
          <p className="text-sm text-muted-foreground">{user?.email}</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="settings-name">
            {t("profile.displayName")}
          </label>
          <Input
            id="settings-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("profile.namePlaceholder")}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="settings-email">
            {t("settings.email")}
          </label>
          <Input
            id="settings-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@example.com"
          />
        </div>
      </div>

      <Button
        onClick={handleSave}
        disabled={saving || (name === (user?.name ?? "") && email === (user?.email ?? ""))}
      >
        {saving && <Loader2 className="size-4 animate-spin" />}
        {t("settings.saveChanges")}
      </Button>
    </div>
  );
}
