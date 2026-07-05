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
  FileText,
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
  Users,
} from "lucide-react";
import { TeamSwitcher } from "./team-switcher";
import { ShareToTeamsDialog } from "./share-to-teams-dialog";
import { Button } from "@/components/ui/button";
import { Input as SidebarInput } from "@/components/ui/input";
import { useMemoryStore } from "@/store/memory-store";
import { useCategoriesStore, type CategoryItem, type CategoryKind } from "@/store/categories-store";
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
  const router = useRouter();
  // The stat tiles LOOK like metric entry points, so make them act like ones:
  // clicking lands on the All Memories list (sorted newest-first) instead of
  // being a dead end that reads as an unfinished feature.
  const goToMemories = React.useCallback(() => {
    const s = useMemoryStore.getState();
    s.setSelectedCollection("all");
    s.clearTags();
    s.setSortBy("date-newest");
    router.push("/");
  }, [router]);
  // Clicking a top-category row scopes the memories list to that collection —
  // same dead-end complaint as the stat tiles, same cure.
  const goToCollection = React.useCallback(
    (categoryId: string) => {
      const s = useMemoryStore.getState();
      s.setSelectedCollection(categoryId);
      s.clearTags();
      router.push("/");
    },
    [router],
  );
  const [insights, setInsights] = React.useState<{
    totalDocuments: number;
    thisWeek: number;
    topCategories: Array<{ id?: string; name: string; count: number }>;
    pendingJobs: number;
  } | null>(null);
  // Change signal: the memory store is refreshed by the SSE stream (see
  // useDocumentEvents) and by user actions, so refetch insights whenever it moves.
  const memories = useMemoryStore((s) => s.memories);

  const loadInsights = React.useCallback(() => {
    fetch("/api/insights")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setInsights(data); })
      .catch(() => {});
  }, []);

  // Refetch on mount and whenever documents change.
  React.useEffect(() => { loadInsights(); }, [loadInsights, memories]);

  // Also refetch on tab refocus and on a slow interval — catches changes that
  // don't emit an SSE event (e.g. direct DB edits) so the counts don't go stale.
  React.useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") loadInsights(); };
    document.addEventListener("visibilitychange", onVisible);
    const interval = setInterval(loadInsights, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    };
  }, [loadInsights]);

  if (!insights) return null;

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
      <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
        {t("insights.title")}
      </h4>
      <div className="grid grid-cols-2 gap-2 text-center">
        <button
          type="button"
          onClick={goToMemories}
          className="rounded-md bg-background p-2 cursor-pointer hover:bg-accent transition-colors"
        >
          <div className="text-lg font-bold">{insights.totalDocuments}</div>
          <div className="text-[10px] text-muted-foreground">{t("insights.total")}</div>
        </button>
        <button
          type="button"
          onClick={goToMemories}
          className="rounded-md bg-background p-2 cursor-pointer hover:bg-accent transition-colors"
        >
          <div className="text-lg font-bold text-primary">+{insights.thisWeek}</div>
          <div className="text-[10px] text-muted-foreground">{t("insights.thisWeek")}</div>
        </button>
      </div>
      {insights.topCategories.length > 0 && (
        <div className="space-y-1">
          {insights.topCategories.map((cat) =>
            cat.id ? (
              <button
                key={cat.id}
                type="button"
                onClick={() => goToCollection(cat.id!)}
                className="flex w-full items-center justify-between text-xs cursor-pointer rounded-sm px-1 -mx-1 py-0.5 hover:bg-accent transition-colors"
              >
                <span className="truncate text-muted-foreground">{cat.name}</span>
                <span className="text-muted-foreground/60 shrink-0">{cat.count}</span>
              </button>
            ) : (
              <div key={cat.name} className="flex items-center justify-between text-xs">
                <span className="truncate text-muted-foreground">{cat.name}</span>
                <span className="text-muted-foreground/60 shrink-0">{cat.count}</span>
              </div>
            ),
          )}
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
  depth: number;
  kind: CategoryKind;
  getChildren: (parentId: string) => CategoryItem[];
  isHomePage: boolean;
  selectedCollection: string;
  onSelect: (category: CategoryItem) => void;
  renamingId: string | null;
  setRenamingId: (id: string | null) => void;
  renameValue: string;
  setRenameValue: (v: string) => void;
  renameCategory: (id: string, name: string) => Promise<boolean>;
  deleteCategory: (id: string) => Promise<boolean>;
  onCreateContent: (type: "doc" | "mindmap", categoryId: string) => void;
  onCreateSubfolder: (parentId: string) => void;
  t: (key: string) => string;
}

function FolderItem({
  category,
  depth,
  kind,
  getChildren,
  isHomePage,
  selectedCollection,
  onSelect,
  renamingId,
  setRenamingId,
  renameValue,
  setRenameValue,
  renameCategory,
  deleteCategory,
  onCreateContent,
  onCreateSubfolder,
  t,
}: FolderItemProps) {
  const router = useRouter();
  const isActive = isHomePage && selectedCollection === category.id;
  const isRenaming = renamingId === category.id;
  const children = getChildren(category.id);
  const [teamShareOpen, setTeamShareOpen] = React.useState(false);

  const renderChildren = () =>
    children.map((child) => (
      <FolderItem
        key={child.id}
        category={child}
        depth={depth + 1}
        kind={kind}
        getChildren={getChildren}
        isHomePage={isHomePage}
        selectedCollection={selectedCollection}
        onSelect={onSelect}
        renamingId={renamingId}
        setRenamingId={setRenamingId}
        renameValue={renameValue}
        setRenameValue={setRenameValue}
        renameCategory={renameCategory}
        deleteCategory={deleteCategory}
        onCreateContent={onCreateContent}
        onCreateSubfolder={onCreateSubfolder}
        t={t}
      />
    ));

  if (isRenaming) {
    return (
      <>
        <SidebarMenuItem>
          <form
            className="flex items-center gap-1 px-2 py-1"
            style={{ paddingLeft: depth > 0 ? `${depth * 12}px` : undefined }}
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
        {renderChildren()}
      </>
    );
  }

  return (
    <>
    <SidebarMenuItem className="group/cat">
      <SidebarMenuButton
        asChild
        isActive={isActive}
        className="h-[38px]"
      >
        <Link
          href="/"
          style={{ paddingLeft: depth > 0 ? `${depth * 12}px` : undefined }}
          onClick={(e) => {
            e.preventDefault();
            onSelect(category);
            // Client-side nav (not a full reload) so the persistent shell layout
            // survives — the sidebar stays mounted and only the content swaps.
            if (!isHomePage) router.push("/");
          }}
        >
          <Folder className="size-5" />
          <span className="flex-1 truncate">{category.name}</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
              <button className="opacity-0 group-hover/cat:opacity-100 p-0.5 rounded hover:bg-muted transition-opacity shrink-0" title={t("sidebar.newSubfolder")}>
                <Plus className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {(kind === "collection" || kind === "doc") && (
                <DropdownMenuItem onClick={() => onCreateContent("doc", category.id)}>
                  <FileText className="size-3.5 mr-2" />
                  {t("sidebar.newDocument")}
                </DropdownMenuItem>
              )}
              {(kind === "collection" || kind === "mindmap") && (
                <DropdownMenuItem onClick={() => onCreateContent("mindmap", category.id)}>
                  <Network className="size-3.5 mr-2" />
                  {t("sidebar.newMindmap")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onCreateSubfolder(category.id)}>
                <Folder className="size-3.5 mr-2" />
                {t("sidebar.newSubfolder")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
              <DropdownMenuItem onClick={() => setTeamShareOpen(true)}>
                <Users className="size-3.5 mr-2" />
                {t("memory.shareWithTeams")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={async () => {
                  const ok = await deleteCategory(category.id);
                  if (ok) {
                    toast.success(t("sidebar.deleted"));
                    if (selectedCollection === category.id) {
                      useMemoryStore.getState().setSelectedCollection("all");
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
    <ShareToTeamsDialog
      open={teamShareOpen}
      onOpenChange={setTeamShareOpen}
      memoryId={category.id}
      memoryName={category.name}
      resourceType="category"
    />
    {renderChildren()}
    </>
  );
}

/**
 * A folder-tree sidebar section, sibling to COLLECTIONS. Used for the
 * Documents and Mind maps namespaces (kind="doc" | "mindmap"). Folders are
 * categories scoped to this kind; adding a folder reuses the collection logic
 * (addCategory with kind). Selecting a folder scopes the main list to this
 * type via the store. Manages its own collapse / rename / add-root state.
 */
function CategorySection({
  kind,
  label,
  roots,
  getChildren,
  isHomePage,
  selectedCollection,
  onSelect,
  onCreateContent,
  addCategory,
  renameCategory,
  deleteCategory,
  t,
}: {
  kind: CategoryKind;
  label: string;
  roots: CategoryItem[];
  getChildren: (parentId: string) => CategoryItem[];
  isHomePage: boolean;
  selectedCollection: string;
  onSelect: (category: CategoryItem) => void;
  onCreateContent: (type: "doc" | "mindmap", categoryId: string) => void;
  addCategory: (name: string, parentId?: string, kind?: CategoryKind) => Promise<string | null>;
  renameCategory: (id: string, name: string) => Promise<boolean>;
  deleteCategory: (id: string) => Promise<boolean>;
  t: (key: string) => string;
}) {
  const [open, setOpen] = React.useState(true);
  const [adding, setAdding] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState("");

  // Subfolders inherit the parent's kind in createCategory, so no kind arg here.
  const handleCreateSubfolder = async (parentId: string) => {
    const id = await addCategory(t("sidebar.folder"), parentId);
    if (id) {
      setRenamingId(id);
      setRenameValue(t("sidebar.folder"));
    } else {
      toast.error(t("sidebar.createFailed"));
    }
  };

  return (
    <SidebarGroup className="p-0">
      <SidebarGroupLabel className="flex items-center gap-1.5 px-0 text-xs font-bold tracking-wider text-foreground/75">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 cursor-pointer">
          <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
          {label}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setAdding(true); setOpen(true); }}
          className="ml-auto text-muted-foreground hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
      </SidebarGroupLabel>
      {open && (
        <SidebarGroupContent>
          <SidebarMenu className="mt-2">
            {roots.map((cat) => (
              <FolderItem
                key={cat.id}
                category={cat}
                depth={0}
                kind={kind}
                getChildren={getChildren}
                isHomePage={isHomePage}
                selectedCollection={selectedCollection}
                onSelect={onSelect}
                renamingId={renamingId}
                setRenamingId={setRenamingId}
                renameValue={renameValue}
                setRenameValue={setRenameValue}
                renameCategory={renameCategory}
                deleteCategory={deleteCategory}
                onCreateContent={onCreateContent}
                onCreateSubfolder={handleCreateSubfolder}
                t={t}
              />
            ))}

            {adding && (
              <SidebarMenuItem>
                <form
                  className="flex items-center gap-1 px-2 py-1"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const trimmed = newName.trim();
                    if (trimmed) {
                      const id = await addCategory(trimmed, undefined, kind);
                      if (!id) toast.error(t("sidebar.createFailed"));
                    }
                    setNewName("");
                    setAdding(false);
                  }}
                >
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                  <SidebarInput
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder={t("sidebar.newCategoryPlaceholder")}
                    className="h-7 text-sm"
                    autoFocus
                    onBlur={() => { setAdding(false); setNewName(""); }}
                    onKeyDown={(e) => { if (e.key === "Escape") { setAdding(false); setNewName(""); } }}
                  />
                </form>
              </SidebarMenuItem>
            )}

            {roots.length === 0 && !adding && (
              <p className="px-3 py-1 text-xs text-muted-foreground">{t("sidebar.emptyList")}</p>
            )}
          </SidebarMenu>
        </SidebarGroupContent>
      )}
    </SidebarGroup>
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
    selectFolder,
    setOpenEditor,
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
    getRootCategoriesByKind,
    getChildren,
  } = useCategoriesStore();
  const [addingCategory, setAddingCategory] = React.useState(false);
  const [newCategoryName, setNewCategoryName] = React.useState("");
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState("");
  const { data: session } = useSession();
  const { t } = useTranslation();
  const isHomePage = pathname === "/";

  // Create a doc / mind map inside a collection, then open it in place.
  const handleCreateContent = React.useCallback(
    async (type: "doc" | "mindmap", categoryId: string) => {
      try {
        const res = await fetch("/api/docs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, categoryId }),
        });
        if (!res.ok) {
          toast.error(t("sidebar.createFailed"));
          return;
        }
        const { id } = (await res.json()) as { id: string };
        if (!isHomePage) {
          router.push(type === "mindmap" ? `/mindmaps/${id}` : `/docs/${id}`);
        } else {
          setOpenEditor({ type, id });
        }
      } catch {
        toast.error(t("sidebar.createFailed"));
      }
    },
    [router, t, isHomePage, setOpenEditor],
  );

  // Create a child collection and drop straight into rename mode.
  const handleCreateSubfolder = React.useCallback(
    async (parentId: string) => {
      const newId = await addCategory(t("sidebar.folder"), parentId);
      if (newId) {
        setRenamingId(newId);
        setRenameValue(t("sidebar.folder"));
      } else {
        toast.error(t("sidebar.createFailed"));
      }
    },
    [addCategory, t],
  );

  // Folder selection: collections show all memories; doc/mind-map folders
  // scope the main list to that document type.
  const handleSelectCollection = React.useCallback(
    (cat: CategoryItem) => { setSelectedCollection(cat.id); clearTags(); },
    [setSelectedCollection, clearTags],
  );
  const handleSelectDoc = React.useCallback(
    (cat: CategoryItem) => { selectFolder(cat.id, "doc"); clearTags(); },
    [selectFolder, clearTags],
  );
  const handleSelectMindmap = React.useCallback(
    (cat: CategoryItem) => { selectFolder(cat.id, "mindmap"); clearTags(); },
    [selectFolder, clearTags],
  );

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

  const rootCategories = getRootCategoriesByKind("collection");
  const docRoots = getRootCategoriesByKind("doc");
  const mindmapRoots = getRootCategoriesByKind("mindmap");

  const userName = session?.user?.name ?? session?.user?.email ?? "";
  const userInitials = userName.slice(0, 2).toUpperCase() || "??";

  return (
    <Sidebar collapsible="offcanvas" className="lg:border-r-0!" {...props}>
      <SidebarHeader className="p-5 pb-0">
        <div className="flex items-center justify-between">
          <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
            <DialogTrigger asChild>
              <button
                className="flex items-center gap-2 outline-none cursor-pointer"
                aria-label={t("sidebar.accountSettings")}
              >
                <Avatar className="size-7">
                  <AvatarFallback>{userInitials}</AvatarFallback>
                </Avatar>
                <ChevronDown className="size-3 text-muted-foreground" />
              </button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <img src="/logo-icon.png" alt="" className="size-6 rounded-lg shrink-0" />
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
            <TeamSwitcher />
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-5 pt-5">
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder={t("sidebar.searchPlaceholder")}
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            className="pl-9 pr-10 h-9 bg-background"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 bg-muted px-1.5 py-0.5 rounded text-[11px] text-muted-foreground font-medium">
            ⌘K
          </div>
        </div>

        <SidebarGroup className="p-0">
          <SidebarGroupLabel className="flex items-center gap-1.5 px-0 text-xs font-bold tracking-wider text-foreground/75">
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
                    depth={0}
                    kind="collection"
                    getChildren={getChildren}
                    isHomePage={isHomePage}
                    selectedCollection={selectedCollection}
                    onSelect={handleSelectCollection}
                    renamingId={renamingId}
                    setRenamingId={setRenamingId}
                    renameValue={renameValue}
                    setRenameValue={setRenameValue}
                    renameCategory={renameCategory}
                    deleteCategory={deleteCategory}
                    onCreateContent={handleCreateContent}
                    onCreateSubfolder={handleCreateSubfolder}
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

        <CategorySection
          kind="doc"
          label={t("sidebar.documents")}
          roots={docRoots}
          getChildren={getChildren}
          isHomePage={isHomePage}
          selectedCollection={selectedCollection}
          onSelect={handleSelectDoc}
          onCreateContent={handleCreateContent}
          addCategory={addCategory}
          renameCategory={renameCategory}
          deleteCategory={deleteCategory}
          t={t}
        />

        <CategorySection
          kind="mindmap"
          label={t("sidebar.mindmaps")}
          roots={mindmapRoots}
          getChildren={getChildren}
          isHomePage={isHomePage}
          selectedCollection={selectedCollection}
          onSelect={handleSelectMindmap}
          onCreateContent={handleCreateContent}
          addCategory={addCategory}
          renameCategory={renameCategory}
          deleteCategory={deleteCategory}
          t={t}
        />

        <SidebarGroup className="p-0">
          <SidebarGroupLabel className="flex items-center gap-1.5 px-0 text-xs font-bold tracking-wider text-foreground/75">
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
