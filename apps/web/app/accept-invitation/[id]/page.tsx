"use client";

import * as React from "react";
import { useRouter, useParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Loader2, Building2, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";

type PageState = "loading" | "ready" | "accepting" | "rejecting" | "accepted" | "rejected" | "error";

export default function AcceptInvitationPage() {
  const router = useRouter();
  const params = useParams();
  const invitationId = params.id as string;

  const [state, setState] = React.useState<PageState>("loading");
  const [orgName, setOrgName] = React.useState<string | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    // Resolve the invitation details by attempting to load it
    // Better-auth doesn't expose a direct "getInvitation" client call,
    // so we read the org name from the server via a thin endpoint if available,
    // or fall back to showing the invitation ID.
    const fetchInvitationInfo = async () => {
      try {
        const res = await fetch(`/api/invitations/${encodeURIComponent(invitationId)}`);
        if (res.ok) {
          const data = await res.json();
          setOrgName(data.organizationName ?? data.organization?.name ?? null);
        }
      } catch {
        // ignore — gracefully fall back to showing raw invitation
      } finally {
        setState("ready");
      }
    };
    void fetchInvitationInfo();
  }, [invitationId]);

  const handleAccept = async () => {
    setState("accepting");
    try {
      const result = await authClient.organization.acceptInvitation({ invitationId });
      if (result.error) {
        setErrorMsg(result.error.message ?? "Failed to accept invitation");
        setState("error");
        return;
      }
      setState("accepted");
      toast.success("Welcome to the team!");
      setTimeout(() => router.push("/"), 1500);
    } catch {
      setErrorMsg("Something went wrong. Please try again.");
      setState("error");
    }
  };

  const handleReject = async () => {
    setState("rejecting");
    try {
      const result = await authClient.organization.rejectInvitation({ invitationId });
      if (result.error) {
        setErrorMsg(result.error.message ?? "Failed to reject invitation");
        setState("error");
        return;
      }
      setState("rejected");
      setTimeout(() => router.push("/"), 1500);
    } catch {
      setErrorMsg("Something went wrong. Please try again.");
      setState("error");
    }
  };

  return (
    <div className="min-h-svh flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Brand */}
        <div className="flex items-center justify-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-icon.png" alt="SayknowMind" className="size-8 rounded-lg" />
          <span className="text-lg font-semibold">SayknowMind</span>
        </div>

        <div className="rounded-xl border border-border bg-card shadow-sm p-6 space-y-5">
          {state === "loading" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Loading invitation…</p>
            </div>
          )}

          {(state === "ready" || state === "accepting" || state === "rejecting") && (
            <>
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="size-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                  <Building2 className="size-6" />
                </div>
                <div>
                  <h1 className="text-lg font-semibold">Team invitation</h1>
                  <p className="text-sm text-muted-foreground mt-1">
                    {orgName
                      ? `You've been invited to join "${orgName}"`
                      : "You've been invited to join a team on SayknowMind."}
                  </p>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={handleReject}
                  disabled={state === "accepting" || state === "rejecting"}
                >
                  {state === "rejecting" && <Loader2 className="size-4 animate-spin" />}
                  Decline
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleAccept}
                  disabled={state === "accepting" || state === "rejecting"}
                >
                  {state === "accepting" && <Loader2 className="size-4 animate-spin" />}
                  Accept invitation
                </Button>
              </div>
            </>
          )}

          {state === "accepted" && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <CheckCircle className="size-10 text-emerald-500" />
              <p className="text-sm font-medium">You&apos;ve joined the team!</p>
              <p className="text-xs text-muted-foreground">Redirecting you to the app…</p>
            </div>
          )}

          {state === "rejected" && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <XCircle className="size-10 text-muted-foreground" />
              <p className="text-sm font-medium">Invitation declined</p>
              <p className="text-xs text-muted-foreground">Redirecting you to the app…</p>
            </div>
          )}

          {state === "error" && (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <XCircle className="size-10 text-destructive" />
              <div>
                <p className="text-sm font-medium text-destructive">Something went wrong</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {errorMsg ?? "The invitation may have expired or already been used."}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => router.push("/")}>
                Go home
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
