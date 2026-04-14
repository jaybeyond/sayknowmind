"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  Brain,
  ChevronDown,
  Search,
  Settings,
  Globe,
  Plus,
  User,
  LogOut,
  Folder,
  Star,
  Tag,
  Archive,
  Trash2,
  MessageSquare,
  Network,
  MoreHorizontal,
  Pencil,
  X,
  Share2,
} from "lucide-react";
import { NotificationBell } from "./notification-bell";
import { Button } from "@/components/ui/button";
import { Input as SidebarInput } from "@/components/ui/input";
import { useMemoryStore } from "@/store/memory-store";
import { useCategoriesStore, type CategoryItem } from "@/store/categories-store";
import { useSession, signOut } from "@/lib/auth-client";
import { useTranslation } from "@/lib/i18n";
import { useDocumentEvents } from "@/lib/use-document-events";
import { toast } from "sonner";

const navItemKeys = [
  { icon: Star, key: "sidebar.favorites", href: "/favorites" },
  { icon: Archive, key: "sidebar.archive", href: "/archive" },
  { icon: Trash2, key: "sidebar.trash", href: "/trash" },
  { icon: MessageSquare, key: "sidebar.chat", href: "/chat" },
  { icon: Network, key: "sidebar.knowledge", href: "/knowledge" },
  { icon: Share2, key: "sidebar.published", href: "/published" },
  { icon: Settings, key: "sidebar.settings", href: "/settings" },
];

function InsightsWidget() {
  const { t } = useTranslation();
  const [insights, setInsights] = React.useState<{
    totalDocuments: number;
    thisWeek: number;
    topCategories: Array<{ name: string; count: number }>;
    pendingJobs: number;
  } | null>(null);

  React.useEffect(() => {
    fetch("/api/insights")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setInsights(data); })
      .catch(() => {});
  }, []);

  if (!insights) return null;

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
      <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
        {t("insights.title")}
      </h4>
      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-md bg-background p-2">
          <div className="text-lg font-bold">{insights.totalDocuments}</div>
          <div className="text-[10px] text-muted-foreground">{t("insights.total")}</div>
        </div>
        <div className="rounded-md bg-background p-2">
          <div className="text-lg font-bold text-primary">+{insights.thisWeek}</div>
          <div className="text-[10px] text-muted-foreground">{t("insights.thisWeek")}</div>
        </div>
      </div>
      {insights.topCategories.length > 0 && (
        <div className="space-y-1">
          {insights.topCategories.map((cat) => (
            <div key={cat.name} className="flex items-center justify-between text-xs">
              <span className="truncate text-muted-foreground">{cat.name}</span>
              <span className="text-muted-foreground/60 shrink-0">{cat.count}</span>
            </div>
          ))}
        </div>
      )}
      {insights.pendingJobs > 0 && (
        <div className="text-[10px] text-muted-foreground/60 text-center">
          {insights.pendingJobs} {t("insights.processing")}
        </div>
      )}
    </div>
  );
}

interface FolderItemProps {
  category: CategoryItem;
  isHomePage: boolean;
  selectedCollection: string;
  setSelectedCollection: (id: string) => void;
  clearTags: () => void;
  renamingId: string | null;
  setRenamingId: (id: string | null) => void;
  renameValue: string;
  setRenameValue: (v: string) => void;
  renameCategory: (id: string, name: string) => Promise<boolean>;
  deleteCategory: (id: string) => Promise<boolean>;
  t: (key: string) => string;
}

