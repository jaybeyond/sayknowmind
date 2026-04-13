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
import { useRuntimeStore } from "@/store/runtime-store";

interface MemoryHeaderProps {
  title?: string;
  showFilters?: boolean;
}

export function MemoryHeader({ title, showFilters = true }: MemoryHeaderProps) {
  const [addOpen, setAddOpen] = React.useState(false);
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

  // Daily usage limit
  const [usage, setUsage] = React.useState<{ used: number; limit: number; hasOwnKeys: boolean } | null>(null);
  React.useEffect(() => {
    fetch("/api/usage").then((r) => r.ok ? r.json() : null).then((data) => {
      if (data) setUsage({ used: data.used, limit: data.limit, hasOwnKeys: data.hasOwnKeys });
    }).catch(() => {});
  }, []);

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

  return (
    <>
    <AddMemoryDialog open={addOpen} onOpenChange={setAddOpen} />
    <DownloadBanner />
    <header className="w-full border-b">
      <div className="flex items-center justify-between h-14 px-4">
        <div className="flex items-center gap-3">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-5" />
          {breadcrumb ? (
            <nav className="hidden sm:flex items-center gap-1 text-sm">
              <button
                onClick={() => { setSelectedCollection("all"); setSelectedTab(null); }}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {title ?? t("header.memory")}
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
            <h1 className="text-base font-semibold hidden sm:block">{title ?? t("header.memory")}</h1>
          )}
        </div>

        <div className="flex items-center gap-2">
          {showFilters && (
            <>
              <div className="relative hidden md:block">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  placeholder={t("header.searchPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
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

              <Button size="sm" className="hidden sm:flex" onClick={() => setAddOpen(true)}>
                <Plus className="size-4" />
                {t("header.addMemory")}
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
                    {usage.limit - usage.used}/{usage.limit}
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
