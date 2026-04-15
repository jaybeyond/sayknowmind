"use client";

import * as React from "react";
import { Brain, Globe, LogIn, Search, UserPlus, X, Database, Network, BookOpen, Sparkles, FileText, Link2 } from "lucide-react";
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
    <div className="min-h-screen">
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
// Empty Hero — full-page neural network + i18n mock cards
// ---------------------------------------------------------------------------

// Generate ultra-dense neural nodes (250+)
function generateNeuralNodes(count: number) {
  const nodes: { x: number; y: number; size: number; color: string }[] = [];
  const colors = [
    "bg-primary", "bg-primary", "bg-primary",
    "bg-muted-foreground", "bg-muted-foreground",
    "bg-primary/80", "bg-primary/60",
  ];
  let seed = 42;
  const rand = () => { seed = (seed * 16807 + 0) % 2147483647; return (seed - 1) / 2147483646; };

  for (let i = 0; i < count; i++) {
    nodes.push({
      x: 1 + rand() * 98,
      y: 1 + rand() * 98,
      size: 1.5 + rand() * 4.5,
      color: colors[Math.floor(rand() * colors.length)],
    });
  }
  return nodes;
}

function generateNeuralEdges(nodeCount: number) {
  const edges: [number, number][] = [];
  let seed = 99;
  const rand = () => { seed = (seed * 16807 + 0) % 2147483647; return (seed - 1) / 2147483646; };

  for (let i = 0; i < nodeCount; i++) {
    const connections = 1 + Math.floor(rand() * 4);
    for (let c = 0; c < connections; c++) {
      // Prefer connecting to nearby nodes for cluster effect
      const offset = 1 + Math.floor(rand() * Math.min(20, nodeCount));
      const target = (i + offset) % nodeCount;
      if (target !== i) edges.push([i, target]);
    }
  }
  return edges;
}

const NEURAL_NODES = generateNeuralNodes(250);
const NEURAL_EDGES = generateNeuralEdges(NEURAL_NODES.length);

const MOCK_CARDS_I18N: Record<string, { title: string; tags: string[]; minutes: number }[]> = {
  en: [
    { title: "Transformer Architecture Deep Dive", tags: ["AI", "ML", "Architecture"], minutes: 8 },
    { title: "Building RAG Pipelines at Scale", tags: ["RAG", "Vector", "Search"], minutes: 12 },
    { title: "Knowledge Graph Fundamentals", tags: ["Graph", "NLP", "Data"], minutes: 5 },
    { title: "LLM Fine-tuning Best Practices", tags: ["LLM", "ML", "Training"], minutes: 15 },
    { title: "Vector Database Comparison 2026", tags: ["Vector", "DB", "Benchmark"], minutes: 10 },
    { title: "Multi-Agent System Design", tags: ["Agent", "AI", "System"], minutes: 7 },
  ],
  ko: [
    { title: "트랜스포머 아키텍처 심층 분석", tags: ["AI", "ML", "아키텍처"], minutes: 8 },
    { title: "대규모 RAG 파이프라인 구축", tags: ["RAG", "벡터", "검색"], minutes: 12 },
    { title: "지식 그래프 기초", tags: ["그래프", "NLP", "데이터"], minutes: 5 },
    { title: "LLM 파인튜닝 모범 사례", tags: ["LLM", "ML", "학습"], minutes: 15 },
    { title: "벡터 데이터베이스 비교 2026", tags: ["벡터", "DB", "벤치마크"], minutes: 10 },
    { title: "멀티 에이전트 시스템 설계", tags: ["에이전트", "AI", "시스템"], minutes: 7 },
  ],
  zh: [
    { title: "Transformer 架构深度解析", tags: ["AI", "ML", "架构"], minutes: 8 },
    { title: "大规模 RAG 管道构建", tags: ["RAG", "向量", "搜索"], minutes: 12 },
    { title: "知识图谱基础", tags: ["图谱", "NLP", "数据"], minutes: 5 },
    { title: "LLM 微调最佳实践", tags: ["LLM", "ML", "训练"], minutes: 15 },
    { title: "向量数据库对比 2026", tags: ["向量", "DB", "基准"], minutes: 10 },
    { title: "多智能体系统设计", tags: ["智能体", "AI", "系统"], minutes: 7 },
  ],
  ja: [
    { title: "Transformerアーキテクチャ詳解", tags: ["AI", "ML", "設計"], minutes: 8 },
    { title: "大規模RAGパイプライン構築", tags: ["RAG", "ベクトル", "検索"], minutes: 12 },
    { title: "ナレッジグラフの基礎", tags: ["グラフ", "NLP", "データ"], minutes: 5 },
    { title: "LLMファインチューニング実践", tags: ["LLM", "ML", "学習"], minutes: 15 },
    { title: "ベクトルDB比較 2026", tags: ["ベクトル", "DB", "ベンチ"], minutes: 10 },
    { title: "マルチエージェントシステム設計", tags: ["エージェント", "AI", "システム"], minutes: 7 },
  ],
};

const CARD_ICONS = [BookOpen, Sparkles, Network, FileText, Database, Link2];
const CARD_COLORS = [
  "from-blue-500/10 to-violet-500/10",
  "from-emerald-500/10 to-cyan-500/10",
  "from-amber-500/10 to-orange-500/10",
  "from-pink-500/10 to-rose-500/10",
  "from-indigo-500/10 to-blue-500/10",
  "from-teal-500/10 to-emerald-500/10",
];

