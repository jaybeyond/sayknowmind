"use client";

import * as React from "react";
import { authClient, useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Loader2, Mail, Shield, User, X } from "lucide-react";

type Role = "owner" | "admin" | "member";

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

const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

const INVITE_ROLES: Role[] = ["admin", "member"];

export function TeamTab() {
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
      toast.error("Failed to load team data");
    } finally {
      setLoading(false);
    }
  }, [activeOrg?.id]);

  React.useEffect(() => {
    void loadOrgData();
  }, [loadOrgData]);

  const currentMember = members.find((m) => m.userId === currentUserId);
  const currentRole = currentMember?.role ?? "member";
  const isAdmin = currentRole === "owner" || currentRole === "admin";

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;
    setInviting(true);
    try {
      const result = await authClient.organization.inviteMember({
        email,
        role: inviteRole,
      });
      if (result.error) {
        toast.error(result.error.message ?? "Failed to send invitation");
        return;
      }
      toast.success(`Invitation sent to ${email}`);
      setInviteEmail("");
      void loadOrgData();
    } catch {
      toast.error("Failed to send invitation");
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
        toast.error(result.error.message ?? "Failed to update role");
        return;
      }
      toast.success("Role updated");
      void loadOrgData();
    } catch {
      toast.error("Failed to update role");
    } finally {
      setUpdatingRole(null);
    }
  };

  const handleRemove = async (memberId: string) => {
    setRemoving(memberId);
    try {
      const result = await authClient.organization.removeMember({ memberIdOrEmail: memberId });
      if (result.error) {
        toast.error(result.error.message ?? "Failed to remove member");
        return;
      }
      toast.success("Member removed");
      void loadOrgData();
    } catch {
      toast.error("Failed to remove member");
    } finally {
      setRemoving(null);
    }
  };

  const handleCancelInvitation = async (invitationId: string) => {
    setCancelling(invitationId);
    try {
      const result = await authClient.organization.cancelInvitation({ invitationId });
      if (result.error) {
        toast.error(result.error.message ?? "Failed to cancel invitation");
        return;
      }
      toast.success("Invitation cancelled");
      void loadOrgData();
    } catch {
      toast.error("Failed to cancel invitation");
    } finally {
      setCancelling(null);
    }
  };

  if (!activeOrg) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          No active team. Create or join a team from the team switcher in the sidebar.
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
      <div>
        <h2 className="text-base font-semibold">{activeOrg.name}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          {members.length} {members.length === 1 ? "member" : "members"}
        </p>
      </div>

      {/* Members */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Members</h3>
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
                  {isMe && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}
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
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-xs text-muted-foreground px-2 py-1 rounded-md border border-border bg-muted/30 flex items-center gap-1">
                  {member.role === "owner" && <Shield className="size-3" />}
                  {ROLE_LABELS[member.role]}
                </span>
              )}

              {canModify && (
                <button
                  onClick={() => handleRemove(member.id)}
                  disabled={removing === member.id}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  title="Remove member"
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
          <h3 className="text-sm font-semibold">Invite a teammate</h3>
          <form onSubmit={handleInvite} className="flex gap-2">
            <div className="relative flex-1">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                type="email"
                placeholder="colleague@example.com"
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
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <Button type="submit" disabled={!inviteEmail.trim() || inviting}>
              {inviting && <Loader2 className="size-4 animate-spin" />}
              Invite
            </Button>
          </form>
        </div>
      )}

      {/* Pending invitations */}
      {pendingInvites.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Pending invitations</h3>
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
                  Invited as {ROLE_LABELS[inv.role]} · Pending
                </p>
              </div>
              {isAdmin && (
                <button
                  onClick={() => handleCancelInvitation(inv.id)}
                  disabled={cancelling === inv.id}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  title="Cancel invitation"
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
