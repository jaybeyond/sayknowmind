"use client";

import * as React from "react";
import { useRouter, useParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Loader2, Building2, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "@/lib/i18n";

type PageState = "loading" | "ready" | "accepting" | "rejecting" | "accepted" | "rejected" | "error";

export default function AcceptInvitationPage() {
  const router = useRouter();
  const { t } = useTranslation();
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
        setErrorMsg(result.error.message ?? t("team.accept.acceptFailed"));
        setState("error");
        return;
      }
      setState("accepted");
      toast.success(t("team.accept.welcomeToast"));
      setTimeout(() => router.push("/"), 1500);
    } catch {
      setErrorMsg(t("team.accept.genericError"));
      setState("error");
    }
  };

  const handleReject = async () => {
    setState("rejecting");
    try {
      const result = await authClient.organization.rejectInvitation({ invitationId });
      if (result.error) {
        setErrorMsg(result.error.message ?? t("team.accept.declineFailed"));
        setState("error");
        return;
      }
      setState("rejected");
      setTimeout(() => router.push("/"), 1500);
    } catch {
      setErrorMsg(t("team.accept.genericError"));
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
              <p className="text-sm text-muted-foreground">{t("team.accept.loading")}</p>
            </div>
          )}

          {(state === "ready" || state === "accepting" || state === "rejecting") && (
            <>
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="size-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                  <Building2 className="size-6" />
                </div>
                <div>
                  <h1 className="text-lg font-semibold">{t("team.accept.title")}</h1>
                  <p className="text-sm text-muted-foreground mt-1">
                    {orgName
                      ? t("team.accept.subtitleWithOrg").replace("{org}", orgName)
                      : t("team.accept.subtitleGeneric")}
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
                  {t("team.accept.decline")}
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleAccept}
                  disabled={state === "accepting" || state === "rejecting"}
                >
                  {state === "accepting" && <Loader2 className="size-4 animate-spin" />}
                  {t("team.accept.accept")}
                </Button>
              </div>
            </>
          )}

          {state === "accepted" && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <CheckCircle className="size-10 text-emerald-500" />
              <p className="text-sm font-medium">{t("team.accept.joinedTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("team.accept.joinedRedirect")}</p>
            </div>
          )}

          {state === "rejected" && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <XCircle className="size-10 text-muted-foreground" />
              <p className="text-sm font-medium">{t("team.accept.declinedTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("team.accept.declinedRedirect")}</p>
            </div>
          )}

          {state === "error" && (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <XCircle className="size-10 text-destructive" />
              <div>
                <p className="text-sm font-medium text-destructive">{t("team.accept.errorTitle")}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {errorMsg ?? t("team.accept.errorFallback")}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => router.push("/")}>
                {t("team.accept.goHome")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
