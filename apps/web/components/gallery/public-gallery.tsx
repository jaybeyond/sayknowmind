"use client";

import * as React from "react";
import { Brain, Globe, LogIn, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation, useI18nStore, localeNames, type Locale } from "@/lib/i18n";
import { AuthModal } from "@/components/auth/auth-modal";
import { GalleryCard, type GalleryItem } from "./gallery-card";

const PAGE_SIZE = 24;

export function PublicGallery() {
  const { t } = useTranslation();
  const [items, setItems] = React.useState<GalleryItem[]>([]);
  const [total, setTotal] = React.useState(0);
  const [hasMore, setHasMore] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const sentinelRef = React.useRef<HTMLDivElement>(null);

  const [authOpen, setAuthOpen] = React.useState(false);
  const [authMode, setAuthMode] = React.useState<"login" | "signup">("login");
  const [langOpen, setLangOpen] = React.useState(false);
  const { locale, setLocale } = useI18nStore();

  const openLogin = () => {
    setAuthMode("login");
    setAuthOpen(true);
  };
  const openSignup = () => {
    setAuthMode("signup");
    setAuthOpen(true);
  };

  // Initial fetch
  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/share/gallery?limit=${PAGE_SIZE}&offset=0`);
        if (res.ok) {
          const data = await res.json();
          setItems(data.items);
          setTotal(data.total);
          setHasMore(data.hasMore);
        }
      } catch {
        /* network error */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Infinite scroll
  const loadMore = React.useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/share/gallery?limit=${PAGE_SIZE}&offset=${items.length}`,
      );
      if (res.ok) {
        const data = await res.json();
        setItems((prev) => [...prev, ...data.items]);
        setHasMore(data.hasMore);
      }
    } catch {
      /* network error */
    } finally {
      setLoadingMore(false);
    }
  }, [items.length, hasMore, loadingMore]);

  React.useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore();
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-4 md:px-6 h-14">
          <div className="flex items-center gap-2">
            <img src="/app-icon.png" alt="SayknowMind" className="size-7 rounded-lg" />
            <img src="/logo-text.svg" alt="SayknowMind" className="h-4 hidden sm:block invert dark:invert-0" />
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Button variant="ghost" size="sm" onClick={() => setLangOpen(!langOpen)}>
                <Globe className="size-4 mr-1.5" />
                {localeNames[locale]}
              </Button>
              {langOpen && (
                <div className="absolute right-0 top-full mt-1 bg-popover border rounded-md shadow-md py-1 z-50 min-w-[120px]">
                  {(Object.entries(localeNames) as [Locale, string][]).map(([code, name]) => (
                    <button
                      key={code}
                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors ${
                        locale === code ? "text-primary font-medium" : ""
                      }`}
                      onClick={() => { setLocale(code); setLangOpen(false); }}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={openLogin}>
              <LogIn className="size-4 mr-1.5" />
              {t("auth.login")}
            </Button>
            <Button size="sm" onClick={openSignup}>
              <UserPlus className="size-4 mr-1.5" />
              {t("auth.signup")}
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-7xl mx-auto px-4 md:px-6 pt-12 pb-8 text-center">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">
          {t("gallery.hero")}
        </h1>
        <p className="text-muted-foreground max-w-lg mx-auto mb-2">
          {t("gallery.heroSubtitle")}
        </p>
        {total > 0 && (
          <p className="text-sm text-muted-foreground">
            {t("gallery.sharedCount").replace("{{count}}", String(total))}
          </p>
        )}
      </section>

      {/* Grid */}
      <main className="max-w-7xl mx-auto px-4 md:px-6 pb-16">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border bg-card overflow-hidden animate-pulse"
              >
                <div className="h-32 bg-muted" />
                <div className="p-4 space-y-2">
                  <div className="h-4 w-3/4 rounded bg-muted" />
                  <div className="h-3 w-full rounded bg-muted" />
                  <div className="h-3 w-1/2 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Brain className="size-16 text-muted-foreground/20 mb-4" />
            <h2 className="text-xl font-semibold mb-2">
              {t("gallery.noShares")}
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              {t("gallery.loginToSave")}
            </p>
            <Button onClick={openSignup}>
              <UserPlus className="size-4 mr-1.5" />
              {t("auth.signup")}
            </Button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {items.map((item) => (
                <GalleryCard key={item.shareToken} item={item} />
              ))}
            </div>

            {/* Loading more indicator */}
            {loadingMore && (
              <div className="flex justify-center py-8">
                <div className="size-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              </div>
            )}

            {/* Sentinel for infinite scroll */}
            {hasMore && <div ref={sentinelRef} className="h-1" />}
          </>
        )}
      </main>

      {/* Auth modal */}
      <AuthModal
        open={authOpen}
        onOpenChange={setAuthOpen}
        defaultMode={authMode}
      />
    </div>
  );
}
