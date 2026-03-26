"use client";

import { useState, useEffect } from "react";
import { useSession, authClient } from "@/lib/auth-client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

export function ProfileTab() {
  const { data: session, isPending, refetch } = useSession();
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);

  useEffect(() => {
    if (session?.user?.name) setName(session.user.name);
    if (session?.user?.email) setEmail(session.user.email);
  }, [session?.user?.name, session?.user?.email]);

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error(t("auth.passwordMismatch"));
      return;
    }
    if (newPassword.length < 8) {
      toast.error(t("profile.passwordTooShort"));
      return;
    }
    setChangingPassword(true);
    try {
      const { error } = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (error) {
        toast.error(error.message ?? t("profile.passwordChangeFailed"));
      } else {
        toast.success(t("profile.passwordChanged"));
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      }
    } catch {
      toast.error(t("profile.passwordChangeFailed"));
    } finally {
      setChangingPassword(false);
    }
  };

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

      <hr className="border-border" />

      <div className="space-y-4">
        <h3 className="text-sm font-semibold">{t("profile.changePassword")}</h3>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="current-password">
            {t("profile.currentPassword")}
          </label>
          <div className="relative">
            <Input
              id="current-password"
              type={showCurrentPw ? "text" : "password"}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowCurrentPw(!showCurrentPw)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showCurrentPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="new-password">
            {t("profile.newPassword")}
          </label>
          <div className="relative">
            <Input
              id="new-password"
              type={showNewPw ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowNewPw(!showNewPw)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showNewPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="confirm-password">
            {t("profile.confirmPassword")}
          </label>
          <Input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
          />
          {confirmPassword && newPassword !== confirmPassword && (
            <p className="text-xs text-destructive">{t("auth.passwordMismatch")}</p>
          )}
        </div>

        <Button
          onClick={handleChangePassword}
          disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword || newPassword !== confirmPassword}
          variant="outline"
        >
          {changingPassword && <Loader2 className="size-4 animate-spin" />}
          {t("profile.changePassword")}
        </Button>
      </div>
    </div>
  );
}
