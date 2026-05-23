"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { Building2, ChevronDown, Plus, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "@/lib/i18n";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function TeamSwitcher() {
  const router = useRouter();
  const { t } = useTranslation();
  const { data: orgs, isPending: orgsLoading } = authClient.useListOrganizations();
  const { data: activeOrg } = authClient.useActiveOrganization();

  const [createOpen, setCreateOpen] = React.useState(false);
  const [teamName, setTeamName] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [switching, setSwitching] = React.useState<string | null>(null);

  const handleSwitch = async (orgId: string) => {
    if (orgId === activeOrg?.id) return;
    setSwitching(orgId);
    try {
      await authClient.organization.setActive({ organizationId: orgId });
      router.refresh();
    } catch {
      toast.error(t("team.switcher.switchFailed"));
    } finally {
      setSwitching(null);
    }
  };

  const handleCreate = async () => {
    const name = teamName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const slug = slugify(name) || `team-${Date.now()}`;
      const result = await authClient.organization.create({ name, slug });
      if (result.error) {
        toast.error(result.error.message ?? t("team.switcher.createFailed"));
        return;
      }
      const newOrgId = result.data?.id;
      if (newOrgId) {
        await authClient.organization.setActive({ organizationId: newOrgId });
      }
      toast.success(t("team.switcher.createSuccess").replace("{name}", name));
      setCreateOpen(false);
      setTeamName("");
      router.refresh();
    } catch {
      toast.error(t("team.switcher.createFailed"));
    } finally {
      setCreating(false);
    }
  };

  const displayName = activeOrg?.name ?? "Personal";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-1.5 px-2 py-1 rounded-md text-sm font-medium hover:bg-muted transition-colors text-left max-w-[160px]">
            <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate flex-1">{displayName}</span>
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          {orgsLoading ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="size-3.5 animate-spin" />
              {t("team.switcher.loading")}
            </div>
          ) : (
            <>
              {(orgs ?? []).map((org) => (
                <DropdownMenuItem
                  key={org.id}
                  onClick={() => handleSwitch(org.id)}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <Building2 className="size-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate flex-1">{org.name}</span>
                  {switching === org.id ? (
                    <Loader2 className="size-3.5 animate-spin shrink-0" />
                  ) : activeOrg?.id === org.id ? (
                    <Check className="size-3.5 text-primary shrink-0" />
                  ) : null}
                </DropdownMenuItem>
              ))}
              {(orgs ?? []).length > 0 && <DropdownMenuSeparator />}
            </>
          )}
          <DropdownMenuItem
            onClick={() => setCreateOpen(true)}
            className="cursor-pointer"
          >
            <Plus className="size-3.5 text-muted-foreground" />
            {t("team.switcher.createTeam")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("team.switcher.createDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("team.switcher.createDialogDesc")}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreate();
            }}
          >
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="team-name">
                {t("team.switcher.teamNameLabel")}
              </label>
              <Input
                id="team-name"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder={t("team.switcher.teamNamePlaceholder")}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => { setCreateOpen(false); setTeamName(""); }}
              >
                {t("team.switcher.cancel")}
              </Button>
              <Button type="submit" disabled={!teamName.trim() || creating}>
                {creating && <Loader2 className="size-4 animate-spin" />}
                {t("team.switcher.create")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
