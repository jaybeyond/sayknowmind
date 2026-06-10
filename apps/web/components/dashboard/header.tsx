"use client";

import * as React from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { AddMemoryDialog } from "@/components/dashboard/add-memory-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Search,
  LayoutGrid,
  List,
  Plus,
  SlidersHorizontal,
  ArrowUpDown,
  Check,
  Zap,
  FileText,
  Network,
  FileSpreadsheet,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useMemoryStore } from "@/store/memory-store";
import { useCategoriesStore } from "@/store/categories-store";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/language-switcher";
import { NotificationBell } from "@/components/dashboard/notification-bell";
import { useRuntimeStore } from "@/store/runtime-store";
import { useRouter } from "next/navigation";

interface MemoryHeaderProps {
  /** Literal title (rarely used — prefer titleKey for i18n). */
  title?: string;
  /** i18n key for the page title, e.g. "sidebar.settings". Translated client-side. */
  titleKey?: string;
  showFilters?: boolean;
}

export function MemoryHeader({ title, titleKey, showFilters = true }: MemoryHeaderProps) {
  const [addOpen, setAddOpen] = React.useState(false);
  const router = useRouter();
  const setOpenEditor = useMemoryStore((s) => s.setOpenEditor);
  const openEditor = useMemoryStore((s) => s.openEditor);

  // Create + open in place (the header only renders on the dashboard home,
  // where the content area can host the editor).
  const handleCreate = React.useCallback(
    async (type: "doc" | "mindmap" | "sheet") => {
      try {
        const res = await fetch("/api/docs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type }),
        });
        if (!res.ok) return;
        const { id } = (await res.json()) as { id: string };
        // Spreadsheets open in the doc editor (which renders their seeded sheet tab);
        // only mindmaps use the mindmap editor.
        setOpenEditor({ type: type === "mindmap" ? "mindmap" : "doc", id });
      } catch {
        /* silent */
      }
    },
    [setOpenEditor],
  );
  const handleNewDoc = React.useCallback(() => handleCreate("doc"), [handleCreate]);
  const handleNewMindmap = React.useCallback(() => handleCreate("mindmap"), [handleCreate]);
  const handleNewSheet = React.useCallback(() => handleCreate("sheet"), [handleCreate]);

  // Listen for tray menu "add memory" event
  React.useEffect(() => {
    const handler = () => setAddOpen(true);
    window.addEventListener("sayknow-open-add-memory", handler);
    return () => window.removeEventListener("sayknow-open-add-memory", handler);
  }, []);
  const [usageOpen, setUsageOpen] = React.useState(false);
  const {
    viewMode,
    setViewMode,
    searchQuery,
    setSearchQuery,
    sortBy,
    setSortBy,
    filterType,
    setFilterType,
    selectedCollection,
    selectedTab,
    setSelectedCollection,
    setSelectedTab,
  } = useMemoryStore();
  const { categories } = useCategoriesStore();
  const { t } = useTranslation();

  // Daily usage limit — fetch on mount + listen for changes + poll every 30s
  const [usage, setUsage] = React.useState<{ used: number; limit: number; hasOwnKeys: boolean } | null>(null);
  const fetchUsage = React.useCallback(() => {
    fetch("/api/usage").then((r) => r.ok ? r.json() : null).then((data) => {
      if (data) setUsage({ used: data.used, limit: data.limit, hasOwnKeys: data.hasOwnKeys });
    }).catch(() => {});
  }, []);

  React.useEffect(() => {
    fetchUsage();
    // Poll every 30s for real-time updates
    const interval = setInterval(fetchUsage, 30_000);
    // Listen for custom event (fired after AI calls)
    const handler = () => fetchUsage();
    window.addEventListener("sayknow-usage-changed", handler);
    return () => { clearInterval(interval); window.removeEventListener("sayknow-usage-changed", handler); };
  }, [fetchUsage]);

  // Build breadcrumb segments for folder > tab navigation
  const breadcrumb = React.useMemo(() => {
    if (selectedCollection === "all") return null;
    const segments: Array<{ id: string; name: string }> = [];
    // Walk up parent chain
    let current = categories.find((c) => c.id === selectedCollection);
    while (current) {
      segments.unshift({ id: current.id, name: current.name });
      current = current.parent_id
        ? categories.find((c) => c.id === current!.parent_id)
        : undefined;
    }
    // Add tab if selected
    if (selectedTab) {
      const tab = categories.find((c) => c.id === selectedTab);
      if (tab) segments.push({ id: tab.id, name: tab.name });
    }
    return segments.length > 0 ? segments : null;
  }, [selectedCollection, selectedTab, categories]);

  const sortOptions = [
    { value: "date-newest", label: t("sort.dateNewest") },
    { value: "date-oldest", label: t("sort.dateOldest") },
    { value: "alpha-az", label: t("sort.alphaAZ") },
    { value: "alpha-za", label: t("sort.alphaZA") },
  ] as const;

  const filterOptions = [
    { value: "all", label: t("filter.all") },
    { value: "favorites", label: t("filter.favorites") },
    { value: "with-tags", label: t("filter.withTags") },
    { value: "without-tags", label: t("filter.withoutTags") },
  ] as const;

  const currentSort = sortOptions.find((opt) => opt.value === sortBy);
  const currentFilter = filterOptions.find((opt) => opt.value === filterType);

  // Page title: prefer the i18n key, fall back to a literal, then the default.
  const hasTitle = !!(title || titleKey);
  const displayTitle = titleKey ? t(titleKey) : (title ?? t("header.memory"));

  // When a doc / sheet / mind map is open in place on the dashboard, the editor
  // renders its own header (title + back), so this global header is redundant —
  // hide it. Other pages pass a `title`, so they keep their header regardless.
  if (openEditor && !hasTitle) return null;

  return (
    <>
    <AddMemoryDialog open={addOpen} onOpenChange={setAddOpen} />
    <DownloadBanner />
    <header className="w-full border-b">
      <div className="flex items-center justify-between h-14 px-4">
        <div className="flex items-center gap-3">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-5" />
          {breadcrumb && !hasTitle ? (
            <nav className="hidden sm:flex items-center gap-1 text-sm">
              <button
                onClick={() => { setSelectedCollection("all"); setSelectedTab(null); }}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {displayTitle}
              </button>
              {breadcrumb.map((seg, i) => (
                <React.Fragment key={seg.id}>
                  <span className="text-muted-foreground/50">/</span>
                  {i < breadcrumb.length - 1 ? (
                    <button
                      onClick={() => { setSelectedCollection(seg.id); setSelectedTab(null); }}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {seg.name}
                    </button>
                  ) : (
                    <span className="font-semibold">{seg.name}</span>
                  )}
                </React.Fragment>
              ))}
            </nav>
          ) : (
            <h1 className="text-base font-semibold hidden sm:block">{displayTitle}</h1>
          )}
        </div>

        <div className="flex items-center gap-2">
          {showFilters && (
            <>
              <div className="relative hidden md:block">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder={t("header.searchPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  className="pl-9 w-64 h-9"
                />
              </div>

              <div className="flex items-center border rounded-md p-0.5">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className={cn("rounded-sm", viewMode === "grid" && "bg-muted")}
                  onClick={() => setViewMode("grid")}
                >
                  <LayoutGrid className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className={cn("rounded-sm", viewMode === "list" && "bg-muted")}
                  onClick={() => setViewMode("list")}
                >
                  <List className="size-4" />
                </Button>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="hidden sm:flex">
                    <ArrowUpDown className="size-4" />
                    <span className="hidden lg:inline">{currentSort?.label.split(" ")[0]}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    {t("header.sortBy")}
                  </DropdownMenuLabel>
                  {sortOptions.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      onClick={() => setSortBy(option.value)}
                      className="flex items-center justify-between"
                    >
                      {option.label}
                      {sortBy === option.value && <Check className="size-4" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "hidden sm:flex",
                      filterType !== "all" && "border-primary text-primary"
                    )}
                  >
                    <SlidersHorizontal className="size-4" />
                    <span className="hidden lg:inline">
                      {filterType !== "all" ? currentFilter?.label : t("header.filterBy")}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    {t("header.filterBy")}
                  </DropdownMenuLabel>
                  {filterOptions.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      onClick={() => setFilterType(option.value)}
                      className="flex items-center justify-between"
                    >
                      {option.label}
                      {filterType === option.value && <Check className="size-4" />}
                    </DropdownMenuItem>
                  ))}
                  {filterType !== "all" && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setFilterType("all")}
                        className="text-muted-foreground"
                      >
                        {t("header.clearFilter")}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Single "+" entry point: the frequent "add memory" action sits
                  at the top, document/mindmap/sheet creation folds in below. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" className="hidden sm:flex">
                    <Plus className="size-4" />
                    {t("header.add")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onClick={() => setAddOpen(true)}>
                    <Plus className="size-4 mr-2" />
                    {t("header.addMemory")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleNewDoc}>
                    <FileText className="size-4 mr-2" />
                    {t("header.newDoc")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleNewMindmap}>
                    <Network className="size-4 mr-2" />
                    {t("header.newMindmap")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleNewSheet}>
                    <FileSpreadsheet className="size-4 mr-2 text-emerald-600" />
                    {t("office.new.sheet")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Mobile FAB */}
              <Button
                onClick={() => setAddOpen(true)}
                aria-label={t("header.addMemory")}
                className="sm:hidden fixed right-4 bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] z-40 size-14 rounded-full p-0 shadow-lg shadow-primary/30"
              >
                <Plus className="size-6" />
              </Button>

              <Separator orientation="vertical" className="h-5 hidden sm:block" />
            </>
          )}

          {usage && !usage.hasOwnKeys && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setUsageOpen(true)}
                    className={cn(
                      "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors hover:opacity-80",
                      usage.used >= usage.limit
                        ? "bg-destructive/10 text-destructive"
                        : usage.limit - usage.used <= 3
                          ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                          : "bg-muted text-muted-foreground"
                    )}
                  >
                    <Zap className="size-3" />
                    {usage.used}/{usage.limit}
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("usage.dailyLimit") || `Daily AI limit: ${usage.used}/${usage.limit} used`}</p>
                </TooltipContent>
              </Tooltip>
              <Dialog open={usageOpen} onOpenChange={setUsageOpen}>
                <DialogContent className="sm:max-w-sm">
                  <DialogHeader>
                    <DialogTitle>{t("usage.modalTitle") || "AI Usage"}</DialogTitle>
                    <DialogDescription>{t("usage.modalDesc") || "Your daily AI call usage"}</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{t("usage.used") || "Used"}</span>
                        <span className="font-medium">{usage.used} / {usage.limit}</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            usage.used >= usage.limit
                              ? "bg-destructive"
                              : usage.limit - usage.used <= 3
                                ? "bg-yellow-500"
                                : "bg-primary"
                          )}
                          style={{ width: `${Math.min((usage.used / usage.limit) * 100, 100)}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {usage.used >= usage.limit
                          ? t("usage.exceeded")
                          : (t("usage.remaining") || "{{count}} of {{limit}} free calls remaining")
                              .replace("{{count}}", String(usage.limit - usage.used))
                              .replace("{{limit}}", String(usage.limit))
                        }
                      </p>
                    </div>
                    <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground space-y-1">
                      <p>{t("usage.includes") || "Includes: chat messages, document AI processing"}</p>
                      <p>{t("usage.resets") || "Resets daily at midnight UTC"}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => { setUsageOpen(false); window.location.href = "/settings"; }}
                    >
                      {t("usage.addKey")}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </>
          )}
          <NotificationBell />
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>
    </header>
    </>
  );
}

function DownloadBanner() {
  const { status, downloadProgress, downloadLabel } = useRuntimeStore();
  if (status !== "downloading") return null;

  return (
    <div className="w-full bg-primary/10 border-b px-4 py-1.5 flex items-center gap-3">
      <div className="size-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <div className="flex-1 flex items-center gap-3 text-xs">
        <span className="font-medium text-primary">{downloadLabel}</span>
        <div className="flex-1 max-w-xs h-1.5 rounded-full bg-primary/20 overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-300"
            style={{ width: `${downloadProgress}%` }}
          />
        </div>
        <span className="font-mono text-muted-foreground">{downloadProgress}%</span>
      </div>
    </div>
  );
}
