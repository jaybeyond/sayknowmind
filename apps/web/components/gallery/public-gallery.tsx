"use client";

import * as React from "react";
import { Brain, Globe, LogIn, Search, UserPlus, X, Zap, Database, Network, TrendingUp, BookOpen, Sparkles, FileText, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

  // Search & filter
  const [searchQuery, setSearchQuery] = React.useState("");
  const [activeSearch, setActiveSearch] = React.useState("");
  const [selectedCategory, setSelectedCategory] = React.useState<string | null>(null);
  const [categories, setCategories] = React.useState<{ id: string; name: string; count: number }[]>([]);
  const searchTimeoutRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);

  const openLogin = () => {
    setAuthMode("login");
    setAuthOpen(true);
  };
  const openSignup = () => {
    setAuthMode("signup");
    setAuthOpen(true);
  };

  // Build query URL
  const buildUrl = React.useCallback((offset: number) => {
    const sp = new URLSearchParams();
    sp.set("limit", String(PAGE_SIZE));
    sp.set("offset", String(offset));
    if (activeSearch) sp.set("q", activeSearch);
    if (selectedCategory) sp.set("categoryId", selectedCategory);
    return `/api/share/gallery?${sp.toString()}`;
  }, [activeSearch, selectedCategory]);

  // Fetch items (resets on search/category change)
  React.useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(buildUrl(0));
        if (res.ok) {
          const data = await res.json();
          setItems(data.items);
          setTotal(data.total);
          setHasMore(data.hasMore);
          if (data.categories) setCategories(data.categories);
        }
      } catch { /* network error */ }
      finally { setLoading(false); }
    })();
  }, [buildUrl]);

  // Debounced search
  const handleSearch = (value: string) => {
    setSearchQuery(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => setActiveSearch(value), 400);
  };

  // Infinite scroll
  const loadMore = React.useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(buildUrl(items.length));
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
            <img src="/logo-icon.svg" alt="SayknowMind" className="size-7 rounded-lg" />
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

      {/* Search engine style — centered when no results, top when results exist */}
      <section className={`max-w-5xl mx-auto px-4 md:px-6 transition-all duration-500 ${
        !loading && items.length === 0 && !activeSearch ? "pt-[20vh] pb-8" : "pt-6 pb-4"
      }`}>
        {/* Logo + Search */}
        <div className={`flex flex-col items-center gap-6 transition-all duration-500 ${
          !loading && items.length === 0 && !activeSearch ? "mb-8" : "mb-4"
        }`}>
          {(!loading && items.length === 0 && !activeSearch) && (
            <img src="/logo-text.svg" alt="SayknowMind" className="h-8 md:h-10 invert dark:invert-0" />
          )}

          {/* Search bar */}
          <div className={`relative w-full transition-all duration-300 ${
            !loading && items.length === 0 && !activeSearch ? "max-w-2xl" : "max-w-3xl"
          }`}>
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder={t("gallery.searchPlaceholder")}
              className={`pl-11 pr-10 rounded-full border-muted-foreground/20 ${
                !loading && items.length === 0 && !activeSearch ? "h-12 text-base" : "h-10"
              }`}
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(""); setActiveSearch(""); }}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>

        {/* Category pills */}
        {categories.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            <button
              onClick={() => setSelectedCategory(null)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                !selectedCategory
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("filter.all")}
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(selectedCategory === cat.id ? null : cat.id)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  selectedCategory === cat.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
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
          <EmptyHero onSignup={openSignup} />
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

// ---------------------------------------------------------------------------
// Empty Hero — knowledge graph visualization with mock data
// ---------------------------------------------------------------------------

const MOCK_NODES = [
  { x: 15, y: 20, size: 6, label: "AI", color: "bg-blue-500" },
  { x: 35, y: 35, size: 8, label: "ML", color: "bg-violet-500" },
  { x: 55, y: 15, size: 5, label: "NLP", color: "bg-cyan-500" },
  { x: 75, y: 30, size: 7, label: "RAG", color: "bg-emerald-500" },
  { x: 25, y: 60, size: 5, label: "LLM", color: "bg-amber-500" },
  { x: 50, y: 50, size: 9, label: "Knowledge", color: "bg-primary" },
  { x: 70, y: 60, size: 5, label: "Graph", color: "bg-pink-500" },
  { x: 85, y: 45, size: 4, label: "API", color: "bg-orange-500" },
  { x: 40, y: 75, size: 6, label: "Vector", color: "bg-teal-500" },
  { x: 65, y: 80, size: 5, label: "Search", color: "bg-indigo-500" },
];

const MOCK_EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [1, 5], [4, 5], [5, 6], [3, 7], [5, 8], [8, 9], [6, 9], [0, 4], [3, 6],
];

