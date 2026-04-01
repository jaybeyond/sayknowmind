"use client";

import { useEffect, useState } from "react";

/**
 * Client-side auth gate. Checks session via /api/auth/get-session
 * and renders authenticated or guest content accordingly.
 * Avoids async server components that trigger streaming SSR issues on HTTP/2 proxies.
 */
export function AuthGate({
  authenticated,
  guest,
}: {
  authenticated: React.ReactNode;
  guest: React.ReactNode;
}) {
  const [state, setState] = useState<"loading" | "authed" | "guest">("loading");

  useEffect(() => {
    fetch("/api/auth/get-session")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setState(data?.session ? "authed" : "guest");
      })
      .catch(() => setState("guest"));
  }, []);

  if (state === "loading") {
    return (
      <div className="min-h-svh flex items-center justify-center bg-background">
        <div className="size-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <>{state === "authed" ? authenticated : guest}</>;
}
