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
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  Bookmark,
  ChevronDown,
  ChevronRight,
  Search,
  Settings,
  Globe,
  Plus,
  Check,
  User,
  LogOut,
  Folder,
  Star,
  Tag,
  Archive,
  Trash2,
  MessageSquare,
  Network,
  LayoutGrid,
} from "lucide-react";
import { useBookmarksStore } from "@/store/bookmarks-store";
import { useCategoriesStore } from "@/store/categories-store";
import { useSession, signOut } from "@/lib/auth-client";
import { useTranslation } from "@/lib/i18n";

const navItemKeys = [
  { icon: Star, key: "sidebar.favorites", href: "/favorites" },
  { icon: Archive, key: "sidebar.archive", href: "/archive" },
  { icon: Trash2, key: "sidebar.trash", href: "/trash" },
];

const toolNavItems = [
  { icon: MessageSquare, key: "sidebar.chat", href: "/chat" },
  { icon: Network, key: "sidebar.knowledge", href: "/knowledge" },
  { icon: LayoutGrid, key: "sidebar.categories", href: "/categories" },
];

export function BookmarksSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  const router = useRouter();
  const [collectionsOpen, setCollectionsOpen] = React.useState(true);
  const [tagsOpen, setTagsOpen] = React.useState(true);
  const {
    selectedCollection,
    setSelectedCollection,
    selectedTags,
    toggleTag,
    clearTags,
    getDerivedTags,
    fetchBookmarks,
  } = useBookmarksStore();
  const { categories, fetchCategories } = useCategoriesStore();
  const { data: session } = useSession();
  const { t } = useTranslation();

  React.useEffect(() => {
    fetchBookmarks();
    fetchCategories();
  }, [fetchBookmarks, fetchCategories]);

  const derivedTags = getDerivedTags();

  // Build collection list: "All" virtual entry + real categories
  const collectionList = React.useMemo(() => [
    { id: "all", name: t("sidebar.allBookmarks") || "All Bookmarks", count: null },
    ...categories.map((c) => ({ id: c.id, name: c.name, count: null })),
  ], [categories, t]);

  // User display info from session
  const userName = session?.user?.name ?? session?.user?.email ?? "";
  const userInitials = userName.slice(0, 2).toUpperCase() || "??";

  const isHomePage = pathname === "/";

  return (
    <Sidebar collapsible="offcanvas" className="lg:border-r-0!" {...props}>
      <SidebarHeader className="p-5 pb-0">
        <div className="flex items-center justify-between">
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2 outline-none">
              <div className="size-7 rounded-full overflow-hidden bg-linear-to-br from-blue-400 via-indigo-500 to-violet-500 flex items-center justify-center ring-1 ring-white/40 shadow-lg" />
              <span className="font-medium text-muted-foreground">
                {t("app.title")}
              </span>
              <ChevronDown className="size-3 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel className="text-muted-foreground text-xs font-medium">
                {t("sidebar.workspaces")}
              </DropdownMenuLabel>
              <DropdownMenuItem>
                <div className="size-5 rounded-full bg-linear-to-br from-blue-400 via-indigo-500 to-violet-500 mr-2" />
                {userName || t("app.title")}
                <Check className="size-4 ml-auto" />
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem>
                <Plus className="size-4 mr-2" />
                {t("sidebar.createWorkspace")}
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem>
                <User className="size-4 mr-2" />
                {t("sidebar.accountSettings")}
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Settings className="size-4 mr-2" />
                {t("sidebar.workspaceSettings")}
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                className="text-destructive"
                onClick={async () => {
                  await signOut();
                  router.push("/login");
                }}
              >
                <LogOut className="size-4 mr-2" />
                {t("sidebar.logOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Avatar className="size-6.5">
            <AvatarFallback>{userInitials}</AvatarFallback>
          </Avatar>
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
          </SidebarGroupLabel>
          {collectionsOpen && (
            <SidebarGroupContent>
              <SidebarMenu className="mt-2">
                {collectionList.map((collection) => {
                  const isActive =
                    isHomePage && selectedCollection === collection.id;
                  const IconComponent = collection.id === "all" ? Bookmark : Folder;
                  return (
                    <SidebarMenuItem key={collection.id}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        className="h-[38px]"
                      >
                        <Link
                          href="/"
                          onClick={() => {
                            setSelectedCollection(collection.id);
                            clearTags();
                          }}
                        >
                          <IconComponent className="size-5" />
                          <span className="flex-1">{collection.name}</span>
                          {isActive && (
                            <ChevronRight className="size-4 text-muted-foreground opacity-60" />
                          )}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
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
                  <p className="text-xs text-muted-foreground px-1">No tags yet</p>
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
              {navItemKeys.map((item) => (
                <SidebarMenuItem key={item.key}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.href}
                    className="h-[38px]"
                  >
                    <Link href={item.href}>
                      <item.icon className="size-5" />
                      <span>{t(item.key)}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="p-0">
          <SidebarGroupLabel className="px-0 text-[10px] font-semibold tracking-wider text-muted-foreground">
            TOOLS
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="mt-1">
              {toolNavItems.map((item) => (
                <SidebarMenuItem key={item.key}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.href}
                    className="h-[38px]"
                  >
                    <Link href={item.href}>
                      <item.icon className="size-5" />
                      <span>{t(item.key)}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === "/settings"}
                  className="h-[38px]"
                >
                  <Link href="/settings">
                    <Settings className="size-5" />
                    <span>{t("sidebar.settings")}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="px-5 pb-5">
        <div className="inline-flex items-center justify-center gap-2 h-9 px-4 rounded-md border border-border bg-background shadow-xs text-sm font-medium w-full text-muted-foreground">
          <Globe className="size-4" />
          {t("app.title")} v0.1.0
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