const HERO_TEXT: Record<string, { title: string; subtitle: string; desc: string; trending: string }> = {
  en: {
    title: "Every thought, connected.",
    subtitle: "The AI-native knowledge engine that thinks with you.",
    desc: "Capture anything. Let AI find the meaning. Build a living network of everything you know.",
    trending: "Explore Knowledge",
  },
  ko: {
    title: "모든 생각이 연결됩니다.",
    subtitle: "당신과 함께 사고하는 AI 네이티브 지식 엔진.",
    desc: "무엇이든 저장하세요. AI가 의미를 찾습니다. 당신이 아는 모든 것의 살아있는 네트워크를 구축하세요.",
    trending: "지식 탐색",
  },
  zh: {
    title: "每个想法，皆有连接。",
    subtitle: "与你共同思考的AI原生知识引擎。",
    desc: "捕获一切，让AI发现意义，构建你所知一切的活知识网络。",
    trending: "探索知识",
  },
  ja: {
    title: "すべての思考が、つながる。",
    subtitle: "あなたと共に考えるAIネイティブ知識エンジン。",
    desc: "何でも保存。AIが意味を見つけ、知識のネットワークを構築します。",
    trending: "知識を探索",
  },
};

function NeuralBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      {/* Vignette — bright center, dark edges */}
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse 20% 20% at 50% 45%, transparent 0%, black 45%)" }}
      />

      {/* Inline keyframes for floating animation */}
      <style>{`
        @keyframes neural-drift {
          0%, 100% { transform: translate(-50%, -50%) translate(0px, 0px); }
          25% { transform: translate(-50%, -50%) translate(var(--dx1), var(--dy1)); }
          50% { transform: translate(-50%, -50%) translate(var(--dx2), var(--dy2)); }
          75% { transform: translate(-50%, -50%) translate(var(--dx3), var(--dy3)); }
        }
      `}</style>

      {/* SVG edges — they move with nodes via CSS */}
      <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
        {NEURAL_EDGES.map(([from, to], i) => (
          <line
            key={i}
            x1={`${NEURAL_NODES[from].x}%`}
            y1={`${NEURAL_NODES[from].y}%`}
            x2={`${NEURAL_NODES[to].x}%`}
            y2={`${NEURAL_NODES[to].y}%`}
            className="stroke-primary/[0.07]"
            strokeWidth="0.5"
          />
        ))}
      </svg>

      {/* Floating nodes */}
      {NEURAL_NODES.map((node, i) => {
        // Each node gets unique drift offsets
        const seed = i * 7 + 13;
        const dx1 = ((seed * 3) % 30) - 15;
        const dy1 = ((seed * 5) % 24) - 12;
        const dx2 = ((seed * 7) % 26) - 13;
        const dy2 = ((seed * 11) % 20) - 10;
        const dx3 = ((seed * 13) % 28) - 14;
        const dy3 = ((seed * 17) % 22) - 11;

        return (
          <div
            key={i}
            className="absolute"
            style={{
              left: `${node.x}%`,
              top: `${node.y}%`,
              animation: `neural-drift ${8 + (i % 7) * 2}s ease-in-out infinite`,
              animationDelay: `${(i * 137) % 5000}ms`,
              "--dx1": `${dx1}px`,
              "--dy1": `${dy1}px`,
              "--dx2": `${dx2}px`,
              "--dy2": `${dy2}px`,
              "--dx3": `${dx3}px`,
              "--dy3": `${dy3}px`,
            } as React.CSSProperties}
          >
            <div
              className={`rounded-full ${node.color}`}
              style={{
                width: `${node.size * 2}px`,
                height: `${node.size * 2}px`,
                opacity: 0.15 + (node.size / 6) * 0.45,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

function EmptyHero({ onSignup }: { onSignup: () => void }) {
  const { locale } = useI18nStore();
  const lang = HERO_TEXT[locale] ? locale : "en";
  const hero = HERO_TEXT[lang];
  const cards = MOCK_CARDS_I18N[lang] ?? MOCK_CARDS_I18N.en;

  return (
    <>
      {/* Full-page fixed neural network background */}
      <NeuralBackground />

      {/* Hero text */}
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 -mt-8">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-medium mb-6 backdrop-blur-sm">
            <Brain className="size-3.5" />
            SayKnowMind
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-4 bg-gradient-to-r from-foreground via-foreground to-muted-foreground bg-clip-text">
            {hero.title}
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground font-medium mb-3">
            {hero.subtitle}
          </p>
          <p className="text-sm text-muted-foreground/70 max-w-lg mx-auto">
            {hero.desc}
          </p>
        </div>
      </div>

      {/* Trending cards — i18n */}
      <div className="pt-8 relative">
        <h3 className="text-sm font-medium text-muted-foreground mb-4">{hero.trending}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {cards.map((card, i) => {
            const Icon = CARD_ICONS[i % CARD_ICONS.length];
            const color = CARD_COLORS[i % CARD_COLORS.length];
            return (
              <div
                key={i}
                className="group relative rounded-xl border bg-card/80 backdrop-blur-sm overflow-hidden opacity-70 hover:opacity-100 transition-opacity cursor-default"
              >
                <div className={`h-24 bg-gradient-to-br ${color} flex items-center justify-center`}>
                  <Icon className="size-8 text-muted-foreground/20" />
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
            );
          })}
        </div>
      </div>
    </>
  );
}
