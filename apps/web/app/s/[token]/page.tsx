"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { Lock, Globe, AlertTriangle, FileText } from "lucide-react";

interface ShareData {
  title?: string;
  summary?: string;
  content?: string | null;
  keyPoints?: string[];
  accessType?: string;
  passphraseRequired?: boolean;
  expiresAt?: string;
  error?: string;
  message?: string;
  fallback?: boolean;
}

export default function ShareViewPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = React.useState<ShareData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [passphrase, setPassphrase] = React.useState("");
  const [passphraseError, setPassphraseError] = React.useState(false);
  const [unlocking, setUnlocking] = React.useState(false);

  const fetchShare = React.useCallback(async (pass?: string) => {
    setLoading(true);
    try {
      const url = new URL(`/api/share/view/${token}`, window.location.origin);
      if (pass) url.searchParams.set("passphrase", pass);
      const res = await fetch(url.toString());
      const json = await res.json();

      if (res.status === 404) {
        setData({ error: "not_found" });
      } else if (res.status === 410) {
        setData({ error: json.error, title: json.title });
      } else if (res.status === 403) {
        setPassphraseError(true);
        setData({ passphraseRequired: true, title: json.title ?? data?.title });
      } else if (json.passphraseRequired) {
        setData(json);
      } else {
        setData(json);
      }
    } catch {
      setData({ error: "network" });
    } finally {
      setLoading(false);
      setUnlocking(false);
    }
  }, [token, data?.title]);

  React.useEffect(() => {
    if (token) fetchShare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase.trim()) return;
    setPassphraseError(false);
    setUnlocking(true);
    fetchShare(passphrase);
  };

  // Loading
  if (loading && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse flex flex-col items-center gap-3">
          <div className="size-10 rounded-full bg-muted" />
          <div className="h-4 w-32 rounded bg-muted" />
        </div>
      </div>
    );
  }

  // Error states
  if (data?.error === "not_found") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center max-w-sm">
          <AlertTriangle className="size-12 text-muted-foreground/30 mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">Share not found</h1>
          <p className="text-sm text-muted-foreground">
            This link may have been removed or never existed.
          </p>
        </div>
      </div>
    );
  }

  if (data?.error === "revoked" || data?.error === "expired") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center max-w-sm">
          <AlertTriangle className="size-12 text-amber-500/40 mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">{data.title ?? "Share unavailable"}</h1>
          <p className="text-sm text-muted-foreground">{data.message}</p>
        </div>
      </div>
    );
  }

  if (data?.error === "network") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center max-w-sm">
          <AlertTriangle className="size-12 text-destructive/30 mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">Connection error</h1>
          <p className="text-sm text-muted-foreground">Could not load this share. Please try again.</p>
        </div>
      </div>
    );
  }

  // Passphrase prompt
  if (data?.passphraseRequired && !data.content) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <Lock className="size-10 text-amber-500 mx-auto mb-3" />
            <h1 className="text-xl font-semibold">{data.title ?? "Protected share"}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Enter the passphrase to view this content
            </p>
          </div>
          <form onSubmit={handleUnlock} className="space-y-3">
            <input
              type="password"
              value={passphrase}
              onChange={(e) => { setPassphrase(e.target.value); setPassphraseError(false); }}
              placeholder="Passphrase"
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              autoFocus
            />
            {passphraseError && (
              <p className="text-sm text-destructive">Incorrect passphrase</p>
            )}
            <button
              type="submit"
              disabled={unlocking || !passphrase.trim()}
              className="inline-flex items-center justify-center w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {unlocking ? "Unlocking..." : "Unlock"}
            </button>
          </form>
          <p className="text-xs text-center text-muted-foreground">
            Shared via SayKnowMind
          </p>
        </div>
      </div>
    );
  }

  // Content view
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8 md:py-16">
        {/* Header */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-6">
          {data?.accessType === "passphrase" ? (
            <Lock className="size-3.5" />
          ) : (
            <Globe className="size-3.5" />
          )}
          <span>Shared via SayKnowMind</span>
        </div>

        {/* Title */}
        <h1 className="text-2xl md:text-3xl font-bold mb-4">{data?.title}</h1>

        {/* Summary */}
        {data?.summary && (
          <div className="rounded-lg border bg-muted/30 p-4 mb-6">
            <p className="text-sm text-muted-foreground leading-relaxed">{data.summary}</p>
          </div>
        )}

        {/* Key points */}
        {data?.keyPoints && data.keyPoints.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
              <FileText className="size-4" />
              Key Points
            </h2>
            <ul className="space-y-1.5">
              {data.keyPoints.map((point, i) => (
                <li key={i} className="text-sm text-muted-foreground flex gap-2">
                  <span className="text-primary mt-0.5 shrink-0">•</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Content */}
        {data?.content && (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <div className="whitespace-pre-wrap text-sm leading-relaxed">
              {data.content}
            </div>
          </div>
        )}

        {data?.fallback && !data.content && (
          <p className="text-sm text-muted-foreground italic">
            Content is temporarily unavailable. Please try again later.
          </p>
        )}
      </div>
    </div>
  );
}
