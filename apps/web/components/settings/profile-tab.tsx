"use client";

import { useState, useEffect } from "react";
import { useSession } from "@/lib/auth-client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export function ProfileTab() {
  const { data: session, isPending, refetch } = useSession();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (session?.user?.name) {
      setName(session.user.name);
    }
  }, [session?.user?.name]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/user/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        toast.success("Profile updated");
        refetch?.();
      } else {
        toast.error("Failed to save");
      }
    } catch {
      toast.error("Failed to save");
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
          <p className="font-medium">{user?.name || "No name set"}</p>
          <p className="text-sm text-muted-foreground">{user?.email}</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="settings-name">
            Display name
          </label>
          <Input
            id="settings-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="settings-email">
            Email
          </label>
          <Input
            id="settings-email"
            value={user?.email ?? ""}
            disabled
            className="opacity-60"
          />
          <p className="text-xs text-muted-foreground">
            Email cannot be changed
          </p>
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving || name === (user?.name ?? "")}>
        {saving && <Loader2 className="size-4 animate-spin" />}
        Save changes
      </Button>
    </div>
  );
}
