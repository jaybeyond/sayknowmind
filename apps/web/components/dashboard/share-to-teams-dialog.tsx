"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Check, Users, Home } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";

interface TeamEntry {
  id: string;
  name: string;
  isHome: boolean;
  shared: boolean;
}

interface ShareToTeamsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memoryId: string;
  memoryName?: string;
}

export function ShareToTeamsDialog({
  open,
  onOpenChange,
  memoryId,
  memoryName,
}: ShareToTeamsDialogProps) {
  const { t } = useTranslation();
  const [teams, setTeams] = React.useState<TeamEntry[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [toggling, setToggling] = React.useState<string | null>(null);

  const loadTeams = React.useCallback(async () => {
    if (!memoryId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/documents/${memoryId}/teams`);
      if (!res.ok) {
        if (res.status !== 404) {
          toast.error(t("team.shareTeams.loadFailed"));
        }
        setTeams([]);
        return;
      }
      const data = await res.json();
      setTeams(data.teams ?? []);
    } catch {
      toast.error(t("team.shareTeams.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [memoryId, t]);

  React.useEffect(() => {
    if (open) {
      void loadTeams();
    } else {
      setTeams([]);
    }
  }, [open, loadTeams]);

  const handleToggle = async (team: TeamEntry) => {
    if (toggling) return;
    const next = !team.shared;

    // Optimistic update
    setTeams((prev) =>
      prev.map((t) => (t.id === team.id ? { ...t, shared: next } : t))
    );
    setToggling(team.id);

    try {
      const res = await fetch(`/api/documents/${memoryId}/teams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: team.id, shared: next }),
      });
      if (!res.ok) {
        // Revert
        setTeams((prev) =>
          prev.map((t) => (t.id === team.id ? { ...t, shared: team.shared } : t))
        );
        toast.error(t("team.shareTeams.updateFailed"));
      }
    } catch {
      // Revert
      setTeams((prev) =>
        prev.map((t) => (t.id === team.id ? { ...t, shared: team.shared } : t))
      );
      toast.error(t("team.shareTeams.updateFailed"));
    } finally {
      setToggling(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("team.shareTeams.title")}</DialogTitle>
          <DialogDescription>
            {memoryName ? `"${memoryName}" — ` : ""}
            {t("team.shareTeams.desc")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {loading ? (
            <>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2">
                  <Skeleton className="size-8 rounded-full" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="size-5 rounded" />
                </div>
              ))}
            </>
          ) : teams.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              {t("team.shareTeams.noTeams")}
            </p>
          ) : (
            teams.map((team) => (
              <button
                key={team.id}
                onClick={() => handleToggle(team)}
                disabled={toggling === team.id}
                className={cn(
                  "w-full flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  team.shared
                    ? "border-primary/40 bg-primary/5 hover:bg-primary/10"
                    : "border-border bg-card hover:bg-accent/50"
                )}
              >
                <div className="size-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
                  <Users className="size-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium truncate block">{team.name}</span>
                  {team.isHome && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                      <Home className="size-2.5" />
                      {t("team.shareTeams.home")}
                    </span>
                  )}
                </div>
                <div
                  className={cn(
                    "size-5 rounded border flex items-center justify-center shrink-0 transition-colors",
                    team.shared
                      ? "bg-primary border-primary text-primary-foreground"
                      : "border-border bg-background"
                  )}
                >
                  {team.shared && <Check className="size-3" />}
                </div>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
