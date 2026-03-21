import { create } from "zustand";

export type Bookmark = {
  id: string;
  title: string;
  url: string;
  description: string;
  favicon: string;
  collectionId: string;
  tags: string[];
  createdAt: string;
  isFavorite: boolean;
  hasDarkIcon?: boolean;
};

type ViewMode = "grid" | "list";
type SortBy = "date-newest" | "date-oldest" | "alpha-az" | "alpha-za";
type FilterType = "all" | "favorites" | "with-tags" | "without-tags";

/** Map a DB document row to the Bookmark shape used by the UI */
function documentToBookmark(row: Record<string, unknown>): Bookmark {
  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  const tags = (Array.isArray(metadata.tags) ? metadata.tags : []) as string[];
  const categories = (row.categories ?? []) as Array<{ id: string; name: string }>;

  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    url: String(row.url ?? ""),
    description: String(row.summary ?? ""),
    favicon: row.url
      ? `https://www.google.com/s2/favicons?domain=${new URL(String(row.url)).hostname}&sz=64`
      : "",
    collectionId: categories[0]?.id ?? "all",
    tags,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    isFavorite: metadata.isFavorite === true,
  };
}

export interface DerivedTag {
  id: string;
  name: string;
  count: number;
}

interface BookmarksState {
  bookmarks: Bookmark[];
  archivedBookmarks: Bookmark[];
  trashedBookmarks: Bookmark[];
  selectedCollection: string;
  selectedTags: string[];
  searchQuery: string;
  viewMode: ViewMode;
  sortBy: SortBy;
  filterType: FilterType;
  isLoading: boolean;
  error: string | null;
  setSelectedCollection: (collectionId: string) => void;
  toggleTag: (tagId: string) => void;
  clearTags: () => void;
  setSearchQuery: (query: string) => void;
  setViewMode: (mode: ViewMode) => void;
  setSortBy: (sort: SortBy) => void;
  setFilterType: (filter: FilterType) => void;
  toggleFavorite: (bookmarkId: string) => void;
  archiveBookmark: (bookmarkId: string) => void;
  restoreFromArchive: (bookmarkId: string) => void;
  trashBookmark: (bookmarkId: string) => void;
  restoreFromTrash: (bookmarkId: string) => void;
  permanentlyDelete: (bookmarkId: string) => void;
  fetchBookmarks: () => Promise<void>;
  getFilteredBookmarks: () => Bookmark[];
  getFavoriteBookmarks: () => Bookmark[];
  getArchivedBookmarks: () => Bookmark[];
  getTrashedBookmarks: () => Bookmark[];
  getDerivedTags: () => DerivedTag[];
}

