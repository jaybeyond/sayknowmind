"use client";

import * as React from "react";
import Image from "next/image";
import { useParams } from "next/navigation";
import {
  Lock,
  Globe,
  AlertTriangle,
  Clock,
  BookOpen,
  ArrowLeft,
  Copy,
  Check,
  ExternalLink,
  Tag,
  Lightbulb,
  FileText,
  Link2,
} from "lucide-react";

interface ShareData {
  title?: string;
  summary?: string;
  content?: string | null;
  url?: string;
  sourceType?: string;
  ogImage?: string;
  aiSummary?: string;
  whatItSolves?: string;
  keyPoints?: string[];
  readingTimeMinutes?: number;
  tags?: string[];
  accessType?: string;
  passphraseRequired?: boolean;
  expiresAt?: string;
  error?: string;
  message?: string;
  fallback?: boolean;
}

/** Split plain-text content into paragraphs, preserving blank-line breaks. */
function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Extract domain from URL for display */
function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default function ShareViewPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = React.useState<ShareData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [passphrase, setPassphrase] = React.useState("");
  const [passphraseError, setPassphraseError] = React.useState(false);
  const [unlocking, setUnlocking] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const fetchShare = React.useCallback(
    async (pass?: string) => {
      setLoading(true);
      try {
        const url = new URL(`/api/share/view/${token}`, window.location.origin);
        if (pass) url.searchParams.set("passphrase", pass);
        const res = await fetch(url.toString());
        const json = await res.json();

        if (res.status === 404) {
          setData({ error: "not_found" });
        } else if (res.status === 410) {
          setData({ error: json.error, title: json.title, message: json.message });
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
    },
    [token, data?.title],
  );

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

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available */
    }
  };

  // Loading
  if (loading && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/20">
        <div className="flex flex-col items-center gap-4">
          <div className="relative size-12">
            <div className="absolute inset-0 rounded-full border-2 border-muted" />
            <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
          <p className="text-sm text-muted-foreground animate-pulse">
            Loading shared content...
          </p>
        </div>
      </div>
    );
  }

  // Error: not found
  if (data?.error === "not_found") {
    return (
      <ErrorPage
        icon={<AlertTriangle className="size-12 text-muted-foreground/40" />}
        title="Share not found"
        description="This link may have been removed or never existed."
      />
    );
  }

  // Error: revoked or expired
  if (data?.error === "revoked" || data?.error === "expired") {
    return (
      <ErrorPage
        icon={<AlertTriangle className="size-12 text-amber-500/60" />}
        title={data.title ?? "Share unavailable"}
        description={data.message ?? `This share has been ${data.error}.`}
      />
    );
  }

  // Error: network
  if (data?.error === "network") {
    return (
      <ErrorPage
        icon={<AlertTriangle className="size-12 text-destructive/40" />}
        title="Connection error"
        description="Could not load this share. Please try again later."
      />
    );
  }

  // Passphrase prompt
  if (data?.passphraseRequired && !data.content) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/20 p-4">
        <div className="w-full max-w-sm">
          <div className="rounded-2xl border bg-card shadow-lg p-8 space-y-6">
            <div className="text-center">
              <div className="inline-flex items-center justify-center size-14 rounded-full bg-amber-500/10 mb-4">
                <Lock className="size-7 text-amber-500" />
              </div>
              <h1 className="text-xl font-semibold tracking-tight">
                {data.title ?? "Protected share"}
              </h1>
              <p className="text-sm text-muted-foreground mt-1.5">
                Enter the passphrase to view this content
              </p>
            </div>
            <form onSubmit={handleUnlock} className="space-y-3">
              <input
                type="password"
                value={passphrase}
                onChange={(e) => {
                  setPassphrase(e.target.value);
                  setPassphraseError(false);
                }}
                placeholder="Passphrase"
                className="flex w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-shadow"
                autoFocus
              />
              {passphraseError && (
                <p className="text-sm text-destructive flex items-center gap-1.5">
                  <AlertTriangle className="size-3.5" />
                  Incorrect passphrase
                </p>
              )}
              <button
                type="submit"
                disabled={unlocking || !passphrase.trim()}
                className="inline-flex items-center justify-center w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {unlocking ? (
                  <>
                    <div className="size-4 mr-2 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin" />
                    Unlocking...
                  </>
                ) : (
                  "Unlock"
                )}
              </button>
            </form>
          </div>
          <BrandFooter />
        </div>
      </div>
    );
  }

  // ---- Content View ----
  // Use aiSummary (from metadata.summary) if available, else DB summary
  const displaySummary = data?.aiSummary || data?.summary;
  const contentParagraphs = data?.content ? splitParagraphs(data.content) : [];
  const readingTime = data?.readingTimeMinutes ?? 0;
  const hasTags = data?.tags && data.tags.length > 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-md">
        <div className="max-w-3xl mx-auto flex items-center justify-between px-4 h-12">
          <a
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            SayKnowMind
          </a>
          <button
            onClick={handleCopyLink}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1.5 rounded-md hover:bg-muted"
          >
            {copied ? (
              <>
                <Check className="size-3.5 text-green-500" />
                Copied
              </>
            ) : (
              <>
                <Copy className="size-3.5" />
                Copy link
              </>
            )}
          </button>
        </div>
      </header>

      {/* Article */}
      <article className="max-w-3xl mx-auto px-4 py-10 md:py-16">
        {/* Meta badges */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mb-6">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted/60">
            {data?.accessType === "passphrase" ? (
              <Lock className="size-3" />
            ) : (
              <Globe className="size-3" />
            )}
            {data?.accessType === "passphrase" ? "Private" : "Public"}
          </span>
          {readingTime > 0 && (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" />
              {readingTime} min read
            </span>
          )}
          {data?.sourceType && (
            <span className="inline-flex items-center gap-1">
              <FileText className="size-3" />
              {data.sourceType === "file"
                ? "File"
                : data.sourceType === "text"
                  ? "Note"
                  : "Web"}
            </span>
          )}
          {data?.expiresAt && (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" />
              Expires {new Date(data.expiresAt).toLocaleDateString()}
            </span>
          )}
        </div>

        {/* OG Image */}
        {data?.ogImage && (
          <div className="relative w-full h-48 md:h-64 rounded-xl overflow-hidden mb-6 bg-muted">
            <Image
              src={data.ogImage}
              alt={data.title ?? ""}
              fill
              className="object-cover"
              unoptimized
            />
          </div>
        )}

        {/* Title */}
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight leading-tight mb-4">
          {data?.title}
        </h1>

        {/* Original URL */}
        {data?.url && (
          <a
            href={data.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline mb-6 max-w-full"
          >
            <Link2 className="size-3.5 shrink-0" />
            <span className="truncate">{getDomain(data.url)}</span>
            <ExternalLink className="size-3 shrink-0" />
          </a>
        )}

        {/* Tags */}
        {hasTags && (
          <div className="flex flex-wrap items-center gap-1.5 mb-6">
            <Tag className="size-3.5 text-muted-foreground" />
            {data!.tags!.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* AI Summary card */}
        {displaySummary && (
          <div className="rounded-xl border bg-card/50 p-5 mb-6">
            <div className="flex items-start gap-3">
              <div className="shrink-0 mt-0.5">
                <BookOpen className="size-4 text-primary/60" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                  Summary
                </p>
                <p className="text-sm leading-relaxed text-foreground/90">
                  {displaySummary}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* What it solves */}
        {data?.whatItSolves && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 mb-6">
            <div className="flex items-start gap-3">
              <div className="shrink-0 mt-0.5">
                <Lightbulb className="size-4 text-amber-500" />
              </div>
              <div>
                <p className="text-xs font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wider mb-1.5">
                  What it solves
                </p>
                <p className="text-sm leading-relaxed text-foreground/90">
                  {data.whatItSolves}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Key points */}
        {data?.keyPoints && data.keyPoints.length > 0 && (
          <div className="rounded-xl border bg-card/50 p-5 mb-6">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Key Points
            </p>
            <ul className="space-y-2">
              {data.keyPoints.map((point, i) => (
                <li key={i} className="flex gap-3 text-sm leading-relaxed">
                  <span className="shrink-0 inline-flex items-center justify-center size-5 rounded-full bg-primary/10 text-primary text-xs font-medium mt-0.5">
                    {i + 1}
                  </span>
                  <span className="text-foreground/90">{point}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Divider before main content */}
        {(displaySummary ||
          data?.whatItSolves ||
          (data?.keyPoints && data.keyPoints.length > 0)) &&
          contentParagraphs.length > 0 && (
            <hr className="border-border/50 mb-8" />
          )}

        {/* Content body */}
        {contentParagraphs.length > 0 && (
          <div className="space-y-5">
            {contentParagraphs.map((para, i) => (
              <p
                key={i}
                className="text-base leading-7 text-foreground/85"
              >
                {para}
              </p>
            ))}
          </div>
        )}

        {data?.fallback && !data.content && (
          <div className="rounded-xl border border-dashed border-amber-500/30 bg-amber-500/5 p-6 text-center">
            <AlertTriangle className="size-8 text-amber-500/50 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Content is temporarily unavailable. Please try again later.
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="mt-16">
          <hr className="border-border/50 mb-6" />
          <BrandFooter />
        </div>
      </article>
    </div>
  );
}

function ErrorPage({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/20 p-4">
      <div className="text-center max-w-sm">
        <div className="mb-5">{icon}</div>
        <h1 className="text-xl font-semibold tracking-tight mb-2">{title}</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {description}
        </p>
        <a
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline mt-6"
        >
          <ArrowLeft className="size-3.5" />
          Go to SayKnowMind
        </a>
      </div>
    </div>
  );
}

function BrandFooter() {
  return (
    <div className="flex items-center justify-center gap-2 py-4">
      <span className="text-xs text-muted-foreground/60">Shared via</span>
      <a
        href="/"
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        SayKnowMind
        <ExternalLink className="size-3" />
      </a>
    </div>
  );
}
