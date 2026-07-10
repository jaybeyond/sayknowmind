"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { authClient, useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Check, Loader2, Mail, Shield, User, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { isSaasAuth, synthesizeSaasEmail } from "@/lib/auth-mode";

type Role = "owner" | "admin" | "member";

type RoleKey = "roles.owner" | "roles.admin" | "roles.member";

interface Member {
  id: string;
  userId: string;
  organizationId: string;
  role: Role;
  createdAt: Date;
  user: {
    id: string;
    name: string | null;
    email: string;
    image?: string | null;
  };
}

interface Invitation {
  id: string;
  email: string;
  role: Role;
  status: string;
  expiresAt: Date;
  organizationId: string;
}

interface MyInvitation {
  id: string;
  role: Role;
  status: string;
  expiresAt: Date;
  organizationId: string;
  organizationName: string;
}

const ROLE_KEYS: Record<Role, RoleKey> = {
  owner: "roles.owner",
  admin: "roles.admin",
  member: "roles.member",
};

const INVITE_ROLES: Role[] = ["admin", "member"];

export function TeamTab() {
  const { t } = useTranslation();
  const router = useRouter();
  const { data: session } = useSession();
  const { data: activeOrg } = authClient.useActiveOrganization();

  const [members, setMembers] = React.useState<Member[]>([]);
  const [invitations, setInvitations] = React.useState<Invitation[]>([]);
  const [loading, setLoading] = React.useState(true);

  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteRole, setInviteRole] = React.useState<Role>("member");
  const [inviting, setInviting] = React.useState(false);

  const [updatingRole, setUpdatingRole] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState<string | null>(null);
  const [cancelling, setCancelling] = React.useState<string | null>(null);
  const [myInvites, setMyInvites] = React.useState<MyInvitation[]>([]);
  const [respondingInvite, setRespondingInvite] = React.useState<string | null>(null);

  const currentUserId = session?.user?.id;

  const loadOrgData = React.useCallback(async () => {
    if (!activeOrg?.id) return;
    setLoading(true);
    try {
      const result = await authClient.organization.getFullOrganization();
      if (result.data) {
        setMembers((result.data.members ?? []) as Member[]);
        setInvitations((result.data.invitations ?? []) as Invitation[]);
      }
    } catch {
      toast.error(t("team.settings.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [activeOrg?.id]);

  React.useEffect(() => {
    void loadOrgData();
  }, [loadOrgData]);

  const loadMyInvites = React.useCallback(async () => {
    try {
      const res = await fetch("/api/invitations/mine");
      if (!res.ok) return;
      const data = await res.json();
      setMyInvites((data.invitations ?? []) as MyInvitation[]);
    } catch {
      // Non-fatal: the tab still works without the received-invites list.
    }
  }, []);

  React.useEffect(() => {
    void loadMyInvites();
  }, [loadMyInvites]);

  const handleAcceptMyInvite = async (inv: MyInvitation) => {
    setRespondingInvite(inv.id);
    try {
      const result = await authClient.organization.acceptInvitation({ invitationId: inv.id });
      if (result.error) {
        toast.error(result.error.message ?? t("team.switcher.acceptFailed"));
        return;
      }
      await authClient.organization.setActive({ organizationId: inv.organizationId });
      toast.success(t("team.switcher.acceptSuccess").replace("{name}", inv.organizationName));
      setMyInvites((prev) => prev.filter((i) => i.id !== inv.id));
      void loadOrgData();
      router.refresh();
    } catch {
      toast.error(t("team.switcher.acceptFailed"));
    } finally {
      setRespondingInvite(null);
    }
  };

  const handleDeclineMyInvite = async (inv: MyInvitation) => {
    setRespondingInvite(inv.id);
    try {
      const result = await authClient.organization.rejectInvitation({ invitationId: inv.id });
      if (result.error) {
        toast.error(result.error.message ?? t("team.switcher.declineFailed"));
        return;
      }
      toast.success(t("team.switcher.declined"));
      setMyInvites((prev) => prev.filter((i) => i.id !== inv.id));
    } catch {
      toast.error(t("team.switcher.declineFailed"));
    } finally {
      setRespondingInvite(null);
    }
  };

  const currentMember = members.find((m) => m.userId === currentUserId);
  const currentRole = currentMember?.role ?? "member";
  const isAdmin = currentRole === "owner" || currentRole === "admin";

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = inviteEmail.trim();
    if (!raw) return;
    // 사원번호(이메일 아님) → saas 에디션에서 SaaS 합성 이메일로 변환
    const email = raw.includes("@") ? raw : (isSaasAuth ? synthesizeSaasEmail(raw) : raw);
    setInviting(true);
    try {
      const result = await authClient.organization.inviteMember({
        email,
        role: inviteRole,
      });
      if (result.error) {
        toast.error(result.error.message ?? t("team.settings.inviteFailed"));
        return;
      }
      toast.success(t("team.settings.inviteSuccess").replace("{email}", raw));
      setInviteEmail("");
      void loadOrgData();
    } catch {
      toast.error(t("team.settings.inviteFailed"));
    } finally {
      setInviting(false);
    }
  };

  const handleUpdateRole = async (memberId: string, newRole: Role) => {
    setUpdatingRole(memberId);
    try {
      const result = await authClient.organization.updateMemberRole({
        memberId,
        role: newRole,
      });
      if (result.error) {
        toast.error(result.error.message ?? t("team.settings.roleUpdateFailed"));
        return;
      }
      toast.success(t("team.settings.roleUpdated"));
      void loadOrgData();
    } catch {
      toast.error(t("team.settings.roleUpdateFailed"));
    } finally {
      setUpdatingRole(null);
    }
  };

  const handleRemove = async (memberId: string) => {
    setRemoving(memberId);
    try {
      const result = await authClient.organization.removeMember({ memberIdOrEmail: memberId });
      if (result.error) {
        toast.error(result.error.message ?? t("team.settings.removeFailed"));
        return;
      }
      toast.success(t("team.settings.memberRemoved"));
      void loadOrgData();
    } catch {
      toast.error(t("team.settings.removeFailed"));
    } finally {
      setRemoving(null);
    }
  };

  const handleCancelInvitation = async (invitationId: string) => {
    setCancelling(invitationId);
    try {
      const result = await authClient.organization.cancelInvitation({ invitationId });
      if (result.error) {
        toast.error(result.error.message ?? t("team.settings.cancelInviteFailed"));
        return;
      }
      toast.success(t("team.settings.inviteCancelled"));
      void loadOrgData();
    } catch {
      toast.error(t("team.settings.cancelInviteFailed"));
    } finally {
      setCancelling(null);
    }
  };

  if (!activeOrg) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          {t("team.settings.noActiveTeam")}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-8 rounded-full" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-7 w-20" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const pendingInvites = invitations.filter((inv) => inv.status === "pending");

  return (
    <div className="space-y-8">
      {/* Invitations addressed to me — accept/decline (mirrors the sidebar team switcher) */}
      {myInvites.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">{t("team.switcher.invitesHeading")}</h3>
          {myInvites.map((inv) => (
            <div
              key={inv.id}
              className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5"
            >
              <div className="size-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Mail className="size-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{inv.organizationName}</p>
                <p className="text-xs text-muted-foreground">
                  {t("team.settings.invitedAs").replace("{role}", t(`team.${ROLE_KEYS[inv.role]}`))}
                </p>
              </div>
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={respondingInvite === inv.id}
                onClick={() => handleAcceptMyInvite(inv)}
              >
                {respondingInvite === inv.id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Check className="size-3.5" />
                )}
                {t("team.switcher.accept")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={respondingInvite === inv.id}
                onClick={() => handleDeclineMyInvite(inv)}
              >
                <X className="size-3.5" />
                {t("team.switcher.decline")}
              </Button>
            </div>
          ))}
        </div>
      )}
      <div>
        <h2 className="text-base font-semibold">{activeOrg.name}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          {members.length === 1
            ? t("team.settings.membersCount").replace("{count}", String(members.length))
            : t("team.settings.membersCountPlural").replace("{count}", String(members.length))}
        </p>
      </div>

      {/* Members */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">{t("team.settings.membersHeading")}</h3>
        {members.map((member) => {
          const isMe = member.userId === currentUserId;
          const isOwner = member.role === "owner";
          const canModify = isAdmin && !isMe && !(isOwner && currentRole !== "owner");

          return (
            <div
              key={member.id}
              className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5"
            >
              <div className="size-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
                {(member.user.name ?? member.user.email).slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {member.user.name ?? member.user.email}
                  {isMe && <span className="ml-1.5 text-xs text-muted-foreground">{t("team.settings.you")}</span>}
                </p>
                <p className="text-xs text-muted-foreground truncate">{member.user.email}</p>
              </div>

              {canModify ? (
                <select
                  className="text-xs border border-border rounded-md px-2 py-1 bg-background text-foreground h-7"
                  value={member.role}
                  disabled={updatingRole === member.id}
                  onChange={(e) => handleUpdateRole(member.id, e.target.value as Role)}
                >
                  {INVITE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`team.${ROLE_KEYS[r]}`)}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-xs text-muted-foreground px-2 py-1 rounded-md border border-border bg-muted/30 flex items-center gap-1">
                  {member.role === "owner" && <Shield className="size-3" />}
                  {t(`team.${ROLE_KEYS[member.role]}`)}
                </span>
              )}

              {canModify && (
                <button
                  onClick={() => handleRemove(member.id)}
                  disabled={removing === member.id}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  title={t("team.settings.removeMemberTitle")}
                >
                  {removing === member.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <X className="size-3.5" />
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Invite form — admin only */}
      {isAdmin && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">{t("team.settings.inviteHeading")}</h3>
          <form onSubmit={handleInvite} className="flex gap-2">
            <div className="relative flex-1">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                type={isSaasAuth ? "text" : "email"}
                placeholder={t(isSaasAuth ? "team.settings.invitePlaceholderSaas" : "team.settings.invitePlaceholder")}
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="pl-9"
              />
            </div>
            <select
              className="text-sm border border-border rounded-md px-2 bg-background text-foreground h-9"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as Role)}
            >
              {INVITE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`team.${ROLE_KEYS[r]}`)}
                </option>
              ))}
            </select>
            <Button type="submit" disabled={!inviteEmail.trim() || inviting}>
              {inviting && <Loader2 className="size-4 animate-spin" />}
              {t("team.settings.inviteButton")}
            </Button>
          </form>
        </div>
      )}

      {/* Pending invitations */}
      {pendingInvites.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">{t("team.settings.pendingHeading")}</h3>
          {pendingInvites.map((inv) => (
            <div
              key={inv.id}
              className="flex items-center gap-3 rounded-lg border border-border border-dashed px-3 py-2.5"
            >
              <div className="size-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                <User className="size-3.5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{inv.email}</p>
                <p className="text-xs text-muted-foreground">
                  {t("team.settings.invitedAs").replace("{role}", t(`team.${ROLE_KEYS[inv.role]}`))}
                </p>
              </div>
              {isAdmin && (
                <button
                  onClick={() => handleCancelInvitation(inv.id)}
                  disabled={cancelling === inv.id}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  title={t("team.settings.cancelInviteTitle")}
                >
                  {cancelling === inv.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <X className="size-3.5" />
                  )}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