const MOCK_STATS = [
  { icon: Database, value: "12.4K", label: "Documents" },
  { icon: Network, value: "847", label: "Connections" },
  { icon: Zap, value: "2.1M", label: "Embeddings" },
  { icon: TrendingUp, value: "99.2%", label: "Accuracy" },
];

const MOCK_CARDS = [
  { title: "Transformer Architecture Deep Dive", tags: ["AI", "ML", "Architecture"], icon: BookOpen, color: "from-blue-500/10 to-violet-500/10", minutes: 8 },
  { title: "Building RAG Pipelines at Scale", tags: ["RAG", "Vector", "Search"], icon: Sparkles, color: "from-emerald-500/10 to-cyan-500/10", minutes: 12 },
  { title: "Knowledge Graph Fundamentals", tags: ["Graph", "NLP", "Data"], icon: Network, color: "from-amber-500/10 to-orange-500/10", minutes: 5 },
  { title: "LLM Fine-tuning Best Practices", tags: ["LLM", "ML", "Training"], icon: FileText, color: "from-pink-500/10 to-rose-500/10", minutes: 15 },
  { title: "Vector Database Comparison 2026", tags: ["Vector", "DB", "Benchmark"], icon: Database, color: "from-indigo-500/10 to-blue-500/10", minutes: 10 },
  { title: "Multi-Agent System Design", tags: ["Agent", "AI", "System"], icon: Link2, color: "from-teal-500/10 to-emerald-500/10", minutes: 7 },
];

function EmptyHero({ onSignup }: { onSignup: () => void }) {
  const { t } = useTranslation();

  return (
    <div className="space-y-12">
      {/* Knowledge Graph Visualization */}
      <div className="relative w-full h-[280px] rounded-2xl border bg-card/50 overflow-hidden">
        {/* Animated gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-violet-500/5" />

        {/* SVG edges */}
        <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
          {MOCK_EDGES.map(([from, to], i) => (
            <line
              key={i}
              x1={`${MOCK_NODES[from].x}%`}
              y1={`${MOCK_NODES[from].y}%`}
              x2={`${MOCK_NODES[to].x}%`}
              y2={`${MOCK_NODES[to].y}%`}
              className="stroke-muted-foreground/10"
              strokeWidth="1"
            />
          ))}
        </svg>

        {/* Nodes */}
        {MOCK_NODES.map((node, i) => (
          <div
            key={i}
            className="absolute flex items-center gap-1.5 animate-pulse"
            style={{
              left: `${node.x}%`,
              top: `${node.y}%`,
              transform: "translate(-50%, -50%)",
              animationDelay: `${i * 300}ms`,
              animationDuration: `${2 + (i % 3)}s`,
            }}
          >
            <div
              className={`rounded-full ${node.color} opacity-80`}
              style={{ width: `${node.size * 2}px`, height: `${node.size * 2}px` }}
            />
            <span className="text-[10px] font-medium text-muted-foreground/60 whitespace-nowrap">
              {node.label}
            </span>
          </div>
        ))}

        {/* Center CTA overlay */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="rounded-2xl bg-background/80 backdrop-blur-sm border shadow-lg px-8 py-5 text-center">
            <Brain className="size-8 text-primary mx-auto mb-2" />
            <h2 className="text-lg font-bold tracking-tight mb-1">Your Second Brain Awaits</h2>
            <p className="text-xs text-muted-foreground mb-3">Save, connect, and discover knowledge with AI</p>
            <Button size="sm" onClick={onSignup}>
              <UserPlus className="size-3.5 mr-1.5" />
              {t("auth.signup")}
            </Button>
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {MOCK_STATS.map((stat) => (
          <div key={stat.label} className="flex items-center gap-3 rounded-xl border bg-card/50 px-4 py-3">
            <div className="size-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <stat.icon className="size-4 text-primary" />
            </div>
            <div>
              <p className="text-lg font-bold tracking-tight">{stat.value}</p>
              <p className="text-[11px] text-muted-foreground">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Mock cards grid */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-3">Trending Knowledge</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {MOCK_CARDS.map((card) => (
            <div
              key={card.title}
              className="group relative rounded-xl border bg-card overflow-hidden opacity-75 hover:opacity-100 transition-opacity cursor-default"
            >
              <div className={`h-24 bg-gradient-to-br ${card.color} flex items-center justify-center`}>
                <card.icon className="size-8 text-muted-foreground/20" />
              </div>
              <div className="p-3 space-y-1.5">
                <h4 className="text-sm font-medium line-clamp-1">{card.title}</h4>
                <div className="flex items-center gap-1.5">
                  {card.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground">{card.minutes} min read</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
