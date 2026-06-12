"use client";

import { useSyncExternalStore } from "react";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

// Accounts (name, email, password) live in SayKnowWork SaaS — login is delegated
// there. Editing them locally would only touch the shadow record and get
// overwritten on the next login, so this tab is read-only and points the user
// to SayKnowWork to manage their account / reset their password.
const SAYKNOWWORK_URL = "https://sayknowwork.ai-ops.click";

export function ProfileTab() {
  const { data: session, isPending } = useSession();
  const { t } = useTranslation();
  // useSession resolves from a client-side cache, so the first client render can
  // differ from the server's. Gate on `mounted` (true only after hydration) to
  // avoid a hydration mismatch — using useSyncExternalStore keeps it lint-clean.
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);

  if (!mounted || isPending) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="size-16 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
        <Skeleton className="h-20 w-full rounded-xl" />
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

      <div className="rounded-xl border border-border p-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          {t("profile.managedBySayKnowWork")}
        </p>
        <Button asChild variant="outline">
          <a href={SAYKNOWWORK_URL} target="_blank" rel="noopener noreferrer">
            {t("profile.manageOnSayKnowWork")}
            <ExternalLink className="size-4" />
          </a>
        </Button>
      </div>
    </div>
  );
}