function FolderItem({
  category,
  isHomePage,
  selectedCollection,
  setSelectedCollection,
  clearTags,
  renamingId,
  setRenamingId,
  renameValue,
  setRenameValue,
  renameCategory,
  deleteCategory,
  t,
}: FolderItemProps) {
  const isActive = isHomePage && selectedCollection === category.id;
  const isRenaming = renamingId === category.id;

  if (isRenaming) {
    return (
      <SidebarMenuItem>
        <form
          className="flex items-center gap-1 px-2 py-1"
          onSubmit={async (e) => {
            e.preventDefault();
            const trimmed = renameValue.trim();
            if (trimmed && trimmed !== category.name) {
              const ok = await renameCategory(category.id, trimmed);
              if (ok) toast.success(t("sidebar.renamed"));
              else toast.error(t("sidebar.renameFailed"));
            }
            setRenamingId(null);
          }}
        >
          <Folder className="size-4 shrink-0 text-muted-foreground" />
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            className="h-7 text-sm"
            autoFocus
            onBlur={() => setRenamingId(null)}
            onKeyDown={(e) => { if (e.key === "Escape") setRenamingId(null); }}
          />
        </form>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem className="group/cat">
      <SidebarMenuButton
        asChild
        isActive={isActive}
        className="h-[38px]"
      >
        <Link
          href="/"
          onClick={(e) => {
            e.preventDefault();
            setSelectedCollection(category.id);
            clearTags();
            if (!isHomePage) window.location.href = "/";
          }}
        >
          <Folder className="size-5" />
          <span className="flex-1 truncate">{category.name}</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
              <button className="opacity-0 group-hover/cat:opacity-100 p-0.5 rounded hover:bg-muted transition-opacity shrink-0">
                <MoreHorizontal className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => {
                setRenamingId(category.id);
                setRenameValue(category.name);
              }}>
                <Pencil className="size-3.5 mr-2" />
                {t("sidebar.rename")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={async () => {
                  const ok = await deleteCategory(category.id);
                  if (ok) {
                    toast.success(t("sidebar.deleted"));
                    if (selectedCollection === category.id) {
                      setSelectedCollection("all");
                    }
                  } else {
                    toast.error(t("sidebar.deleteFailed"));
                  }
                }}
              >
                <Trash2 className="size-3.5 mr-2" />
                {t("common.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function MemorySidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  const router = useRouter();
  const [collectionsOpen, setCollectionsOpen] = React.useState(true);
  const [tagsOpen, setTagsOpen] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const {
    selectedCollection,
    setSelectedCollection,
    selectedTags,
    toggleTag,
    clearTags,
    getDerivedTags,
    fetchMemories,
  } = useMemoryStore();
  const {
    categories,
    fetchCategories,
    addCategory,
    renameCategory,
    deleteCategory,
    getRootCategories,
  } = useCategoriesStore();
  const [addingCategory, setAddingCategory] = React.useState(false);
  const [newCategoryName, setNewCategoryName] = React.useState("");
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState("");
  const { data: session } = useSession();
  const { t } = useTranslation();

  // SSE: real-time document updates (replaces aggressive polling)
  useDocumentEvents();

  React.useEffect(() => {
    fetchMemories();
    fetchCategories();

    // Refresh when tab becomes visible again (replaces aggressive 30s polling)
    let lastFetch = Date.now();
    const REFRESH_INTERVAL = 120_000; // 2 min minimum between refreshes

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && Date.now() - lastFetch > REFRESH_INTERVAL) {
        lastFetch = Date.now();
        fetchMemories();
        fetchCategories();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [fetchMemories, fetchCategories]);

  const derivedTags = getDerivedTags();

  const rootCategories = getRootCategories();

  const userName = session?.user?.name ?? session?.user?.email ?? "";
  const userInitials = userName.slice(0, 2).toUpperCase() || "??";

  const isHomePage = pathname === "/";

  return (
    <Sidebar collapsible="offcanvas" className="lg:border-r-0!" {...props}>
      <SidebarHeader className="p-5 pb-0">
        <div className="flex items-center justify-between">
          <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
            <DialogTrigger asChild>
              <button className="flex items-center gap-2 outline-none cursor-pointer">
                <img src="/app-icon.png" alt="SayknowMind" className="size-7 rounded-lg" />
                <ChevronDown className="size-3 text-muted-foreground" />
              </button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <img src="/app-icon.png" alt="" className="size-6 rounded-lg shrink-0" />
                  {userName || t("app.title")}
                </DialogTitle>
                <DialogDescription>{t("app.subtitle")}</DialogDescription>
              </DialogHeader>
              <div className="space-y-1 pt-2">
                <button
                  className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm hover:bg-muted transition-colors text-left"
                  onClick={() => {
                    setMenuOpen(false);
                    setAddingCategory(true);
                    setCollectionsOpen(true);
                  }}
                >
                  <Plus className="size-4 text-muted-foreground" />
                  {t("categories.create")}
                </button>
                <button
                  className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm hover:bg-muted transition-colors text-left"
                  onClick={() => { setMenuOpen(false); router.push("/settings"); }}
                >
                  <User className="size-4 text-muted-foreground" />
                  {t("sidebar.accountSettings")}
                </button>
                <button
                  className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm hover:bg-muted transition-colors text-left"
                  onClick={() => { setMenuOpen(false); router.push("/settings"); }}
                >
                  <Settings className="size-4 text-muted-foreground" />
                  {t("sidebar.settings")}
                </button>
                <div className="border-t my-2" />
                <button
                  className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm hover:bg-muted transition-colors text-left text-destructive"
                  onClick={async () => {
                    setMenuOpen(false);
                    await signOut();
                    router.push("/login");
                  }}
                >
                  <LogOut className="size-4" />
                  {t("sidebar.logOut")}
                </button>
              </div>
            </DialogContent>
          </Dialog>
          <div className="flex items-center gap-1">
            <NotificationBell />
            <Avatar className="size-6.5">
              <AvatarFallback>{userInitials}</AvatarFallback>
            </Avatar>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-5 pt-5">
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder={t("sidebar.searchPlaceholder")}
            className="pl-9 pr-10 h-9 bg-background"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 bg-muted px-1.5 py-0.5 rounded text-[11px] text-muted-foreground font-medium">
            ⌘K
          </div>
        </div>

        <SidebarGroup className="p-0">
          <SidebarGroupLabel className="flex items-center gap-1.5 px-0 text-[10px] font-semibold tracking-wider text-muted-foreground">
            <button
              onClick={() => setCollectionsOpen(!collectionsOpen)}
              className="flex items-center gap-1.5 cursor-pointer"
            >
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform",
                  !collectionsOpen && "-rotate-90"
                )}
              />
              {t("sidebar.collections")}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setAddingCategory(true);
                setCollectionsOpen(true);
              }}
              className="ml-auto text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-3.5" />
            </button>
          </SidebarGroupLabel>
          {collectionsOpen && (
            <SidebarGroupContent>
              <SidebarMenu className="mt-2">
                {/* All Memories */}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={isHomePage && selectedCollection === "all"}
                    className="h-[38px]"
                  >
                    <Link
                      href="/"
                      onClick={() => {
                        setSelectedCollection("all");
                        clearTags();
                      }}
                    >
                      <Brain className="size-5" />
                      <span className="flex-1">{t("sidebar.allMemories")}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                {/* Recursive folder tree */}
                {rootCategories.map((cat) => (
                  <FolderItem
                    key={cat.id}
                    category={cat}
                    isHomePage={isHomePage}
                    selectedCollection={selectedCollection}
                    setSelectedCollection={setSelectedCollection}
                    clearTags={clearTags}
                    renamingId={renamingId}
                    setRenamingId={setRenamingId}
                    renameValue={renameValue}
                    setRenameValue={setRenameValue}
                    renameCategory={renameCategory}
                    deleteCategory={deleteCategory}
                    t={t}
                  />
                ))}

                {/* Add root folder */}
                {addingCategory && (
                  <SidebarMenuItem>
                    <form
                      className="flex items-center gap-1 px-2 py-1"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const trimmed = newCategoryName.trim();
                        if (trimmed) {
                          const newId = await addCategory(trimmed);
                          if (newId) {
                            toast.success(t("sidebar.categoryCreated"));
                            setSelectedCollection(newId);
                            clearTags();
                          } else {
                            toast.error(t("sidebar.createFailed"));
                          }
                        }
                        setNewCategoryName("");
                        setAddingCategory(false);
                      }}
                    >
                      <Plus className="size-4 shrink-0 text-muted-foreground" />
                      <SidebarInput
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        placeholder={t("sidebar.newCategoryPlaceholder")}
                        className="h-7 text-sm"
                        autoFocus
                        onBlur={() => { setAddingCategory(false); setNewCategoryName(""); }}
                        onKeyDown={(e) => { if (e.key === "Escape") { setAddingCategory(false); setNewCategoryName(""); } }}
                      />
                    </form>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          )}
        </SidebarGroup>

        <SidebarGroup className="p-0">
          <SidebarGroupLabel className="flex items-center gap-1.5 px-0 text-[10px] font-semibold tracking-wider text-muted-foreground">
            <button
              onClick={() => setTagsOpen(!tagsOpen)}
              className="flex items-center gap-1.5 cursor-pointer"
            >
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform",
                  !tagsOpen && "-rotate-90"
                )}
              />
              {t("sidebar.tags")}
            </button>
            {selectedTags.length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  clearTags();
                }}
                className="ml-auto text-[10px] text-muted-foreground hover:text-foreground"
              >
                {t("sidebar.clearTags")}
              </button>
            )}
          </SidebarGroupLabel>
          {tagsOpen && (
            <SidebarGroupContent>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {derivedTags.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-1">{t("sidebar.noTags")}</p>
                ) : (
                  derivedTags.map((tag) => (
                    <button
                      key={tag.id}
                      onClick={() => toggleTag(tag.id)}
                      className={cn(
                        "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors",
                        selectedTags.includes(tag.id)
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/60 text-muted-foreground hover:bg-muted"
                      )}
                    >
                      <Tag className="size-3" />
                      {tag.name}
                    </button>
                  ))
                )}
              </div>
            </SidebarGroupContent>
          )}
        </SidebarGroup>

        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            <SidebarMenu>
              {/* Shared Gallery — inline in content area */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={isHomePage && selectedCollection === "gallery"}
                  className="h-8 cursor-pointer"
                  onClick={() => {
                    if (!isHomePage) router.push("/");
                    setSelectedCollection("gallery");
                    clearTags();
                  }}
                >
                  <Globe className="size-4" />
                  <span className="text-sm">{t("sidebar.gallery")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {navItemKeys.map((item) => (
                <SidebarMenuItem key={item.key}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.href}
                    className="h-8"
                  >
                    <Link href={item.href}>
                      <item.icon className="size-4" />
                      <span className="text-sm">{t(item.key)}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="px-5 pb-5 space-y-3">
        <InsightsWidget />
        <div className="inline-flex items-center justify-center gap-2 h-9 px-4 rounded-md border border-border bg-background shadow-xs text-sm font-medium w-full text-muted-foreground">
          <Globe className="size-4" />
          {t("app.title")} v0.1.0
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