export const useBookmarksStore = create<BookmarksState>((set, get) => ({
  bookmarks: [],
  archivedBookmarks: [],
  trashedBookmarks: [],
  selectedCollection: "all",
  selectedTags: [],
  searchQuery: "",
  viewMode: "grid",
  sortBy: "date-newest",
  filterType: "all",
  isLoading: true,
  error: null,

  setSelectedCollection: (collectionId) => set({ selectedCollection: collectionId }),

  toggleTag: (tagId) =>
    set((state) => ({
      selectedTags: state.selectedTags.includes(tagId)
        ? state.selectedTags.filter((t) => t !== tagId)
        : [...state.selectedTags, tagId],
    })),

  clearTags: () => set({ selectedTags: [] }),

  setSearchQuery: (query) => set({ searchQuery: query }),

  setViewMode: (mode) => set({ viewMode: mode }),

  setSortBy: (sort) => set({ sortBy: sort }),

  setFilterType: (filter) => set({ filterType: filter }),

  toggleFavorite: (bookmarkId) => {
    const state = get();
    const bookmark = state.bookmarks.find((b) => b.id === bookmarkId);
    if (!bookmark) return;

    const newValue = !bookmark.isFavorite;

    // Optimistic update
    set({
      bookmarks: state.bookmarks.map((b) =>
        b.id === bookmarkId ? { ...b, isFavorite: newValue } : b
      ),
    });

    // Persist to API (fire-and-forget)
    fetch(`/api/documents/${bookmarkId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: { isFavorite: newValue } }),
    }).catch(() => {
      // Revert on failure
      set((s) => ({
        bookmarks: s.bookmarks.map((b) =>
          b.id === bookmarkId ? { ...b, isFavorite: !newValue } : b
        ),
      }));
    });
  },

  archiveBookmark: (bookmarkId) =>
    set((state) => {
      const bookmark = state.bookmarks.find((b) => b.id === bookmarkId);
      if (!bookmark) return state;
      return {
        bookmarks: state.bookmarks.filter((b) => b.id !== bookmarkId),
        archivedBookmarks: [...state.archivedBookmarks, bookmark],
      };
    }),

  restoreFromArchive: (bookmarkId) =>
    set((state) => {
      const bookmark = state.archivedBookmarks.find((b) => b.id === bookmarkId);
      if (!bookmark) return state;
      return {
        archivedBookmarks: state.archivedBookmarks.filter((b) => b.id !== bookmarkId),
        bookmarks: [...state.bookmarks, bookmark],
      };
    }),

  trashBookmark: (bookmarkId) =>
    set((state) => {
      const bookmark = state.bookmarks.find((b) => b.id === bookmarkId);
      if (!bookmark) return state;
      return {
        bookmarks: state.bookmarks.filter((b) => b.id !== bookmarkId),
        trashedBookmarks: [...state.trashedBookmarks, bookmark],
      };
    }),

  restoreFromTrash: (bookmarkId) =>
    set((state) => {
      const bookmark = state.trashedBookmarks.find((b) => b.id === bookmarkId);
      if (!bookmark) return state;
      return {
        trashedBookmarks: state.trashedBookmarks.filter((b) => b.id !== bookmarkId),
        bookmarks: [...state.bookmarks, bookmark],
      };
    }),

  permanentlyDelete: (bookmarkId) => {
    set((state) => ({
      trashedBookmarks: state.trashedBookmarks.filter((b) => b.id !== bookmarkId),
    }));

    // Hard-delete from DB
    fetch(`/api/documents/${bookmarkId}`, { method: "DELETE" }).catch(() => {});
  },

  fetchBookmarks: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch("/api/documents?limit=100");
      if (!res.ok) {
        set({ isLoading: false, error: res.status === 401 ? null : "Failed to load bookmarks" });
        return;
      }
      const data = await res.json();
      set({
        bookmarks: Array.isArray(data.documents) ? data.documents.map(documentToBookmark) : [],
        isLoading: false,
      });
    } catch {
      set({ isLoading: false, error: "Network error" });
    }
  },

  getFilteredBookmarks: () => {
    const state = get();
    let filtered = [...state.bookmarks];

    if (state.selectedCollection !== "all") {
      filtered = filtered.filter((b) => b.collectionId === state.selectedCollection);
    }

    if (state.selectedTags.length > 0) {
      filtered = filtered.filter((b) =>
        state.selectedTags.some((tag) => b.tags.includes(tag))
      );
    }

    if (state.searchQuery) {
      const query = state.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (b) =>
          b.title.toLowerCase().includes(query) ||
          b.description.toLowerCase().includes(query) ||
          b.url.toLowerCase().includes(query)
      );
    }

    switch (state.filterType) {
      case "favorites":
        filtered = filtered.filter((b) => b.isFavorite);
        break;
      case "with-tags":
        filtered = filtered.filter((b) => b.tags.length > 0);
        break;
      case "without-tags":
        filtered = filtered.filter((b) => b.tags.length === 0);
        break;
    }

    switch (state.sortBy) {
      case "date-newest":
        filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
      case "date-oldest":
        filtered.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        break;
      case "alpha-az":
        filtered.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case "alpha-za":
        filtered.sort((a, b) => b.title.localeCompare(a.title));
        break;
    }

    return filtered;
  },

  getFavoriteBookmarks: () => {
    const state = get();
    let filtered = state.bookmarks.filter((b) => b.isFavorite);

    if (state.searchQuery) {
      const query = state.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (b) =>
          b.title.toLowerCase().includes(query) ||
          b.description.toLowerCase().includes(query) ||
          b.url.toLowerCase().includes(query)
      );
    }

    switch (state.sortBy) {
      case "date-newest":
        filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
      case "date-oldest":
        filtered.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        break;
      case "alpha-az":
        filtered.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case "alpha-za":
        filtered.sort((a, b) => b.title.localeCompare(a.title));
        break;
    }

    return filtered;
  },

  getArchivedBookmarks: () => {
    const state = get();
    let filtered = [...state.archivedBookmarks];

    if (state.searchQuery) {
      const query = state.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (b) =>
          b.title.toLowerCase().includes(query) ||
          b.description.toLowerCase().includes(query) ||
          b.url.toLowerCase().includes(query)
      );
    }

    return filtered;
  },

  getTrashedBookmarks: () => {
    const state = get();
    let filtered = [...state.trashedBookmarks];

    if (state.searchQuery) {
      const query = state.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (b) =>
          b.title.toLowerCase().includes(query) ||
          b.description.toLowerCase().includes(query) ||
          b.url.toLowerCase().includes(query)
      );
    }

    return filtered;
  },

  getDerivedTags: () => {
    const { bookmarks } = get();
    const counts = new Map<string, number>();
    for (const b of bookmarks) {
      for (const tag of b.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ id: name.toLowerCase(), name, count }))
      .sort((a, b) => b.count - a.count);
  },
}));
